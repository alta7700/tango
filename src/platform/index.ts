import type { GameContainer } from '../shared/container';

type Reward = Awaited<ReturnType<GameContainer['requestHintReward']>>;
type AdCallbacks = { onOpen(): void; onClose(wasShown: boolean): void; onError(error?: object): void; onRewarded?(): void };
/** Используемая адаптером часть SDK Яндекс Игр. */
export interface YandexSDK {
  features?: { LoadingAPI?: { ready(): void }; GameplayAPI?: { start(): void; stop(): void } };
  adv?: { showRewardedVideo?(options: { callbacks: AdCallbacks }): void; showFullscreenAdv?(options: { callbacks: AdCallbacks }): void };
  on?(event: 'game_api_pause' | 'game_api_resume', listener: () => void): void;
  off?(event: 'game_api_pause' | 'game_api_resume', listener: () => void): void;
}
/** Параметры загрузки и ограничений ожидания адаптера. */
export interface ContainerOptions {
  document?: Document;
  sdkLoader?: (signal: AbortSignal) => Promise<YandexSDK | undefined>;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  initializeTimeoutMs?: number;
  adOpenTimeoutMs?: number;
  adCloseTimeoutMs?: number;
}

/** Локальная игра не обращается к платформе и всегда выдаёт подсказку бесплатно. */
export class StandaloneContainer implements GameContainer {
  readonly platform = 'standalone' as const;
  private readonly doc?: Document;
  private readonly listeners = new Set<(paused: boolean) => void>();
  private disposed = false;
  private readonly visibility = () => { for (const listener of this.listeners) listener(!!this.doc?.hidden); };
  constructor(options: ContainerOptions = {}) {
    this.doc = options.document ?? (typeof document === 'undefined' ? undefined : document);
    this.doc?.addEventListener('visibilitychange', this.visibility);
  }
  async initialize(): Promise<void> {}
  ready(): void {}
  gameplayStart(): void {}
  gameplayStop(): void {}
  async requestHintReward(): Promise<Reward> { return { granted: true, reason: 'free' }; }
  async showInterstitial(): Promise<void> {}
  onPauseChange(listener: (paused: boolean) => void): () => void {
    if (this.disposed) { listener(false); return () => {}; }
    this.listeners.add(listener); listener(!!this.doc?.hidden);
    return () => { this.listeners.delete(listener); };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.doc?.removeEventListener('visibilitychange', this.visibility);
    this.listeners.clear();
  }
}

/** Динамически загружает SDK, предоставляемый сервером Яндекс Игр. */
function loadSDK(doc: Document, signal: AbortSignal): Promise<YandexSDK | undefined> {
  return new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    const cleanup = () => { script.onload = null; script.onerror = null; signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); script.remove(); resolve(undefined); };
    script.src = '/sdk.js';
    script.async = true;
    script.onerror = () => { cleanup(); script.remove(); reject(new Error('Не удалось загрузить SDK')); };
    script.onload = () => {
      cleanup();
      const api = (globalThis as typeof globalThis & { YaGames?: { init(): Promise<YandexSDK> } }).YaGames;
      if (!api?.init) { resolve(undefined); return; }
      try { Promise.resolve(api.init()).then(resolve, reject); } catch (error) { reject(error); }
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    (doc.head || doc.body).append(script);
  });
}

/** Адаптер жизненного цикла и рекламы Яндекс Игр с безопасным резервным режимом. */
export class YandexContainer implements GameContainer {
  readonly platform = 'yandex' as const;
  private readonly doc?: Document;
  private readonly options: ContainerOptions;
  private readonly abort = new AbortController();
  private sdk?: YandexSDK;
  private initialization?: Promise<void>;
  private disposed = false;
  private readyRequested = false;
  private readySent = false;
  private wantedGameplay = false;
  private sentGameplay = false;
  private reasons = new Set<string>();
  private listeners = new Set<(paused: boolean) => void>();
  private pendingReward?: Promise<Reward>;
  private pendingInterstitial?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private cancelPending = new Set<() => void>();
  private readonly visibility = () => this.setPause('visibility', !!this.doc?.hidden);
  private readonly sdkPause = () => this.setPause('sdk', true);
  private readonly sdkResume = () => this.setPause('sdk', false);

  constructor(options: ContainerOptions = {}) {
    this.options = options;
    this.doc = options.document ?? (typeof document === 'undefined' ? undefined : document);
    if (this.doc?.hidden) this.reasons.add('visibility');
    this.doc?.addEventListener('visibilitychange', this.visibility);
  }
  private timer(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
    return (this.options.setTimeout ?? globalThis.setTimeout)(callback, ms);
  }
  private clear(timer: ReturnType<typeof setTimeout>): void { (this.options.clearTimeout ?? globalThis.clearTimeout)(timer); }
  async initialize(): Promise<void> {
    if (this.disposed) return;
    if (this.initialization) return this.initialization;
    this.initialization = new Promise<void>((resolve) => {
      let finished = false;
      const finish = (sdk?: YandexSDK) => {
        if (finished) return;
        finished = true;
        this.clear(timer);
        this.cancelPending.delete(cancel);
        if (!this.disposed && sdk) {
          this.sdk = sdk;
          try { sdk.on?.('game_api_pause', this.sdkPause); sdk.on?.('game_api_resume', this.sdkResume); } catch { /* Отказ подписки не мешает игре. */ }
          this.sendReady();
          this.syncGameplay();
        }
        resolve();
      };
      const cancel = () => finish();
      const timer = this.timer(() => { this.abort.abort(); finish(); }, this.options.initializeTimeoutMs ?? 10000);
      this.cancelPending.add(cancel);
      try {
        const loader = this.options.sdkLoader ?? ((signal: AbortSignal) => this.doc ? loadSDK(this.doc, signal) : Promise.resolve(undefined));
        Promise.resolve(loader(this.abort.signal)).then(finish, () => finish());
      } catch { finish(); }
    });
    return this.initialization;
  }
  ready(): void { if (!this.disposed) { this.readyRequested = true; this.sendReady(); } }
  private sendReady(): void {
    if (!this.sdk || !this.readyRequested || this.readySent) return;
    this.readySent = true;
    try { this.sdk.features?.LoadingAPI?.ready(); } catch { /* Ошибка SDK не останавливает игру. */ }
  }
  gameplayStart(): void { if (!this.disposed) { this.wantedGameplay = true; this.syncGameplay(); } }
  gameplayStop(): void { if (!this.disposed) { this.wantedGameplay = false; this.syncGameplay(); } }
  private syncGameplay(): void {
    if (!this.sdk || this.disposed) return;
    const active = this.wantedGameplay && this.reasons.size === 0;
    if (active === this.sentGameplay) return;
    this.sentGameplay = active;
    try { if (active) this.sdk.features?.GameplayAPI?.start(); else this.sdk.features?.GameplayAPI?.stop(); } catch { /* Ошибка SDK не останавливает игру. */ }
  }
  private setPause(reason: string, active: boolean): void {
    if (this.disposed) return;
    const before = this.reasons.size > 0;
    if (active) this.reasons.add(reason); else this.reasons.delete(reason);
    const after = this.reasons.size > 0;
    if (before !== after) { this.syncGameplay(); for (const listener of this.listeners) listener(after); }
  }
  onPauseChange(listener: (paused: boolean) => void): () => void {
    if (this.disposed) { listener(false); return () => {}; }
    this.listeners.add(listener); listener(this.reasons.size > 0);
    return () => { this.listeners.delete(listener); };
  }
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run, run);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
  requestHintReward(): Promise<Reward> {
    if (this.pendingReward) return this.pendingReward;
    const result = this.enqueue(() => this.ad(true));
    this.pendingReward = result;
    void result.finally(() => { if (this.pendingReward === result) this.pendingReward = undefined; });
    return result;
  }
  showInterstitial(): Promise<void> {
    if (this.pendingInterstitial) return this.pendingInterstitial;
    const result = this.enqueue(async () => { await this.ad(false); });
    this.pendingInterstitial = result;
    void result.finally(() => { if (this.pendingInterstitial === result) this.pendingInterstitial = undefined; });
    return result;
  }
  private ad(rewarded: boolean): Promise<Reward> {
    const unavailable: Reward = { granted: true, reason: 'unavailable' };
    if (this.disposed) return Promise.resolve(unavailable);
    const adv = this.sdk?.adv;
    const show = rewarded ? adv?.showRewardedVideo : adv?.showFullscreenAdv;
    if (!show || !adv) return Promise.resolve(unavailable);
    return new Promise((resolve) => {
      let finished = false;
      let opened = false;
      let earned = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (result: Reward) => {
        if (finished) return;
        finished = true;
        this.clear(timer);
        this.cancelPending.delete(cancel);
        this.setPause('ad', false);
        resolve(result);
      };
      const cancel = () => finish(earned ? { granted: true, reason: 'rewarded' } : unavailable);
      const timeout = () => finish(earned ? { granted: true, reason: 'rewarded' } : opened ? { granted: true, reason: 'error' } : unavailable);
      const callbacks: AdCallbacks = {
        onOpen: () => {
          if (finished || opened) return;
          opened = true;
          this.setPause('ad', true);
          this.clear(timer);
          timer = this.timer(timeout, this.options.adCloseTimeoutMs ?? 180000);
        },
        onRewarded: () => { if (!finished) earned = true; },
        onClose: (wasShown) => finish(earned ? { granted: true, reason: 'rewarded' } : (opened || wasShown) ? { granted: false, reason: 'cancelled' } : unavailable),
        onError: () => finish(earned ? { granted: true, reason: 'rewarded' } : { granted: true, reason: 'error' }),
      };
      timer = this.timer(timeout, this.options.adOpenTimeoutMs ?? 10000);
      this.cancelPending.add(cancel);
      try { show.call(adv, { callbacks }); } catch { callbacks.onError(); }
    });
  }
  dispose(): void {
    if (this.disposed) return;
    // Запрещаем возобновление до завершения рекламы и сообщаем платформе об остановке.
    this.wantedGameplay = false;
    this.syncGameplay();
    // После остановки исключаем повторный запуск из обработчиков завершения ожиданий.
    this.disposed = true;
    for (const cancel of [...this.cancelPending]) cancel();
    this.abort.abort();
    this.doc?.removeEventListener('visibilitychange', this.visibility);
    try { this.sdk?.off?.('game_api_pause', this.sdkPause); this.sdk?.off?.('game_api_resume', this.sdkResume); } catch { /* Очистка остальных ресурсов продолжается. */ }
    this.listeners.clear();
    this.reasons.clear();
  }
}

/** Создаёт контейнер выбранной платформы; по умолчанию игра работает автономно. */
export function createGameContainer(platform: 'standalone' | 'yandex' = 'standalone', options: ContainerOptions = {}): GameContainer {
  return platform === 'yandex' ? new YandexContainer(options) : new StandaloneContainer(options);
}

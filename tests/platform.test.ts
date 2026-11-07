import { describe, expect, it, vi, afterEach } from 'vitest';
import { createGameContainer, YandexContainer, type YandexSDK } from '../src/platform';

type Callbacks = { onOpen(): void; onClose(shown: boolean): void; onError(error?: object): void; onRewarded?(): void };
function fixture() {
  let reward!: Callbacks;
  let fullscreen!: Callbacks;
  const events = new Map<string, () => void>();
  const sdk: YandexSDK = {
    features: { LoadingAPI: { ready: vi.fn() }, GameplayAPI: { start: vi.fn(), stop: vi.fn() } },
    adv: { showRewardedVideo: vi.fn(({ callbacks }) => { reward = callbacks; }), showFullscreenAdv: vi.fn(({ callbacks }) => { fullscreen = callbacks; }) },
    on: vi.fn((event, callback) => { events.set(event, callback); }),
    off: vi.fn((event) => { events.delete(event); }),
  };
  const container = new YandexContainer({ sdkLoader: async () => sdk, adOpenTimeoutMs: 100, adCloseTimeoutMs: 200 });
  return { sdk, container, events, reward: () => reward, fullscreen: () => fullscreen };
}
afterEach(() => { vi.useRealTimers(); });
describe('платформенные контейнеры', () => {
  it('не загружает SDK в автономном режиме', async () => {
    const loader = vi.fn();
    const container = createGameContainer('standalone', { sdkLoader: loader });
    await container.initialize();
    expect(await container.requestHintReward()).toEqual({ granted: true, reason: 'free' });
    await container.showInterstitial();
    expect(loader).not.toHaveBeenCalled();
  });
  it('переживает отказ и тайм-аут инициализации', async () => {
    vi.useFakeTimers();
    for (const loader of [() => Promise.reject(new Error()), () => Promise.resolve(undefined), () => new Promise<YandexSDK>(() => {})]) {
      const container = new YandexContainer({ sdkLoader: loader, initializeTimeoutMs: 10 });
      const promise = container.initialize();
      await vi.advanceTimersByTimeAsync(10);
      await promise;
      expect(await container.requestHintReward()).toEqual({ granted: true, reason: 'unavailable' });
      container.dispose();
    }
  });
  it('обрабатывает ошибку загрузки скрипта и отсутствие YaGames', async () => {
    const script = { src: '', async: false, onload: null as null | (() => void), onerror: null as null | (() => void), remove: vi.fn() };
    const doc = { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), createElement: () => script, head: { append: vi.fn() } } as unknown as Document;
    const container = new YandexContainer({ document: doc });
    const pending = container.initialize();
    expect(script.src).toBe('/sdk.js');
    script.onerror?.();
    await pending;
    expect(await container.requestHintReward()).toEqual({ granted: true, reason: 'unavailable' });
    container.dispose();
    const other = new YandexContainer({ document: doc });
    const pendingOther = other.initialize();
    script.onload?.();
    await pendingOther;
    expect(await other.requestHintReward()).toEqual({ granted: true, reason: 'unavailable' });
    other.dispose();
  });
  it('сообщает о готовности один раз, в том числе до инициализации', async () => {
    const { container, sdk } = fixture();
    container.ready(); container.ready(); await container.initialize(); container.ready();
    expect(sdk.features?.LoadingAPI?.ready).toHaveBeenCalledTimes(1);
    container.dispose();
  });
  it('ждёт закрытия после награды и игнорирует повторные и поздние callback', async () => {
    const f = fixture(); await f.container.initialize();
    const states: boolean[] = []; f.container.onPauseChange((value) => states.push(value));
    const promise = f.container.requestHintReward(); await Promise.resolve();
    f.reward().onOpen(); f.reward().onRewarded?.(); f.reward().onRewarded?.();
    let done = false; void promise.then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false);
    f.reward().onClose(true);
    expect(await promise).toEqual({ granted: true, reason: 'rewarded' });
    f.reward().onOpen(); f.reward().onClose(true);
    expect(states).toEqual([false, true, false]); f.container.dispose();
  });
  it('различает отмену, непоказ и ошибку', async () => {
    const f = fixture(); await f.container.initialize();
    let result = f.container.requestHintReward(); await Promise.resolve(); f.reward().onOpen(); f.reward().onClose(false);
    expect(await result).toEqual({ granted: false, reason: 'cancelled' }); await Promise.resolve();
    result = f.container.requestHintReward(); await Promise.resolve(); f.reward().onClose(false);
    expect(await result).toEqual({ granted: true, reason: 'unavailable' }); await Promise.resolve();
    result = f.container.requestHintReward(); await Promise.resolve(); f.reward().onError();
    expect(await result).toEqual({ granted: true, reason: 'error' }); f.container.dispose();
    const thrown = new YandexContainer({ sdkLoader: async () => ({ adv: { showRewardedVideo: () => { throw Error(); } } }) });
    await thrown.initialize(); expect(await thrown.requestHintReward()).toEqual({ granted: true, reason: 'error' }); thrown.dispose();
  });
  it('учитывает факт показа из onClose даже без onOpen', async () => {
    const f = fixture(); await f.container.initialize();
    const pending = f.container.requestHintReward(); await Promise.resolve(); f.reward().onClose(true);
    expect(await pending).toEqual({ granted: false, reason: 'cancelled' }); f.container.dispose();
  });
  it('останавливает активный геймплей при dispose и не возобновляет его после рекламы', async () => {
    const active = fixture(); await active.container.initialize(); active.container.gameplayStart(); active.container.dispose();
    expect(active.sdk.features?.GameplayAPI?.stop).toHaveBeenCalledTimes(1);
    const f = fixture(); await f.container.initialize(); f.container.gameplayStart();
    const pending = f.container.requestHintReward(); await Promise.resolve(); f.reward().onOpen();
    expect(f.sdk.features?.GameplayAPI?.stop).toHaveBeenCalledTimes(1);
    f.container.dispose(); await pending;
    f.reward().onClose(true);
    expect(f.sdk.features?.GameplayAPI?.start).toHaveBeenCalledTimes(1);
    expect(f.sdk.features?.GameplayAPI?.stop).toHaveBeenCalledTimes(1);
  });
  it('не уведомляет о возобновлении и не запускает игру повторно при dispose', async () => {
    const f = fixture(); await f.container.initialize();
    const states: boolean[] = [];
    f.container.onPauseChange((paused) => {
      states.push(paused);
      if (!paused) f.container.gameplayStart();
    });
    const pending = f.container.requestHintReward(); await Promise.resolve(); f.reward().onOpen();
    f.container.dispose(); await pending;
    expect(states).toEqual([false, true]);
    expect(f.sdk.features?.GameplayAPI?.start).toHaveBeenCalledTimes(1);
    expect(f.sdk.features?.GameplayAPI?.stop).toHaveBeenCalledTimes(1);
  });
  it('сообщает видимость вкладки в автономном режиме и отписывается', () => {
    let listener = () => {}; let hidden = true;
    const doc = { get hidden() { return hidden; }, addEventListener: (_: string, fn: () => void) => { listener = fn; }, removeEventListener: vi.fn() } as unknown as Document;
    const container = createGameContainer('standalone', { document: doc });
    const states: boolean[] = []; const unsubscribe = container.onPauseChange((paused) => states.push(paused));
    hidden = false; listener(); unsubscribe(); hidden = true; listener();
    expect(states).toEqual([true, false]); container.dispose(); expect(doc.removeEventListener).toHaveBeenCalledTimes(1);
  });
  it('объединяет одинаковые запросы и сериализует разные виды рекламы', async () => {
    const f = fixture(); await f.container.initialize();
    const first = f.container.requestHintReward(); const same = f.container.requestHintReward(); const inter = f.container.showInterstitial();
    expect(first).toBe(same); await Promise.resolve(); expect(f.sdk.adv?.showFullscreenAdv).not.toHaveBeenCalled();
    const old = f.reward(); old.onClose(false); await first; await Promise.resolve(); await Promise.resolve();
    expect(f.sdk.adv?.showFullscreenAdv).toHaveBeenCalledTimes(1);
    f.fullscreen().onOpen(); old.onClose(true); f.fullscreen().onClose(true); await inter;
    f.container.dispose();
  });
  it('завершает межстраничную рекламу при блокировке, ошибке и закрытии', async () => {
    const f = fixture(); await f.container.initialize();
    for (const close of [(c: Callbacks) => c.onClose(false), (c: Callbacks) => c.onError(), (c: Callbacks) => { c.onOpen(); c.onClose(true); }]) {
      const pending = f.container.showInterstitial(); await Promise.resolve(); close(f.fullscreen()); await pending; await Promise.resolve();
    }
    f.container.dispose();
  });
  it('ограничивает ожидания до и после открытия и завершает их при dispose', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.container.initialize();
    let pending = f.container.requestHintReward(); await Promise.resolve(); await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual({ granted: true, reason: 'unavailable' });
    pending = f.container.requestHintReward(); await Promise.resolve(); f.reward().onOpen(); await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toEqual({ granted: true, reason: 'error' });
    pending = f.container.requestHintReward(); await Promise.resolve(); f.container.dispose();
    expect(await pending).toEqual({ granted: true, reason: 'unavailable' }); expect(vi.getTimerCount()).toBe(0);
  });
  it('объединяет причины паузы и не возобновляет завершённую игру', async () => {
    const f = fixture(); await f.container.initialize(); const states: boolean[] = [];
    f.container.onPauseChange((paused) => states.push(paused)); f.container.gameplayStart();
    f.events.get('game_api_pause')?.();
    const pending = f.container.requestHintReward(); await Promise.resolve(); f.reward().onOpen();
    f.events.get('game_api_resume')?.(); expect(states).toEqual([false, true]);
    f.container.gameplayStop(); f.reward().onClose(false); await pending;
    expect(states).toEqual([false, true, false]);
    expect(f.sdk.features?.GameplayAPI?.start).toHaveBeenCalledTimes(1); f.container.dispose();
    expect(f.events.size).toBe(0);
  });
  it('сохраняет паузу скрытой вкладки после возобновления SDK', async () => {
    let listener = () => {}; let hidden = false;
    const doc = { get hidden() { return hidden; }, addEventListener: (_: string, fn: () => void) => { listener = fn; }, removeEventListener: vi.fn() } as unknown as Document;
    const callbacks = new Map<string, () => void>();
    const c = new YandexContainer({ document: doc, sdkLoader: async () => ({ on: (e, cb) => { callbacks.set(e, cb); } }) });
    await c.initialize(); const states: boolean[] = []; c.onPauseChange((p) => states.push(p));
    hidden = true; listener(); callbacks.get('game_api_pause')?.(); callbacks.get('game_api_resume')?.();
    expect(states).toEqual([false, true]); hidden = false; listener(); expect(states).toEqual([false, true, false]); c.dispose();
  });
});

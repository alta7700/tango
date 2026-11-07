/** Платформенный механизм жизненного цикла и рекламы игры. */
export interface GameContainer {
  platform: 'standalone' | 'yandex';
  /** Подготавливает платформу до начала игры. */
  initialize(): Promise<void>;
  /** Сообщает платформе о готовности игры. */
  ready(): void;
  /** Сообщает о начале активной игры. */
  gameplayStart(): void;
  /** Сообщает об остановке активной игры. */
  gameplayStop(): void;
  /** Запрашивает награду: при недоступности или ошибке подсказка бесплатна. */
  requestHintReward(): Promise<{ granted: boolean; reason: 'free' | 'rewarded' | 'unavailable' | 'error' | 'cancelled' }>;
  /** Запрашивает межстраничную рекламу; частоту определяет интерфейс. */
  showInterstitial(): Promise<void>;
  /** Подписывает на изменение паузы и возвращает функцию отписки. */
  onPauseChange(listener: (paused: boolean) => void): () => void;
  /** Освобождает ресурсы и подписки. */
  dispose(): void;
}

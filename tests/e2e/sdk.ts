import type { Page } from '@playwright/test';

/** Подменяет только внешний SDK, сохраняя реальные события и интерфейс приложения. */
export async function installSdk(page: Page, mode: 'reward' | 'cancel' | 'error' | 'unavailable' | 'init-error' | '404' = 'reward'): Promise<void> {
  await page.route('**/sdk.js', async route => {
    if (mode === '404') { await route.fulfill({ status: 404, body: '' }); return; }
    const script = `
      window.sdkCalls = [];
      window.sdkListeners = {};
      window.YaGames = { init: async () => {
        window.sdkCalls.push('init');
        if (${JSON.stringify(mode)} === 'init-error') throw new Error('SDK unavailable');
        const record = name => () => window.sdkCalls.push(name);
        return {
          features: { LoadingAPI: { ready: record('ready') }, GameplayAPI: { start: record('start'), stop: record('stop') } },
          on: (name, callback) => { window.sdkListeners[name] = callback; },
          off: name => { delete window.sdkListeners[name]; },
          adv: ${mode === 'unavailable' ? '{}' : `{
            showRewardedVideo: ({callbacks}) => {
              window.sdkCalls.push('reward');
              if (${JSON.stringify(mode)} === 'error') { callbacks.onError(); return; }
              callbacks.onOpen();
              if (${JSON.stringify(mode)} === 'reward') callbacks.onRewarded();
              callbacks.onClose(true);
            },
            showFullscreenAdv: ({callbacks}) => { window.sdkCalls.push('interstitial'); callbacks.onOpen(); callbacks.onClose(true); }
          }`}
        };
      }};
    `;
    await route.fulfill({ contentType: 'application/javascript', body: script });
  });
}

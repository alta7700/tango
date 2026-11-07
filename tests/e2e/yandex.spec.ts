import { test, expect, type Page } from '@playwright/test';
import { installSdk } from './sdk';

const url = 'http://127.0.0.1:4274/';
const key = 'tango:yandex:game:v1';
const countKey = 'tango:yandex:count:v1';
async function saved(page: Page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null')?.state, key); }
async function calls(page: Page): Promise<string[]> { return page.evaluate(() => (window as any).sdkCalls || []); }

const pageErrors = new WeakMap<Page, Error[]>();
test.beforeEach(async ({ page }) => {
  const errors: Error[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error));
});
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

test('язык SDK читается до готовности и запуска, неподдерживаемый язык заменяется русским', async ({ page }) => {
  await installSdk(page);
  await page.goto(url);
  await expect.poll(() => calls(page)).toContain('start');
  const events = await calls(page);
  expect(events.indexOf('lang')).toBeGreaterThan(events.indexOf('init'));
  expect(events.indexOf('lang')).toBeLessThan(events.indexOf('ready'));
  expect(events.indexOf('lang')).toBeLessThan(events.indexOf('start'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
});

for (const mode of ['reward', 'cancel', 'error', 'unavailable', 'init-error', '404'] as const) {
  test(`подсказка при состоянии SDK: ${mode}`, async ({ page }) => {
    await installSdk(page, mode);
    await page.goto(url);
    await expect(page.locator('#board .cell')).toHaveCount(36);
    const before = (await saved(page)).board;
    await page.locator('#hint').click();
    if (mode === 'cancel') {
      await expect(page.locator('#status')).toContainText('не завершён');
      await expect(page.locator('#hint-panel')).toBeHidden();
      expect((await saved(page)).board).toEqual(before);
    } else {
      await expect(page.locator('#apply-hint')).toBeVisible();
      expect((await saved(page)).board).toEqual(before);
      await page.locator('#apply-hint').click();
      await expect.poll(async () => (await saved(page)).board).not.toEqual(before);
      expect((await saved(page)).board.filter((v: unknown, i: number) => v !== before[i])).toHaveLength(1);
    }
    if (mode === 'reward' || mode === 'cancel' || mode === 'error') expect((await calls(page)).filter(x => x === 'reward')).toHaveLength(1);
  });
}

test('межстраничная реклама перед третьей и шестой партиями; перезагрузка и сброс не считаются', async ({ page }) => {
  await installSdk(page);
  await page.goto(url);
  await expect(page.locator('#board .cell')).toHaveCount(36);
  await expect.poll(() => calls(page)).toContain('ready');
  await expect.poll(() => calls(page)).toContain('start');
  for (let number = 2; number <= 6; number++) {
    await page.locator('#new').click({ clickCount: 2 });
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), countKey)).toBe(String(number));
    expect((await calls(page)).filter(x => x === 'interstitial')).toHaveLength(Math.floor(number / 3) - (number > 3 ? 1 : 0));
    if (number === 3) {
      await page.reload();
      await expect(page.locator('#board .cell')).toHaveCount(36);
      await page.locator('#reset').click();
      expect(await page.evaluate(key => localStorage.getItem(key), countKey)).toBe('3');
      // После перезагрузки журнал stub начинается заново.
      expect((await calls(page)).filter(x => x === 'interstitial')).toHaveLength(0);
    }
  }
});

test('пауза SDK блокирует ввод и часы, после продолжения игра возобновляется', async ({ page }) => {
  await installSdk(page);
  await page.clock.install();
  await page.goto(url);
  await expect(page.locator('#board .cell')).toHaveCount(36);
  const current = await saved(page);
  const i = current.puzzle.givens.findIndex((v: unknown) => v === null);
  await page.evaluate(() => (window as any).sdkListeners.game_api_pause());
  await expect(page.locator('#status')).toContainText('пауз');
  await expect(page.locator(`.cell[data-index="${i}"]`)).toBeDisabled();
  const paused = await saved(page);
  const pausedTimer = await page.locator('#timer').textContent();
  await page.clock.fastForward(5000);
  expect(await page.locator('#timer').textContent()).toBe(pausedTimer);
  await page.evaluate(() => (window as any).sdkListeners.game_api_resume());
  await expect(page.locator(`.cell[data-index="${i}"]`)).toBeEnabled();
  await page.locator(`.cell[data-index="${i}"]`).click();
  expect((await saved(page)).board[i]).not.toEqual(paused.board[i]);
  expect(await calls(page)).toContain('stop');
});


test('возобновление SDK не запускает завершённую игру', async ({ page }) => {
  await installSdk(page);
  await page.goto(url);
  await expect(page.locator('#board .cell')).toHaveCount(36);
  for (let step = 0; step < 36; step++) {
    if (await page.locator('#victory').isVisible()) break;
    await page.locator('#hint').click();
    await expect(page.locator('#apply-hint')).toBeVisible();
    await page.locator('#apply-hint').click();
  }
  await expect(page.locator('#victory')).toBeVisible();
  const starts = (await calls(page)).filter(x => x === 'start').length;
  await page.evaluate(() => { (window as any).sdkListeners.game_api_pause(); (window as any).sdkListeners.game_api_resume(); });
  expect((await calls(page)).filter(x => x === 'start')).toHaveLength(starts);
});

test('кнопка подсказки заранее сообщает о видео', async ({ page }) => {
  await installSdk(page);
  await page.goto(url);
  await expect(page.locator('#board .cell')).toHaveCount(36);
  await expect(page.locator('#hint')).toContainText(/видео|реклам/i);
});

test('двойной щелчок с обычным интервалом запускает одну партию', async ({ page }) => {
  await installSdk(page);
  await page.goto(url);
  await expect(page.locator('#board .cell')).toHaveCount(36);
  const before = Number(await page.evaluate(key => localStorage.getItem(key), countKey));
  await page.locator('#new').dblclick({ delay: 120 });
  await expect(page.locator('#new')).toBeEnabled();
  await expect.poll(() => page.evaluate(key => Number(localStorage.getItem(key)), countKey)).toBe(before + 1);
});

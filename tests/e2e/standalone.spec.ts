import { test, expect, type Page } from '@playwright/test';

const url = 'http://127.0.0.1:4273/';
const gameKey = 'tango:standalone:game:v1';
const countKey = 'tango:standalone:count:v1';

/** Читает только сохраняемое состояние, доступное пользователю после перезагрузки. */
async function state(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null')?.state, gameKey);
}

/** Находит редактируемую клетку по исходным условиям задачи. */
async function editable(page: Page) {
  const saved = await state(page);
  return saved.puzzle.givens.findIndex((value: unknown) => value === null);
}

const pageErrors = new WeakMap<Page, Error[]>();
test.beforeEach(async ({ page }) => {
  const errors: Error[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error));
});
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

test('автономная загрузка не запрашивает SDK, размеры и число клеток', async ({ page }) => {
  const sdk: string[] = [];
  page.on('request', request => { if (request.url().includes('/sdk.js')) sdk.push(request.url()); });
  await page.goto(url);
  await expect(page.locator('#board .cell')).toHaveCount(36);
  for (const size of [8, 10, 6]) {
    await page.locator('#size').selectOption(String(size));
    await page.locator('#new').click();
    await expect(page.locator('#board .cell')).toHaveCount(size * size);
  }
  expect(sdk).toEqual([]);
});

test('цикл клетки, неизменяемые условия, отмена и сброс', async ({ page }) => {
  await page.goto(url);
  await expect(page.locator('#board .cell')).toHaveCount(36);
  const initial = await state(page);
  const i = await editable(page);
  const cell = page.locator(`.cell[data-index="${i}"]`);
  const given = initial.puzzle.givens.findIndex((value: unknown) => value !== null);
  await page.locator(`.cell[data-index="${given}"]`).click();
  expect((await state(page)).board[given]).toEqual(initial.board[given]);
  await cell.click();
  const first = (await state(page)).board[i];
  expect(first).not.toEqual(initial.board[i]);
  await cell.click();
  expect((await state(page)).board[i]).not.toEqual(first);
  await cell.click();
  expect((await state(page)).board[i]).toEqual(initial.board[i]);
  await cell.click();
  await page.locator('#undo').click();
  expect((await state(page)).board[i]).toEqual(initial.board[i]);
  await cell.click();
  await page.locator('#reset').click();
  expect((await state(page)).board).toEqual(initial.board);
});

test('поле, история и номер сохраняются, повреждённое сохранение восстанавливается', async ({ page }) => {
  await page.goto(url);
  await expect(page.locator('#board .cell')).toHaveCount(36);
  const i = await editable(page);
  await page.locator(`.cell[data-index="${i}"]`).click();
  const saved = await state(page);
  const count = await page.evaluate(key => localStorage.getItem(key), countKey);
  await page.reload();
  await expect.poll(() => state(page)).toMatchObject({ board: saved.board, history: saved.history, number: saved.number });
  expect(await page.evaluate(key => localStorage.getItem(key), countKey)).toBe(count);
  await page.locator('#undo').click();
  expect((await state(page)).board[i]).not.toEqual(saved.board[i]);
  await page.evaluate(key => localStorage.setItem(key, '{bad'), gameKey);
  await page.reload();
  await expect(page.locator('#board .cell')).toHaveCount(36);
});

test('подсказка объясняет ход до применения и решает поле последовательно', async ({ page }) => {
  await page.goto(url);
  await expect(page.locator('#board .cell')).toHaveCount(36);
  for (let step = 0; step < 36; step++) {
    if (await page.locator('#victory').isVisible()) break;
    const before = (await state(page)).board;
    await page.locator('#hint').click();
    await expect(page.locator('#hint-panel')).toBeVisible();
    await expect(page.locator('#hint-panel')).not.toBeEmpty();
    expect((await state(page)).board).toEqual(before);
    await page.locator('#apply-hint').click();
    await expect.poll(async () => (await state(page)).board).not.toEqual(before);
  }
  await expect(page.locator('#victory')).toBeVisible();
});

for (const width of [320, 360, 1280]) {
  test(`адаптивное поле ${width}px без горизонтальной прокрутки`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(url);
    await expect(page.locator('#board .cell')).toHaveCount(36);
    // Несколько доказанных ходов делают снимок показательным для заполненных и пустых клеток.
    for (let step = 0; step < 8; step++) {
      await page.locator('#hint').click();
      await expect(page.locator('#apply-hint')).toBeVisible();
      await page.locator('#apply-hint').click();
    }
    const board = (await state(page)).board;
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width !== 320) await page.screenshot({ path: `test-results/${width === 360 ? 'mobile' : 'desktop'}.png`, fullPage: true });
    await page.setViewportSize({ width: 800, height: width });
    expect((await state(page)).board).toEqual(board);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('ошибочный ход сохраняется и доступен отмене', async ({ page }) => {
  await page.goto(url);
  await expect(page.locator('#board .cell')).toHaveCount(36);
  const initial = await state(page);
  for (let i = 0; i < 36; i++) {
    if (initial.puzzle.givens[i] !== null) continue;
    await page.locator(`.cell[data-index="${i}"]`).click();
    if (await page.locator('.cell.conflict').count()) break;
  }
  await expect(page.locator('.cell.conflict').first()).toBeVisible();
  const incorrect = await state(page);
  await page.reload();
  await expect(page.locator('.cell.conflict').first()).toBeVisible();
  expect((await state(page)).board).toEqual(incorrect.board);
  await page.locator('#undo').click();
  expect((await state(page)).board).toEqual(incorrect.history.at(-1));
});

test('клавиатура меняет клетку и очищает её', async ({ page }) => {
  await page.goto(url);
  await expect(page.locator('#board .cell')).toHaveCount(36);
  const i = await editable(page);
  const cell = page.locator(`.cell[data-index="${i}"]`);
  await cell.focus();
  await page.keyboard.press('Enter');
  expect((await state(page)).board[i]).toBe('sun');
  await page.keyboard.press('Space');
  expect((await state(page)).board[i]).toBe('moon');
  await page.keyboard.press('Delete');
  expect((await state(page)).board[i]).toBeNull();
  if (i % 6 < 5) {
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(`.cell[data-index="${i + 1}"]`)).toBeFocused();
  }
});

test('увеличение поля 10×10 сохраняет ходы без переполнения страницы', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(url);
  await expect(page.locator('#board .cell')).toHaveCount(36);
  await page.locator('#size').selectOption('10');
  await page.locator('#new').click();
  await expect(page.locator('#board .cell')).toHaveCount(100);
  const i = await editable(page);
  await page.locator(`.cell[data-index="${i}"]`).click();
  const board = (await state(page)).board;
  await page.locator('#zoom').click();
  await expect(page.locator('#board')).toHaveClass(/zoomed/);
  expect((await state(page)).board).toEqual(board);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#zoom').click();
  expect((await state(page)).board).toEqual(board);
});

test('быстрые ходы не теряют накопленное время', async ({ page }) => {
  await page.clock.install();
  await page.goto(url);
  await expect(page.locator('#board .cell')).toHaveCount(36);
  const i = await editable(page);
  await page.clock.fastForward(2500);
  await page.locator(`.cell[data-index="${i}"]`).click();
  const first = (await state(page)).elapsed;
  await page.clock.fastForward(700);
  await page.locator(`.cell[data-index="${i}"]`).click();
  const second = (await state(page)).elapsed;
  expect(first).toBeGreaterThanOrEqual(2000);
  expect(second - first).toBeGreaterThanOrEqual(700);
});

test('возврат назад восстанавливает игру, счётчик и работающий таймер', async ({ page }) => {
  await page.clock.install();
  await page.goto(url);
  await expect(page.locator('#board .cell')).toHaveCount(36);
  const i = await editable(page);
  await page.clock.fastForward(2500);
  await page.locator(`.cell[data-index="${i}"]`).click();
  const before = await state(page);
  const count = await page.evaluate(key => localStorage.getItem(key), countKey);
  await page.goto('about:blank');
  await page.goBack();
  await expect(page.locator('#board .cell')).toHaveCount(36);
  expect((await state(page)).board).toEqual(before.board);
  expect(await page.evaluate(key => localStorage.getItem(key), countKey)).toBe(count);
  await page.clock.fastForward(3000);
  await expect.poll(async () => (await state(page)).elapsed).toBeGreaterThan(before.elapsed);
});

test('автономная подсказка не предупреждает о видео', async ({ page }) => {
  await page.goto(url);
  await expect(page.locator('#board .cell')).toHaveCount(36);
  await expect(page.locator('#hint')).not.toContainText(/видео|реклам/i);
});


/** Сравнивает реальные границы всех клеток с допуском на округление CSS-пикселей. */
async function checkGrid(page: Page, size: number) {
  const grid = page.getByRole('grid');
  const cells = grid.getByRole('gridcell');
  await expect(cells).toHaveCount(size * size);
  const boxes = await Promise.all((await cells.all()).map(cell => cell.boundingBox()));
  expect(boxes.every(box => box !== null)).toBe(true);
  const widths = boxes.map(box => box!.width);
  const heights = boxes.map(box => box!.height);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
  for (const box of boxes) expect(Math.abs(box!.width - box!.height)).toBeLessThanOrEqual(1);
  const rows = grid.getByRole('row');
  await expect(rows).toHaveCount(size);
  for (let row = 0; row < size; row++) {
    await expect(rows.nth(row).getByRole('gridcell')).toHaveCount(size);
  }
}

for (const width of [320, 1280]) {
  for (const size of [6, 8, 10]) {
    test(`геометрия и доступность поля ${size}×${size} при ширине ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(url);
      await expect(page.locator('#board .cell')).toHaveCount(36);
      if (size !== 6) {
        await page.locator('#size').selectOption(String(size));
        await page.locator('#new').click();
        await expect(page.locator('#board .cell')).toHaveCount(size * size);
      }
      await checkGrid(page, size);
      if (size === 10) {
        await page.locator('#zoom').click();
        await expect(page.locator('#board')).toHaveClass(/zoomed/);
        await checkGrid(page, size);
      }
    });
  }
}

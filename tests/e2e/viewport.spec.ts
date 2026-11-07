import { test, expect, type Page } from '@playwright/test';
import { generatePuzzle, solve } from '../../src/core';

const url = 'http://127.0.0.1:4273/';
const key = 'tango:standalone:game:v1';

/** Проверяет отсутствие прокрутки страницы и доступность основных элементов. */
async function checkViewport(page: Page) {
  const result = await page.evaluate(() => {
    const rect = (selector: string) => {
      const r = document.querySelector(selector)!.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight, board: rect('#board'),
      elements: ['#size', '#new', '#undo', '#reset', '#hint', '.rules summary'].map(rect) };
  });
  expect(result.scrollWidth).toBeLessThanOrEqual(result.width);
  expect(result.scrollHeight).toBeLessThanOrEqual(result.height);
  expect(Math.abs(result.board.width - result.board.height)).toBeLessThan(1);
  for (const rect of result.elements) {
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(result.width);
    expect(rect.bottom).toBeLessThanOrEqual(result.height);
  }
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 600 },
  { width: 390, height: 844 }, { width: 360, height: 640 }, { width: 844, height: 390 }]) {
  test(`окно ${viewport.width}×${viewport.height}: поле и панели`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(url);
    await expect(page.locator('.cell')).toHaveCount(36);
    for (const size of [6, 8, 10]) {
      if (size !== 6) {
        await page.locator('#size').selectOption(String(size));
        await page.locator('#new').click();
        await expect(page.locator('.cell')).toHaveCount(size * size);
      }
      await checkViewport(page);
      const cells = await page.locator('.cell').evaluateAll(nodes => nodes.map(node => {
        const r = node.getBoundingClientRect(); return [r.width, r.height];
      }));
      for (const [width, height] of cells) {
        expect(Math.abs(width - height)).toBeLessThan(1);
        expect(Math.abs(width - cells[0][0])).toBeLessThan(1);
      }
    }
    await page.locator('#zoom').click();
    expect(await page.locator('#board').evaluate(el => el.getBoundingClientRect().width)).toBe(600);
    const scroll = page.locator('.board-scroll');
    await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = el.scrollHeight; });
    expect(await scroll.evaluate(el => el.scrollLeft > 0 || el.scrollTop > 0)).toBe(true);
    await page.locator('#zoom').click();
    await page.locator('.rules summary').click();
    await checkViewport(page);
    await page.locator('#hint').click();
    await expect(page.locator('#apply-hint')).toBeAttached();
    await page.locator('#apply-hint').scrollIntoViewIfNeeded();
    await expect(page.locator('#apply-hint')).toBeInViewport();
    await checkViewport(page);
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await checkViewport(page);
  });
}

test('панель победы доступна внутри экрана', async ({ page }) => {
  const puzzle = generatePuzzle({ size: 6, seed: 'viewport', maxAttempts: 0 });
  const solution = solve(puzzle).solutions[0];
  await page.setViewportSize({ width: 844, height: 390 });
  await page.addInitScript(({ key, puzzle, solution }) => localStorage.setItem(key, JSON.stringify({ version: 1, state: { puzzle, board: solution, history: [], elapsed: 0, number: 1 } })), { key, puzzle, solution });
  await page.goto(url);
  await expect(page.locator('#victory-new')).toBeAttached();
  await page.locator('#victory-new').scrollIntoViewIfNeeded();
  await expect(page.locator('#victory-new')).toBeInViewport();
  await checkViewport(page);
});

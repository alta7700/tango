import { expect, test } from '@playwright/test';

for (const [platform, port] of [['standalone', 4273], ['yandex', 4274]] as const) {
  test(`${platform}: подсказка после восстановления при недоступном worker`, async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.locator('.cell')).toHaveCount(36);
    const key = `tango:${platform}:game:v1`;
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, key);
    // После перезагрузки страница уже загружена, но новый worker ещё не создавался.
    await page.reload();
    await expect(page.locator('.cell')).toHaveCount(36);
    let attempts = 0;
    await page.route('**/assets/game-*.js', route => { attempts++; return route.abort(); });
    await page.locator('#hint').click();
    await expect(page.locator('#hint-panel')).toBeVisible();
    await expect(page.locator('#apply-hint')).toBeVisible();
    expect(attempts).toBe(2);
    const current = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, key);
    expect(current.board).toEqual(saved.board);
    expect(current.puzzle).toEqual(saved.puzzle);
  });
}

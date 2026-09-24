import { expect, test } from '@playwright/test';

test('boots to the main menu and enters the game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/?nosdk');
  const play = page.locator('.main-menu .btn-primary');
  await expect(play).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: 'test-results/menu.png' });

  await play.click();
  await expect(page.locator('#overlay')).toBeHidden();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/ingame.png' });

  expect(errors).toEqual([]);
});

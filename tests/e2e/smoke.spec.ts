import { expect, test } from '@playwright/test';

test('boots, plays, builds, saves and restores a world', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/?nosdk');
  const play = page.locator('.main-menu .btn-primary');
  await expect(play).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: 'test-results/menu.png' });

  await play.click();
  await expect(page.locator('#overlay')).toBeHidden();
  await page.waitForFunction(() => (window as any).game.session.spawned, null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/ingame.png' });

  // Build a small pillar next to the player, save, reload and check it is still there.
  const spot = await page.evaluate(() => {
    const s = (window as any).game.session;
    const p = s.player.position;
    const x = Math.floor(p.x) + 2;
    const z = Math.floor(p.z) + 2;
    const y = Math.floor(p.y);
    for (let i = 0; i < 4; i++) s.world.setBlock(x, y + i, z, 1);
    return { x, y, z };
  });
  await page.evaluate(() => (window as any).game.saveSession());
  await page.reload();
  await expect(page.locator('.main-menu .btn-primary')).toBeVisible({ timeout: 60_000 });
  await page.locator('.main-menu .btn-primary').click();
  await page.waitForFunction((s) => (window as any).game.session.world.isLoaded(s.x, s.z), spot, {
    timeout: 60_000,
  });
  const restored = await page.evaluate(
    (s) => (window as any).game.session.world.getBlock(s.x, s.y + 3, s.z),
    spot,
  );
  expect(restored).toBe(1);

  // The creative inventory opens and closes.
  await page.keyboard.press('KeyE');
  await expect(page.locator('.inventory-screen')).toBeVisible();
  await page.keyboard.press('KeyE');
  await expect(page.locator('.inventory-screen')).toBeHidden();

  expect(errors).toEqual([]);
});

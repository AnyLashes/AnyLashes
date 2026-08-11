const { test, expect } = require('@playwright/test');
const { installMockAppsScript } = require('./mockAppsScript');

test('humo: la landing carga en Chrome real y el mock de API responde', async ({ page, browserName }) => {
  await installMockAppsScript(page);
  await page.goto('/');
  await expect(page).toHaveTitle(/AnyLashes/);
  await expect(page.locator('h1')).toBeVisible();
});

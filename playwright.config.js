// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Corre las pruebas E2E contra Google Chrome REAL ya instalado en esta
 * máquina (channel: 'chrome'), no contra el Chromium que trae Playwright
 * por defecto — así se prueba el navegador que de verdad usan las
 * clientas y la dueña del negocio.
 *
 * El servidor estático (scripts/static-server.js) se levanta solo antes de
 * correr las pruebas; no hace falta arrancarlo a mano.
 */
module.exports = defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/artifacts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30000,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/html-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:4173',
    channel: 'chrome',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-1440x900', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'laptop-1366x768', use: { viewport: { width: 1366, height: 768 } } },
    { name: 'tablet-768x1024', use: { viewport: { width: 768, height: 1024 } } },
    { name: 'mobile-390x844', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'mobile-360x800', use: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'node scripts/static-server.js 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});

'use strict';
const { test, expect } = require('./fixtures');
const { loginAsAdmin, TEST_PASSWORD } = require('./adminHelpers');
const { API_URL_PATTERN } = require('./mockAppsScript');

test.describe('Panel administrativo — autenticación', () => {
  test('sin sesión: se ve la pantalla de acceso privado y NO se expone información de citas', async ({ page }) => {
    await page.goto('/admin.html');
    await expect(page.locator('#loginOverlay')).toHaveClass(/is-open/);
    await expect(page.locator('#adminMain')).toBeHidden();
    // No debe haber ninguna tarjeta de cita en el DOM todavía (ni oculta):
    // la información privada nunca se pide sin sesión.
    await expect(page.locator('.appt-card')).toHaveCount(0);
  });

  test('contraseña incorrecta: muestra error y no entra', async ({ page, env }) => {
    const { setAdminPassword } = require('./mockAppsScript');
    setAdminPassword(env, TEST_PASSWORD);
    await page.goto('/admin.html');
    await page.fill('#loginPassword', 'clave-equivocada');
    await page.locator('#loginSubmitBtn').click();
    await expect(page.locator('#loginError')).toBeVisible();
    await expect(page.locator('#loginError')).toContainText(/incorrecta/i);
    await expect(page.locator('#adminMain')).toBeHidden();
  });

  test('login correcto muestra el panel; logout regresa a la pantalla de acceso', async ({ page, env }) => {
    await loginAsAdmin(page, env);
    await expect(page.locator('#adminMain')).toBeVisible();

    await page.locator('#logoutBtn').click();
    await expect(page.locator('#loginOverlay')).toHaveClass(/is-open/);
    await expect(page.locator('#adminMain')).toBeHidden();
  });

  test('sesión vencida durante una operación: regresa al login con aviso, sin tronar', async ({ page, env }) => {
    await loginAsAdmin(page, env);

    // Simula que el token expiró justo antes de la siguiente petición
    // autenticada (p. ej. al cambiar de mes).
    await page.route(API_URL_PATTERN, async (route) => {
      const req = route.request();
      if (req.method() === 'GET' && req.url().indexOf('action=appointments') !== -1) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: 'Sesión inválida o vencida. Inicia sesión de nuevo.' }) });
        return;
      }
      await route.fallback();
    });

    await page.locator('#nextMonthBtn').click();
    await expect(page.locator('#loginOverlay')).toHaveClass(/is-open/, { timeout: 10000 });
    await expect(page.locator('#loginError')).toContainText(/sesión/i);
  });
});

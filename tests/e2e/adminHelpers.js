'use strict';
const { setAdminPassword } = require('./mockAppsScript');

const TEST_PASSWORD = 'clave-de-pruebas-e2e';

/** Deja el mock listo con contraseña conocida y hace login real por la UI
 * (no por atajo): escribe la contraseña y envía el formulario, como lo
 * haría la dueña. Devuelve una vez que el panel ya está visible. */
async function loginAsAdmin(page, env) {
  setAdminPassword(env, TEST_PASSWORD);
  await page.goto('/admin.html');
  await page.fill('#loginPassword', TEST_PASSWORD);
  await page.locator('#loginSubmitBtn').click();
  await page.locator('#adminMain').waitFor({ state: 'visible' });
}

module.exports = { loginAsAdmin, TEST_PASSWORD };

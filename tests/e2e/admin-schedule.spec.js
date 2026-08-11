'use strict';
const { test, expect } = require('./fixtures');
const { installSlowMockAppsScript, setAdminPassword } = require('./mockAppsScript');
const { daysFromNow } = require('./helpers');

// Bug real reportado: al entrar al panel, la carga del horario ya guardado
// para el día (una petición async) podía resolverse DESPUÉS de que la
// administradora ya hubiera agregado un horario a mano — y esa respuesta
// tardía pisaba en silencio lo que acababa de agregar, dejando la lista
// vacía justo antes de guardar. Esta prueba fuerza esa carrera con un mock
// lento y confirma que el horario agregado sobrevive y se guarda de verdad.
test('agregar un horario a mano mientras el horario del día todavía está cargando no lo pierde al guardar', async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const slowEnv = await installSlowMockAppsScript(page, 1200);
  setAdminPassword(slowEnv, 'clave-de-pruebas-e2e');
  const today = daysFromNow(0);

  await page.goto('/admin.html');
  await page.fill('#loginPassword', 'clave-de-pruebas-e2e');
  await page.locator('#loginSubmitBtn').click();
  await page.locator('#adminMain').waitFor({ state: 'visible' });

  // El panel recién mostrado ya disparó, en segundo plano, la carga lenta
  // del horario existente para hoy. Antes de que esa respuesta llegue
  // (1200ms), se agrega un horario a mano — esto no necesita red, así que
  // ocurre casi al instante.
  await page.fill('#manualTime', '11:00');
  await page.locator('#addSlotBtn').click();
  await expect(page.locator('#scheduleList')).toContainText('11:00');

  // Se espera a que la carga lenta ya haya tenido tiempo de resolver.
  await page.waitForTimeout(1600);
  // El horario agregado a mano debe seguir ahí — no debe haber sido
  // borrado por la respuesta tardía de la carga original.
  await expect(page.locator('#scheduleList')).toContainText('11:00');

  await page.locator('#saveScheduleBtn').click();
  await expect(page.locator('#scheduleFeedback')).toContainText('guardado', { timeout: 10000 });

  const saved = slowEnv.getScheduleRange(today, today).schedule[today];
  expect(Array.from(saved || [])).toEqual(['11:00']);
});

test('guardar un horario del día sin ningún horario en la lista pide confirmación', async ({ page, env }) => {
  const { loginAsAdmin } = require('./adminHelpers');
  await loginAsAdmin(page, env);

  // Al entrar, el día seleccionado por defecto (hoy) no tiene horarios
  // guardados — la lista ya está vacía sin que el usuario haya hecho nada.
  await page.locator('#scheduleList .slots__empty').waitFor();
  await page.locator('#saveScheduleBtn').click();

  await expect(page.locator('#confirmModal')).toHaveClass(/is-open/);
  await expect(page.locator('#confirmModalText')).toContainText(/sin horarios/i);

  // Cancelar la confirmación no debe guardar nada.
  await page.locator('#confirmModalDismiss').click();
  await expect(page.locator('#confirmModal')).not.toHaveClass(/is-open/);
});

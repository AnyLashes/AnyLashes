'use strict';
const { test, expect } = require('./fixtures');
const { loginAsAdmin } = require('./adminHelpers');
const { daysFromNow } = require('./helpers');
const { API_URL_PATTERN } = require('./mockAppsScript');

async function selectCalendarDay(page, dateStr) {
  for (let i = 0; i < 3; i++) {
    const cell = page.locator(`.calendar-day[data-date="${dateStr}"]`);
    if (await cell.count()) { await cell.click(); return; }
    await page.locator('#nextMonthBtn').click();
  }
  throw new Error('No se encontró el día ' + dateStr + ' en el calendario tras navegar meses.');
}

async function fillApptForm(page, { name = 'Cliente Manual', phone = '2321234567', service = 'Técnica clásica', style = 'Natural Soft', date, notes = '' } = {}) {
  await page.fill('#apptFormName', name);
  await page.fill('#apptFormPhone', phone);
  await page.selectOption('#apptFormService', service);
  await page.selectOption('#apptFormStyle', style);
  await page.fill('#apptFormDate', date);
  await page.waitForFunction(() => {
    var wrap = document.getElementById('apptFormSlots');
    return wrap && wrap.querySelector('.slot-btn') && !wrap.textContent.includes('Cargando');
  });
  if (notes) await page.fill('#apptFormNotes', notes);
}

test.describe('Panel administrativo — crear, editar y reprogramar citas manualmente', () => {
  test('botón "Nueva cita" abre un modal accesible con foco atrapado y cierre con Escape', async ({ page, env }) => {
    await loginAsAdmin(page, env);
    await page.locator('#newApptBtn').click();
    await expect(page.locator('#apptFormModal')).toHaveClass(/is-open/);
    await expect(page.locator('#apptFormName')).toBeFocused();

    // Escape sin datos capturados: cierra directo (no hay nada que descartar).
    await page.keyboard.press('Escape');
    await expect(page.locator('#apptFormModal')).not.toHaveClass(/is-open/);
    await expect(page.locator('#newApptBtn')).toBeFocused();
  });

  test('Escape con datos sin guardar pide confirmación antes de descartar', async ({ page, env }) => {
    await loginAsAdmin(page, env);
    await page.locator('#newApptBtn').click();
    await page.fill('#apptFormName', 'Datos que no quiero perder');
    await page.keyboard.press('Escape');

    await expect(page.locator('#confirmModal')).toHaveClass(/is-open/);
    await page.locator('#confirmModalDismiss').click(); // "No, mantener"
    await expect(page.locator('#apptFormModal')).toHaveClass(/is-open/);
    await expect(page.locator('#apptFormName')).toHaveValue('Datos que no quiero perder');
  });

  test('navegación completa por teclado dentro del formulario', async ({ page, env }) => {
    await loginAsAdmin(page, env);
    await page.locator('#newApptBtn').click();
    await expect(page.locator('#apptFormName')).toBeFocused();
    // Tab a través de varios campos debe mantenerse dentro del modal.
    for (let i = 0; i < 20; i++) await page.keyboard.press('Tab');
    const stillInside = await page.evaluate(() => {
      var modal = document.getElementById('apptFormModal');
      return modal.contains(document.activeElement);
    });
    expect(stillInside).toBe(true);
  });

  test('crea una cita manual válida y aparece de inmediato en el listado, sin recargar', async ({ page, env }) => {
    const date = daysFromNow(3);
    env.saveSchedule(date, ['10:00', '11:00', '12:00']);
    await loginAsAdmin(page, env);

    await page.locator('#newApptBtn').click();
    await fillApptForm(page, { date, name: 'María Manual', notes: 'Cliente VIP' });
    await page.locator('#apptFormSlots .slot-btn').first().click();
    await page.locator('#apptFormSubmitBtn').click();

    await expect(page.locator('#apptFormModal')).not.toHaveClass(/is-open/, { timeout: 10000 });
    // Foco regresa al botón que abrió el modal.
    await expect(page.locator('#newApptBtn')).toBeFocused();

    await selectCalendarDay(page, date);
    await expect(page.locator('.appt-card')).toContainText('María Manual');
    await expect(page.locator('.appt-card')).toContainText('Cliente VIP');

    const appts = env.getAppointments(date, date).appointments;
    expect(appts).toHaveLength(1);
    expect(appts[0].source).toBe('admin');
  });

  test('doble clic al guardar no crea dos citas', async ({ page, env }) => {
    const date = daysFromNow(3);
    env.saveSchedule(date, ['10:00', '11:00']);
    await loginAsAdmin(page, env);
    await page.locator('#newApptBtn').click();
    await fillApptForm(page, { date });
    await page.locator('#apptFormSlots .slot-btn').first().click();

    // Dos clics en el mismo tick de JS (no dos .click() de Playwright en
    // paralelo): el modal se cierra en cuanto el primero tiene éxito, y
    // para entonces el botón deja de ser "visible" — dos acciones de
    // Playwright corriendo a la vez sobre un elemento que desaparece a
    // medio camino es una carrera de la PRUEBA, no del comportamiento que
    // se quiere comprobar. Disparar ambos clics síncronamente reproduce
    // el doble clic real y además ejercita la protección nativa del
    // navegador (un botón ya deshabilitado no dispara un segundo click).
    await page.evaluate(() => {
      var btn = document.getElementById('apptFormSubmitBtn');
      btn.click();
      btn.click();
    });
    await expect(page.locator('#apptFormModal')).not.toHaveClass(/is-open/, { timeout: 10000 });

    expect(env.getAppointments(date, date).appointments).toHaveLength(1);
  });

  test('crear en un horario ya ocupado: error claro y el modal se queda abierto para corregir', async ({ page, env }) => {
    await loginAsAdmin(page, env);
    const date = daysFromNow(3);
    env.saveSchedule(date, ['10:00']);
    env.createAdminAppointment({ date, time: '10:00', service: 'Mega volumen', style: 'Volumen Elegante', clientName: 'Ya estaba', clientPhone: '2320000000' });

    await page.locator('#newApptBtn').click();
    await page.fill('#apptFormName', 'Nueva clienta');
    await page.fill('#apptFormPhone', '2321234567');
    await page.selectOption('#apptFormService', 'Retoque');
    await page.selectOption('#apptFormStyle', 'Natural Soft');
    await page.fill('#apptFormDate', date);
    // El horario 10:00 debe verse ocupado (Mega volumen dura 210 min).
    await expect(page.locator('#apptFormSlots .slot-btn', { hasText: '10:00' })).toBeDisabled();
  });

  test('intento de manipular servicio/estilo/estado inválidos: el servidor lo rechaza', async ({ page, env }) => {
    await loginAsAdmin(page, env);
    const date = daysFromNow(3);
    await page.locator('#newApptBtn').click();
    await page.fill('#apptFormName', 'Cliente');
    await page.fill('#apptFormPhone', '2321234567');
    await page.fill('#apptFormDate', date);
    await page.evaluate(() => {
      var opt = document.createElement('option');
      opt.value = 'Servicio Falso';
      opt.textContent = 'Servicio Falso';
      document.getElementById('apptFormService').appendChild(opt);
    });
    await page.selectOption('#apptFormService', 'Servicio Falso');
    await page.selectOption('#apptFormStyle', 'Natural Soft');
    await page.evaluate(() => { document.getElementById('apptFormTime').value = '10:00'; });
    await page.locator('#apptFormSubmitBtn').click();
    await expect(page.locator('#apptFormFeedback')).toContainText(/servicio.*no.*válido/i, { timeout: 10000 });
    // No debe haberse creado nada.
    expect(env.getAppointments(date, date).appointments).toHaveLength(0);
  });

  test('editar datos del cliente de una cita existente', async ({ page, env }) => {
    const date = daysFromNow(3);
    // Se siembra ANTES de iniciar sesión: loginAsAdmin ya dispara la
    // primera carga del mes (loadMonthData) al entrar, y esa carga no se
    // repite sola — si se siembra después, la cita queda en el servidor
    // pero el panel nunca se entera hasta el siguiente heartbeat (30s).
    env.saveSchedule(date, ['10:00']);
    env.createAdminAppointment({ date, time: '10:00', service: 'Técnica clásica', style: 'Natural Soft', clientName: 'Nombre Original', clientPhone: '2321111111' });
    await loginAsAdmin(page, env);

    await selectCalendarDay(page, date);
    await page.locator('.appt-card', { hasText: 'Nombre Original' }).locator('button', { hasText: 'Editar' }).click();
    await expect(page.locator('#apptFormTitle')).toContainText(/editar/i);
    await expect(page.locator('#apptFormName')).toHaveValue('Nombre Original');

    await page.fill('#apptFormName', 'Nombre Corregido');
    await page.locator('#apptFormSubmitBtn').click();
    await expect(page.locator('#apptFormModal')).not.toHaveClass(/is-open/, { timeout: 10000 });

    const appt = env.getAppointments(date, date).appointments[0];
    expect(appt.clientName).toBe('Nombre Corregido');
  });

  test('reprogramar una cita a otro horario recalcula disponibilidad y mueve la cita', async ({ page, env }) => {
    const date = daysFromNow(3);
    env.saveSchedule(date, ['10:00', '13:00']);
    const created = env.createAdminAppointment({ date, time: '10:00', service: 'Técnica clásica', style: 'Natural Soft', clientName: 'Reprogramar', clientPhone: '2321111111' });
    await loginAsAdmin(page, env);

    await selectCalendarDay(page, date);
    await page.locator('.appt-card', { hasText: 'Reprogramar' }).locator('button', { hasText: 'Editar' }).click();

    // El propio horario actual (10:00) debe seguir seleccionable (excludeId).
    await expect(page.locator('#apptFormSlots .slot-btn', { hasText: '10:00' })).not.toBeDisabled();
    await page.locator('#apptFormSlots .slot-btn', { hasText: '13:00' }).click();
    await page.locator('#apptFormSubmitBtn').click();
    await expect(page.locator('#apptFormModal')).not.toHaveClass(/is-open/, { timeout: 10000 });

    const appt = env.getAppointments(date, date).appointments.find((a) => a.id === created.id);
    expect(appt.time).toBe('13:00');
  });

  test('reprogramar ENCIMA de otra cita existente se bloquea', async ({ page, env }) => {
    const date = daysFromNow(3);
    env.saveSchedule(date, ['10:00', '13:00']);
    env.createAdminAppointment({ date, time: '10:00', service: 'Técnica clásica', style: 'Natural Soft', clientName: 'Cita A', clientPhone: '2321111111' });
    env.createAdminAppointment({ date, time: '13:00', service: 'Técnica clásica', style: 'Natural Soft', clientName: 'Cita B', clientPhone: '2322222222' });
    await loginAsAdmin(page, env);

    await selectCalendarDay(page, date);
    await page.locator('.appt-card', { hasText: 'Cita A' }).locator('button', { hasText: 'Editar' }).click();
    await expect(page.locator('#apptFormSlots .slot-btn', { hasText: '13:00' })).toBeDisabled();
  });

  test('cambiar el estado de una cita a "Concluida" se refleja en la tarjeta', async ({ page, env }) => {
    const date = daysFromNow(3);
    env.saveSchedule(date, ['10:00']);
    const created = env.createAdminAppointment({ date, time: '10:00', service: 'Técnica clásica', style: 'Natural Soft', clientName: 'Cambiar Estado', clientPhone: '2321111111' });
    await loginAsAdmin(page, env);

    await selectCalendarDay(page, date);
    await page.locator('.appt-card', { hasText: 'Cambiar Estado' }).locator('button', { hasText: 'Editar' }).click();
    await page.selectOption('#apptFormStatus', 'completed');
    await page.locator('#apptFormSubmitBtn').click();
    await expect(page.locator('#apptFormModal')).not.toHaveClass(/is-open/, { timeout: 10000 });

    const appt = env.getAppointments(date, date).appointments.find((a) => a.id === created.id);
    expect(appt.status).toBe('completed');
  });

  test('cancelar una cita (flujo existente) sigue funcionando: confirmación, WhatsApp y refresco', async ({ page, env }) => {
    const date = daysFromNow(3);
    env.saveSchedule(date, ['10:00']);
    env.createAdminAppointment({ date, time: '10:00', service: 'Técnica clásica', style: 'Natural Soft', clientName: 'Para Cancelar', clientPhone: '2321111111' });
    await loginAsAdmin(page, env);

    await selectCalendarDay(page, date);
    await page.locator('.appt-card', { hasText: 'Para Cancelar' }).locator('button', { hasText: 'Cancelar cita' }).click();
    await expect(page.locator('#confirmModal')).toHaveClass(/is-open/);
    await page.locator('#confirmModalConfirm').click();
    await expect(page.locator('.appt-card.is-cancelled')).toBeVisible({ timeout: 10000 });
  });

  test('móvil: el modal de nueva cita es usable en una pantalla de 390x844', async ({ page, env }) => {
    const date = daysFromNow(3);
    env.saveSchedule(date, ['10:00', '11:00']);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsAdmin(page, env);

    await page.locator('#newApptBtn').click();
    await expect(page.locator('#apptFormModal')).toHaveClass(/is-open/);
    await fillApptForm(page, { date });
    await page.locator('#apptFormSlots .slot-btn').first().scrollIntoViewIfNeeded();
    await page.locator('#apptFormSlots .slot-btn').first().click();
    await page.locator('#apptFormSubmitBtn').scrollIntoViewIfNeeded();
    await page.locator('#apptFormSubmitBtn').click();
    await expect(page.locator('#apptFormModal')).not.toHaveClass(/is-open/, { timeout: 10000 });
  });

  test('recargar la página conserva la cita creada (persistida en el servidor, no solo en memoria del navegador)', async ({ page, env }) => {
    await loginAsAdmin(page, env);
    const date = daysFromNow(3);
    env.saveSchedule(date, ['10:00']);
    env.createAdminAppointment({ date, time: '10:00', service: 'Técnica clásica', style: 'Natural Soft', clientName: 'Persistente', clientPhone: '2321111111' });

    await page.reload();
    await page.locator('#adminMain').waitFor({ state: 'visible' });
    await selectCalendarDay(page, date);
    await expect(page.locator('.appt-card')).toContainText('Persistente');
  });

  test('cambiar servicio o fecha después de elegir horario vuelve a pedir disponibilidad (sin peticiones extra innecesarias)', async ({ page, env }) => {
    await loginAsAdmin(page, env);
    const date = daysFromNow(3);
    env.saveSchedule(date, ['10:00', '11:00']);

    let slotsRequests = 0;
    page.on('request', (req) => {
      if (req.url().indexOf('action=slots') !== -1) slotsRequests++;
    });

    await page.locator('#newApptBtn').click();
    await page.selectOption('#apptFormService', 'Técnica clásica');
    await page.fill('#apptFormDate', date);
    await page.waitForFunction(() => document.querySelectorAll('#apptFormSlots .slot-btn').length > 0);
    const afterFirstLoad = slotsRequests;
    expect(afterFirstLoad).toBeGreaterThan(0);

    await page.selectOption('#apptFormService', 'Mega volumen');
    await page.waitForTimeout(300);
    expect(slotsRequests).toBeGreaterThan(afterFirstLoad); // sí se refrescó
    expect(slotsRequests).toBeLessThanOrEqual(afterFirstLoad + 2); // pero no en exceso
  });
});

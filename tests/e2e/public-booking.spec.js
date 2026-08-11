'use strict';
const { test, expect } = require('./fixtures');
const { daysFromNow } = require('./helpers');
const { API_URL_PATTERN } = require('./mockAppsScript');

async function fillBookingBasics(page, { service = 'Técnica clásica', style = 'Natural Soft', date, name = 'Cliente de prueba', phone = '2321234567' } = {}) {
  await page.selectOption('#bookingService', service);
  await page.selectOption('#bookingStyle', style);
  await page.fill('#bookingDate', date);
  await page.fill('#bookingName', name);
  await page.fill('#bookingPhone', phone);
}

test.describe('Reserva pública — flujo completo', () => {
  test('flujo feliz: elegir servicio, fecha, horario, llenar datos y confirmar', async ({ page, env }) => {
    const date = daysFromNow(10);
    env.saveSchedule(date, ['10:00', '12:00', '15:00']);

    await page.goto('/#reserva');
    await fillBookingBasics(page, { date });

    await expect(page.locator('#bookingSlots .slot-btn')).toHaveCount(3);
    await page.locator('#bookingSlots .slot-btn', { hasText: '12:00' }).click();
    await expect(page.locator('#bookingTime')).toHaveValue('12:00');

    await expect(page.locator('#bookingSummary')).toContainText('12:00');

    await page.locator('#bookingForm button[type="submit"]').click();
    await expect(page.locator('#bookingSummary')).toContainText('Registramos tu cita', { timeout: 10000 });

    const appts = env.getAppointments(date, date).appointments;
    expect(appts).toHaveLength(1);
    expect(appts[0].time).toBe('12:00');
    expect(appts[0].service).toBe('Técnica clásica');
  });

  test('campos vacíos: no envía y marca cada campo inválido junto a su error', async ({ page }) => {
    await page.goto('/#reserva');
    await page.locator('#bookingForm button[type="submit"]').click();

    await expect(page.locator('#bookingService').locator('xpath=..')).toHaveClass(/has-error/);
    await expect(page.locator('#bookingName').locator('xpath=..')).toHaveClass(/has-error/);
    await expect(page.locator('#bookingPhone').locator('xpath=..')).toHaveClass(/has-error/);
  });

  test('teléfono inválido y nombre demasiado corto se rechazan en el cliente', async ({ page }) => {
    const date = daysFromNow(10);
    await page.goto('/#reserva');
    await page.fill('#bookingName', 'A');
    await page.fill('#bookingPhone', '123');
    await page.locator('#bookingForm button[type="submit"]').click();

    await expect(page.locator('#bookingName').locator('xpath=..')).toHaveClass(/has-error/);
    await expect(page.locator('#bookingPhone').locator('xpath=..')).toHaveClass(/has-error/);
  });

  test('espacios al inicio/fin del nombre no impiden reservar (se recortan)', async ({ page, env }) => {
    const date = daysFromNow(10);
    env.saveSchedule(date, ['10:00']);
    await page.goto('/#reserva');
    await fillBookingBasics(page, { date, name: '   Ana Espacios   ' });
    await page.locator('#bookingSlots .slot-btn').click();
    await page.locator('#bookingForm button[type="submit"]').click();
    await expect(page.locator('#bookingSummary')).toContainText('Registramos tu cita', { timeout: 10000 });
    expect(env.getAppointments(date, date).appointments[0].clientName).toBe('Ana Espacios');
  });

  test('fecha pasada (forzada saltándose el selector nativo) es rechazada por el servidor', async ({ page, env }) => {
    const past = daysFromNow(-5);
    // Se publica ese horario para que la única razón de rechazo posible sea
    // "la fecha ya pasó" — si no se seedea, el servidor rechaza antes por
    // "horario no publicado", que es una regla distinta y también válida.
    env.saveSchedule(past, ['10:00']);
    await page.goto('/#reserva');
    await fillBookingBasics(page, { date: past });
    // No hay horarios publicados para una fecha pasada, así que se agrega
    // uno "a mano" en la hora oculta para forzar el envío y comprobar que
    // el SERVIDOR (no solo el <input min>) es quien de verdad lo bloquea.
    await page.evaluate(() => { document.getElementById('bookingTime').value = '10:00'; });
    await page.locator('#bookingForm button[type="submit"]').click();
    await expect(page.locator('#bookingSummary')).toContainText(/pasó/i, { timeout: 10000 });
  });

  test('servicio manipulado en el DOM es rechazado por el servidor, no solo por la interfaz', async ({ page }) => {
    const date = daysFromNow(10);
    await page.goto('/#reserva');
    // Simula un cliente alterado: se inyecta una opción que no existe en
    // la whitelist real y se envía tal cual llegaría de un fetch manual.
    await page.evaluate(() => {
      var opt = document.createElement('option');
      opt.value = 'Servicio Inventado';
      opt.textContent = 'Servicio Inventado';
      document.getElementById('bookingService').appendChild(opt);
    });
    await page.selectOption('#bookingService', 'Servicio Inventado');
    await page.selectOption('#bookingStyle', 'Natural Soft');
    await page.fill('#bookingDate', date);
    await page.fill('#bookingName', 'Cliente de prueba');
    await page.fill('#bookingPhone', '2321234567');
    await page.evaluate(() => { document.getElementById('bookingTime').value = '10:00'; });
    await page.locator('#bookingForm button[type="submit"]').click();
    await expect(page.locator('#bookingSummary')).toContainText(/servicio.*no.*válido/i, { timeout: 10000 });
  });

  test('horario ya ocupado: el botón aparece deshabilitado y no se puede reservar', async ({ page, env }) => {
    const date = daysFromNow(10);
    env.saveSchedule(date, ['10:00', '11:00']);
    env.createAppointment({ date, time: '10:00', service: 'Técnica clásica', style: 'Natural Soft', clientName: 'Ya reservada', clientPhone: '2320000000' });

    await page.goto('/#reserva');
    await fillBookingBasics(page, { date });
    const bookedBtn = page.locator('#bookingSlots .slot-btn', { hasText: '10:00' });
    await expect(bookedBtn).toBeDisabled();
  });

  test('condición de carrera: el horario se ocupa DESPUÉS de listarlo pero ANTES de enviar — el servidor lo detiene', async ({ page, env }) => {
    const date = daysFromNow(10);
    env.saveSchedule(date, ['10:00']);

    await page.goto('/#reserva');
    await fillBookingBasics(page, { date });
    await page.locator('#bookingSlots .slot-btn').click();

    // Alguien más reserva ese mismo horario justo antes de que se confirme.
    env.createAppointment({ date, time: '10:00', service: 'Mega volumen', style: 'Volumen Elegante', clientName: 'Otra clienta', clientPhone: '2321119999' });

    await page.locator('#bookingForm button[type="submit"]').click();
    await expect(page.locator('#bookingSummary')).toContainText(/ya no está disponible|traslapa|reservado/i, { timeout: 10000 });
    expect(env.getAppointments(date, date).appointments).toHaveLength(1); // solo la de "Otra clienta"
  });

  test('doble clic en "Reservar" no crea dos citas', async ({ page, env }) => {
    const date = daysFromNow(10);
    env.saveSchedule(date, ['10:00']);
    await page.goto('/#reserva');
    await fillBookingBasics(page, { date });
    await page.locator('#bookingSlots .slot-btn').click();

    const submitBtn = page.locator('#bookingForm button[type="submit"]');
    await Promise.all([submitBtn.click(), submitBtn.click({ force: true })]);
    await expect(page.locator('#bookingSummary')).toContainText('Registramos tu cita', { timeout: 10000 });

    expect(env.getAppointments(date, date).appointments).toHaveLength(1);
  });

  test('honeypot: si el campo invisible "website" llega lleno, no se crea ninguna cita real', async ({ page, env }) => {
    const date = daysFromNow(10);
    env.saveSchedule(date, ['10:00']);
    await page.goto('/#reserva');
    await fillBookingBasics(page, { date });
    await page.locator('#bookingSlots .slot-btn').click();
    await page.locator('#bookingWebsite').fill('http://spam.example', { force: true });

    await page.locator('#bookingForm button[type="submit"]').click();
    // El bot "ve" éxito (para no delatar la trampa)...
    await expect(page.locator('#bookingSummary')).toContainText('Registramos tu cita', { timeout: 10000 });
    // ...pero no debe haber quedado ninguna cita real.
    expect(env.getAppointments(date, date).appointments).toHaveLength(0);
  });

  test('error de red: mensaje claro y el usuario puede reintentar cuando vuelve la conexión', async ({ page, env }) => {
    const { simulateNetworkFailure, restoreNetwork } = require('./mockAppsScript');
    const date = daysFromNow(10);
    env.saveSchedule(date, ['10:00']);
    // El abort() de la red genera un "requestfailed" real — es la señal
    // esperada de esta prueba, no un bug.
    // Chrome reporta el mismo corte de red dos veces: como evento
    // "requestfailed" y también como mensaje de consola "net::ERR_FAILED".
    env.expectedProblems.push(/requestfailed|net::ERR_FAILED/);

    await page.goto('/#reserva');
    await fillBookingBasics(page, { date });
    await page.locator('#bookingSlots .slot-btn').click();

    // Se corta la red justo antes de enviar (una capa por ENCIMA del mock,
    // así que al quitarla el mock original — con el horario ya sembrado —
    // sigue funcionando exactamente igual que antes del corte).
    const failureHandler = await simulateNetworkFailure(page);
    await page.locator('#bookingForm button[type="submit"]').click();
    await expect(page.locator('#bookingSummary')).toContainText(/no pudimos conectar/i, { timeout: 10000 });
    await expect(page.locator('#bookingForm button[type="submit"]')).toBeEnabled();

    // Vuelve la conexión: reintentar debe funcionar, con los mismos datos.
    await restoreNetwork(page, failureHandler);
    await page.locator('#bookingForm button[type="submit"]').click();
    await expect(page.locator('#bookingSummary')).toContainText('Registramos tu cita', { timeout: 10000 });
  });

  test('respuesta lenta del servidor: el botón queda deshabilitado mientras espera, sin trabarse', async ({ page }) => {
    const date = daysFromNow(10);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const { installSlowMockAppsScript } = require('./mockAppsScript');
    const slowEnv = await installSlowMockAppsScript(page, 1200);
    slowEnv.saveSchedule(date, ['10:00']);

    await page.goto('/#reserva');
    await fillBookingBasics(page, { date });
    await page.locator('#bookingSlots .slot-btn').click();

    const submitBtn = page.locator('#bookingForm button[type="submit"]');
    await submitBtn.click();
    await expect(submitBtn).toBeDisabled();
    await expect(page.locator('#bookingSummary')).toContainText('Registramos tu cita', { timeout: 10000 });
    await expect(submitBtn).toBeEnabled();
  });

  test('error genérico del servidor se muestra sin exponer detalles internos', async ({ page }) => {
    const date = daysFromNow(10);
    await page.goto('/#reserva');
    await fillBookingBasics(page, { date });
    await page.evaluate(() => { document.getElementById('bookingTime').value = '10:00'; });

    // Sustituye la acción "book" por un error genérico del servidor, sin
    // tocar el resto de la API (login, slots, etc. siguen funcionando).
    await page.route(API_URL_PATTERN, async (route) => {
      const req = route.request();
      const body = req.postData() || '';
      if (req.method() === 'POST' && body.indexOf('"action":"book"') !== -1) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: 'Ocurrió un error inesperado.' }) });
        return;
      }
      await route.fallback();
    });

    await page.locator('#bookingForm button[type="submit"]').click();
    await expect(page.locator('#bookingSummary')).toContainText('Ocurrió un error inesperado.', { timeout: 10000 });
    // No debe filtrar trazas, rutas de archivo ni nombres de función internos.
    const text = await page.locator('#bookingSummary').textContent();
    expect(text).not.toMatch(/at [A-Za-z_]+\s*\(|\.gs:\d+|TypeError|ReferenceError/);
  });
});

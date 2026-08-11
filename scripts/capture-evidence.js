'use strict';
/** Script de un solo uso: genera capturas de los flujos principales ya
 * verificados por las pruebas E2E, para incluirlas como evidencia en el
 * reporte final. No es parte de la suite de pruebas. */
const { chromium } = require('@playwright/test');
const path = require('path');
const { installMockAppsScript, setAdminPassword } = require('../tests/e2e/mockAppsScript');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const OUT = path.join(__dirname, '..', 'evidence');

async function main() {
  const browser = await chromium.launch({ channel: 'chrome' });

  // 1) Reserva pública completada
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const env = await installMockAppsScript(page);
    const date = daysFromNow(10);
    env.saveSchedule(date, ['10:00', '12:00', '15:00']);
    await page.goto('http://localhost:4173/#reserva');
    await page.selectOption('#bookingService', 'Técnica clásica');
    await page.selectOption('#bookingStyle', 'Natural Soft');
    await page.fill('#bookingDate', date);
    await page.locator('#bookingSlots .slot-btn', { hasText: '12:00' }).click();
    await page.fill('#bookingName', 'Ana Ejemplo');
    await page.fill('#bookingPhone', '2321234567');
    await page.locator('#bookingForm button[type="submit"]').click();
    await page.locator('#bookingSummary').getByText('Registramos tu cita').waitFor();
    await page.screenshot({ path: path.join(OUT, '1-reserva-publica-completada.png') });
    await page.close();
  }

  // 2) Cita manual creada en el panel
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const env = await installMockAppsScript(page);
    setAdminPassword(env, 'demo12345');
    const date = daysFromNow(3);
    env.saveSchedule(date, ['10:00', '11:00']);
    await page.goto('http://localhost:4173/admin.html');
    await page.fill('#loginPassword', 'demo12345');
    await page.locator('#loginSubmitBtn').click();
    await page.locator('#adminMain').waitFor({ state: 'visible' });
    await page.locator('#newApptBtn').click();
    await page.fill('#apptFormName', 'María Manual');
    await page.fill('#apptFormPhone', '2321234567');
    await page.selectOption('#apptFormService', 'Técnica clásica');
    await page.selectOption('#apptFormStyle', 'Natural Soft');
    await page.fill('#apptFormDate', date);
    await page.waitForFunction(() => document.querySelectorAll('#apptFormSlots .slot-btn').length > 0);
    await page.locator('#apptFormSlots .slot-btn').first().click();
    await page.locator('#apptFormSubmitBtn').click();
    await page.locator('#apptFormModal.is-open').waitFor({ state: 'detached' }).catch(() => {});
    for (let i = 0; i < 3; i++) {
      const cell = page.locator(`.calendar-day[data-date="${date}"]`);
      if (await cell.count()) { await cell.click(); break; }
      await page.locator('#nextMonthBtn').click();
    }
    await page.locator('.appt-card', { hasText: 'María Manual' }).waitFor();
    await page.screenshot({ path: path.join(OUT, '2-cita-manual-creada.png') });
    await page.close();
  }

  // 3) Cita reprogramada
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const env = await installMockAppsScript(page);
    setAdminPassword(env, 'demo12345');
    const date = daysFromNow(3);
    env.saveSchedule(date, ['10:00', '13:00']);
    env.createAdminAppointment({ date, time: '10:00', service: 'Técnica clásica', style: 'Natural Soft', clientName: 'Cliente a Reprogramar', clientPhone: '2321111111' });
    await page.goto('http://localhost:4173/admin.html');
    await page.fill('#loginPassword', 'demo12345');
    await page.locator('#loginSubmitBtn').click();
    await page.locator('#adminMain').waitFor({ state: 'visible' });
    for (let i = 0; i < 3; i++) {
      const cell = page.locator(`.calendar-day[data-date="${date}"]`);
      if (await cell.count()) { await cell.click(); break; }
      await page.locator('#nextMonthBtn').click();
    }
    await page.locator('.appt-card', { hasText: 'Cliente a Reprogramar' }).locator('button', { hasText: 'Editar' }).click();
    await page.locator('#apptFormSlots .slot-btn', { hasText: '13:00' }).click();
    await page.screenshot({ path: path.join(OUT, '3-reprogramando-cita.png') });
    await page.locator('#apptFormSubmitBtn').click();
    await page.locator('#apptFormModal.is-open').waitFor({ state: 'detached' }).catch(() => {});
    await page.screenshot({ path: path.join(OUT, '3b-cita-reprogramada.png') });
    await page.close();
  }

  // 4) Vista móvil (landing)
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await installMockAppsScript(page);
    await page.goto('http://localhost:4173/');
    await page.locator('#hamburgerBtn').click();
    await page.locator('#mobileMenu.is-open').waitFor();
    await page.screenshot({ path: path.join(OUT, '4-vista-movil-menu.png') });
    await page.close();
  }

  await browser.close();
  console.log('Capturas guardadas en', OUT);
}

main().catch((err) => { console.error(err); process.exit(1); });

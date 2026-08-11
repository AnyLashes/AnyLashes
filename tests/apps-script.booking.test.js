'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/fakeGas');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
/** Fecha futura en formato yyyy-MM-dd, calculada desde "hoy" para que la
 * prueba nunca quede obsoleta ni dependa de una fecha fija en el pasado. */
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function validBooking(overrides) {
  return Object.assign({
    date: daysFromNow(10),
    time: '10:00',
    service: 'Técnica clásica', // 120 min
    style: 'Natural Soft',
    clientName: 'María',
    clientPhone: '2321234567',
  }, overrides);
}

function setupDayWithSlots(env, date, slots) {
  env.saveSchedule(date, slots);
}

test('createAppointment: flujo feliz crea la cita y devuelve un id', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  setupDayWithSlots(env, date, ['10:00', '12:30', '15:00']);

  const res = env.createAppointment(validBooking({ date }));
  assert.equal(res.error, undefined);
  assert.equal(res.ok, true);
  assert.match(res.id, /^apt_/);
});

test('createAppointment: valida campos obligatorios, servicio/estilo desconocidos y datos de contacto', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  setupDayWithSlots(env, date, ['10:00']);

  assert.match(env.createAppointment(validBooking({ date, service: '' })).error, /faltan datos/i);
  assert.match(env.createAppointment(validBooking({ date, service: 'Servicio inventado' })).error, /servicio.*no.*válido/i);
  assert.match(env.createAppointment(validBooking({ date, style: 'Estilo inventado' })).error, /estilo.*no.*válido/i);
  assert.match(env.createAppointment(validBooking({ date, clientName: 'A' })).error, /nombre/i);
  assert.match(env.createAppointment(validBooking({ date, clientName: 'A'.repeat(200) })).error, /nombre/i);
  assert.match(env.createAppointment(validBooking({ date, clientPhone: '123' })).error, /10 dígitos/i);
});

test('createAppointment: rechaza fechas pasadas y horas de hoy que ya pasaron', () => {
  const env = loadAppsScript();
  const yesterday = daysFromNow(-1);
  setupDayWithSlots(env, yesterday, ['10:00']);
  assert.match(env.createAppointment(validBooking({ date: yesterday })).error, /fecha ya pasó/i);

  const today = daysFromNow(0);
  const pastHour = pad(new Date().getHours() === 0 ? 0 : new Date().getHours() - 1) + ':00';
  setupDayWithSlots(env, today, [pastHour]);
  assert.match(env.createAppointment(validBooking({ date: today, time: pastHour })).error, /horario ya pasó/i);
});

test('createAppointment: rechaza un horario que no forma parte del horario publicado ese día', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  setupDayWithSlots(env, date, ['10:00']);
  const res = env.createAppointment(validBooking({ date, time: '17:45' }));
  assert.match(res.error, /ya no está disponible/i);
});

test('createAppointment: NO se puede reservar dos veces la misma hora exacta (traslape total)', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  setupDayWithSlots(env, date, ['10:00']);

  const first = env.createAppointment(validBooking({ date }));
  assert.equal(first.ok, true);

  const second = env.createAppointment(validBooking({ date }));
  assert.ok(second.error);
  assert.match(second.error, /traslapa|reservado/i);
});

test('createAppointment: bloquea un horario que se traslaparía por duración, aunque la hora exacta no coincida', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  // "Mega volumen" dura 210 min: 10:00 ocupa hasta las 13:30.
  setupDayWithSlots(env, date, ['10:00', '12:00', '13:30']);

  const first = env.createAppointment(validBooking({ date, time: '10:00', service: 'Mega volumen' }));
  assert.equal(first.ok, true);

  // 12:00 (Técnica clásica, 120 min) cae DENTRO de la ventana 10:00-13:30.
  const conflicting = env.createAppointment(validBooking({ date, time: '12:00', service: 'Técnica clásica' }));
  assert.ok(conflicting.error);
  assert.match(conflicting.error, /traslapa|reservado/i);

  // 13:30 es justo cuando termina la cita anterior: no se traslapan.
  const backToBack = env.createAppointment(validBooking({ date, time: '13:30', service: 'Retoque' }));
  assert.equal(backToBack.ok, true, backToBack.error);
});

test('createAppointment: una cita cancelada NO bloquea su horario para alguien más', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  setupDayWithSlots(env, date, ['10:00']);

  const first = env.createAppointment(validBooking({ date }));
  assert.equal(first.ok, true);
  env.cancelAppointment(first.id);

  const second = env.createAppointment(validBooking({ date }));
  assert.equal(second.ok, true, second.error);
});

test('createAppointment: peticiones simultáneas por el mismo horario — solo una debe ganar (sin duplicados)', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  setupDayWithSlots(env, date, ['10:00']);

  // El LockService real serializa esto en Apps Script; el stub de pruebas
  // no bloquea nada pero, como Node ejecuta un solo hilo, dos llamadas
  // "seguidas" ya representan el peor caso de una carrera: la segunda debe
  // ver la fila que acaba de escribir la primera.
  const results = [validBooking({ date }), validBooking({ date })].map((b) => env.createAppointment(b));
  const oks = results.filter((r) => r.ok);
  const errors = results.filter((r) => r.error);
  assert.equal(oks.length, 1, 'exactamente una de las dos reservas debe tener éxito');
  assert.equal(errors.length, 1);
});

test('createAppointment: honeypot ("website" lleno) responde éxito falso sin crear la cita de verdad', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  setupDayWithSlots(env, date, ['10:00']);

  const res = env.createAppointment(validBooking({ date, website: 'http://spam.example' }));
  assert.equal(res.ok, true); // el bot ve un "éxito" para no delatar la trampa
  assert.match(res.id, /^apt_/);

  // Pero no debe haber quedado ninguna cita real guardada, y el horario
  // sigue disponible para una persona real.
  assert.equal(env.getAppointments(date, date).appointments.length, 0);
  assert.equal(env.getAvailableSlots(date).booked.length, 0);
});

test('getAvailableSlots: marca como ocupados también los horarios que se traslaparían por duración', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  setupDayWithSlots(env, date, ['10:00', '11:00', '12:00', '13:30']);

  env.createAppointment(validBooking({ date, time: '10:00', service: 'Mega volumen' })); // 210 min => hasta 13:30

  const preview = env.getAvailableSlots(date, 'Técnica clásica');
  // Array.from(): los arrays que cruzan la frontera de `vm` son de un
  // "realm" distinto al de las pruebas — assert.deepEqual los compara mal
  // aunque el contenido sea idéntico. Array.from() los normaliza.
  assert.deepEqual(Array.from(preview.booked).sort(), ['10:00', '11:00', '12:00']);
  assert.ok(preview.booked.indexOf('13:30') === -1, '13:30 empieza justo cuando termina la cita anterior, no debería bloquearse');
});

test('getAvailableSlots: sin servicio elegido, usa una duración conservadora por defecto (no debe tronar)', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  setupDayWithSlots(env, date, ['10:00', '11:00']);
  env.createAppointment(validBooking({ date, time: '10:00' }));

  const res = env.getAvailableSlots(date);
  assert.equal(res.error, undefined);
  assert.ok(Array.isArray(res.booked));
});

test('cancelAppointment y completeAppointment cambian el estado; "no encontrada" para ids inexistentes', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  setupDayWithSlots(env, date, ['10:00', '12:00']);
  const a = env.createAppointment(validBooking({ date, time: '10:00' }));
  const b = env.createAppointment(validBooking({ date, time: '12:00', clientName: 'Ana' }));

  const cancelRes = env.cancelAppointment(a.id);
  assert.equal(cancelRes.ok, true);
  const completeRes = env.completeAppointment(b.id);
  assert.equal(completeRes.ok, true);

  const list = env.getAppointments(date, date).appointments;
  const statusById = Object.fromEntries(list.map((x) => [x.id, x.status]));
  assert.equal(statusById[a.id], 'cancelled');
  assert.equal(statusById[b.id], 'completed');

  assert.match(env.cancelAppointment('no-existe').error, /no encontrada/i);
  assert.match(env.completeAppointment('no-existe').error, /no encontrada/i);
});

test('saveNote guarda y recorta notas demasiado largas (tope de 500 caracteres)', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  setupDayWithSlots(env, date, ['10:00']);
  const appt = env.createAppointment(validBooking({ date, time: '10:00' }));

  env.saveNote(appt.id, 'x'.repeat(1000));
  const saved = env.getAppointments(date, date).appointments[0];
  assert.equal(saved.notes.length, 500);
});

test('saveSchedule reemplaza por completo los horarios del día (no los mezcla con los anteriores)', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  env.saveSchedule(date, ['09:00', '10:00', '11:00']);
  env.saveSchedule(date, ['14:00', '16:00']);

  const res = env.getScheduleRange(date, date);
  assert.deepEqual(Array.from(res.schedule[date]), ['14:00', '16:00']);
});

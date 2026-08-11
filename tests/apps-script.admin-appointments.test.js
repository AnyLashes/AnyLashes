'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/fakeGas');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function validManual(overrides) {
  return Object.assign({
    date: daysFromNow(10),
    time: '10:00',
    service: 'Técnica clásica', // 120 min
    style: 'Natural Soft',
    clientName: 'María',
    clientPhone: '2321234567',
    clientEmail: 'maria@example.com',
    notes: 'Cliente frecuente',
  }, overrides);
}

function setPassword(env, plain) {
  env.PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD_HASH', env.sha256(plain));
}

function loginToken(env) {
  setPassword(env, 'clave-correcta');
  return env.login('clave-correcta').token;
}

test('createAdminAppointment: crea la cita con email y notas, marcada como "admin"', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  env.saveSchedule(date, ['10:00', '12:00']);

  const res = env.createAdminAppointment(validManual({ date }));
  assert.equal(res.error, undefined);
  assert.equal(res.ok, true);

  const appt = env.getAppointments(date, date).appointments[0];
  assert.equal(appt.clientEmail, 'maria@example.com');
  assert.equal(appt.notes, 'Cliente frecuente');
  assert.equal(appt.source, 'admin');
  assert.equal(appt.status, 'confirmed');
});

test('createAdminAppointment: reutiliza EXACTAMENTE la misma validación que la reservación pública (mismos mensajes de error)', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  env.saveSchedule(date, ['10:00']);

  const badService = env.createAdminAppointment(validManual({ date, service: 'Servicio inventado' }));
  assert.match(badService.error, /servicio.*no.*válido/i);

  const badStyle = env.createAdminAppointment(validManual({ date, style: 'Estilo inventado' }));
  assert.match(badStyle.error, /estilo.*no.*válido/i);

  const badPhone = env.createAdminAppointment(validManual({ date, clientPhone: '123' })).error;
  assert.match(badPhone, /10 dígitos/i);

  const badTime = env.createAdminAppointment(validManual({ date, time: '23:59' })).error;
  assert.match(badTime, /ya no está disponible/i);
});

test('createAdminAppointment: correo opcional — vacío es válido, uno mal formado no lo es', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  env.saveSchedule(date, ['10:00', '12:00']);

  const noEmail = env.createAdminAppointment(validManual({ date, time: '10:00', clientEmail: '' }));
  assert.equal(noEmail.ok, true);

  const badEmail = env.createAdminAppointment(validManual({ date, time: '12:00', clientEmail: 'no-es-un-correo' }));
  assert.match(badEmail.error, /correo/i);
});

test('createAdminAppointment: respeta el estado inicial elegido, pero solo si es uno válido del sistema', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  env.saveSchedule(date, ['10:00', '12:00']);

  const invalid = env.createAdminAppointment(validManual({ date, time: '10:00', status: 'en-camino' }));
  assert.match(invalid.error, /estado.*no.*válido/i);

  const ok = env.createAdminAppointment(validManual({ date, time: '12:00', status: 'completed' }));
  assert.equal(ok.ok, true);
  const appt = env.getAppointments(date, date).appointments.find((a) => a.time === '12:00');
  assert.equal(appt.status, 'completed');
});

test('createAdminAppointment: NO permite forzar un horario traslapado, ni siquiera desde el panel', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  env.saveSchedule(date, ['10:00', '11:00']);

  const first = env.createAdminAppointment(validManual({ date, time: '10:00', service: 'Mega volumen' })); // 210 min
  assert.equal(first.ok, true);

  const conflicting = env.createAdminAppointment(validManual({ date, time: '11:00', service: 'Retoque' }));
  assert.ok(conflicting.error);
  assert.match(conflicting.error, /traslapa|reservado/i);
});

test('Conflicto cruzado: una reservación pública no puede pisar una cita manual, y viceversa', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  env.saveSchedule(date, ['10:00', '10:30']);

  const manual = env.createAdminAppointment(validManual({ date, time: '10:00', service: 'Mega volumen' })); // hasta 13:30
  assert.equal(manual.ok, true);

  const publicBooking = env.createAppointment({
    date, time: '10:30', service: 'Retoque', style: 'Natural Soft',
    clientName: 'Ana', clientPhone: '2321112233',
  });
  assert.ok(publicBooking.error);
  assert.match(publicBooking.error, /traslapa|reservado/i);
});

test('createAdminAppointment: dos envíos "simultáneos" del mismo horario — solo uno gana', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  env.saveSchedule(date, ['10:00']);

  const results = [validManual({ date }), validManual({ date })].map((b) => env.createAdminAppointment(b));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.filter((r) => r.error).length, 1);
});

test('updateAppointment: reprograma la cita, recalcula disponibilidad y conserva id/CreatedAt', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  env.saveSchedule(date, ['10:00', '12:00']);
  const created = env.createAdminAppointment(validManual({ date, time: '10:00' }));
  const before = env.getAppointments(date, date).appointments[0];

  const moved = env.updateAppointment(Object.assign(validManual({ date, time: '12:00' }), { id: created.id }));
  assert.equal(moved.ok, true, moved.error);

  const after = env.getAppointments(date, date).appointments[0];
  assert.equal(after.id, before.id);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.time, '12:00');
});

test('updateAppointment: excluye la propia cita del cálculo de traslape (se puede "reprogramar" a la misma hora)', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  env.saveSchedule(date, ['10:00']);
  const created = env.createAdminAppointment(validManual({ date, time: '10:00' }));

  const res = env.updateAppointment(Object.assign(validManual({ date, time: '10:00', clientName: 'María (actualizada)' }), { id: created.id }));
  assert.equal(res.ok, true, res.error);
  assert.equal(env.getAppointments(date, date).appointments[0].clientName, 'María (actualizada)');
});

test('updateAppointment: SÍ debe chocar si se reprograma encima de OTRA cita existente', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  env.saveSchedule(date, ['10:00', '12:00']);
  const a = env.createAdminAppointment(validManual({ date, time: '10:00', clientName: 'Cita A' }));
  env.createAdminAppointment(validManual({ date, time: '12:00', clientName: 'Cita B' }));

  const res = env.updateAppointment(Object.assign(validManual({ date, time: '12:00', clientName: 'Cita A' }), { id: a.id }));
  assert.ok(res.error);
  assert.match(res.error, /traslapa|reservado/i);
});

test('updateAppointment: "cita no encontrada" para un id inexistente, y valida igual que crear', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  env.saveSchedule(date, ['10:00']);

  const notFound = env.updateAppointment(Object.assign(validManual({ date }), { id: 'no-existe' }));
  assert.match(notFound.error, /no encontrada/i);

  const created = env.createAdminAppointment(validManual({ date }));
  const invalidService = env.updateAppointment(Object.assign(validManual({ date, service: 'Inventado' }), { id: created.id }));
  assert.match(invalidService.error, /servicio.*no.*válido/i);
});

test('getAvailableSlots con excludeId: el horario propio de la cita que se reprograma no aparece como ocupado', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  env.saveSchedule(date, ['10:00', '11:00']);
  const created = env.createAdminAppointment(validManual({ date, time: '10:00' }));

  const withoutExclude = env.getAvailableSlots(date, 'Técnica clásica');
  assert.ok(Array.from(withoutExclude.booked).indexOf('10:00') !== -1);

  const withExclude = env.getAvailableSlots(date, 'Técnica clásica', created.id);
  assert.equal(Array.from(withExclude.booked).indexOf('10:00'), -1);
});

test('doPost: createAdminAppointment y updateAppointment exigen token válido (protección real en servidor)', () => {
  const env = loadAppsScript();
  const date = daysFromNow(10);
  env.saveSchedule(date, ['10:00']);

  const noToken = JSON.parse(env.doPost({
    postData: { contents: JSON.stringify(Object.assign({ action: 'createAdminAppointment' }, validManual({ date }))) },
  }).getContent());
  assert.match(noToken.error, /sesión/i);

  const token = loginToken(env);
  const withToken = JSON.parse(env.doPost({
    postData: { contents: JSON.stringify(Object.assign({ action: 'createAdminAppointment', token }, validManual({ date }))) },
  }).getContent());
  assert.equal(withToken.ok, true, withToken.error);
});

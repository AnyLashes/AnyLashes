'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/fakeGas');

test('timeToMinutes_ convierte HH:mm a minutos desde medianoche', () => {
  const env = loadAppsScript();
  assert.equal(env.timeToMinutes_('00:00'), 0);
  assert.equal(env.timeToMinutes_('09:30'), 570);
  assert.equal(env.timeToMinutes_('23:59'), 1439);
});

test('rangesOverlap_ detecta traslapes y respeta límites exactos (no traslapa si solo se tocan)', () => {
  const env = loadAppsScript();
  // [10:00-12:00) vs [11:00-13:00) => se traslapan
  assert.equal(env.rangesOverlap_(600, 720, 660, 780), true);
  // [10:00-11:00) vs [11:00-12:00) => terminan/empiezan justo igual, NO se traslapan
  assert.equal(env.rangesOverlap_(600, 660, 660, 720), false);
  // rangos idénticos siempre se traslapan
  assert.equal(env.rangesOverlap_(600, 660, 600, 660), true);
  // completamente separados
  assert.equal(env.rangesOverlap_(600, 660, 900, 960), false);
});

test('getServiceDurationMinutes_ usa el mapa real y cae en el valor por defecto si no reconoce el servicio', () => {
  const env = loadAppsScript();
  assert.equal(env.getServiceDurationMinutes_('Técnica clásica'), 120);
  assert.equal(env.getServiceDurationMinutes_('Mega volumen'), 210);
  assert.equal(env.getServiceDurationMinutes_('Servicio que no existe'), env.DEFAULT_DURATION_MINUTES);
});

test('normalizeDate_ y normalizeTime_ devuelven texto sin importar si Sheets guardó un Date', () => {
  const env = loadAppsScript();
  assert.equal(env.normalizeDate_('2026-08-12'), '2026-08-12');
  assert.equal(env.normalizeDate_(new Date(2026, 7, 12)), '2026-08-12'); // mes 7 = agosto (0-indexado)
  assert.equal(env.normalizeTime_('13:30'), '13:30');
  assert.equal(env.normalizeTime_(new Date(1899, 11, 30, 13, 30)), '13:30');
});

test('extractDriveFileId_ / driveViewUrl_ extraen y reconstruyen el id sin importar el formato de URL guardado', () => {
  const env = loadAppsScript();
  assert.equal(env.extractDriveFileId_('https://drive.google.com/uc?export=view&id=ABC123'), 'ABC123');
  assert.equal(env.extractDriveFileId_('https://lh3.googleusercontent.com/d/XYZ789=w1000'), 'XYZ789');
  assert.equal(env.extractDriveFileId_(null), null);
  assert.equal(env.driveViewUrl_('ABC123'), 'https://lh3.googleusercontent.com/d/ABC123=w1000');
});

test('sha256 calcula el hash SHA-256 estándar en hexadecimal (vector de prueba conocido)', () => {
  const env = loadAppsScript();
  // Vector de prueba oficial NIST: SHA-256("abc"). Se contrasta también
  // contra el digest hexadecimal nativo de Node (independiente del mapeo
  // de bytes a hex que hace sha256() en el .gs) para no confiar en un
  // solo valor tecleado a mano.
  const expected = require('node:crypto').createHash('sha256').update('abc', 'utf8').digest('hex');
  assert.equal(expected, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(env.sha256('abc'), expected);
  // La misma contraseña siempre da el mismo hash, y una distinta da otro.
  assert.equal(env.sha256('miContraseña'), env.sha256('miContraseña'));
  assert.notEqual(env.sha256('miContraseña'), env.sha256('otraContraseña'));
});

test('requireAuth rechaza sin token o con token inexistente, y acepta uno recién emitido por login', () => {
  const env = loadAppsScript();
  env.PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD_HASH', env.sha256('secreta123'));

  assert.throws(() => env.requireAuth(null), /sesión/i);
  assert.throws(() => env.requireAuth('token-que-no-existe'), /sesión/i);

  const res = env.login('secreta123');
  assert.equal(res.ok, true);
  assert.doesNotThrow(() => env.requireAuth(res.token));
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/fakeGas');

function setPassword(env, plain) {
  env.PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD_HASH', env.sha256(plain));
}

test('login: contraseña correcta da token; contraseña incorrecta da error sin token', () => {
  const env = loadAppsScript();
  setPassword(env, 'clave-correcta');

  const bad = env.login('clave-incorrecta');
  assert.ok(bad.error);
  assert.equal(bad.token, undefined);

  const good = env.login('clave-correcta');
  assert.equal(good.ok, true);
  assert.ok(good.token && good.token.length > 10);
});

test('login: sin contraseña configurada en el servidor, avisa en vez de tronar', () => {
  const env = loadAppsScript();
  const res = env.login('cualquier-cosa');
  assert.ok(res.error);
  assert.match(res.error, /no se configuró una contraseña/i);
});

test('login: se bloquea tras varios intentos fallidos seguidos (protección contra fuerza bruta)', () => {
  const env = loadAppsScript();
  setPassword(env, 'clave-correcta');

  for (let i = 0; i < env.LOGIN_MAX_ATTEMPTS; i++) {
    const res = env.login('clave-incorrecta');
    assert.ok(res.error);
  }

  // Ya se alcanzó el máximo de intentos: ahora hasta la contraseña
  // CORRECTA debe quedar bloqueada durante la ventana de bloqueo.
  const lockedOut = env.login('clave-correcta');
  assert.ok(lockedOut.error);
  assert.match(lockedOut.error, /demasiados intentos/i);
});

test('login: intentos fallidos por debajo del límite no bloquean el acceso', () => {
  const env = loadAppsScript();
  setPassword(env, 'clave-correcta');

  for (let i = 0; i < env.LOGIN_MAX_ATTEMPTS - 1; i++) {
    env.login('clave-incorrecta');
  }
  const res = env.login('clave-correcta');
  assert.equal(res.ok, true);
});

test('logout invalida el token: una petición autenticada después del logout es rechazada', () => {
  const env = loadAppsScript();
  setPassword(env, 'clave-correcta');
  const { token } = env.login('clave-correcta');

  assert.doesNotThrow(() => env.requireAuth(token));
  env.logout(token);
  assert.throws(() => env.requireAuth(token), /sesión/i);
});

test('doPost: las acciones privilegiadas exigen token válido antes de ejecutar la lógica (protección real, no solo de interfaz)', () => {
  const env = loadAppsScript();
  setPassword(env, 'clave-correcta');

  const withoutToken = JSON.parse(
    env.doPost({ postData: { contents: JSON.stringify({ action: 'cancel', id: 'apt_x' }) } }).getContent()
  );
  assert.ok(withoutToken.error);
  assert.match(withoutToken.error, /sesión/i);

  const { token } = env.login('clave-correcta');
  const withToken = JSON.parse(
    env.doPost({ postData: { contents: JSON.stringify({ action: 'cancel', id: 'apt_x', token }) } }).getContent()
  );
  // Con token válido sí llega hasta la lógica de negocio (aquí falla porque
  // la cita no existe, pero eso confirma que pasó el candado de auth).
  assert.equal(withToken.error, 'Cita no encontrada.');
});

test('doGet: "slots" y "recentWork" son públicas; "appointments" exige token', () => {
  const env = loadAppsScript();
  setPassword(env, 'clave-correcta');

  const publicRes = JSON.parse(env.doGet({ parameter: { action: 'slots', date: '2099-01-01' } }).getContent());
  assert.equal(publicRes.error, undefined);
  assert.ok(Array.isArray(publicRes.times));

  const privRes = JSON.parse(env.doGet({ parameter: { action: 'appointments' } }).getContent());
  assert.ok(privRes.error);
  assert.match(privRes.error, /sesión/i);
});

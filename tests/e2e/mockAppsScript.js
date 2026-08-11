'use strict';
/**
 * Intercepta en Playwright las peticiones que el frontend hace a la API de
 * Google Apps Script y las responde con la lógica REAL del servidor
 * (apps-script-code.gs), cargada mediante el mismo helper `vm` que usan las
 * pruebas unitarias (tests/helpers/fakeGas.js).
 *
 * Por qué así y no con un mock hecho a mano: si escribiéramos aquí una
 * segunda copia de "cómo debería comportarse" el backend, con el tiempo se
 * desincronizaría del código real y las pruebas E2E dejarían de detectar
 * bugs de verdad (o peor, inventarían fallas que no existen). Interceptar
 * la red pero ejecutar el .gs real adentro cumple el pedido: "el mock debe
 * reproducir la estructura real de la API" — literalmente lo es — y "las
 * pruebas principales de interfaz deben ejecutar el código real del
 * frontend", que es justo lo único que NO se toca aquí.
 */
const { loadAppsScript } = require('../helpers/fakeGas');

const API_URL_PATTERN = 'https://script.google.com/macros/s/**';

/** Engancha el mock a una página de Playwright. Devuelve el entorno de
 * Apps Script en memoria (env) para que la prueba pueda sembrar datos
 * antes de navegar: env.saveSchedule(...), setPassword vía
 * env.PropertiesService, etc. Cada llamada crea un entorno nuevo y
 * aislado — dos pruebas nunca comparten citas u horarios. */
async function installMockAppsScript(page) {
  const env = loadAppsScript();

  await page.route(API_URL_PATTERN, async (route) => {
    const request = route.request();
    try {
      var output;
      if (request.method() === 'GET') {
        const url = new URL(request.url());
        const params = {};
        url.searchParams.forEach((value, key) => { params[key] = value; });
        output = env.doGet({ parameter: params });
      } else {
        output = env.doPost({ postData: { contents: request.postData() || '{}' } });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: output.getContent(),
      });
    } catch (err) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Error del mock de pruebas: ' + (err && err.message) }),
      });
    }
  });

  return env;
}

/** Deja de responder (para simular caída total del servidor / sin red).
 * Se agrega como una capa ADICIONAL encima del mock ya instalado — no lo
 * reemplaza — así que quitar solo esta capa (con el handler que se
 * devuelve aquí) restaura el mock original con todos sus datos intactos,
 * en vez de tener que instalar un mock nuevo y perder lo ya sembrado. */
async function simulateNetworkFailure(page) {
  const handler = (route) => route.abort('failed');
  await page.route(API_URL_PATTERN, handler);
  return handler;
}

/** Quita SOLO la capa de "sin red" agregada por simulateNetworkFailure,
 * dejando que el mock original (con sus datos) vuelva a responder. */
async function restoreNetwork(page, handler) {
  await page.unroute(API_URL_PATTERN, handler);
}

/** Responde con una demora artificial antes de resolver como de costumbre,
 * para probar el estado de "cargando" prolongado. */
async function installSlowMockAppsScript(page, delayMs) {
  const env = loadAppsScript();
  await page.route(API_URL_PATTERN, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const request = route.request();
    var output;
    if (request.method() === 'GET') {
      const url = new URL(request.url());
      const params = {};
      url.searchParams.forEach((value, key) => { params[key] = value; });
      output = env.doGet({ parameter: params });
    } else {
      output = env.doPost({ postData: { contents: request.postData() || '{}' } });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: output.getContent() });
  });
  return env;
}

function setAdminPassword(env, plainPassword) {
  env.PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD_HASH', env.sha256(plainPassword));
}

module.exports = { installMockAppsScript, simulateNetworkFailure, restoreNetwork, installSlowMockAppsScript, setAdminPassword, API_URL_PATTERN };

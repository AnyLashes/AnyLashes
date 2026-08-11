'use strict';
/**
 * Fixture compartido por todas las specs E2E:
 *  - Instala el mock de la API (apps-script-code.gs real, vía vm) ANTES de
 *    que la página navegue, y lo expone como `env` para que cada prueba
 *    pueda sembrar datos (horarios, contraseña) antes de visitar el sitio.
 *  - Vigila la consola y errores no capturados durante toda la prueba; si
 *    aparece uno, la prueba falla — así no hace falta repetir esa
 *    comprobación en cada archivo.
 */
const base = require('@playwright/test');
const { installMockAppsScript } = require('./mockAppsScript');

// Orígenes externos que son mejora progresiva (tipografías), no
// funcionalidad de la app: si su CDN tiene un hipo de red real durante la
// prueba, eso no es un bug de AnyLashes y no debe tumbar la prueba.
const IGNORED_ERROR_ORIGINS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

function isIgnorable(urlOrText) {
  return IGNORED_ERROR_ORIGINS.some((origin) => urlOrText.indexOf(origin) !== -1);
}

const test = base.test.extend({
  // auto: true — se activa SIEMPRE, aunque una prueba no escriba `env` en
  // sus parámetros. Sin esto, una prueba que solo usa `page` corre con las
  // rutas de red SIN interceptar, y el fetch() real del sitio termina
  // pegándole al endpoint de producción de Apps Script en vez de al mock
  // (justo el tipo de accidente que las reglas de esta tarea prohíben).
  env: [async ({ page }, use) => {
    const problems = [];

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      // Chrome emite "Failed to load resource" como texto genérico SIN la
      // URL — hay que mirar location().url (el recurso que falló) para
      // poder distinguir un hipo de la CDN de tipografías de un error real.
      var loc = msg.location && msg.location();
      var locationUrl = (loc && loc.url) || '';
      if (isIgnorable(msg.text()) || isIgnorable(locationUrl)) return;
      problems.push('console: ' + msg.text() + (locationUrl ? ' [' + locationUrl + ']' : ''));
    });
    page.on('pageerror', (err) => {
      problems.push('pageerror: ' + err.message);
    });
    page.on('requestfailed', (req) => {
      if (isIgnorable(req.url())) return;
      const failure = req.failure();
      problems.push('requestfailed: ' + req.method() + ' ' + req.url() + ' (' + (failure && failure.errorText) + ')');
    });
    page.on('response', (res) => {
      if (res.status() < 400) return;
      if (isIgnorable(res.url())) return;
      problems.push('response ' + res.status() + ': ' + res.request().method() + ' ' + res.url());
    });

    const env = await installMockAppsScript(page);
    // Vía de escape explícita para las pruebas que SIMULAN a propósito una
    // caída de red (simulateNetworkFailure): esa simulación genera un
    // "requestfailed" real que no es un bug de la app. Cualquier otro
    // problema de red/consola sigue fallando la prueba como antes.
    env.expectedProblems = [];
    await use(env);

    const realProblems = problems.filter((p) => !env.expectedProblems.some((pattern) => pattern.test(p)));
    if (realProblems.length) {
      throw new Error('Se detectaron errores de consola/red durante la prueba:\n- ' + realProblems.join('\n- '));
    }
  }, { auto: true }],
});

module.exports = { test, expect: base.expect };

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/fakeGas');

// Hallazgo real: getSpreadsheet_() llamaba a ensureSheets_() en CADA
// petición al backend, y ensureSheets_() hace varias escrituras a Sheets
// (setNumberFormat, migración de columnas) — cada una es un viaje de ida y
// vuelta que Apps Script tarda en resolver de verdad. Eso hacía que TODO
// el sitio se sintiera lento (no solo las fotos, que eran las más
// visibles), incluso en acciones de solo lectura como ver horarios o las
// fotos recientes. Esta prueba verifica que esas escrituras ahora se
// hacen una sola vez por hoja, no una vez por petición.
test('getSpreadsheet_ solo prepara la hoja (escrituras de formato) una vez, no en cada acción del backend', () => {
  const env = loadAppsScript();

  // Varias acciones de solo lectura, cada una dispara su propio
  // getSpreadsheet_() internamente — como pasaría con peticiones HTTP
  // reales separadas.
  env.getAvailableSlots('2099-01-01');
  env.getRecentWork();
  env.getScheduleRange('2099-01-01', '2099-01-31');
  env.getAvailableSlots('2099-01-02');

  // setNumberFormat se llama varias veces (Schedule, Appointments x2,
  // Works) la PRIMERA vez que se prepara la hoja — pero solo esa vez.
  const callsAfterFirstBatch = env._counters.setNumberFormatCalls;
  assert.ok(callsAfterFirstBatch > 0, 'la primera preparación sí debe escribir formato');

  env.getAvailableSlots('2099-01-03');
  env.getRecentWork();
  env.getScheduleRange('2099-02-01', '2099-02-28');

  assert.equal(
    env._counters.setNumberFormatCalls,
    callsAfterFirstBatch,
    'las peticiones siguientes no deben repetir las escrituras de preparación de la hoja'
  );
});

test('getSpreadsheet_ vuelve a preparar la hoja si se crea una nueva (SPREADSHEET_ID no existía)', () => {
  const env = loadAppsScript();
  env.getAvailableSlots('2099-01-01');
  const calls = env._counters.setNumberFormatCalls;
  assert.ok(calls > 0);

  // Simula una hoja de cálculo nueva (como si se hubiera borrado el
  // ID guardado): debe volver a prepararse, no quedarse con una hoja a
  // medio formatear.
  env.PropertiesService.getScriptProperties().deleteProperty('SPREADSHEET_ID');
  env.PropertiesService.getScriptProperties().deleteProperty('SHEETS_READY_VERSION');
  env.getAvailableSlots('2099-01-01');
  assert.ok(env._counters.setNumberFormatCalls > calls, 'una hoja nueva sí debe volver a prepararse');
});

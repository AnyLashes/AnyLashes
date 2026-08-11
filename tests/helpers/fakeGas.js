'use strict';
/**
 * Entorno falso de Google Apps Script para poder correr apps-script-code.gs
 * dentro de Node con `node:test`, SIN reescribir su lógica.
 *
 * Por qué existe: Apps Script no se puede instalar como dependencia de Node
 * (SpreadsheetApp, CacheService, etc. solo existen dentro de script.google.com).
 * En vez de copiar/duplicar la lógica del servidor en un módulo aparte para
 * poder probarla (lo que la desincroniza con el código real tarde o
 * temprano), este helper carga el archivo .gs TAL CUAL con `vm`, y le
 * inyecta implementaciones mínimas en memoria de los únicos servicios de
 * Apps Script que el código usa: Spreadsheet, Properties, Cache, Lock,
 * Session/Utilities.formatDate y Drive. Así las pruebas ejercitan el mismo
 * archivo que se pega en el editor de Apps Script.
 *
 * Simplificaciones deliberadas (documentadas para que no se confundan con
 * el comportamiento real de producción):
 *  - Utilities.formatDate ignora la zona horaria (usa la hora local de
 *    donde corran las pruebas) y solo entiende los 3 patrones que el
 *    código realmente usa: 'yyyy-MM-dd', 'HH:mm', 'yyyy-MM'.
 *  - Utilities.computeDigest normalmente lo implementa la JVM de Apps
 *    Script; aquí se usa el módulo `crypto` de Node para calcular el mismo
 *    SHA-256 estándar, así que sha256() en el .gs se prueba de verdad.
 *  - CacheService en producción expira las llaves solas después del TTL;
 *    este stub no expira nada por tiempo (no hay reloj real que avanzar en
 *    una prueba unitaria) — las pruebas que necesitan "expiración" la
 *    simulan llamando remove() a mano.
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function makeSheet(name) {
  const rows = [];
  return {
    name,
    appendRow(row) { rows.push(row.slice()); },
    setFrozenRows() {},
    getLastRow() { return rows.length; },
    getDataRange() {
      return { getValues: () => rows.map((r) => r.slice()) };
    },
    getRange(a, b, c, d) {
      if (typeof a === 'string') {
        // Notación A1 (p. ej. "A2:A"): en este código solo se usa para
        // setNumberFormat, que no afecta la lógica de negocio — no-op.
        return { setNumberFormat() {} };
      }
      const row = a;
      const col = b;
      if (c !== undefined && d !== undefined) {
        const numRows = c;
        const numCols = d;
        return {
          setValues(vals) {
            for (let r = 0; r < numRows; r++) {
              if (!rows[row - 1 + r]) rows[row - 1 + r] = [];
              for (let cc = 0; cc < numCols; cc++) {
                rows[row - 1 + r][col - 1 + cc] = vals[r][cc];
              }
            }
          },
        };
      }
      return {
        getValue() { return rows[row - 1] ? rows[row - 1][col - 1] : undefined; },
        setValue(v) {
          if (!rows[row - 1]) rows[row - 1] = [];
          rows[row - 1][col - 1] = v;
        },
      };
    },
    deleteRow(rowNum) { rows.splice(rowNum - 1, 1); },
    _rows: rows, // acceso directo para inspeccionar el estado en las pruebas
  };
}

function createFakeSpreadsheet() {
  const sheets = {};
  return {
    getSheetByName: (name) => sheets[name] || null,
    insertSheet(name) {
      const s = makeSheet(name);
      sheets[name] = s;
      return s;
    },
    getSheets: () => Object.keys(sheets).map((k) => sheets[k]),
    deleteSheet(sheet) { delete sheets[sheet.name]; },
    getId: () => 'fake-spreadsheet-id',
  };
}

/** Crea un entorno de Apps Script nuevo (sin estado compartido con otras
 * pruebas) y devuelve el contexto de `vm` con apps-script-code.gs cargado
 * adentro — sus funciones quedan disponibles como propiedades de lo que
 * devuelve esta función, p. ej. `env.createAppointment(...)`. */
function loadAppsScript() {
  const fakeSpreadsheet = createFakeSpreadsheet();
  const propsStore = {};
  const cacheStore = {};

  const SpreadsheetApp = {
    openById: (id) => (id === 'fake-spreadsheet-id' ? fakeSpreadsheet : null),
    create: () => fakeSpreadsheet,
  };
  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (Object.prototype.hasOwnProperty.call(propsStore, k) ? propsStore[k] : null),
      setProperty: (k, v) => { propsStore[k] = v; },
    }),
  };
  const CacheService = {
    getScriptCache: () => ({
      get: (k) => (Object.prototype.hasOwnProperty.call(cacheStore, k) ? cacheStore[k] : null),
      put: (k, v) => { cacheStore[k] = v; },
      remove: (k) => { delete cacheStore[k]; },
    }),
  };
  const LockService = {
    getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
  };
  const Session = { getScriptTimeZone: () => 'local-test-tz' };
  const Utilities = {
    getUuid: () => crypto.randomUUID(),
    base64Decode: (b64) => Array.from(Buffer.from(b64, 'base64')),
    computeDigest: (_algo, text) => Array.from(crypto.createHash('sha256').update(text, 'utf8').digest()),
    Charset: { UTF_8: 'UTF-8' },
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    newBlob: (bytes, mimeType, name) => ({ bytes, mimeType, name }),
    formatDate(date, _tz, pattern) {
      const d = date instanceof Date ? date : new Date(date);
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (pattern === 'HH:mm') return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      if (pattern === 'yyyy-MM') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      throw new Error('Patrón de fecha no soportado en el stub de pruebas: ' + pattern);
    },
  };
  const DriveApp = {
    createFolder: () => ({
      getId: () => 'fake-folder-id',
      createFile: (blob) => ({
        getId: () => 'fake-file-' + Math.random().toString(36).slice(2),
        _blob: blob,
        setSharing() {},
      }),
    }),
    getFolderById: () => { throw new Error('getFolderById no está implementado en el stub de pruebas'); },
    getFileById: () => ({ setTrashed() {} }),
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
    Permission: { VIEW: 'VIEW' },
  };
  const ContentService = {
    createTextOutput: (text) => ({
      setMimeType: () => ({ getContent: () => text }),
    }),
    MimeType: { JSON: 'JSON' },
  };

  const sandbox = {
    console,
    SpreadsheetApp,
    PropertiesService,
    CacheService,
    LockService,
    Session,
    Utilities,
    DriveApp,
    ContentService,
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script-code.gs'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'apps-script-code.gs' });
  return sandbox;
}

module.exports = { loadAppsScript };

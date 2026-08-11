'use strict';
function pad(n) { return n < 10 ? '0' + n : '' + n; }

/** Fecha futura en formato yyyy-MM-dd, calculada desde "hoy" para que las
 * pruebas nunca queden obsoletas por una fecha fija en el pasado. */
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

module.exports = { daysFromNow };

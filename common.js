/* =========================================================
   ANYLASHES — Utilidades compartidas entre el sitio público
   (script.js) y el panel de administración (admin.js), para no
   mantener dos copias de la misma lógica en paralelo.
   Debe cargarse ANTES de esos archivos.
   ========================================================= */
var API_URL = 'https://script.google.com/macros/s/AKfycby_dX7NN0w20zN7-zN7Yi7Gfoxq8JinteaT2K1fwNud8dLtTneHV7QDHEftP-Fidl9W_w/exec';
var REQUEST_TIMEOUT_MS = 20000;
var MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function todayISO() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function nowHHMM() {
  var d = new Date();
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function formatDateEs(dateStr) {
  var parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  var day = parseInt(parts[2], 10);
  var month = MONTHS_ES[parseInt(parts[1], 10) - 1];
  return day + ' de ' + month + ' de ' + parts[0];
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

// fetch() no tiene límite de tiempo por sí solo: si el servidor o la red se
// cuelgan, la petición se queda esperando para siempre y cualquier botón
// que dependa de ella ("Enviando…") se queda pegado sin forma de salir.
// Este wrapper la corta a los 20s y la convierte en un error normal, para
// que siempre se pueda reintentar.
function fetchWithTimeout(url, options) {
  var controller = new AbortController();
  var timedOut = false;
  var timer = setTimeout(function () { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
  options = options || {};
  options.signal = controller.signal;
  return fetch(url, options).then(function (r) {
    clearTimeout(timer);
    return r;
  }).catch(function (err) {
    clearTimeout(timer);
    if (timedOut) throw new Error('La solicitud tardó demasiado. Revisa tu internet e intenta de nuevo.');
    throw err;
  });
}

function apiGet(params) {
  var query = Object.keys(params)
    .map(function (k) { return k + '=' + encodeURIComponent(params[k]); })
    .join('&');
  return fetchWithTimeout(API_URL + '?' + query).then(function (r) { return r.json(); });
}

function apiPost(payload) {
  // Sin header Content-Type a propósito: así el navegador la trata como
  // petición "simple" y evita el preflight OPTIONS que Apps Script no maneja.
  return fetchWithTimeout(API_URL, { method: 'POST', body: JSON.stringify(payload) })
    .then(function (r) { return r.json(); });
}

// Abre una pestaña en blanco de forma síncrona (dentro del gesto del
// usuario) para poder redirigirla luego de una respuesta async sin que el
// navegador la bloquee como pop-up.
function openPendingTab() {
  var tab = window.open('about:blank', '_blank');
  if (tab) {
    try {
      tab.document.write('<title>Abriendo WhatsApp…</title><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#6E665D;">Redirigiendo a WhatsApp…</body>');
    } catch (e) { /* noop */ }
  }
  return tab;
}

// Carga una foto probando varias URLs de Drive antes de rendirse. Google a
// veces bloquea o tarda en propagar un formato (p. ej. justo después de
// subir la foto) pero no otro — por eso algunas fotos "no cargaban". Probar
// formatos alternos en cadena hace que casi siempre se vea.
function loadPhotoWithFallback(imgEl, originalUrl, onFail) {
  if (imgEl._fallbackHandler) imgEl.removeEventListener('error', imgEl._fallbackHandler);

  var idMatch = String(originalUrl).match(/\/d\/([^/=?&]+)/) || String(originalUrl).match(/[?&]id=([^&=]+)/);
  var fileId = idMatch ? idMatch[1] : null;

  var candidates = [originalUrl];
  if (fileId) {
    ['https://drive.google.com/thumbnail?id=' + fileId + '&sz=w700',
      'https://lh3.googleusercontent.com/d/' + fileId + '=w700',
      'https://drive.google.com/uc?export=view&id=' + fileId
    ].forEach(function (u) { if (candidates.indexOf(u) === -1) candidates.push(u); });
  }

  var attempt = 0;
  function tryNext() {
    if (attempt >= candidates.length) {
      imgEl.removeEventListener('error', tryNext);
      imgEl._fallbackHandler = null;
      if (onFail) onFail();
      return;
    }
    imgEl.src = candidates[attempt++];
  }
  imgEl._fallbackHandler = tryNext;
  imgEl.addEventListener('error', tryNext);
  tryNext();
}

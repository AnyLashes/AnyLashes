'use strict';
/**
 * Servidor estático mínimo (sin dependencias) para servir este sitio en
 * local durante las pruebas E2E y Lighthouse. No hace falta nada más
 * porque el sitio no tiene build: son los mismos archivos que se suben
 * al hosting final.
 *
 * Uso: node scripts/static-server.js [puerto]
 * Puerto por defecto: 4173 (el mismo que usa Playwright/Lighthouse aquí).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2] || process.env.PORT || '4173', 10);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function safeJoin(root, urlPath) {
  var decoded = decodeURIComponent(urlPath);
  var resolved = path.normalize(path.join(root, decoded));
  // Evita que una URL con "../" se salga de la carpeta del proyecto.
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

var server = http.createServer(function (req, res) {
  var parsed = new URL(req.url, 'http://localhost');
  var pathname = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  var filePath = safeJoin(ROOT, pathname);

  if (!filePath) {
    res.writeHead(400);
    res.end('Ruta inválida.');
    return;
  }

  fs.stat(filePath, function (err, stats) {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 - No encontrado: ' + pathname);
      return;
    }
    var ext = path.extname(filePath).toLowerCase();
    var contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
  });
});

if (require.main === module) {
  server.listen(PORT, function () {
    console.log('Servidor estático de AnyLashes en http://localhost:' + PORT);
  });
}

module.exports = server;

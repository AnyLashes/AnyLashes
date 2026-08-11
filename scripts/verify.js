'use strict';
/**
 * `npm run verify` — corre, en orden, todas las comprobaciones razonables
 * del proyecto y termina con un resumen claro. Pensado para correrse antes
 * de subir cambios de verdad (incluye Lighthouse, así que tarda varios
 * minutos — no es para cada guardado, es para antes de un despliegue).
 */
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const results = [];

async function step(name, fn) {
  console.log('\n=== ' + name + ' ===');
  const start = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, seconds: ((Date.now() - start) / 1000).toFixed(1) });
  } catch (err) {
    console.error(err.message || err);
    results.push({ name, ok: false, seconds: ((Date.now() - start) / 1000).toFixed(1) });
  }
}

function run(cmd, args, opts) {
  const res = spawnSync(cmd, args, Object.assign({ cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' }, opts));
  if (res.status !== 0) throw new Error((cmd + ' ' + args.join(' ')) + ' terminó con código ' + res.status);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pingServer(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

async function waitForServer(url, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await pingServer(url)) return true;
    await sleep(150);
  }
  return false;
}

async function main() {
  // 1) Sintaxis de todos los archivos JS del proyecto (incluye
  //    apps-script-code.gs, copiado a .js temporalmente porque Node no
  //    reconoce esa extensión).
  await step('1. Verificación de sintaxis', () => {
    ['common.js', 'script.js', 'admin.js'].forEach((f) => run(process.execPath, ['--check', path.join(ROOT, f)]));

    const gsSrc = fs.readFileSync(path.join(ROOT, 'apps-script-code.gs'), 'utf8');
    const tmp = path.join(os.tmpdir(), 'anylashes-appsscript-check.js');
    fs.writeFileSync(tmp, gsSrc);
    run(process.execPath, ['--check', tmp]);
    fs.unlinkSync(tmp);
  });

  // 2) Pruebas unitarias (node:test) — lógica del backend real vía fakeGas.
  await step('2. Pruebas unitarias', () => {
    run(process.execPath, ['--test']);
  });

  // 3) Pruebas E2E en Chrome real (Playwright levanta su propio servidor).
  await step('3. Pruebas E2E en Google Chrome', () => {
    run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'test']);
  });

  // 4) Lighthouse móvil + escritorio, x3 cada uno. Levanta el servidor
  //    estático nada más para este paso y lo apaga al terminar.
  await step('4. Lighthouse (móvil + escritorio, mediana de 3 corridas)', async () => {
    const server = spawn(process.execPath, [path.join(ROOT, 'scripts', 'static-server.js'), '4173'], { cwd: ROOT, stdio: 'ignore' });
    try {
      const up = await waitForServer('http://localhost:4173/', 8000);
      if (!up) throw new Error('El servidor estático no respondió a tiempo en localhost:4173.');
      run(process.execPath, [path.join(ROOT, 'scripts', 'run-lighthouse.js')]);
    } finally {
      server.kill();
    }
  });

  console.log('\n\n========== RESUMEN ==========');
  let allOk = true;
  results.forEach((r) => {
    console.log((r.ok ? 'OK  ' : 'FAIL') + '  ' + r.name + '  (' + r.seconds + 's)');
    if (!r.ok) allOk = false;
  });
  console.log('==============================\n');

  process.exit(allOk ? 0 : 1);
}

main();

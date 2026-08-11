'use strict';
/**
 * Corre Lighthouse contra el sitio servido en local, 3 veces en móvil y 3
 * veces en escritorio sobre la landing pública, y reporta la MEDIANA de
 * cada categoría (no solo el mejor resultado, como pide la auditoría).
 * Usa el Chrome real del sistema (chrome-launcher lo detecta solo).
 *
 * Guarda los reportes HTML + un resumen JSON en lighthouse-reports/,
 * carpeta que no se sube al repo (ver .gitignore).
 *
 * Uso: node scripts/run-lighthouse.js [url]
 * Por defecto usa http://localhost:4173/ — asegúrate de tener el servidor
 * estático corriendo (npm run serve) antes de ejecutar esto, o usa
 * "npm run lighthouse", que ya lo levanta y lo apaga solo.
 */
const fs = require('fs');
const path = require('path');
const lighthouse = require('lighthouse').default || require('lighthouse');
const chromeLauncher = require('chrome-launcher');
// Preset oficial de Lighthouse para "escritorio" (sin emulación móvil, sin
// CPU/red limitadas). Sin esto, un objeto de config armado a mano puede
// quedar incompleto y Lighthouse termina corriendo con throttling/UA de
// móvil de todas formas — es justo el bug que se encontró la primera vez
// que se corrió este script (el reporte "desktop" traía el user-agent de
// un Android real).
const desktopConfig = (require('lighthouse/core/config/desktop-config.js').default);

const URL_TO_TEST = process.argv[2] || 'http://localhost:4173/';
const RUNS_PER_MODE = 3;
const OUT_DIR = path.join(__dirname, '..', 'lighthouse-reports');

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

function median(nums) {
  const sorted = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function runOnce(url, mode, chrome, index) {
  const isMobile = mode === 'mobile';
  // Móvil: config por defecto de Lighthouse (perfil de gama media emulado,
  // red 4G simulada). Escritorio: el preset oficial desktop-config.js, que
  // sí desactiva la emulación móvil y el throttling de CPU/red.
  const config = isMobile
    ? { extends: 'lighthouse:default', settings: { onlyCategories: CATEGORIES } }
    : Object.assign({}, desktopConfig, { settings: Object.assign({}, desktopConfig.settings, { onlyCategories: CATEGORIES }) });

  const runnerResult = await lighthouse(url, {
    port: chrome.port,
    output: 'html',
    logLevel: 'error',
  }, config);

  const scores = {};
  CATEGORIES.forEach((cat) => {
    scores[cat] = Math.round((runnerResult.lhr.categories[cat].score || 0) * 100);
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const fileName = `${mode}-run${index + 1}.html`;
  fs.writeFileSync(path.join(OUT_DIR, fileName), runnerResult.report);

  return scores;
}

async function runMode(url, mode, chrome) {
  const results = [];
  for (let i = 0; i < RUNS_PER_MODE; i++) {
    process.stdout.write(`  ${mode} run ${i + 1}/${RUNS_PER_MODE}... `);
    const scores = await runOnce(url, mode, chrome, i);
    console.log(JSON.stringify(scores));
    results.push(scores);
  }
  const medians = {};
  CATEGORIES.forEach((cat) => {
    medians[cat] = median(results.map((r) => r[cat]));
  });
  return { results, medians };
}

async function main() {
  console.log('Lighthouse contra:', URL_TO_TEST);
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
  console.log('Chrome real lanzado en puerto', chrome.port);

  try {
    const summary = { url: URL_TO_TEST, date: new Date().toISOString(), mobile: null, desktop: null };

    console.log('\n--- Móvil (3 corridas) ---');
    summary.mobile = await runMode(URL_TO_TEST, 'mobile', chrome);

    console.log('\n--- Escritorio (3 corridas) ---');
    summary.desktop = await runMode(URL_TO_TEST, 'desktop', chrome);

    fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

    console.log('\n=== MEDIANA (de 3 corridas) ===');
    console.log('Categoría         Móvil   Escritorio');
    CATEGORIES.forEach((cat) => {
      console.log(
        cat.padEnd(18) + String(summary.mobile.medians[cat]).padStart(5) + '   ' + String(summary.desktop.medians[cat]).padStart(5)
      );
    });
    console.log('\nReportes guardados en', OUT_DIR);
  } finally {
    await chrome.kill();
  }
}

main().catch((err) => {
  console.error('Lighthouse falló:', err);
  process.exit(1);
});

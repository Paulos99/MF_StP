import { build } from 'esbuild';
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';

// Чистим каталог сборки, чтобы в выпуск не попадали файлы от прошлых сборок
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/assets', { recursive: true });

await build({
  entryPoints: ['src/ui/app.js'],
  bundle: true,
  splitting: true,
  format: 'esm',
  outdir: 'dist/assets',
});

// Проверочный стенд (рабочий процесс «Deploy to GitHub Pages») скрывается от поисковиков и без Метрики.
// В выпуске по метке, в локальной сборке этого нет. Принудительно: NOINDEX=1 / NOINDEX=0.
const isStand =
  process.env.NOINDEX === '1' ||
  (process.env.NOINDEX !== '0' &&
    process.env.GITHUB_ACTIONS === 'true' &&
    process.env.GITHUB_WORKFLOW === 'Deploy to GitHub Pages');

// Яндекс.Метрика: номер счётчика из VITE_YM_ID или из metrika.config.json (counterId). Нет номера — ничего не вшивается.
function metrikaCounterId() {
  let raw = String(process.env.VITE_YM_ID || '').trim();
  if (!raw) {
    try {
      raw = String(JSON.parse(readFileSync('metrika.config.json', 'utf8')).counterId ?? '').trim();
    } catch {
      raw = '';
    }
  }
  if (!raw) return null;
  if (!/^\d{1,12}$/.test(raw) || Number(raw) <= 0) {
    throw new Error('Номер счётчика Метрики должен состоять только из цифр');
  }
  return Number(raw);
}

let html = readFileSync('index.html', 'utf8');
html = html
  // Keep query/hash cache-busters out of dist — assets are hashed by deploy CDN/browser after rebuild
  .replace(/src="\.\/src\/ui\/app\.js[^"]*"/, 'src="./assets/app.js"')
  .replace(/src="\/src\/ui\/app\.js[^"]*"/, 'src="./assets/app.js"')
  .replace('src="./logo.png"', 'src="./logo.png"')
  .replace('src="/logo.png"', 'src="./logo.png"')
  .replace(/href="\.\/styles\.css[^"]*"/, 'href="./assets/app.css"')
  .replace(/href="\/styles\.css[^"]*"/, 'href="./assets/app.css"');
const ymId = isStand ? null : metrikaCounterId();
if (ymId) html = html.replace('</head>', `  <script>window.MF_YM_ID=${ymId};</script>\n</head>`);
if (isStand) {
  html = html.replace('<head>', '<head>\n  <meta name="robots" content="noindex,nofollow">');
  writeFileSync('dist/robots.txt', 'User-agent: *\nDisallow: /\n');
}
writeFileSync('dist/index.html', html);

copyFileSync('styles.css', 'dist/assets/app.css');

// Шрифт Manrope (url в styles.css относительный: ./fonts/ рядом с app.css)
cpSync('fonts', 'dist/assets/fonts', { recursive: true });

for (const file of ['logo.png', 'logo-multiframe.png', 'buy.png', 'add-image.png']) {
  try {
    copyFileSync(file, `dist/${file}`);
  } catch {
    /* optional asset */
  }
}

console.log(`Build complete → dist/ (${isStand ? 'стенд: noindex' : 'боевая сборка'}, Метрика: ${ymId ? 'включена' : 'нет'})`);

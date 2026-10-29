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

let html = readFileSync('index.html', 'utf8');
html = html
  // Keep query/hash cache-busters out of dist — assets are hashed by deploy CDN/browser after rebuild
  .replace(/src="\.\/src\/ui\/app\.js[^"]*"/, 'src="./assets/app.js"')
  .replace(/src="\/src\/ui\/app\.js[^"]*"/, 'src="./assets/app.js"')
  .replace('src="./logo.png"', 'src="./logo.png"')
  .replace('src="/logo.png"', 'src="./logo.png"')
  .replace(/href="\.\/styles\.css[^"]*"/, 'href="./assets/app.css"')
  .replace(/href="\/styles\.css[^"]*"/, 'href="./assets/app.css"');
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

console.log('Build complete → dist/');

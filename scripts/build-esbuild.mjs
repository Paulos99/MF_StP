import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

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

for (const file of ['logo.png', 'logo-multiframe.png', 'buy.png', 'add-image.png']) {
  try {
    copyFileSync(file, `dist/${file}`);
  } catch {
    /* optional asset */
  }
}

console.log('Build complete → dist/');

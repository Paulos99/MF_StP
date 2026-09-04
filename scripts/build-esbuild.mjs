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

try {
  copyFileSync('logo.png', 'dist/logo.png');
} catch {
  /* optional asset */
}

try {
  copyFileSync('buy.png', 'dist/buy.png');
} catch {
  /* optional asset */
}

console.log('Build complete → dist/');

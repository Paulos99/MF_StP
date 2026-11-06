import { mkdirSync, copyFileSync, readdirSync } from 'node:fs';
// Never rely on Tesseract CDN defaults. Assets are served by this static site.
for (const dir of ['public/ocr/core', 'public/ocr/lang', 'public/plan-import', 'public/ocr/licenses']) mkdirSync(dir, { recursive: true });
copyFileSync('node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js');
copyFileSync('node_modules/tesseract.js/dist/tesseract.min.js', 'public/ocr/tesseract.min.js');
for (const file of ['tesseract.min.js.LICENSE.txt', 'worker.min.js.LICENSE.txt']) copyFileSync(`node_modules/tesseract.js/dist/${file}`, `public/ocr/${file}`);
for (const file of readdirSync('node_modules/tesseract.js-core')) {
  if (/\.wasm(\.js)?$/.test(file)) copyFileSync(`node_modules/tesseract.js-core/${file}`, `public/ocr/core/${file}`);
}
for (const lang of ['eng', 'rus']) copyFileSync(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`, `public/ocr/lang/${lang}.traineddata.gz`);
for (const file of ['core.js', 'detect.worker.js', 'ocr.worker.js']) copyFileSync(`src/plan-import/${file}`, `public/plan-import/${file}`);

copyFileSync('node_modules/tesseract.js/LICENSE.md', 'public/ocr/licenses/tesseract.js-Apache-2.0.txt');
copyFileSync('node_modules/tesseract.js-core/LICENSE', 'public/ocr/licenses/tesseract-core-Apache-2.0.txt');
copyFileSync('docs/plan-import-licenses.txt', 'public/ocr/licenses/NOTICE.txt');

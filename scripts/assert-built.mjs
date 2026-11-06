// HTTP + real ES module evaluation at a GitHub Pages-style subpath. This is not
// browser automation: canvas/dialog are DOM test doubles; parent does visual QA.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
const root = resolve('dist');
const seen = [];
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    seen.push(req.url);
    const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    if (!path.startsWith('/MF_StP/')) { res.writeHead(404).end(); return; }
    const file = resolve(root, path.slice('/MF_StP/'.length) || 'index.html');
    if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    await stat(file);
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const base = `http://127.0.0.1:${server.address().port}/MF_StP/`;
  async function text(url) {
    const response = await fetch(url); assert.equal(response.status, 200, url);
    return response.text();
  }
  const html = await text(base);
  const { document, window } = parseHTML(html.replace('<head>', `<head><base href="${base}">`));
  const entryUrl = new URL(document.querySelector('script[type=module][src]').getAttribute('src'), base).href;
  const entry = await text(entryUrl);
  assert.match(entryUrl, /\/assets\/(?:app(?:-[\w-]+)?|index-[\w-]+)\.js$/, 'production entry resolves');
  const cssUrl = new URL(document.querySelector('link[rel=stylesheet]').getAttribute('href'), base).href;
  const css = await text(cssUrl);
  assert.match(cssUrl, /\/assets\/(?:app(?:-[\w-]+)?|index-[\w-]+)\.css$/, 'production CSS resolves');
  assert.match(css, /\.sketch-tool-btn\[hidden\]\s*\{[^}]*display:\s*none\s*!important/, 'hidden locked tools must override author display:flex');
  assert.equal(document.querySelectorAll('#sketchPlanImportBtn').length, 1);
  assert.equal(document.querySelectorAll('#sketchBgUploadBtn').length, 0, 'no second adjacent photo action');
  assert.equal(document.getElementById('sketchPlanImportBtn').textContent.trim(), 'Фото плана');
  assert.equal(document.getElementById('drawUploadPhotoBtn').textContent.trim(), 'Фото плана');
  const photoPath = entry.match(/import\(["']([^"']*dialog-[^"']+\.js)["']\)/)?.[1];
  assert.ok(photoPath, 'photo flow must remain a lazy import');
  const photoUrl = new URL(photoPath, entryUrl).href;
  let nativeOpens = 0;
  window.HTMLElement.prototype.showModal = function () { this.setAttribute('open', ''); nativeOpens++; };
  window.HTMLElement.prototype.close = function () { this.removeAttribute('open'); };
  window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (_, key) => key === 'measureText' ? () => ({ width: 20 }) : () => {}, set: () => true });
  const context = vm.createContext({ document, window, URL, console, setTimeout, clearTimeout, performance,
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} });
  const modules = new Map();
  async function load(url, exposeEditor = false) {
    if (modules.has(url)) return modules.get(url);
    let code = await text(url);
    if (exposeEditor) code += '\nexport { SketchEditor as __qaSketchEditor };';
    const module = new vm.SourceTextModule(code, {
      context, identifier: url, initializeImportMeta: meta => { meta.url = url; },
      importModuleDynamically: async (specifier, parent) => {
        const next = await load(new URL(specifier, parent.identifier).href);
        if (next.status === 'linked') await next.evaluate(); return next;
      },
    });
    modules.set(url, module);
    await module.link((specifier, parent) => load(new URL(specifier, parent.identifier).href));
    return module;
  }
  const photo = await load(photoUrl); await photo.evaluate();
  const opensBefore = nativeOpens;
  const handle = photo.namespace.openPlanImport({ onApply() { assert.fail('opening/cancel cannot apply'); }, onUseBackground() {} });
  assert.equal(nativeOpens, opensBefore + 1);
  assert.equal(document.querySelectorAll('dialog[open]').length, 1);
  assert.equal(document.querySelector('[data-id=background-choice]').hidden, false, 'manual background remains within shared flow');
  handle.close(); assert.equal(document.querySelector('dialog'), null);
  assert.equal(seen.some(url => /\/ocr\//.test(url)), false, 'opening dialog must not download OCR');

  // Esbuild keeps class names. Evaluate its actual entry and bind the real click
  // handler against the built HTML, rather than testing a copied event function.
  let exercisedToolbar = false;
  if (entry.includes('var SketchEditor = class')) {
    const app = await load(entryUrl, true); await app.evaluate();
    const editor = Object.create(app.namespace.__qaSketchEditor.prototype);
    Object.assign(editor, { host: document.getElementById('sketchEditorHost'), dialogs: document.getElementById('sketchEditorModal'), canvas: document.getElementById('sketchCanvas'), room: {}, geometryLocked: false, _active: true, onboarding: { dismiss() {} }, showToast: assert.fail });
    editor._bindUi();
    const button = document.getElementById('sketchPlanImportBtn');
    editor.geometryLocked = true; editor._syncLockedToolbar();
    assert.equal(button.disabled, true); assert.equal(button.hidden, true, 'dims-mode control must be genuinely hidden by CSS');
    editor.geometryLocked = false; editor._syncLockedToolbar();
    assert.equal(button.disabled, false); assert.equal(button.hidden, false);
    button.click();
    for (let i = 0; i < 30 && !editor._planImport; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(editor._planImport, 'real deployed toolbar click must open the HTTP-loaded dialog');
    editor._planImport.close(); exercisedToolbar = true;
  }
  // Check runtime entry points/model paths resolve under the project subpath.
  for (const path of ['plan-import/detect.worker.js', 'plan-import/core.js', 'plan-import/ocr.worker.js', 'ocr/tesseract.min.js', 'ocr/worker.min.js', 'ocr/core/tesseract-core-lstm.wasm.js', 'ocr/core/tesseract-core-simd-lstm.wasm.js', 'ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js', 'ocr/lang/eng.traineddata.gz', 'ocr/lang/rus.traineddata.gz']) {
    const response = await fetch(new URL(path, base), { method: 'HEAD' }); assert.equal(response.status, 200, path);
    if (path.endsWith('.js')) assert.match(response.headers.get('content-type'), /javascript/, path);
  }
  console.log(`OK: resolved entry/CSS, lazy photo ESM graph/dialog, unified manual option, runtime assets at /MF_StP/; real compiled toolbar exercised: ${exercisedToolbar}`);
} finally { await new Promise(resolve => server.close(resolve)); }

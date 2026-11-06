import { gunzipSync } from 'node:zlib';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectContours, parseDimensions, calibratedGeometry, validatePolygon, checkFile, imageDimensions, area } from '../src/plan-import/core.js';
const fixture = name => new Uint8ClampedArray(gunzipSync(readFileSync(new URL(`fixtures/plan-import/${name}.rgba.gz`, import.meta.url))));
const square = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
for (const [name, count] of [['rectangle', 1], ['irregular', 1], ['multi-room', 2], ['blank', 0], ['open-wall', 0]]) {
  test(`synthetic ${name}: ${count} explicit contour proposals`, () => {
    const candidates = detectContours(fixture(name), 500, 400);
    assert.equal(candidates.length, count);
    for (const c of candidates) { assert.equal(validatePolygon(c.points), null); assert.ok(c.points.length <= 64); }
    if (name === 'irregular') { assert.ok(candidates[0].points.length >= 6); assert.ok(candidates[0].pixelArea < 110000); }
    if (name === 'rectangle') assert.ok(Math.abs(candidates[0].pixelArea - 120000) / 120000 < .06);
  });
}
test('input work bounds enforced', () => {
  assert.throws(() => detectContours(new Uint8ClampedArray(4), 2000, 1));
  assert.throws(() => checkFile({ type: 'image/svg+xml', size: 12 }));
  assert.throws(() => checkFile({ type: 'application/pdf', size: 12 }));
  assert.throws(() => checkFile({ type: 'image/jpeg', size: 13000000 }));
});
test('headers bounded before decode, malformed and giant rejected', () => {
  const png = readFileSync(new URL('fixtures/plan-import/rectangle.png', import.meta.url));
  const buf = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
  assert.deepEqual(imageDimensions(buf, 'image/png'), { width: 500, height: 400 });
  new DataView(buf).setUint32(16, 20000);
  assert.throws(() => imageDimensions(buf, 'image/png'));
  assert.throws(() => imageDimensions(new ArrayBuffer(2), 'image/jpeg'));
});
test('OCR numbers retain explicit units; unitless numbers never guessed', () => {
  assert.deepEqual(parseDimensions('3500 мм; 250 cm; 4,20 м; №12'), [
    { raw: '3500 мм', value: 3500, unit: 'mm' }, { raw: '250 cm', value: 250, unit: 'cm' },
    { raw: '4,20 м', value: 4.2, unit: 'm' }, { raw: '12', value: 12, unit: null },
  ]);
  assert.deepEqual(parseDimensions('abc 0 мм'), []);
});
test('calibration: mm, cm and m produce same geometry without mutating pixels', () => {
  const before = structuredClone(square);
  for (const [length, unit] of [[4000, 'mm'], [400, 'cm'], [4, 'm']]) {
    const result = calibratedGeometry(square, { a: square[0], b: square[1], length, unit });
    assert.deepEqual(Object.values(result.edgeDimensions), [4, 3, 4, 3]);
    assert.equal(area(result.vertices), 12);
  }
  assert.deepEqual(square, before);
});
test('unknown units, zero and non-finite scales cannot enter calculator', () => {
  for (const calibration of [{ length: 4 }, { length: -1, unit: 'm' }, { length: 'NaN', unit: 'cm' }, { length: 1e10, unit: 'm' }]) {
    assert.throws(() => calibratedGeometry(square, { a: square[0], b: square[1], ...calibration }));
  }
  assert.throws(() => calibratedGeometry(square, { a: square[0], b: square[0], length: 4, unit: 'm' }));
});
test('self intersections, zero edges, collinear overlaps, nonfinite and empty rejected', () => {
  for (const p of [[], [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }], [...square, square[0]], [{x:0,y:0},{x:3,y:0},{x:1,y:0},{x:1,y:2}], [{x:NaN,y:0},...square]]) assert.ok(validatePolygon(p));
});

// DOM-level flow checks, deliberately NOT a browser/desktop substitute.
import { parseHTML } from 'linkedom';
import { openPlanImport } from '../src/plan-import/dialog.js';
function setup() {
  const { document, window } = parseHTML('<html><head><base href="https://example.test/MF_StP/"></head><body></body></html>');
  globalThis.document = document;
  window.HTMLElement.prototype.showModal = function () {};
  window.HTMLElement.prototype.close = function () {};
  // linkedom has no canvas or select-value implementation.
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', { configurable: true, get() { return this._value ?? ''; }, set(v) { this._value = String(v); } });
  window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (_, key) => key === 'measureText' ? () => ({ width: 20 }) : key === 'getImageData' ? () => ({ data: new Uint8ClampedArray(500 * 400 * 4) }) : () => {}, set: () => true });
  window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 400 });
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,fixture';
  globalThis.createImageBitmap = async () => ({ width: 500, height: 400, close() {} });
  class FakeWorker {
    static all = [];
    constructor(url) { this.url = url; FakeWorker.all.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
    respond(data) { this.onmessage({ data }); }
  }
  globalThis.Worker = FakeWorker;
  const room = { geometry: 'old', openings: ['window'], height: 2.7, material: 'old' };
  let applied = 0;
  const handle = openPlanImport({ onApply: geometry => { applied++; room.geometry = geometry; room.openings = []; } });
  const dialog = document.querySelector('dialog');
  const q = id => dialog.querySelector(`[data-id="${id}"]`);
  return { room, q, handle, FakeWorker, applied: () => applied };
}
async function upload(s) {
  const png = readFileSync(new URL('fixtures/plan-import/rectangle.png', import.meta.url));
  Object.defineProperty(s.q('file'), 'files', { value: [{ type: 'image/png', size: png.length, slice: () => ({ arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) }) }] });
  await s.q('file').onchange();
}
function click(q, id) { q(id).onclick(); }
function calibrate(s) {
  click(s.q, 'calibrate');
  s.q('canvas').onpointerdown({ clientX: 40, clientY: 40 });
  s.q('canvas').onpointerdown({ clientX: 440, clientY: 40 });
  s.q('length').value = '4'; s.q('unit').value = 'm'; s.q('unit').onchange();
}
test('cancel draft preserves room/settings/openings; kills worker, ignores late result', async () => {
  const s = setup(), before = structuredClone(s.room); await upload(s);
  click(s.q, 'detect'); const worker = s.FakeWorker.all[0];
  s.handle.close(); worker.respond({ candidates: [{ points: square }] });
  assert.deepEqual(s.room, before); assert.equal(s.applied(), 0); assert.equal(worker.terminated, true);
  assert.equal(document.querySelector('dialog'), null);
});
test('explicit contour choice + calibration + review required; apply only once, settings retained', async () => {
  const s = setup(); await upload(s); click(s.q, 'detect');
  s.FakeWorker.all[0].respond({ candidates: [{ points: square }, { points: square.map(p => ({x:p.x+20,y:p.y+20})) }] });
  assert.equal(s.applied(), 0); assert.equal(s.q('apply').disabled, true);
  calibrate(s); s.q('confirmed').checked = true; s.q('confirmed').onchange();
  assert.equal(s.q('apply').disabled, true); // no selected contour
  s.q('candidate').value = '0'; s.q('candidate').onchange(); calibrate(s);
  assert.equal(s.q('apply').disabled, true);
  s.q('confirmed').checked = true; s.q('confirmed').onchange(); assert.equal(s.q('apply').disabled, false);
  click(s.q, 'apply'); click(s.q, 'apply'); assert.equal(s.applied(), 1); assert.equal(s.room.geometry.edgeDimensions[0], 4);
  assert.deepEqual(s.room.openings, []); assert.equal(s.room.height, 2.7); assert.equal(s.room.material, 'old');
});
test('stop terminates heavy worker and allows manual retry without mutation', async () => {
  const s = setup(); await upload(s); const before = structuredClone(s.room);
  click(s.q, 'ocr'); const first = s.FakeWorker.all[0]; click(s.q, 'stop');
  assert.equal(first.terminated, true); assert.equal(s.q('ocr').disabled, false);
  first.respond({ words: [] }); assert.deepEqual(s.room, before); s.handle.close();
});

import { SketchEditor } from '../src/editor/sketch-editor.js';
import { Room } from '../src/core/room-model.js';
test('actual editor apply uses existing Room pipeline once and preserves height/settings', () => {
  const room = new Room({ wallHeight: 3.2 }); room.openings = [{ id: 'door' }]; room.material = 'unchanged';
  const editor = Object.create(SketchEditor.prototype);
  let changes = 0, settle = 0;
  Object.assign(editor, { room, wallHeightValue: 3.2, history: ['old'], future: [], keypad: { hide() {} },
    onRoomChange: () => changes++, _removeBackgroundImage() {}, _clearPanelOverlay() {}, _markGeometryEditing() {},
    _scheduleFit() {}, render() {}, _updateUi() {}, _beginPanelSettle() { settle++; } });
  const result = calibratedGeometry(square, { a: square[0], b: square[1], length: 4, unit: 'm' });
  editor._applyImportedPlan(result);
  assert.equal(room.getTotalArea(), 12); assert.equal(room.wallHeight, 3.2); assert.equal(room.material, 'unchanged');
  assert.deepEqual(room.openings, []); assert.equal(changes, 1); assert.equal(settle, 1); assert.deepEqual(editor.history, []);
});
test('manual contour edits invalidate review and block applying self-intersection', async () => {
  const s = setup(); await upload(s); click(s.q, 'draw');
  for (const p of square) s.q('canvas').onpointerdown({ clientX: p.x, clientY: p.y });
  click(s.q, 'finish'); calibrate(s); s.q('confirmed').checked = true; s.q('confirmed').onchange();
  assert.equal(s.q('apply').disabled, false);
  const input = s.q('vertices').querySelector('input'); input.value = '440'; input.onchange();
  assert.equal(s.q('confirmed').checked, false); assert.equal(s.q('apply').disabled, true);
  assert.equal(s.applied(), 0); s.handle.close();
});
test('OCR text cannot choose a contour or units that were not recognized', async () => {
  const s = setup(); await upload(s); click(s.q, 'ocr');
  s.FakeWorker.all[0].respond({ words: [{ text: '3500', confidence: 20, bbox: { x0: 10, y0: 10, x1: 80, y1: 30 } }] });
  s.q('words').querySelector('button').onclick();
  assert.equal(s.q('length').value, '3500'); assert.equal(s.q('unit').value, '');
  assert.equal(s.q('apply').disabled, true); assert.equal(s.applied(), 0); s.handle.close();
});

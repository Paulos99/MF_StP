/** Tests the actual app functions without booting a browser or adding test-only
 * production exports. External UI effects are stubbed, calculation/DOM paths kept. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { Room } from '../src/core/room-model.js';
import { PolygonPanelCalculator, ceilingLayoutCacheKey } from '../src/calculators/polygon-ceiling-calculator.js';
import { WallCalculator } from '../src/calculators/wall-calculator.js';
import { buildBOM, renderResultsHtml } from '../src/calculators/materials-bom.js';
import { PANEL, PANEL_COVERAGE_AREA, RESERVES } from '../src/core/constants.js';
import { createRectangleVertices, createLShapeVertices } from '../src/core/polygon-geometry.js';
import { buildEdgeDimensionsFromVertices } from '../src/editor/sketch-constraints.js';

const source = readFileSync(process.env.MF_APP_SOURCE || new URL('../src/ui/app.js', import.meta.url), 'utf8').replace(/^import .+;\n/gm, '');
const rectangle = () => new Room({ vertices: createRectangleVertices(4, 3), wallHeight: 2.7 });
const calculate = room => new PolygonPanelCalculator(room.vertices).calculateBestScheme();
function harness() {
  const { document, window } = parseHTML(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', { configurable: true, get() { return this._value ?? ''; }, set(value) { this._value = value; } });
  let mobile = false, reduceMotion = true, sequence = 0;
  const frames = new Map(), timers = new Map(), media = new Map(), requests = [];
  const matchMedia = query => {
    if (!media.has(query)) media.set(query, { get matches() { return query.includes('max-width: 899') ? mobile : query.includes('reduced-motion') ? reduceMotion : false; }, addEventListener: (_, fn) => { media.get(query).listener = fn; } });
    return media.get(query);
  };
  const appWindow = { matchMedia, addEventListener() {} };
  class DeferredCalculator {
    constructor(vertices) { this.vertices = vertices; this.offsetX = this.offsetY = 0; requests.push(this); }
    calculateBestSchemeAsync() { return new Promise(resolve => { this.resolve = resolve; }); }
  }
  const context = vm.createContext({
    document, window: appWindow, initCalcMetrika() {}, Room, PolygonPanelCalculator: DeferredCalculator,
    ceilingLayoutCacheKey, WallCalculator, buildBOM, renderResultsHtml, PANEL, PANEL_COVERAGE_AREA, RESERVES,
    createRectangleVertices, buildEdgeDimensionsFromVertices, console,
    performance: { now: () => 0 },
    requestAnimationFrame: fn => { const id = ++sequence; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: fn => { const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(source + `\ncacheElements(); globalThis.qa = {state, els, validation: [], selectedWallIds: [],
    animateStatValue, updateStatCards, updateLayoutMode, setupMobileActions, runCalculation,
    clearResultsUi, scheduleAutoRecalc, markPanelPreviewStale};
    validateBeforeCalc = () => qa.validation;
    readSelectedWallIds = () => qa.selectedWallIds;
    showValidationErrors = () => {};
    syncCalcButtons = syncChromeUi = syncResultsAsideVisibility = updateSchemeModeUi = () => {};
    fitSketchAfterLayoutChange = closeMobileSidebar = enterMobileSketchStep = exitMobileSketchStep = () => {};
    updateResultsPreview = flashCalcReadyStatus = revealResultsAfterCalc = () => {};
    populateWallSelect = syncPlanOverlayOptions = renderCeiling = renderSelectedWall = updateResultsTabsVisibility = () => {};
  `, context);
  const qa = context.qa;
  qa.state.inputMode = 'draw'; qa.state.room = rectangle();
  qa.selectedWallIds = qa.state.room.walls.map(w => w.id);
  qa.els.form.calcCeiling.checked = true;
  qa.els.form.ceilingMounting.value = 'ceiling_frameless';
  qa.els.form.wallMounting.value = 'wall_frameless';
  const flushFrames = () => {
    for (let i = 0; frames.size && i < 10; i++) { const batch = [...frames.values()]; frames.clear(); for (const fn of batch) fn(10000); }
    assert.equal(frames.size, 0);
  };
  return { qa, document, requests, timers, frames, flushFrames,
    stepFrames: time => { const batch = [...frames.values()]; frames.clear(); for (const fn of batch) fn(time); },
    setMotion: value => { reduceMotion = value; },
    resize: value => { mobile = value; media.get('(max-width: 899px)')?.listener?.(); },
    get: id => document.getElementById(id),
  };
}
async function initialCalculation(h) {
  const request = h.qa.runCalculation();
  h.requests.at(-1).resolve(calculate(h.qa.state.room));
  assert.equal(await request, true); h.flushFrames();
}
function assertSummary(h, panels, area, cost) {
  assert.equal(Number(h.get('totalPanels').dataset.raw), panels);
  assert.equal(Number(h.get('coverageArea').dataset.raw), area);
  assert.equal(Number(h.get('totalCost').dataset.raw), cost);
}

test('4x3 room aggregate correctly includes ceiling + all walls, not floor area alone', async () => {
  const h = harness(); await initialCalculation(h);
  assert.equal(h.qa.state.bom.ceiling.stats.withReserve, 36);
  assert.equal(h.qa.state.bom.walls.stats.withReserve, 102);
  assertSummary(h, 138, 49.800000000000004, 330648);
  assert.match(h.get('resultsText').textContent, /36/);
  assert.match(h.get('resultsText').textContent, /102/);
  assert.equal(h.qa.state.calcRoom.getTotalArea(), 12);
});

test('mobile locked results never zero committed aggregates; desktop round trip repaints coherent state', async () => {
  const h = harness(); await initialCalculation(h); h.qa.setupMobileActions();
  const bom = h.qa.state.bom, room = h.qa.state.room;
  h.resize(true); h.qa.updateLayoutMode(); h.flushFrames();
  assert.equal(h.get('appLayout').getAttribute('data-state'), 'empty'); // presentation gate only
  assertSummary(h, 138, 49.800000000000004, 330648);
  h.resize(false); h.flushFrames();
  assert.equal(h.get('appLayout').getAttribute('data-state'), 'ready');
  assertSummary(h, 138, 49.800000000000004, 330648);
  assert.equal(h.qa.state.bom, bom); assert.equal(h.qa.state.room, room);
  assert.match(h.get('resultsText').textContent, /102/);
});

test('a repeated/no-op stat update cancels old animation even on the fast path', () => {
  const h = harness(); h.setMotion(false);
  const el = h.get('totalPanels'); el.dataset.raw = '0';
  h.qa.animateStatValue(el, 0, String, { duration: 280 }); // ready fast path
  h.qa.animateStatValue(el, 138, String); // pending animated 0 -> 138
  h.qa.animateStatValue(el, 0, String); // pending animated 138 -> 0
  h.qa.animateStatValue(el, 138, String); // supersede it
  h.qa.animateStatValue(el, 138, String); // same target: fast path must retire old RAF
  assert.equal(el.textContent, '138'); h.stepFrames(100); assert.equal(el.textContent, '138');
  h.flushFrames(); assert.equal(el.textContent, '138');
});

test('pending recalculation keeps all previously committed results intact until atomic replacement', async () => {
  const h = harness(); await initialCalculation(h);
  const old = { bom: h.qa.state.bom, wall: h.qa.state.wallResult, ceiling: h.qa.state.ceilingResult, room: h.qa.state.calcRoom };
  h.qa.state.room = new Room({ vertices: createLShapeVertices(6, 3, 2, 3), wallHeight: 2.7 });
  const requestedRoom = h.qa.state.room;
  const request = h.qa.runCalculation();
  assert.equal(h.qa.state.bom, old.bom); assert.equal(h.qa.state.wallResult, old.wall);
  assert.equal(h.qa.state.ceilingResult, old.ceiling); assert.equal(h.qa.state.calcRoom, old.room);
  h.requests.at(-1).resolve(calculate(requestedRoom)); assert.equal(await request, true); h.flushFrames();
  assert.notEqual(h.qa.state.bom, old.bom); assert.notEqual(h.qa.state.calcRoom, requestedRoom);
  assert.equal(h.qa.state.calcRoom.getTotalArea(), requestedRoom.getTotalArea());
  assert.equal(Number(h.get('totalPanels').dataset.raw), h.qa.state.bom.total.panelsWithReserve);
});

test('geometry edit immediately invalidates a running calculation before debounce fires', async () => {
  const h = harness(); await initialCalculation(h);
  const previousBOM = h.qa.state.bom;
  h.qa.state.room = new Room({ vertices: createLShapeVertices(6, 3, 2, 3) });
  const request = h.qa.runCalculation(); const staleWorker = h.requests.at(-1);
  h.qa.state.room.setVertices(createRectangleVertices(8, 5), {}, {});
  h.qa.scheduleAutoRecalc(); // new generation NOW; don't execute the debounce timer
  staleWorker.resolve(calculate(rectangle())); assert.equal(await request, false);
  assert.equal(h.qa.state.bom, previousBOM); assert.equal(h.qa.state.room.getTotalArea(), 40);
});

test('out-of-order calculation completions cannot overwrite the newest room or panels', async () => {
  const h = harness();
  const old = h.qa.runCalculation(); const first = h.requests[0];
  h.qa.state.room = new Room({ vertices: createRectangleVertices(5, 5) });
  const latest = h.qa.runCalculation(); const second = h.requests[1];
  second.resolve(calculate(h.qa.state.room)); assert.equal(await latest, true);
  const bom = h.qa.state.bom;
  first.resolve(calculate(rectangle())); assert.equal(await old, false);
  assert.equal(h.qa.state.bom, bom); assert.equal(h.qa.state.calcRoom.getTotalArea(), 25);
});

test('quick area result supersedes an older async room calculation', async () => {
  const h = harness();
  const pending = h.qa.runCalculation(); const old = h.requests[0];
  h.qa.state.inputMode = 'area'; h.qa.state.areaWalls = []; h.qa.els.form.areaOnlyInput.value = '7';
  assert.equal(await h.qa.runCalculation(), true); const bom = h.qa.state.bom;
  old.resolve(calculate(rectangle())); assert.equal(await pending, false);
  assert.equal(h.qa.state.bom, bom); assert.equal(bom.ceiling.area, 7); assert.equal(h.qa.state.wallResult, null);
});

test('clear or invalid calculation prevents pending requests from restoring stale results', async () => {
  for (const invalid of [false, true]) {
    const h = harness(); const pending = h.qa.runCalculation(); const old = h.requests[0];
    if (invalid) { h.qa.validation = ['bad room']; assert.equal(await h.qa.runCalculation({ silent: true }), false); }
    else h.qa.clearResultsUi();
    old.resolve(calculate(rectangle())); assert.equal(await pending, false);
    h.flushFrames(); assert.equal(h.qa.state.bom, null); assertSummary(h, 0, 0, 0);
  }
});

test('request snapshots room/openings/options rather than reading live mutable state after await', async () => {
  const h = harness(); const pending = h.qa.runCalculation(); const request = h.requests[0];
  const input = h.qa.state.room;
  input.wallHeight = 5; h.qa.state.options.wallMounting = 'wall_framed';
  request.resolve(calculate(rectangle())); assert.equal(await pending, true);
  assert.equal(h.qa.state.calcRoom.wallHeight, 2.7); assert.equal(h.qa.state.options.wallMounting, 'wall_frameless');
  assert.equal(h.qa.state.bom.walls.area, 37.800000000000004);
});

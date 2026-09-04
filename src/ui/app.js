import { Room } from '../core/room-model.js';
import { PolygonPanelCalculator } from '../calculators/polygon-ceiling-calculator.js';
import { WallCalculator } from '../calculators/wall-calculator.js';
import { buildBOM, formatResultsText } from '../calculators/materials-bom.js';
import { PANEL, PANEL_COVERAGE_AREA, RESERVES } from '../core/constants.js';
import { createRectangleVertices } from '../core/polygon-geometry.js';
import { buildEdgeDimensionsFromVertices } from '../editor/sketch-constraints.js';
import { CeilingVisualizer } from '../visualizers/ceiling-visualizer.js';
import { WallVisualizer } from '../visualizers/wall-visualizer.js';
import { getCeilingFrameBounds } from '../visualizers/frame-overlay.js';
import { SketchEditor } from '../editor/sketch-editor.js';
import { validateRoomForm } from '../editor/opening-tool.js';
import { buildShareUrl, readShareFromUrl, buildProjectPayload } from '../export/share-link.js';

const AUTO_RECALC_MS = 400;
const MOBILE_MQ = '(max-width: 899px)';

const state = {
  inputMode: null,
  areaValue: null,
  areaWalls: [],
  hasResults: false,
  resultsStale: false,
  room: Room.createDefault(),
  ceilingCalc: null,
  bom: null,
  ceilingResult: null,
  wallResult: null,
  activeView: 'plan',
  forceAreaBySize: false,
  options: {
    calcCeiling: true,
    calcWalls: true,
    selectedWallIds: [],
    ceilingMounting: 'ceiling_frameless',
    wallMounting: 'wall_framed',
  },
};

let sketchEditor;
let ceilingViz;
let wallViz;
let autoRecalcTimer = null;
let panelPreviewToken = 0;

const els = {};

function $(id) {
  return document.getElementById(id);
}

function cacheElements() {
  els.form = {
    quickLength: $('quickLength'),
    quickWidth: $('quickWidth'),
    quickHeight: $('quickHeight'),
    wallHeight: $('wallHeight'),
    areaOnlyInput: $('areaOnlyInput'),
    calcCeiling: $('calcCeiling'),
    ceilingMounting: $('ceilingMounting'),
    ceilingMountingGroup: $('ceilingMountingGroup'),
    wallSurfacesList: $('wallSurfacesList'),
    wallMounting: $('wallMounting'),
    wallMountingGroup: $('wallMountingGroup'),
    selectAllWallsBtn: $('selectAllWallsBtn'),
    deselectAllWallsBtn: $('deselectAllWallsBtn'),
  };
}

function isMobileLayout() {
  return window.matchMedia(MOBILE_MQ).matches;
}

function getNoModeHint() {
  return isMobileLayout()
    ? 'Нажмите «Ввести параметры расчёта» внизу и выберите способ'
    : 'Выберите способ слева: размеры, схема или площадь';
}

function isSketchMode(mode = state.inputMode) {
  return mode === 'dims' || mode === 'draw';
}

const MODE_LABELS = {
  dims: 'Ввести размеры',
  draw: 'Нарисовать схему',
  area: 'По площади',
};

let lastPanelsSnapshot = null;

function syncMobileParamsBtn() {
  const btn = $('mobileParamsBtn');
  if (!btn) return;
  btn.textContent = state.hasResults || state.inputMode
    ? 'Изменить параметры'
    : 'Ввести параметры расчёта';
}

function closeMobileSidebar() {
  document.body.classList.remove('mobile-sidebar-open');
}

function flashSchemeUpdated() {
  const card = document.querySelector('.scheme-card');
  const statusEl = $('schemeStatus');
  if (card) {
    card.classList.remove('is-updated');
    // force reflow for restart animation
    void card.offsetWidth;
    card.classList.add('is-updated');
    setTimeout(() => card.classList.remove('is-updated'), 1600);
  }
  if (statusEl) {
    statusEl.hidden = false;
    statusEl.textContent = 'Схема обновлена';
    statusEl.classList.add('is-computing');
    setTimeout(() => {
      statusEl.classList.remove('is-computing');
      statusEl.hidden = true;
      statusEl.textContent = '';
    }, 2200);
  }
  sketchEditor?.showToast?.('Схема обновлена');
  sketchEditor?.fitToScreen?.();
  card?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
}

function updateMobileSummary() {
  // Mobile footer no longer shows sum — kept as no-op for callers
}

const statAnimRafs = {};

function formatStatPanels(n) {
  return `${Math.round(n).toLocaleString('ru-RU')} шт.`;
}

function formatStatArea(n) {
  return `${Number(n).toFixed(2)} м²`;
}

function formatStatCost(n) {
  return `${Math.round(n).toLocaleString('ru-RU')} ₽`;
}

function animateStatValue(el, toValue, formatter, { duration = 520 } = {}) {
  if (!el) return;
  const from = parseFloat(el.dataset.raw || '0') || 0;
  const to = Number(toValue) || 0;
  el.dataset.raw = String(to);

  const card = el.closest('.stat-card');
  card?.classList.remove('is-recalculating');
  card?.classList.add('is-updating');
  el.classList.remove('is-stale');
  el.classList.add('is-updating');

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (reduceMotion || Math.abs(to - from) < 0.005) {
    el.textContent = formatter(to);
    requestAnimationFrame(() => {
      el.classList.remove('is-updating');
      card?.classList.remove('is-updating');
    });
    return;
  }

  const key = el.id || 'stat';
  if (statAnimRafs[key]) cancelAnimationFrame(statAnimRafs[key]);
  const start = performance.now();
  const ease = (t) => 1 - (1 - t) ** 3;

  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const v = from + (to - from) * ease(t);
    el.textContent = formatter(v);
    if (t < 1) {
      statAnimRafs[key] = requestAnimationFrame(tick);
    } else {
      el.textContent = formatter(to);
      el.classList.remove('is-updating');
      card?.classList.remove('is-updating');
      delete statAnimRafs[key];
    }
  };
  statAnimRafs[key] = requestAnimationFrame(tick);
}

function updateStatCards() {
  const bom = state.bom;
  if (!state.hasResults || !bom?.total) {
    animateStatValue($('totalPanels'), 0, formatStatPanels, { duration: 280 });
    animateStatValue($('coverageArea'), 0, formatStatArea, { duration: 280 });
    animateStatValue($('totalCost'), 0, formatStatCost, { duration: 280 });
    updateMobileSummary();
    return;
  }

  const panels = bom.total.panelsWithReserve ?? 0;
  const area = (bom.ceiling?.area ?? 0) + (bom.walls?.area ?? 0);
  const cost = bom.total.totalCost ?? 0;
  animateStatValue($('totalPanels'), panels, formatStatPanels);
  animateStatValue($('coverageArea'), area, formatStatArea);
  animateStatValue($('totalCost'), cost, formatStatCost);
  updateMobileSummary();
}

function setCalcButtonStale(_isStale) {
  /* stale UI removed — kept as no-op for call sites */
}

function markResultsStale() {
  if (!state.hasResults) return;
  scheduleAutoRecalc();
}

function scheduleAutoRecalc() {
  if (!state.inputMode) return;
  markStatsRecalculating();
  clearTimeout(autoRecalcTimer);
  autoRecalcTimer = setTimeout(() => {
    runCalculation({ silent: true });
  }, AUTO_RECALC_MS);
}

function onAutoRecalcFieldChange() {
  scheduleAutoRecalc();
}

function onExplicitChange() {
  scheduleAutoRecalc();
}

function syncCalcButtons() {
  const label = state.hasResults ? 'Пересчитать' : 'Рассчитать';
  const labelEl = $('calculateBtnLabel');
  if (labelEl) labelEl.textContent = label;
  syncMobileParamsBtn();
}

function updatePlanStats() {
  const text = state.room.vertices?.length
    ? `Площадь: ${state.room.getTotalArea().toFixed(2)} м² · Периметр: ${state.room.getPerimeter().toFixed(2)} м`
    : 'Площадь: — · Периметр: —';
  ['planStats', 'planStatsDims', 'planStatsDraw'].forEach((id) => {
    const el = $(id);
    if (el) el.textContent = text;
  });
}

function updateLayoutMode() {
  const workspace = $('appLayout');
  if (!workspace) return;

  const uiState = !state.hasResults ? 'empty' : 'ready';
  workspace.setAttribute('data-state', uiState);
  workspace.setAttribute('data-view', state.activeView || 'plan');

  const downloadDisabled = !state.hasResults;
  if ($('downloadBtn')) $('downloadBtn').disabled = downloadDisabled;

  syncCalcButtons();
  updateStatCards();
  syncChromeUi();
}

/** Спрятать шум: дубли, детали, кнопки — пока нет актуального расчёта */
function syncChromeUi() {
  const ready = !!state.hasResults;
  const mode = state.inputMode;
  const drawReady = mode !== 'draw' || (state.room.vertices?.length >= 3);

  document.querySelector('.workspace-section--panel-info')?.toggleAttribute('hidden', true);
  $('projectLoadedBanner')?.classList.toggle('is-compact', true);

  const resultsCard = document.querySelector('.results-card');
  const secondary = document.querySelector('.secondary-toolbar');
  const stats = document.querySelector('.workspace-stats');

  if (resultsCard) resultsCard.hidden = !ready;
  if (secondary) secondary.hidden = !ready;
  if (stats) stats.classList.toggle('is-idle', !ready);

  $('shareBtnSecondary')?.toggleAttribute('hidden', !ready);
  $('downloadBtn')?.toggleAttribute('hidden', !ready);
  $('calcReadyBanner')?.toggleAttribute('hidden', !ready);

  // В draw до замкнутого контура — только высота/фото, без «что считать»
  const shared = $('sharedCalcOptions');
  if (shared) {
    shared.hidden = !mode || (mode === 'draw' && !drawReady);
  }

  // Оверлеи схемы — только когда есть раскладка
  $('planOverlayToggles')?.classList.toggle(
    'is-hidden',
    !ready || !isSketchMode() || state.activeView !== 'plan'
  );

  // Тема оставляем всегда, но подпись короче на empty
  document.querySelector('.theme-toggle__label')?.toggleAttribute('hidden', !mode);
}

function clearResultsUi(message = '') {
  state.hasResults = false;
  state.bom = null;
  state.ceilingResult = null;
  state.wallResult = null;
  state.ceilingCalc = null;
  state.resultsStale = false;
  lastPanelsSnapshot = null;
  const textEl = $('resultsText');
  if (textEl) {
    textEl.textContent = message || (state.inputMode
      ? 'Цифры появятся после расчёта'
      : 'Выберите способ слева');
  }
  $('calcReadyBanner')?.setAttribute('hidden', '');
  sketchEditor?.clearPanelPreview?.();
  updateResultsTabsVisibility();
  updateStatCards();
  updateResultsPreview();
  syncChromeUi();
}

function renderPlanEditors() {
  updatePlanStats();
}

function isRoomTooLargeForScheme(len, wid) {
  const L = Number(len) || 0;
  const W = Number(wid) || 0;
  return L > 50 || W > 50 || L * W > 500;
}

function updateSchemeModeUi() {
  const workspace = $('appLayout');
  const hint = $('schemeModeHint');
  const hintText = $('schemeModeHintText');
  const areaPh = $('schemeAreaPlaceholder');
  const host = $('sketchEditorHost');
  const noMode = !state.inputMode;
  const schemeTooBig = state.inputMode === 'dims' && state.forceAreaBySize;
  const hideScheme = noMode || state.inputMode === 'area' || schemeTooBig;
  const showAreaPh = !noMode && (state.inputMode === 'area' || schemeTooBig);
  workspace?.setAttribute('data-calc-mode', state.inputMode || 'none');
  if (hint) hint.hidden = !noMode;
  if (hintText && noMode) hintText.textContent = getNoModeHint();
  if (areaPh) {
    areaPh.hidden = !showAreaPh;
    if (schemeTooBig) {
      areaPh.innerHTML = '<p>Помещение слишком большое для схемы — считаем по площади</p>';
    } else {
      areaPh.innerHTML = '<p>Расчёт по площади — схема не используется</p>';
    }
  }
  if (host) host.hidden = hideScheme;
  $('planOverlayToggles')?.classList.toggle('is-hidden', hideScheme || state.activeView !== 'plan');
  const statusEl = $('schemeStatus');
  if (statusEl && hideScheme) {
    statusEl.hidden = true;
    statusEl.classList.remove('is-computing');
  }
  if (hideScheme) {
    sketchEditor?.clearPanelPreview?.();
  }
  syncModePanelsUi();
  syncMobileParamsBtn();
}

function applyQuickRect() {
  const len = parseFloat(els.form.quickLength.value) || 5;
  const wid = parseFloat(els.form.quickWidth.value) || 4;
  const h = parseFloat(els.form.quickHeight?.value) || 2.7;
  state.forceAreaBySize = isRoomTooLargeForScheme(len, wid);
  updateSchemeModeUi();

  if (state.forceAreaBySize) {
    const verts = createRectangleVertices(len, wid);
    state.room.wallHeight = h;
    els.form.wallHeight.value = h;
    state.room.setVertices(verts, buildEdgeDimensionsFromVertices(verts), {});
    if (els.form.areaOnlyInput) els.form.areaOnlyInput.value = (len * wid).toFixed(2);
    state.areaValue = len * wid;
    sketchEditor?.syncFromRoom?.(state.room, { settle: false });
    updatePlanStats();
    refreshWallSurfaceCheckboxes();
    sketchEditor?.showToast?.('Помещение слишком большое для схемы — считаем по площади');
    scheduleAutoRecalc();
    return;
  }

  const verts = createRectangleVertices(len, wid);
  state.room.wallHeight = h;
  els.form.wallHeight.value = h;
  state.room.setVertices(verts, buildEdgeDimensionsFromVertices(verts), {});
  sketchEditor?.syncFromRoom?.(state.room, { settle: true, fit: true });
  updatePlanStats();
  refreshWallSurfaceCheckboxes();
  onExplicitChange();
}

function syncFormToRoom() {
  if (isSketchMode()) {
    const h = state.inputMode === 'draw'
      ? (parseFloat($('drawHeight')?.value) || parseFloat(els.form.wallHeight?.value) || 2.7)
      : (parseFloat(els.form.quickHeight?.value) || parseFloat(els.form.wallHeight?.value) || 2.7);
    state.room.wallHeight = h;
    els.form.wallHeight.value = h;
    if (els.form.quickHeight) els.form.quickHeight.value = h;
    if ($('drawHeight')) $('drawHeight').value = h;
  }
}

function applyRoomToForm(room) {
  const f = els.form;
  f.quickLength.value = room.mainLength;
  f.quickWidth.value = room.mainWidth;
  if (f.quickHeight) f.quickHeight.value = room.wallHeight;
  f.wallHeight.value = room.wallHeight;
  state.room = room.clone();
  state.forceAreaBySize = isRoomTooLargeForScheme(room.mainLength, room.mainWidth);
  if (state.inputMode === 'dims' && !state.forceAreaBySize) {
    sketchEditor?.syncFromRoom?.(state.room, { settle: true });
  } else if (state.inputMode === 'draw') {
    sketchEditor?.syncFromRoom?.(state.room, { settle: true });
  } else {
    sketchEditor?.syncFromRoom?.(state.room, { settle: false });
  }
  updatePlanStats();
  refreshWallSurfaceCheckboxes();
  updateSchemeModeUi();
}

function showValidationErrors(errors) {
  const box = $('validationErrors');
  if (!errors.length) {
    box.innerHTML = '';
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  box.innerHTML = errors.map((e) => `<div>${e}</div>`).join('');
}

function readSelectedWallIds() {
  if (state.inputMode === 'area') {
    return state.areaWalls.filter((w) => w.enabled && w.area > 0).map((w) => w.id);
  }
  const list = $('wallSurfacesList');
  if (!list) return state.options.selectedWallIds ?? [];
  return [...list.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
}

function renderAreaWallsList() {
  const list = $('areaWallsList');
  if (!list) return;
  list.innerHTML = state.areaWalls.map((w, i) => `
    <div class="area-wall-row" data-wall-id="${w.id}">
      <label class="area-wall-row__check">
        <input type="checkbox" data-area-wall-check="${w.id}" ${w.enabled ? 'checked' : ''} />
      </label>
      <span class="area-wall-row__label">Стена ${i + 1}</span>
      <input type="number" class="area-wall-row__input" data-area-wall-input="${w.id}"
        value="${w.area || ''}" placeholder="м²" step="0.1" min="0.1" />
      <button type="button" class="btn-link area-wall-row__remove" data-area-wall-remove="${w.id}" title="Удалить">×</button>
    </div>`).join('');

  list.querySelectorAll('[data-area-wall-check]').forEach((el) => {
    el.addEventListener('change', () => {
      const wall = state.areaWalls.find((w) => w.id === el.dataset.areaWallCheck);
      if (wall) wall.enabled = el.checked;
      updateSurfaceGroupsUi();
      onAutoRecalcFieldChange();
    });
  });
  list.querySelectorAll('[data-area-wall-input]').forEach((el) => {
    el.addEventListener('input', () => {
      const wall = state.areaWalls.find((w) => w.id === el.dataset.areaWallInput);
      if (wall) wall.area = parseFloat(el.value) || 0;
      onExplicitChange();
    });
  });
  list.querySelectorAll('[data-area-wall-remove]').forEach((el) => {
    el.addEventListener('click', () => {
      state.areaWalls = state.areaWalls.filter((w) => w.id !== el.dataset.areaWallRemove);
      renderAreaWallsList();
      updateSurfaceGroupsUi();
      onExplicitChange();
    });
  });
}

function addAreaWall() {
  state.areaWalls.push({ id: `aw-${Date.now()}`, area: 0, enabled: true });
  renderAreaWallsList();
  updateSurfaceGroupsUi();
  onExplicitChange();
}

function refreshWallSurfaceCheckboxes() {
  if (state.inputMode === 'area') {
    renderAreaWallsList();
    updateSurfaceGroupsUi();
    return;
  }
  syncFormToRoom();
  const list = els.form.wallSurfacesList;
  if (!list) return;

  const prev = new Set(
    state.options.selectedWallIds?.length
      ? state.options.selectedWallIds
      : state.room.walls.map((w) => w.id)
  );

  list.innerHTML = state.room.walls
    .map(
      (w) => `
      <label class="surface-chip surface-chip--toggle">
        <input type="checkbox" name="wallSurface" value="${w.id}" ${prev.has(w.id) ? 'checked' : ''} />
        <span class="surface-chip__label">${w.label.replace(/^Стена\s+/i, '')}</span>
      </label>`
    )
    .join('');

  state.options.selectedWallIds = readSelectedWallIds();
  updateSurfaceGroupsUi();
}

function setAllWallSurfaces(checked) {
  els.form.wallSurfacesList?.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.checked = checked;
  });
  state.options.selectedWallIds = readSelectedWallIds();
  updateSurfaceGroupsUi();
  onAutoRecalcFieldChange();
}

function updateSurfaceGroupsUi() {
  const f = els.form;
  const ceilingOn = f.calcCeiling?.checked ?? false;
  const wallsOn = readSelectedWallIds().length > 0;
  f.ceilingMountingGroup?.classList.toggle('is-disabled', !ceilingOn);
  f.wallMountingGroup?.classList.toggle('is-disabled', !wallsOn);

  const isArea = state.inputMode === 'area';
  $('areaWallsBlock')?.toggleAttribute('hidden', false);
  if (isArea) renderAreaWallsList();

  const refine = $('refineOpeningsCta');
  if (refine) {
    refine.hidden = !(isSketchMode() && state.hasResults && wallsOn);
  }
}

function syncModePanelsUi() {
  const mode = state.inputMode;
  const entry = $('entryPicker');
  const bar = $('activeModeBar');
  const label = $('activeModeLabel');

  if (entry) entry.hidden = !!mode;
  if (bar) bar.hidden = !mode;
  if (label) label.textContent = MODE_LABELS[mode] || '—';

  const dimsCard = $('dimsCalcCard');
  const drawCard = $('drawCalcCard');
  const areaCard = $('quickCalcCard');
  if (dimsCard) {
    dimsCard.hidden = mode !== 'dims';
    // Площадь/периметр уже на схеме — не дублируем в сайдбаре
    const stats = $('planStatsDims');
    if (stats) stats.hidden = true;
  }
  if (drawCard) drawCard.hidden = mode !== 'draw';
  if (areaCard) areaCard.hidden = mode !== 'area';

  sketchEditor?.setGeometryLocked?.(mode === 'dims');
  // В dims размеры уже слева и на рёбрах — нижняя строка площади дублирует
  const bottomStats = document.getElementById('sketchBottomStats');
  if (bottomStats) bottomStats.hidden = mode === 'dims';
  syncChromeUi();
}

/** Открыть режим (взаимоисключение dims | draw | area) */
function setInputMode(mode, { confirmSwitch = false, preserveGeometry = false } = {}) {
  const next = mode === 'scheme' ? 'dims' : mode;
  if (next && !['dims', 'draw', 'area'].includes(next)) return;

  if (confirmSwitch && state.inputMode && state.inputMode !== next && state.hasResults) {
    const ok = window.confirm('Сменить способ расчёта? Текущая схема и цифры будут пересобраны.');
    if (!ok) return;
  }

  const prev = state.inputMode;
  state.inputMode = next || null;

  if (!next) {
    clearResultsUi('Выберите способ слева');
    syncModePanelsUi();
    updateSchemeModeUi();
    updateLayoutMode();
    return;
  }

  if (!preserveGeometry) {
    clearResultsUi(next === 'draw'
      ? 'Нарисуйте и замкните контур — затем появятся цифры'
      : 'Цифры появятся после расчёта');
  }

  if (next === 'dims') {
    if (!preserveGeometry) applyQuickRect();
    else {
      sketchEditor?.setGeometryLocked?.(true);
      sketchEditor?.syncFromRoom?.(state.room, { settle: true, fit: true });
    }
    sketchEditor?.setGeometryLocked?.(true);
  } else if (next === 'draw') {
    state.forceAreaBySize = false;
    const h = parseFloat($('drawHeight')?.value) || state.room.wallHeight || 2.7;
    state.room.wallHeight = h;
    els.form.wallHeight.value = h;
    if (els.form.quickHeight) els.form.quickHeight.value = h;
    if ($('drawHeight')) $('drawHeight').value = h;
    sketchEditor?.setGeometryLocked?.(false);
    if (!preserveGeometry) {
      sketchEditor?.clear?.();
      state.room.setVertices([], {}, {});
      updatePlanStats();
      refreshWallSurfaceCheckboxes();
      void $('sketchEditorHost')?.offsetWidth;
      sketchEditor?.fitToScreen?.();
    } else {
      void $('sketchEditorHost')?.offsetWidth;
      sketchEditor?.syncFromRoom?.(state.room, { settle: true, fit: true });
    }
  } else if (next === 'area') {
    sketchEditor?.setGeometryLocked?.(false);
    if (!state.areaWalls.length) {
      state.areaWalls = [];
      renderAreaWallsList();
    }
  }

  syncModePanelsUi();
  refreshWallSurfaceCheckboxes();
  updateSurfaceGroupsUi();
  updateSchemeModeUi();

  if (next === 'dims' && !state.forceAreaBySize && !preserveGeometry) {
    void $('sketchEditorHost')?.offsetWidth;
    sketchEditor?.syncFromRoom?.(state.room, { settle: true, fit: true });
  }

  if (prev !== next) scheduleAutoRecalc();
}

function setupModeToggles() {
  $('entryDimsBtn')?.addEventListener('click', () => setInputMode('dims'));
  $('entryDrawBtn')?.addEventListener('click', () => setInputMode('draw'));
  $('entryAreaBtn')?.addEventListener('click', () => setInputMode('area'));
  $('changeModeBtn')?.addEventListener('click', () => setInputMode(null));

  $('drawUploadPhotoBtn')?.addEventListener('click', () => {
    $('sketchBgUploadBtn')?.click();
  });
  $('drawClearBtn')?.addEventListener('click', () => {
    sketchEditor?.clear?.();
    state.room.setVertices([], {}, {});
    updatePlanStats();
    refreshWallSurfaceCheckboxes();
    scheduleAutoRecalc();
  });
  $('drawHeight')?.addEventListener('input', () => {
    syncFormToRoom();
    sketchEditor.wallHeightValue = state.room.wallHeight;
    onExplicitChange();
  });

  $('refineOpeningsBtn')?.addEventListener('click', () => {
    setSchemeView('walls');
    sketchEditor?._openOpeningsModal?.();
  });
  $('readyOpenWallsBtn')?.addEventListener('click', () => setSchemeView('walls'));
  $('readyShareBtn')?.addEventListener('click', () => handleShare());
  $('shareBtnSecondary')?.addEventListener('click', () => handleShare());
}

function syncModeCardsUI() {
  syncModePanelsUi();
}

function setModeCardExpanded(_mode, _expanded) {
  /* legacy no-op — panels driven by inputMode */
}

function toggleModePanel(mode) {
  setInputMode(mode === 'scheme' ? 'dims' : mode, { confirmSwitch: true });
}

function syncSegmentedFromSelect(selectId) {
  const select = $(selectId);
  if (!select) return;
  const group = document.querySelector(`[data-segment-for="${selectId}"]`);
  if (!group) return;
  group.querySelectorAll('.segmented__btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.value === select.value);
  });
}

function setupSegmentedMounting() {
  document.querySelectorAll('[data-segment-for]').forEach((group) => {
    const selectId = group.dataset.segmentFor;
    const select = $(selectId);
    if (!select) return;
    group.querySelectorAll('.segmented__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        select.value = btn.dataset.value;
        syncSegmentedFromSelect(selectId);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    syncSegmentedFromSelect(selectId);
  });
}

function updateResultsPreview() {
  const card = document.querySelector('.results-card');
  const preview = $('resultsPreview');
  const textEl = $('resultsText');
  const btn = $('resultsExpandBtn');
  const collapseBtn = $('resultsCollapseBtn');
  if (!card || !preview || !textEl || !btn) return;

  preview.style.maxHeight = '';

  if (!state.hasResults) {
    card.classList.remove('is-expanded');
    btn.hidden = true;
    if (collapseBtn) collapseBtn.hidden = true;
    return;
  }

  // Главное — три карточки; детали свёрнуты (не дублировать итог)
  card.classList.remove('is-expanded');
  btn.hidden = false;
  btn.textContent = 'Подробнее: крепёж и каркас';
  if (collapseBtn) collapseBtn.hidden = true;
}

function setupResultsExpand() {
  const btn = $('resultsExpandBtn');
  const collapseBtn = $('resultsCollapseBtn');
  const card = document.querySelector('.results-card');
  const preview = $('resultsPreview');
  const textEl = $('resultsText');
  if (!btn || !card || !preview || !textEl) return;

  const setExpanded = (expanding) => {
    card.classList.toggle('is-expanded', expanding);
    btn.textContent = expanding ? 'Скрыть подробности' : 'Подробнее: крепёж и каркас';
    if (collapseBtn) collapseBtn.hidden = !expanding;
    if (expanding) {
      preview.style.maxHeight = `${Math.max(textEl.scrollHeight + 8, 80)}px`;
    } else {
      preview.style.maxHeight = '';
    }
  };

  btn.addEventListener('click', () => {
    setExpanded(!card.classList.contains('is-expanded'));
  });
  collapseBtn?.addEventListener('click', () => setExpanded(false));
}

function setupFormListeners() {
  const f = els.form;

  ['quickLength', 'quickWidth', 'quickHeight'].forEach((id) => {
    $(id)?.addEventListener('input', applyQuickRect);
  });

  $('addAreaWallBtn')?.addEventListener('click', addAreaWall);

  f.areaOnlyInput?.addEventListener('input', () => {
    state.areaValue = parseFloat(f.areaOnlyInput.value) || null;
    onExplicitChange();
  });

  f.calcCeiling?.addEventListener('change', () => {
    updateSurfaceGroupsUi();
    onAutoRecalcFieldChange();
  });

  f.wallSurfacesList?.addEventListener('change', () => {
    state.options.selectedWallIds = readSelectedWallIds();
    updateSurfaceGroupsUi();
    onAutoRecalcFieldChange();
  });

  f.selectAllWallsBtn?.addEventListener('click', () => setAllWallSurfaces(true));
  f.deselectAllWallsBtn?.addEventListener('click', () => setAllWallSurfaces(false));

  ['ceilingMounting', 'wallMounting'].forEach((id) => {
    $(id)?.addEventListener('change', (e) => {
      const val = e.target?.value;
      const becameFramed = val === 'ceiling_framed' || val === 'wall_framed';
      if (becameFramed && $('showFrame')) {
        $('showFrame').checked = true;
        if ($('showFrameMobile')) $('showFrameMobile').checked = true;
        $('showFrameLabel')?.classList.add('is-highlighted');
        $('showFrameMobileLabel')?.classList.add('is-highlighted');
        setTimeout(() => {
          $('showFrameLabel')?.classList.remove('is-highlighted');
          $('showFrameMobileLabel')?.classList.remove('is-highlighted');
        }, 2400);
      }
      syncPlanOverlayOptions();
      renderCeiling();
      renderSelectedWall();
      onAutoRecalcFieldChange();
    });
  });

  $('calculateBtn')?.addEventListener('click', () => {
    const ok = runCalculation();
    if (ok && isMobileLayout()) {
      closeMobileSidebar();
      requestAnimationFrame(() => flashSchemeUpdated());
    }
  });
}

function setupSketchEditor() {
  const host = $('sketchEditorHost');
  if (!host) return;
  sketchEditor = new SketchEditor(host, {
    inline: true,
    dialogsEl: $('sketchEditorModal'),
    onApply: ({ vertices, edgeDimensions, diagonalDimensions, wallHeight }) => {
      if (state.inputMode === 'dims') return;
      state.room.setVertices(vertices, edgeDimensions, diagonalDimensions);
      if (wallHeight > 0) {
        state.room.wallHeight = wallHeight;
        els.form.wallHeight.value = wallHeight;
        if (els.form.quickHeight) els.form.quickHeight.value = wallHeight;
        if ($('drawHeight')) $('drawHeight').value = wallHeight;
      }
      updatePlanStats();
      refreshWallSurfaceCheckboxes();
      onExplicitChange();
    },
    onRoomChange: ({ wallHeight } = {}) => {
      if (state.inputMode === 'dims') {
        if (wallHeight > 0) {
          state.room.wallHeight = wallHeight;
          els.form.wallHeight.value = wallHeight;
          if (els.form.quickHeight) els.form.quickHeight.value = wallHeight;
        }
        return;
      }
      if (wallHeight > 0) {
        state.room.wallHeight = wallHeight;
        els.form.wallHeight.value = wallHeight;
        if (els.form.quickHeight) els.form.quickHeight.value = wallHeight;
        if ($('drawHeight')) $('drawHeight').value = wallHeight;
      }
      updatePlanStats();
      refreshWallSurfaceCheckboxes();
      syncChromeUi();
      onExplicitChange();
    },
    onGeometryEdit: () => {
      markPanelPreviewStale();
    },
    onGeometrySettle: () => {
      runCalculation({ silent: true });
    },
  });
  sketchEditor.activate({ room: state.room, startTutorial: false });
}

function markPanelPreviewStale() {
  panelPreviewToken += 1;
  document.querySelectorAll('.workspace-stats .stat-card:not(.stat-card-button)').forEach((card) => {
    card.classList.add('is-recalculating');
  });
  ['totalPanels', 'coverageArea', 'totalCost'].forEach((id) => {
    $(id)?.classList.add('is-stale');
  });
}

function markStatsRecalculating() {
  document.querySelectorAll('.workspace-stats .stat-card:not(.stat-card-button)').forEach((card) => {
    card.classList.add('is-recalculating');
  });
  ['totalPanels', 'coverageArea', 'totalCost'].forEach((id) => {
    $(id)?.classList.add('is-stale');
  });
}

function runPanelPreviewLayout() {
  /* full calc via runCalculation on settle */
}

function updatePreviewStatsFromCeiling(ceilingResult) {
  if (!ceilingResult?.stats) return;
  const panels = ceilingResult.stats.withReserve ?? ceilingResult.stats.total ?? 0;
  const area = parseFloat(ceilingResult.stats.coverageArea || ceilingResult.stats.netArea || 0) || 0;
  const cost = panels * PANEL.priceRub;
  $('totalPanels').textContent = `${panels} шт.`;
  $('coverageArea').textContent = `${area.toFixed(2)} м²`;
  $('totalCost').textContent = `${cost.toLocaleString('ru-RU')} ₽`;
  ['totalPanels', 'coverageArea', 'totalCost'].forEach((id) => $(id)?.classList.remove('is-stale'));
}

function setupTabs() {
  document.querySelectorAll('#resultsTabs .tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === 'walls' && !state.wallResult?.wallResults?.length) return;
      setSchemeView(tab);
    });
  });

  $('wallViewSelect')?.addEventListener('change', () => {
    renderSelectedWall();
    syncWallChipsActive();
  });
  $('showNumbers')?.addEventListener('change', () => {
    if ($('showNumbersMobile')) $('showNumbersMobile').checked = $('showNumbers').checked;
    syncPlanOverlayOptions();
    renderSelectedWall();
  });
  $('showFrame')?.addEventListener('change', () => {
    if ($('showFrameMobile')) $('showFrameMobile').checked = $('showFrame').checked;
    syncPlanOverlayOptions();
    renderCeiling();
    renderSelectedWall();
  });
  $('showNumbersMobile')?.addEventListener('change', () => {
    if ($('showNumbers')) $('showNumbers').checked = $('showNumbersMobile').checked;
    syncPlanOverlayOptions();
    renderSelectedWall();
  });
  $('showFrameMobile')?.addEventListener('change', () => {
    if ($('showFrame')) $('showFrame').checked = $('showFrameMobile').checked;
    syncPlanOverlayOptions();
    renderCeiling();
    renderSelectedWall();
  });
  $('sketchOpeningsBtn')?.addEventListener('click', () => {
    sketchEditor?._openOpeningsModal?.();
  });
}

function syncPlanOverlayOptions() {
  const ceilingFramed = els.form.ceilingMounting?.value === 'ceiling_framed';
  const showFrame = ($('showFrame')?.checked ?? false) && ceilingFramed;
  sketchEditor?.setOverlayOptions?.({
    showNumbers: $('showNumbers')?.checked ?? true,
    showFrame,
  });
  sketchEditor?.render?.();
}

function setSchemeView(view) {
  state.activeView = view || 'plan';
  const workspace = $('appLayout');
  workspace?.setAttribute('data-view', state.activeView);

  document.querySelectorAll('#resultsTabs .tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === state.activeView);
  });

  const resultsStage = $('resultsStage');
  if (resultsStage) {
    resultsStage.hidden = state.activeView === 'plan';
  }
  updateSchemeModeUi();

  if (state.activeView === 'walls') {
    renderSelectedWall();
    syncWallChipsActive();
  }
  if (state.activeView === 'plan') {
    // Камеру не трогаем — иначе после drag/расчёта схема резко центрируется
    requestAnimationFrame(() => sketchEditor?.render?.());
  }
}

function buildAreaWallStats(walls) {
  const netArea = walls.reduce((s, w) => s + w.area, 0);
  const total = Math.ceil(netArea / PANEL_COVERAGE_AREA);
  const withReserve = Math.ceil(total * (1 + RESERVES.panels));
  const dowelsBase = total * RESERVES.dowelsPerPanel;
  const dowelsWithReserve = Math.ceil(dowelsBase * (1 + RESERVES.dowels));
  return {
    total,
    fullPanels: total,
    cutPanels: 0,
    panelsToPurchase: total,
    coverageArea: netArea.toFixed(2),
    coveragePercent: '100.0',
    netArea: netArea.toFixed(2),
    withReserve,
    dowels: { base: dowelsBase, withReserve: dowelsWithReserve },
  };
}

function validateBeforeCalc() {
  if (!state.inputMode) {
    return [getNoModeHint()];
  }
  syncFormToRoom();
  const f = els.form;
  const calcCeiling = f.calcCeiling.checked;
  const selectedWallIds = readSelectedWallIds();

  if (!calcCeiling && selectedWallIds.length === 0) {
    return ['Выберите хотя бы одну поверхность для расчёта'];
  }

  const useArea = state.inputMode === 'area' || (state.inputMode === 'dims' && state.forceAreaBySize);
  if (useArea) {
    if (calcCeiling) {
      const area = state.inputMode === 'area'
        ? parseFloat(f.areaOnlyInput?.value)
        : (parseFloat(f.quickLength?.value) || 0) * (parseFloat(f.quickWidth?.value) || 0);
      if (!area || area <= 0) return ['Укажите площадь потолка в м²'];
    }
    if (selectedWallIds.length > 0 && state.inputMode === 'area') {
      const invalid = state.areaWalls.some((w) => w.enabled && selectedWallIds.includes(w.id) && (!w.area || w.area <= 0));
      if (invalid) return ['Укажите площадь для каждой выбранной стены'];
    }
    return [];
  }

  if (state.inputMode === 'draw' && (!state.room.vertices || state.room.vertices.length < 3)) {
    return ['Нарисуйте и замкните контур схемы'];
  }

  return validateRoomForm(null, state.room);
}

function applyResultsToUi() {
  const bom = state.bom;
  const text = bom ? formatResultsText(bom, state.calcRoom ?? state.room) : '';
  $('resultsText').textContent = text || 'Выполните расчёт, чтобы увидеть результаты.';
  updateStatCards();
  updateResultsPreview();
  showCalcReadyBanner();
}

function showCalcReadyBanner() {
  const statusEl = $('schemeStatus');
  if (!state.hasResults || !state.bom?.total) {
    $('calcReadyBanner')?.setAttribute('hidden', '');
    return;
  }
  const panels = state.bom.total.panelsWithReserve ?? 0;
  let msg = 'Расчёт готов';
  if (lastPanelsSnapshot != null && lastPanelsSnapshot !== panels) {
    msg = `Обновлено: ${lastPanelsSnapshot} → ${panels} пан.`;
  }
  lastPanelsSnapshot = panels;

  if (statusEl) {
    statusEl.hidden = false;
    statusEl.textContent = msg;
    statusEl.classList.add('is-computing');
    clearTimeout(showCalcReadyBanner._t);
    showCalcReadyBanner._t = setTimeout(() => {
      statusEl.classList.remove('is-computing');
      statusEl.hidden = true;
      statusEl.textContent = '';
    }, 2600);
  }

  // Компактный CTA проёмов только в сайдбаре — без второго баннера «готов»
  $('calcReadyBanner')?.setAttribute('hidden', '');
  updateSurfaceGroupsUi();
  syncChromeUi();
}

function runQuickAreaCalc(area) {
  const panels = Math.ceil(area / PANEL_COVERAGE_AREA);
  const withReserve = Math.ceil(panels * (1 + RESERVES.panels));
  const dowels = Math.ceil(panels * RESERVES.dowelsPerPanel * (1 + RESERVES.dowels));
  const cost = withReserve * PANEL.priceRub;
  state.bom = {
    total: {
      panelsWithReserve: withReserve,
      totalCost: cost,
    },
    ceiling: { area },
    walls: null,
  };
  $('resultsText').textContent = [
    'Приблизительный расчёт по площади (только потолок)',
    `Площадь: ${area.toFixed(2)} м²`,
    `Панелей к закупке: ${withReserve}`,
    `Дюбели: ${dowels}`,
    `Стоимость панелей: ${cost.toLocaleString('ru-RU')} ₽`,
  ].join('\n');
  $('resultsTabs').style.display = 'flex';
  document.querySelector('#resultsTabs .tab-btn[data-tab="ceiling"]')?.setAttribute('hidden', '');
  document.querySelector('#resultsTabs .tab-btn[data-tab="walls"]')?.setAttribute('hidden', '');
  setSchemeView('plan');

  state.hasResults = true;
  state.resultsStale = false;
  showCalcReadyBanner();
  updateLayoutMode();
  updateStatCards();
  updateResultsPreview();
}

function runCalculation(options = {}) {
  const { silent = false } = options;
  const errors = validateBeforeCalc();
  if (errors.length) {
    if (!silent) showValidationErrors(errors);
    else clearResultsUi(errors[0] || '');
    return false;
  }
  if (!silent) showValidationErrors([]);

  const f = els.form;
  state.options = {
    calcCeiling: f.calcCeiling.checked,
    selectedWallIds: readSelectedWallIds(),
    calcWalls: readSelectedWallIds().length > 0,
    ceilingMounting: f.ceilingMounting.value,
    wallMounting: f.wallMounting.value,
  };

  let calcRoom = state.room;
  const useAreaPath = state.inputMode === 'area' || (state.inputMode === 'dims' && state.forceAreaBySize);

  if (useAreaPath) {
    const ceilingArea = state.inputMode === 'area'
      ? (parseFloat(f.areaOnlyInput.value) || 0)
      : (parseFloat(f.quickLength?.value) || 0) * (parseFloat(f.quickWidth?.value) || 0);
    state.areaValue = ceilingArea;

    if (state.options.calcCeiling && state.options.selectedWallIds.length === 0) {
      runQuickAreaCalc(ceilingArea);
      return true;
    }

    if (state.options.calcCeiling && ceilingArea > 0) {
      const side = Math.sqrt(ceilingArea);
      const verts = createRectangleVertices(side, side);
      calcRoom = Room.createDefault();
      calcRoom.setVertices(verts, buildEdgeDimensionsFromVertices(verts), {});
    } else {
      calcRoom = Room.createDefault();
      calcRoom.setVertices(createRectangleVertices(1, 1), buildEdgeDimensionsFromVertices(createRectangleVertices(1, 1)), {});
    }
  }

  state.calcRoom = calcRoom;

  state.ceilingResult = null;
  state.wallResult = null;
  state.ceilingCalc = null;

  if (state.options.calcCeiling && !useAreaPath) {
    const calc = new PolygonPanelCalculator(calcRoom.vertices);
    state.ceilingCalc = calc;
    state.ceilingResult = calc.calculateBestScheme();
  } else if (state.options.calcCeiling && useAreaPath) {
    const area = state.areaValue || parseFloat(f.areaOnlyInput?.value) || 0;
    const panels = Math.ceil(area / PANEL_COVERAGE_AREA);
    const withReserve = Math.ceil(panels * (1 + RESERVES.panels));
    state.ceilingResult = {
      name: 'По площади',
      panels: [],
      stats: {
        total: panels,
        withReserve,
        panelsToPurchase: panels,
        fullPanels: panels,
        cutPanels: 0,
        coverageArea: area.toFixed(2),
        netArea: area.toFixed(2),
        dowels: {
          base: panels * RESERVES.dowelsPerPanel,
          withReserve: Math.ceil(panels * RESERVES.dowelsPerPanel * (1 + RESERVES.dowels)),
        },
      },
    };
    state.ceilingCalc = new PolygonPanelCalculator(calcRoom.vertices);
  }

  if (state.options.selectedWallIds.length > 0 && state.inputMode === 'area') {
    const walls = state.areaWalls.filter((w) => w.enabled && w.area > 0);
    state.wallResult = {
      wallResults: walls.map((w, i) => ({
        wall: { id: w.id, label: `Стена ${i + 1}`, length: Math.sqrt(w.area) },
        netArea: w.area,
        panels: [],
        openings: [],
      })),
      stats: buildAreaWallStats(walls),
    };
  } else if (state.options.selectedWallIds.length > 0 && !useAreaPath) {
    const wc = new WallCalculator(calcRoom);
    const allResults = wc.calculateAllWalls();
    const selected = new Set(state.options.selectedWallIds);
    const wallResults = allResults.filter((wr) => selected.has(wr.wall.id));
    state.wallResult = {
      wallResults,
      stats: wc.getCombinedStatistics(wallResults),
    };
  } else if (state.options.selectedWallIds.length > 0 && state.inputMode === 'dims' && state.forceAreaBySize) {
    const L = parseFloat(f.quickLength?.value) || 0;
    const W = parseFloat(f.quickWidth?.value) || 0;
    const H = parseFloat(f.quickHeight?.value) || 2.7;
    let walls = state.room.walls
      .filter((w) => state.options.selectedWallIds.includes(w.id))
      .map((w) => ({ id: w.id, area: w.length * H, enabled: true }));
    if (!walls.length) {
      walls = [
        { id: 'aw-a', area: L * H, enabled: true },
        { id: 'aw-b', area: W * H, enabled: true },
        { id: 'aw-c', area: L * H, enabled: true },
        { id: 'aw-d', area: W * H, enabled: true },
      ];
    }
    state.wallResult = {
      wallResults: walls.map((w, i) => ({
        wall: { id: w.id, label: `Стена ${i + 1}`, length: Math.sqrt(Math.max(w.area, 0.01)) },
        netArea: w.area,
        panels: [],
        openings: [],
      })),
      stats: buildAreaWallStats(walls),
    };
  }

  state.bom = buildBOM({
    room: calcRoom,
    ceilingResult: state.ceilingResult,
    wallResult: state.wallResult,
    options: state.options,
  });

  state.hasResults = true;
  state.resultsStale = false;
  applyResultsToUi();
  $('resultsTabs').style.display = 'flex';

  populateWallSelect();
  if (state.ceilingResult && state.ceilingCalc && !useAreaPath) {
    sketchEditor?.setPanelLayout?.({
      panels: state.ceilingResult.panels,
      offsetX: state.ceilingCalc.offsetX,
      offsetY: state.ceilingCalc.offsetY,
      stats: state.ceilingResult.stats,
    });
  }
  syncPlanOverlayOptions();
  renderCeiling();
  renderSelectedWall();
  updateResultsTabsVisibility();
  if (state.activeView !== 'walls') setSchemeView('plan');

  updateLayoutMode();
  updateSchemeModeUi();
  return true;
}

function populateWallSelect() {
  const sel = $('wallViewSelect');
  const chips = $('wallChips');
  if (!state.wallResult) return;
  const walls = state.wallResult.wallResults;
  if (sel) {
    sel.innerHTML = walls.map((w) => `<option value="${w.wall.id}">${w.wall.label}</option>`).join('');
  }
  if (chips) {
    chips.innerHTML = '';
    walls.forEach((w, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wall-chip' + (i === 0 ? ' is-active' : '');
      btn.dataset.wallId = w.wall.id;
      btn.textContent = w.wall.label.replace(/^Стена\s+/i, '');
      btn.addEventListener('click', () => {
        if (sel) sel.value = w.wall.id;
        syncWallChipsActive();
        renderSelectedWall();
      });
      chips.appendChild(btn);
    });
  }
}

function syncWallChipsActive() {
  const id = $('wallViewSelect')?.value;
  document.querySelectorAll('#wallChips .wall-chip').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.wallId === id);
  });
}

function updateResultsTabsVisibility() {
  const hasWalls = !!state.wallResult?.wallResults?.length && state.hasResults;

  document.querySelectorAll('#resultsTabs .tab-btn').forEach((btn) => {
    const tab = btn.dataset.tab;
    if (tab === 'plan') {
      btn.hidden = false;
      return;
    }
    if (tab === 'walls') {
      btn.hidden = !hasWalls;
    }
  });

  if (state.activeView === 'walls' && !hasWalls) setSchemeView('plan');
  if (state.activeView === 'ceiling') setSchemeView('plan');
}

function renderCeiling() {
  if (!state.ceilingResult || !ceilingViz || !state.ceilingCalc) return;
  const room = state.calcRoom ?? state.room;
  ceilingViz.setRoom({
    vertices: room.vertices,
    offsetX: state.ceilingCalc.offsetX,
    offsetY: state.ceilingCalc.offsetY,
  });
  ceilingViz.setPanels(state.ceilingResult.panels);
  const showFrame = $('showFrame')?.checked && state.options.ceilingMounting === 'ceiling_framed';
  const localBounds = getCeilingFrameBounds(room);
  ceilingViz.setFrameOverlay(showFrame, showFrame ? localBounds : null);
  ceilingViz.render({ showNumbers: $('showNumbers')?.checked ?? true });
}

function renderSelectedWall() {
  if (!state.wallResult || !wallViz) return;
  const wallId = $('wallViewSelect')?.value || state.wallResult.wallResults[0]?.wall.id;
  const wr = state.wallResult.wallResults.find((w) => w.wall.id === wallId);
  if (!wr) return;
  const room = state.calcRoom ?? state.room;
  wallViz.setWallResult(wr, room.wallHeight);
  wallViz.setFrameOverlay(
    ($('showFrame')?.checked ?? false) && state.options.wallMounting === 'wall_framed'
  );
  wallViz.render({ showNumbers: $('showNumbers')?.checked ?? true });
}

function readOptionsFromForm() {
  const f = els.form;
  const selectedWallIds = readSelectedWallIds();
  return {
    calcCeiling: f.calcCeiling.checked,
    selectedWallIds,
    calcWalls: selectedWallIds.length > 0,
    ceilingMounting: f.ceilingMounting.value,
    wallMounting: f.wallMounting.value,
  };
}

function applyOptionsToForm(options) {
  if (!options) return;
  const f = els.form;
  f.calcCeiling.checked = options.calcCeiling !== false;

  if (options.selectedWallIds?.length) {
    state.options.selectedWallIds = [...options.selectedWallIds];
  } else if (options.calcWalls === false) {
    state.options.selectedWallIds = [];
  } else {
    state.options.selectedWallIds = state.room.walls.map((w) => w.id);
  }

  if (options.ceilingMounting) f.ceilingMounting.value = options.ceilingMounting;
  if (options.wallMounting) f.wallMounting.value = options.wallMounting;
  syncSegmentedFromSelect('ceilingMounting');
  syncSegmentedFromSelect('wallMounting');
  refreshWallSurfaceCheckboxes();
  state.options = { ...state.options, ...readOptionsFromForm() };
}

function buildProjectState() {
  syncFormToRoom();
  return buildProjectPayload({
    room: state.room.toJSON(),
    options: readOptionsFromForm(),
    inputMode: state.inputMode,
    areaValue: parseFloat(els.form.areaOnlyInput?.value) || null,
    areaWalls: state.areaWalls,
  });
}

function showProjectLoadedBanner() {
  const banner = $('projectLoadedBanner');
  if (!banner) return;
  banner.hidden = false;
  banner.textContent = 'Проект из ссылки загружен';
  clearTimeout(showProjectLoadedBanner._t);
  showProjectLoadedBanner._t = setTimeout(() => {
    banner.hidden = true;
  }, 3500);
}

async function handleShare() {
  const url = buildShareUrl(buildProjectState());
  try {
    await navigator.clipboard.writeText(url);
    alert('Ссылка на проект скопирована.\n\nОткройте её на этом или другом устройстве — все параметры помещения, проёмы и настройки монтажа сохранятся.');
  } catch {
    prompt('Скопируйте ссылку на проект:', url);
  }
}

async function handlePDF() {
  if (!state.bom) {
    alert('Сначала выполните расчёт');
    return;
  }
  const { exportCalculationPDF } = await import('../export/pdf-export.js');
  syncFormToRoom();
  renderPlanEditors();
  const planImage = sketchEditor?.canvas?.toDataURL?.('image/png') ?? null;
  renderCeiling();
  const ceilingImage = state.ceilingResult ? ceilingViz.exportToImage() : null;
  const wallSurfaces = [];
  if (state.wallResult) {
    for (const wr of state.wallResult.wallResults) {
      wallViz.setWallResult(wr, state.room.wallHeight);
      wallViz.render({ showNumbers: $('showNumbers')?.checked ?? true });
      wallSurfaces.push({
        wallResult: wr,
        image: wallViz.canvas.toDataURL('image/png'),
      });
    }
  }
  await exportCalculationPDF({
    bom: state.bom,
    room: state.room,
    ceilingImage,
    wallSurfaces,
    planImage,
  });
}

function setupMobileActions() {
  $('mobileParamsBtn')?.addEventListener('click', () => {
    document.body.classList.add('mobile-sidebar-open');
  });
  $('mobileSidebarClose')?.addEventListener('click', () => {
    closeMobileSidebar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMobileSidebar();
  });
  window.matchMedia(MOBILE_MQ).addEventListener('change', () => {
    updateSchemeModeUi();
    syncMobileParamsBtn();
  });
}

function loadFromUrl() {
  const data = readShareFromUrl();
  if (!data?.room) return;
  const room = Room.fromJSON(data.room);
  applyRoomToForm(room);
  applyOptionsToForm(data.options);
  if (data.inputMode) {
    setInputMode(data.inputMode, { preserveGeometry: true });
  }
  if (data.areaValue && els.form.areaOnlyInput) {
    els.form.areaOnlyInput.value = data.areaValue;
    state.areaValue = data.areaValue;
  }
  if (data.areaWalls?.length) {
    state.areaWalls = data.areaWalls;
    renderAreaWallsList();
  }
  showProjectLoadedBanner();
}

function initTheme() {
  try {
    const savedTheme = localStorage.getItem('mf_theme');
    const isDark = savedTheme === 'dark';
    document.body.classList.toggle('theme-dark', isDark);
    const switchEl = $('themeSwitch');
    if (switchEl) {
      switchEl.checked = isDark;
      switchEl.addEventListener('change', () => {
        const dark = switchEl.checked;
        document.body.classList.toggle('theme-dark', dark);
        localStorage.setItem('mf_theme', dark ? 'dark' : 'light');
        renderPlanEditors();
        if (state.hasResults) {
          renderCeiling();
          renderSelectedWall();
        }
        sketchEditor?.render?.();
      });
    }
  } catch {
    document.body.classList.remove('theme-dark');
  }
}

function init() {
  cacheElements();
  setupSketchEditor();

  ceilingViz = new CeilingVisualizer($('ceilingCanvas'));
  wallViz = new WallVisualizer($('wallCanvas'));

  setupModeToggles();
  setupSegmentedMounting();
  setupResultsExpand();
  setupFormListeners();
  setupTabs();
  setupMobileActions();
  initTheme();

  $('shareBtn')?.addEventListener('click', handleShare);
  $('downloadBtn')?.addEventListener('click', handlePDF);

  state.inputMode = null;
  syncModePanelsUi();
  applyRoomToForm(state.room);
  refreshWallSurfaceCheckboxes();
  setSchemeView('plan');
  updateSchemeModeUi();
  updateLayoutMode();
  updateResultsPreview();
  loadFromUrl();
  if (!state.inputMode) updateSchemeModeUi();
}

document.addEventListener('DOMContentLoaded', init);

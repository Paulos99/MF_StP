import {
  DRAW_GRID_STEP,
  cloneVertices,
  createCutCornerVertices,
  createLShapeVertices,
  createMirrorLShapeVertices,
  createPlusShapeVertices,
  createTShapeVertices,
  createUShapeVertices,
  createZShapeVertices,
  getBounds,
  getEdges,
  labelForIndex,
  shoelaceArea,
  getPerimeter,
  snapPointDraw,
  snapPointEdit,
  solvePolygonFromConstraints,
  triangulateFan,
} from '../core/polygon-geometry.js';
import { OPENING_TYPES } from '../core/constants.js';
import { roundMeters } from '../core/geometry.js';
import { SketchKeypad, buildEdgeDimensionsFromVertices, formatEdgeLabel, formatDiagonalLabel } from './sketch-constraints.js';
import { SketchOnboarding } from './sketch-onboarding.js';
import { WallElevationEditor } from './wall-elevation-editor.js';
import { PlanEditor } from './plan-editor.js';
import { createDefaultOpening } from './opening-tool.js';
import { drawFrameGrid, getCeilingFrameBounds } from '../visualizers/frame-overlay.js';

const ACCENT = '#01644f';
const GRID_COLOR = 'rgba(0, 0, 0, 0.14)';
const GRID_MAJOR_COLOR = 'rgba(0, 0, 0, 0.22)';
const PX_PER_M = 40;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const LONG_PRESS_MS = 800;
const MIN_VERTEX_DIST = 0.5;
const PREVIEW_LERP = 0.22;
const PANEL_SETTLE_MS = 2500;
const PANEL_REVEAL_MS = 400;

export class SketchEditor {
  constructor(hostEl, {
    onApply,
    onClose,
    onRoomChange,
    onGeometryEdit,
    onGeometrySettle,
    dialogsEl = null,
    inline = true,
  } = {}) {
    this.host = hostEl;
    this.dialogs = dialogsEl || document.getElementById('sketchEditorModal');
    this.modal = hostEl;
    this.inline = inline;
    this.canvas = this._q('#sketchCanvas');
    this.canvasWrap = this._q('.sketch-canvas-wrap');
    this.ctx = this.canvas.getContext('2d');
    this.toastEl = this._q('#sketchToast');
    this.hintTextEl = this._q('#sketchHintText');
    this.bottomStatsEl = this._q('#sketchBottomStats');
    this.zoomLabelEl = this._q('#sketchZoomLabel');
    this.wallChipsEl = this._q('#sketchWallChips');
    this.doneBtn = this._q('#sketchDoneBtn');
    this.emptyHintEl = this._q('#sketchEmptyHint');
    this.openingsModal = this._q('#sketchOpeningsModal');
    this.openingsBtn = this._q('#sketchOpeningsBtn');
    this.wallHeightModal = this._q('#sketchWallHeightModal');
    this.wallHeightPopup = this._q('#sketchWallHeightPopup');
    this.gridLegendEl = this._q('#sketchGridLegend');
    this.edgeActionsEl = this._q('#sketchEdgeActions');
    this.edgeEditSizeBtn = this._q('#sketchEdgeEditSize');
    this.edgeOpeningsBtn = this._q('#sketchEdgeOpenings');
    this.wallHeightValue = 2.7;
    this._wallHeightConfirmed = false;
    this._previewSmooth = null;
    this._previewAnimRaf = null;
    this.onApply = onApply;
    this.onClose = onClose;
    this.onRoomChange = onRoomChange;
    this.onGeometryEdit = onGeometryEdit;
    this.onGeometrySettle = onGeometrySettle;
    this._active = inline;
    this._panelMode = 'idle';
    this._panelLayout = null;
    this._panelReveal = 1;
    this._panelSettleTimer = null;
    this._blurAnimRaf = null;
    this._blurPhase = 0;
    this._showPanelNumbers = true;
    this._showFrameOverlay = false;
    this.geometryLocked = false;

    this.room = null;
    this.openingsModalOpen = false;
    this.selectedWallId = null;
    this.selectedOpeningId = null;

    this.vertices = [];
    this.edgeDimensions = {};
    this.diagonalDimensions = {};
    this.closed = false;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.history = [];
    this.future = [];

    this._dragIdx = null;
    this._longPressIdx = null;
    this._longPressProgress = 0;
    this._longPressRaf = null;
    this._selectedEdge = null;
    this._selectedDiagonal = null;
    this._edgeActionRects = null;
    this._pendingDeleteIdx = null;
    this._previewPoint = null;
    this._drawHistorySaved = false;
    this._renderRaf = null;
    this._fitScheduled = false;
    this._needsInitialFit = true;
    this._hoverTarget = null;
    this._panning = false;
    this._spaceDown = false;
    this._panStart = null;
    this._pinch = null;
    this._touchPanCandidate = null;
    this._touchMode = null; // 'pan' | 'pinch' | null
    this._resizeObserver = null;

    this.bgImage = null;
    this._bgObjectUrl = null;
    this.bgTransform = { cx: 4, cy: 3, widthM: 10, opacity: 0.45 };
    this._bgBaseWidthM = 10;
    this.bgAdjustMode = false;
    this._bgDragging = false;
    this._bgDragStart = null;
    this.bgUploadInput = this._q('#sketchBgUploadInput');
    this.bgAdjustBtn = this._q('#sketchBgAdjustBtn');
    this.bgPanel = this._q('#sketchBgPanel');
    this.bgOpacityInput = this._q('#sketchBgOpacity');
    this.bgScaleInput = this._q('#sketchBgScale');

    this.keypad = new SketchKeypad(this._q('#sketchKeypadHost'), {
      onConfirm: (val) => this._onKeypadConfirm(val),
    });

    this.wallElevation = new WallElevationEditor(this._q('#sketchWallCanvas'), {
      onOpeningSelect: (id) => this._selectOpening(id),
      onOpeningChange: (id) => {
        this._syncOpeningProps(id);
        this.onRoomChange?.(this._roomChangePayload());
        this.render();
      },
    });

    this.openingsPlanEditor = new PlanEditor(this._q('#sketchOpeningsPlanCanvas'), {
      onWallSelect: (wallId) => this._selectWall(wallId),
      onOpeningSelect: (id) => this._selectOpening(id),
      onOpeningChange: (openingId) => {
        this._syncOpeningProps(openingId);
        this.onRoomChange?.(this._roomChangePayload());
        this._refreshOpeningsPanel();
        this.render();
      },
      interactiveOpenings: true,
    });

    this.onboarding = new SketchOnboarding(this._q('#sketchTutorial'), {
      onStepChange: () => this.render(),
      onSkip: () => this.render(),
    });

    this._bindUi();
    this._setupResizeObserver();
  }

  _q(sel) {
    return this.host?.querySelector(sel) || this.dialogs?.querySelector(sel) || document.querySelector(sel);
  }

  _qa(sel) {
    const inHost = this.host ? [...this.host.querySelectorAll(sel)] : [];
    const inDialogs = this.dialogs ? [...this.dialogs.querySelectorAll(sel)] : [];
    if (inHost.length || inDialogs.length) return [...inHost, ...inDialogs];
    return [...document.querySelectorAll(sel)];
  }

  _isInteractive() {
    return this.inline ? this._active : !this.host?.hidden;
  }

  _setupResizeObserver() {
    if (!this.canvasWrap || typeof ResizeObserver === 'undefined') return;
    this._resizeObserver = new ResizeObserver(() => {
      if (!this._isInteractive()) return;
      this.render();
      if (this._needsInitialFit) {
        this.fitToScreen();
        this._needsInitialFit = false;
      }
    });
    this._resizeObserver.observe(this.canvasWrap);
  }

  _getCanvasSize() {
    const wrap = this.canvasWrap;
    if (!wrap) return { w: 300, h: 300 };
    const rect = wrap.getBoundingClientRect();
    const w = Math.max(200, Math.round(rect.width) || wrap.clientWidth || 300);
    const h = Math.max(200, Math.round(rect.height) || wrap.clientHeight || 300);
    return { w, h };
  }

  _bindUi() {
    this._q('#sketchCloseBtn')?.addEventListener('click', () => this.close(false));
    this._q('#sketchDoneBtn')?.addEventListener('click', () => this.close(true));
    this._q('#sketchUndoBtn')?.addEventListener('click', () => this.undo());
    this._q('#sketchRedoBtn')?.addEventListener('click', () => this.redo());
    this._q('#sketchClearBtn')?.addEventListener('click', () => this.clear());
    this._q('#sketchZoomInBtn')?.addEventListener('click', () => this._zoomAtCenter(1.15));
    this._q('#sketchZoomOutBtn')?.addEventListener('click', () => this._zoomAtCenter(1 / 1.15));
    this._q('#sketchFitBtn')?.addEventListener('click', () => this.toggleFullscreen());
    this._q('#sketchHelpBtn')?.addEventListener('click', () => {
      if (this.openingsModalOpen) this.onboarding.startOpenings(true);
      else this.onboarding.start(true);
    });

    this.openingsBtn?.addEventListener('click', () => this._openOpeningsModal());
    this._q('#sketchOpeningsCloseBtn')?.addEventListener('click', () => this._closeOpeningsModal());
    this._q('#sketchOpeningsDoneBtn')?.addEventListener('click', () => this._closeOpeningsModal());
    this._q('#sketchOpeningsBackdrop')?.addEventListener('click', () => this._closeOpeningsModal());

    this._q('#sketchWallHeightConfirm')?.addEventListener('click', () => this._confirmWallHeight());
    this.wallHeightModal?.querySelector('.sketch-wall-height-modal__backdrop')?.addEventListener('click', () => this._confirmWallHeight());

    const tplBtn = this._q('#sketchTemplatesBtn');
    const tplMenu = this._q('.sketch-dropdown-menu');
    tplBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (tplMenu) tplMenu.hidden = !tplMenu.hidden;
    });
    document.addEventListener('click', () => { if (tplMenu) tplMenu.hidden = true; });
    this._qa('[data-template]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._applyTemplate(btn.dataset.template);
        if (tplMenu) tplMenu.hidden = true;
      });
    });

    this._q('#sketchBgUploadBtn')?.addEventListener('click', () => {
      this.bgUploadInput?.click();
    });
    this.edgeEditSizeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showKeypadForSelectedEdge();
    });
    this.edgeOpeningsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._openOpeningsForSelectedEdge();
    });
    this.bgUploadInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this._loadBackgroundImage(file);
      e.target.value = '';
    });
    this.bgAdjustBtn?.addEventListener('click', () => this._toggleBgAdjustMode());
    this.bgOpacityInput?.addEventListener('input', () => {
      if (!this.bgImage) return;
      this.bgTransform.opacity = (parseInt(this.bgOpacityInput.value, 10) || 45) / 100;
      this.render();
    });
    this.bgScaleInput?.addEventListener('input', () => {
      if (!this.bgImage) return;
      const pct = parseInt(this.bgScaleInput.value, 10) || 100;
      this.bgTransform.widthM = this._bgBaseWidthM * (pct / 100);
      this.render();
    });
    this._q('#sketchBgRemoveBtn')?.addEventListener('click', () => this._removeBackgroundImage());

    this._q('#sketchDeleteCancel')?.addEventListener('click', () => this._cancelDelete());
    this._q('#sketchDeleteConfirm')?.addEventListener('click', () => this._confirmDelete());
    this._q('#sketchAddDoorBtn')?.addEventListener('click', () => this._addOpening(OPENING_TYPES.DOOR));
    this._q('#sketchAddWindowBtn')?.addEventListener('click', () => this._addOpening(OPENING_TYPES.WINDOW));
    this._q('#sketchOpeningDeleteBtn')?.addEventListener('click', () => this._deleteSelectedOpening());

    ['sketchOpeningOffset', 'sketchOpeningWidth', 'sketchOpeningHeight', 'sketchOpeningSill'].forEach((id) => {
      const el = this._q(`#${id}`);
      el?.addEventListener('change', () => this._applyOpeningPropsFromForm());
      el?.addEventListener('input', () => this._applyOpeningPropsFromForm());
    });

    this.canvas.addEventListener('mousedown', (e) => this._onPointerDown(e));
    this.canvas.addEventListener('mousemove', (e) => this._onPointerMove(e));
    window.addEventListener('mouseup', (e) => this._onPointerUp(e));
    this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    this.canvas.addEventListener('touchend', (e) => this._onTouchEnd(e));
    this.canvas.addEventListener('touchcancel', (e) => this._onTouchEnd(e));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (!this._isInteractive()) return;
      if (e.key === 'Escape' && this.host?.classList.contains('is-fullscreen')) {
        this.toggleFullscreen();
        e.preventDefault();
        return;
      }
      if (e.code === 'Space' && !this._spaceDown) {
        this._spaceDown = true;
        this.canvas.style.cursor = 'grab';
        e.preventDefault();
      }
      this._onKeyDown(e);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this._spaceDown = false;
        if (!this._panning) this.canvas.style.cursor = '';
      }
    });
  }

  open({ room } = {}) {
    this.activate({ room, startTutorial: !this.inline });
  }

  activate({ room, startTutorial = false } = {}) {
    this.room = room ?? null;
    this._active = true;
    const hasShape = (room?.vertices?.length ?? 0) >= 3;
    if (hasShape) {
      this.vertices = cloneVertices(room.vertices);
      this.edgeDimensions = Object.keys(room.edgeDimensions ?? {}).length
        ? { ...room.edgeDimensions }
        : buildEdgeDimensionsFromVertices(room.vertices);
      this.diagonalDimensions = { ...(room.diagonalDimensions ?? {}) };
      this.closed = true;
      this.wallHeightValue = room.wallHeight ?? 2.7;
      this._wallHeightConfirmed = (room.wallHeight ?? 0) > 0;
      this._syncRoomFromShape({ quiet: true });
    } else {
      this.vertices = [];
      this.edgeDimensions = {};
      this.diagonalDimensions = {};
      this.closed = false;
      this.wallHeightValue = this.room?.wallHeight ?? 2.7;
      this._wallHeightConfirmed = false;
    }
    this.openingsModalOpen = false;
    this.selectedWallId = null;
    this.selectedOpeningId = null;
    this._selectedEdge = null;
    this._selectedDiagonal = null;
    this._edgeActionRects = null;
    this.history = [];
    this.future = [];
    this._previewPoint = null;
    this._previewSmooth = null;
    this._drawHistorySaved = false;
    if (!this.inline && this.host) {
      this.host.hidden = false;
      document.body.classList.add('sketch-modal-open');
    }
    if (this.wallHeightPopup) this.wallHeightPopup.value = String(this.wallHeightValue);
    if (this.openingsModal) {
      this.openingsModal.hidden = true;
      this.openingsModal.classList.remove('is-open');
    }
    if (this.wallHeightModal) this.wallHeightModal.hidden = true;
    this._needsInitialFit = true;
    this._clearPanelOverlay();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.render();
        this.fitToScreen();
        this._needsInitialFit = false;
        this._updateUi();
        // Inline: settle only when scheme is visible / syncFromRoom({ settle: true })
        if (this.closed && !this.inline && !this.host?.hidden) this._beginPanelSettle();
      });
    });
    if (startTutorial) this.onboarding.start(true);
  }

  _roomChangePayload() {
    return { wallHeight: this.wallHeightValue };
  }

  _showWallHeightModal() {
    if (!this.wallHeightModal) return;
    if (this.wallHeightPopup) this.wallHeightPopup.value = String(this.wallHeightValue);
    this.wallHeightModal.hidden = false;
    requestAnimationFrame(() => this.wallHeightModal.classList.add('is-open'));
  }

  _confirmWallHeight() {
    const wh = parseFloat(this.wallHeightPopup?.value);
    if (wh > 0) {
      this.wallHeightValue = wh;
      this._wallHeightConfirmed = true;
      if (this.room) this.room.wallHeight = wh;
      this.onRoomChange?.(this._roomChangePayload());
    }
    if (this.wallHeightModal) {
      this.wallHeightModal.classList.remove('is-open');
      setTimeout(() => { this.wallHeightModal.hidden = true; }, 250);
    }
    this.render();
  }

  _openOpeningsModal() {
    if (!this.closed) {
      this.showToast('Сначала замкните контур');
      return;
    }
    if (!this._wallHeightConfirmed) {
      this._showWallHeightModal();
      return;
    }
    this.room?.rebuildWalls();
    if (!this.selectedWallId) this.selectedWallId = this.room?.walls?.[0]?.id ?? null;
    this.openingsModalOpen = true;
    if (this.openingsModal) {
      this.openingsModal.hidden = false;
      requestAnimationFrame(() => this.openingsModal.classList.add('is-open'));
    }
    this.keypad.hide();
    this._hideEdgeActions();
    this._refreshOpeningsPanel();
    this.render();
  }

  _closeOpeningsModal() {
    this.openingsModalOpen = false;
    if (this.openingsModal) {
      this.openingsModal.classList.remove('is-open');
      setTimeout(() => { if (!this.openingsModalOpen) this.openingsModal.hidden = true; }, 280);
    }
    this.render();
  }

  _selectWall(wallId) {
    this.selectedWallId = wallId;
    this.selectedOpeningId = null;
    this._q('#sketchOpeningProps').hidden = true;
    this._renderWallChips();
    this._refreshOpeningsPanel();
    this.render();
  }

  _renderWallChips() {
    if (!this.wallChipsEl || !this.room || !this.openingsModalOpen) return;
    this.wallChipsEl.innerHTML = '';
    for (const wall of this.room.walls) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sketch-wall-chip' + (wall.id === this.selectedWallId ? ' active' : '');
      btn.textContent = `${wall.label.replace('Стена ', '')} · ${wall.length.toFixed(1)} м`;
      btn.addEventListener('click', () => this._selectWall(wall.id));
      this.wallChipsEl.appendChild(btn);
    }
  }

  close(save) {
    if (this.inline) {
      if (save && this._canSave()) this._emitApply();
      return;
    }
    if (save && this._canSave()) this._emitApply();
    this._closeOpeningsModal();
    this._cancelLongPress();
    this._removeBackgroundImage(false);
    if (this.host) this.host.hidden = true;
    document.body.classList.remove('sketch-modal-open');
    this.keypad.hide();
    this.onboarding.dismiss();
    this._active = false;
    this.onClose?.();
  }

  _emitApply() {
    if (this.room) this.room.wallHeight = this.wallHeightValue;
    this.onApply?.({
      vertices: cloneVertices(this.vertices),
      edgeDimensions: { ...this.edgeDimensions },
      diagonalDimensions: { ...this.diagonalDimensions },
      wallHeight: this.wallHeightValue,
    });
  }

  _canSave() {
    return this.closed && this.vertices.length >= 3 && this._allEdgesSet() && this._wallHeightConfirmed;
  }

  _allEdgesSet() {
    for (let i = 0; i < this.vertices.length; i++) {
      if (!this.edgeDimensions[i] || this.edgeDimensions[i] <= 0) return false;
    }
    return true;
  }

  _pushHistory() {
    this.history.push({
      vertices: cloneVertices(this.vertices),
      edgeDimensions: { ...this.edgeDimensions },
      diagonalDimensions: { ...this.diagonalDimensions },
      closed: this.closed,
    });
    if (this.history.length > 50) this.history.shift();
    this.future = [];
  }

  undo() {
    if (!this.history.length) return;
    this.future.push({
      vertices: cloneVertices(this.vertices),
      edgeDimensions: { ...this.edgeDimensions },
      diagonalDimensions: { ...this.diagonalDimensions },
      closed: this.closed,
    });
    const prev = this.history.pop();
    this.vertices = prev.vertices;
    this.edgeDimensions = prev.edgeDimensions;
    this.diagonalDimensions = prev.diagonalDimensions;
    this.closed = prev.closed;
    this._syncRoomFromShape();
    if (this.closed) {
      this._markGeometryEditing('undo');
      this._beginPanelSettle();
    } else {
      this._clearPanelOverlay();
    }
    this.render();
    this._updateUi();
  }

  redo() {
    if (!this.future.length) return;
    this._pushHistory();
    const next = this.future.pop();
    this.vertices = next.vertices;
    this.edgeDimensions = next.edgeDimensions;
    this.diagonalDimensions = next.diagonalDimensions;
    this.closed = next.closed;
    this._syncRoomFromShape();
    if (this.closed) {
      this._markGeometryEditing('redo');
      this._beginPanelSettle();
    } else {
      this._clearPanelOverlay();
    }
    this.render();
    this._updateUi();
  }

  clear() {
    if (this.openingsModalOpen) return;
    if (this.geometryLocked) return;
    this._pushHistory();
    this.vertices = [];
    this.edgeDimensions = {};
    this.diagonalDimensions = {};
    this.closed = false;
    this._previewPoint = null;
    this._drawHistorySaved = false;
    this._clearPanelOverlay();
    this._scheduleFit(true);
    this.render();
    this._updateUi();
    this.onGeometryEdit?.({ reason: 'clear' });
  }

  _applyTemplate(name) {
    if (this.geometryLocked) return;
    this._pushHistory();
    let verts;
    if (name === 'l-shape') verts = createLShapeVertices(5, 4, 2, 2);
    else if (name === 'l-shape-mirror') verts = createMirrorLShapeVertices(5, 4, 2, 2);
    else if (name === 'u-shape') verts = createUShapeVertices(8, 6, 2);
    else if (name === 't-shape') verts = createTShapeVertices(6, 2, 2, 4);
    else if (name === 'cut-corner') verts = createCutCornerVertices(6, 5, 1.5);
    else if (name === 'z-shape') verts = createZShapeVertices(4, 7, 2, 5);
    else if (name === 'plus-shape') verts = createPlusShapeVertices(7, 2);
    else return;
    this.vertices = verts;
    this.edgeDimensions = buildEdgeDimensionsFromVertices(verts);
    this.diagonalDimensions = {};
    this.closed = true;
    this._syncRoomFromShape();
    this._markGeometryEditing('template');
    this._scheduleFit(true);
    this._showWallHeightModal();
    this.render();
    this._updateUi();
    this._beginPanelSettle();
  }

  _syncRoomFromShape({ quiet = false } = {}) {
    if (!this.room) return;
    this.room.setVertices(this.vertices, this.edgeDimensions, this.diagonalDimensions);
    if (!this.selectedWallId || !this.room.walls.find((w) => w.id === this.selectedWallId)) {
      this.selectedWallId = this.room.walls[0]?.id ?? null;
    }
    if (!quiet) this.onRoomChange?.(this._roomChangePayload());
  }

  _clearPanelOverlay() {
    clearTimeout(this._panelSettleTimer);
    this._panelSettleTimer = null;
    if (this._blurAnimRaf) cancelAnimationFrame(this._blurAnimRaf);
    this._blurAnimRaf = null;
    this._panelMode = 'idle';
    this._panelLayout = null;
    this._panelReveal = 1;
  }

  clearPanelPreview() {
    this._clearPanelOverlay();
    this._updateUi();
  }

  _markGeometryEditing(reason = 'edit') {
    if (!this.closed || this.vertices.length < 3) {
      this._clearPanelOverlay();
      return;
    }
    clearTimeout(this._panelSettleTimer);
    this._panelSettleTimer = null;
    this._panelMode = 'blur';
    // Keep previous panels under blur — do not clear _panelLayout
    this._panelReveal = 1;
    this._ensureBlurAnim();
    this.onGeometryEdit?.({ reason });
  }

  _beginPanelSettle() {
    if (!this.closed || this.vertices.length < 3) return;
    this._panelMode = 'computing';
    this._ensureBlurAnim();
    clearTimeout(this._panelSettleTimer);
    this._panelSettleTimer = setTimeout(() => {
      this._panelSettleTimer = null;
      this.onGeometrySettle?.({
        vertices: cloneVertices(this.vertices),
        edgeDimensions: { ...this.edgeDimensions },
        diagonalDimensions: { ...this.diagonalDimensions },
        wallHeight: this.wallHeightValue,
      });
    }, PANEL_SETTLE_MS);
    this._updateUi();
    this.render();
  }

  _ensureBlurAnim() {
    if (this._blurAnimRaf) return;
    const reduceMotion = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = () => {
      if (this._panelMode !== 'blur' && this._panelMode !== 'computing') {
        this._blurAnimRaf = null;
        return;
      }
      if (!reduceMotion) {
        this._blurPhase = (this._blurPhase + 0.042) % (Math.PI * 2);
      }
      this.render();
      this._blurAnimRaf = requestAnimationFrame(tick);
    };
    this._blurAnimRaf = requestAnimationFrame(tick);
  }

  setPanelLayout(layout) {
    if (!layout?.panels) {
      this._panelMode = 'idle';
      this._panelLayout = null;
      this.render();
      this._updateUi();
      return;
    }
    this._panelLayout = layout;
    // Keep laying animation while geometry is still settling (auto-calc may arrive early).
    if (this._panelSettleTimer && (this._panelMode === 'blur' || this._panelMode === 'computing')) {
      this._ensureBlurAnim();
      this.render();
      this._updateUi();
      return;
    }
    this._panelMode = 'ready';
    this._panelReveal = 0;
    const start = performance.now();
    const animate = (now) => {
      this._panelReveal = Math.min(1, (now - start) / PANEL_REVEAL_MS);
      this.render();
      if (this._panelReveal < 1) requestAnimationFrame(animate);
      else this._updateUi();
    };
    requestAnimationFrame(animate);
  }

  syncFromRoom(room, { settle = false, fit = false } = {}) {
    if (!room) return;
    this.room = room;
    if ((room.vertices?.length ?? 0) >= 3) {
      this.vertices = cloneVertices(room.vertices);
      this.edgeDimensions = Object.keys(room.edgeDimensions ?? {}).length
        ? { ...room.edgeDimensions }
        : buildEdgeDimensionsFromVertices(room.vertices);
      this.diagonalDimensions = { ...(room.diagonalDimensions ?? {}) };
      this.closed = true;
      this.wallHeightValue = room.wallHeight ?? this.wallHeightValue;
      this._wallHeightConfirmed = (room.wallHeight ?? 0) > 0;
    }

    const apply = () => {
      // Центрируем до первого кадра settle — иначе схема мелькает в углу (pan=0)
      if (fit && this.closed && this.vertices.length >= 3 && !this.host?.hidden) {
        this.fitToScreen();
      } else {
        this.render();
      }
      this._updateUi();
      if (settle) {
        this._markGeometryEditing('sync');
        this._beginPanelSettle();
      }
    };

    // После снятия [hidden] форсируем layout и сразу fit — без кадра в углу
    if (fit && !this.host?.hidden) {
      void this.canvasWrap?.offsetWidth;
      apply();
    } else {
      apply();
    }
  }

  _tryCloseContour(cx, cy) {
    if (this.closed || this.vertices.length < 3) return false;
    const closeRadius = this._vertexHitRadius() + 10;
    const first = this.worldToCanvas(this.vertices[0].x, this.vertices[0].y);
    if (Math.hypot(cx - first.x, cy - first.y) < closeRadius) {
      this._closeContour();
      return true;
    }
    return false;
  }

  _zoomAtCenter(factor) {
    const { w, h } = this._getCanvasSize();
    this._zoomAt(w / 2, h / 2, factor);
  }

  _zoomAt(cx, cy, factor) {
    const wx = (cx - this.panX) / (PX_PER_M * this.zoom);
    const wy = (cy - this.panY) / (PX_PER_M * this.zoom);
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    this.panX = cx - wx * PX_PER_M * this.zoom;
    this.panY = cy - wy * PX_PER_M * this.zoom;
    this.render();
  }

  _pointerPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const { w, h } = this._getCanvasSize();
    const scaleX = rect.width > 0 ? w / rect.width : 1;
    const scaleY = rect.height > 0 ? h / rect.height : 1;
    return {
      cx: (e.clientX - rect.left) * scaleX,
      cy: (e.clientY - rect.top) * scaleY,
    };
  }

  _clampZoom() {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom));
  }

  _onWheel(e) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (this.bgAdjustMode && this.bgImage && this._hitBackgroundImage(cx, cy)) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.95 : 1.05;
      this.bgTransform.widthM = Math.max(0.5, Math.min(80, this.bgTransform.widthM * factor));
      this._syncBgScaleSlider();
      this.render();
      return;
    }
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    this._zoomAt(cx, cy, factor);
  }

  _scheduleFit(force = false) {
    if (this._fitScheduled && !force) return;
    this._fitScheduled = true;
    requestAnimationFrame(() => {
      this._fitScheduled = false;
      this.fitToScreen();
    });
  }

  fitToScreen() {
    const { w, h } = this._getCanvasSize();
    const b = getBounds(this.vertices.length ? this.vertices : [{ x: 0, y: 0 }, { x: 8, y: 6 }]);
    const pad = 1.2;
    const contentW = b.maxX - b.minX + pad * 2;
    const contentH = b.maxY - b.minY + pad * 2;
    const sx = w / (contentW * PX_PER_M);
    const sy = h / (contentH * PX_PER_M);
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(sx, sy) * 0.94));
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    this.panX = w / 2 - cx * PX_PER_M * this.zoom;
    this.panY = h / 2 - cy * PX_PER_M * this.zoom;
    this.render();
  }

  toggleFullscreen() {
    const host = this.host;
    if (!host) return;
    const on = !host.classList.contains('is-fullscreen');
    host.classList.toggle('is-fullscreen', on);
    document.body.classList.toggle('sketch-fullscreen-open', on);
    const btn = this._q('#sketchFitBtn');
    if (btn) {
      btn.title = on ? 'Свернуть' : 'На весь экран';
      btn.setAttribute('aria-label', btn.title);
      btn.classList.toggle('is-active', on);
    }
    requestAnimationFrame(() => {
      this.render();
      this.fitToScreen();
    });
  }

  setOverlayOptions({ showNumbers, showFrame } = {}) {
    if (showNumbers !== undefined) this._showPanelNumbers = !!showNumbers;
    if (showFrame !== undefined) this._showFrameOverlay = !!showFrame;
    this.render();
  }

  /** dims-mode: нельзя рисовать/ломать контур; можно зум, проёмы, просмотр */
  setGeometryLocked(locked) {
    this.geometryLocked = !!locked;
    this.host?.classList.toggle('sketch-geometry-locked', this.geometryLocked);
    if (this.geometryLocked) {
      this._hideEdgeActions();
      this.keypad?.hide?.();
      this._selectedEdge = null;
      this._selectedDiagonal = null;
      this._dragIdx = null;
      this._cancelLongPress?.(true);
    }
    this._syncLockedToolbar();
    this._updateUi();
    this.render();
  }

  _syncLockedToolbar() {
    const locked = this.geometryLocked;
    [
      'sketchUndoBtn',
      'sketchRedoBtn',
      'sketchClearBtn',
      'sketchTemplatesBtn',
      'sketchBgUploadBtn',
      'sketchHelpBtn',
    ].forEach((id) => {
      const el = this._q(`#${id}`);
      if (!el) return;
      el.disabled = locked;
      el.hidden = locked;
    });
    const dropdown = this._q('#sketchTemplatesDropdown');
    if (dropdown) dropdown.hidden = locked;
    const edgeSize = this.edgeEditSizeBtn;
    if (edgeSize) edgeSize.hidden = locked;
  }

  worldToCanvas(x, y) {
    return { x: x * PX_PER_M * this.zoom + this.panX, y: y * PX_PER_M * this.zoom + this.panY };
  }

  canvasToWorld(cx, cy) {
    return {
      x: (cx - this.panX) / (PX_PER_M * this.zoom),
      y: (cy - this.panY) / (PX_PER_M * this.zoom),
    };
  }

  _vertexHitRadius() {
    return Math.max(22, 14 * Math.sqrt(this.zoom));
  }

  _edgeHitThreshold() {
    return Math.max(16, 12 * this.zoom);
  }

  _pickTarget(cx, cy) {
    const vHit = this._vertexHitRadius();
    let bestVertex = null;
    let bestDist = vHit;

    if (!this.closed && this.vertices.length >= 3) {
      const first = this.worldToCanvas(this.vertices[0].x, this.vertices[0].y);
      const d0 = Math.hypot(cx - first.x, cy - first.y);
      if (d0 < vHit + 10) {
        return { type: 'vertex', index: 0 };
      }
    }

    for (let i = 0; i < this.vertices.length; i++) {
      const p = this.worldToCanvas(this.vertices[i].x, this.vertices[i].y);
      const d = Math.hypot(cx - p.x, cy - p.y);
      if (d < bestDist) {
        bestDist = d;
        bestVertex = i;
      }
    }
    if (bestVertex !== null) {
      return { type: 'vertex', index: bestVertex };
    }

    if (this.closed) {
      const edge = this._hitEdge(cx, cy, this._edgeHitThreshold());
      if (edge !== null) return { type: 'edge', index: edge };
      const diag = this._hitDiagonal(cx, cy, 10);
      if (diag) return { type: 'diagonal', data: diag };
    }

    return null;
  }

  _onKeyDown(e) {
    if (!this._isInteractive() || this.openingsModalOpen) return;
    if (e.key === 'Backspace' && !this.closed && this.vertices.length > 0) {
      e.preventDefault();
      if (!this._drawHistorySaved) {
        this._pushHistory();
        this._drawHistorySaved = true;
      }
      this.vertices.pop();
      this._previewPoint = null;
      if (!this.vertices.length) this._drawHistorySaved = false;
      this.render();
    }
  }

  _touchDistance(t0, t1) {
    return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
  }

  _touchMidpoint(t0, t1) {
    return {
      x: (t0.clientX + t1.clientX) / 2,
      y: (t0.clientY + t1.clientY) / 2,
    };
  }

  _clientToCanvas(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const { w, h } = this._getCanvasSize();
    const scaleX = rect.width > 0 ? w / rect.width : 1;
    const scaleY = rect.height > 0 ? h / rect.height : 1;
    return {
      cx: (clientX - rect.left) * scaleX,
      cy: (clientY - rect.top) * scaleY,
    };
  }

  _beginPinch(e) {
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    const mid = this._touchMidpoint(t0, t1);
    const { cx, cy } = this._clientToCanvas(mid.x, mid.y);
    this._touchMode = 'pinch';
    this._pinch = {
      startDist: Math.max(1, this._touchDistance(t0, t1)),
      startZoom: this.zoom,
      cx,
      cy,
      lastMid: mid,
    };
    this._panning = false;
    this._panStart = null;
    this._touchPanCandidate = null;
    this._cancelLongPress(false);
    this._dragIdx = null;
  }

  _onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length >= 2) {
      this._beginPinch(e);
      return;
    }
    if (this._touchMode === 'pinch') return;

    const t = e.touches[0];
    const { cx, cy } = this._clientToCanvas(t.clientX, t.clientY);
    const target = this._pickTarget(cx, cy);

    // One-finger pan on empty space when contour is closed (or always when zoomed)
    if (this.closed && !target && !this.openingsModalOpen && !this.bgAdjustMode) {
      this._touchMode = 'pan';
      this._panning = true;
      this._panStart = { x: t.clientX, y: t.clientY, panX: this.panX, panY: this.panY };
      this._touchPanCandidate = null;
      // Still clear selection like empty tap
      this._selectedEdge = null;
      this._selectedDiagonal = null;
      this.keypad.hide();
      this._hideEdgeActions();
      this.render();
      return;
    }

    this._touchMode = null;
    this._onPointerDown({ clientX: t.clientX, clientY: t.clientY, button: 0 });
  }

  _onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length >= 2) {
      if (this._touchMode !== 'pinch') this._beginPinch(e);
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const pinch = this._pinch;
      if (!pinch) return;
      const dist = Math.max(1, this._touchDistance(t0, t1));
      const factor = dist / pinch.startDist;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinch.startZoom * factor));
      const mid = this._touchMidpoint(t0, t1);
      const { cx, cy } = this._clientToCanvas(mid.x, mid.y);

      // Zoom around pinch center
      const worldBefore = this.canvasToWorld(cx, cy);
      this.zoom = newZoom;
      const after = this.worldToCanvas(worldBefore.x, worldBefore.y);
      this.panX += cx - after.x;
      this.panY += cy - after.y;

      // Two-finger pan
      this.panX += mid.x - pinch.lastMid.x;
      this.panY += mid.y - pinch.lastMid.y;
      pinch.lastMid = mid;
      this._scheduleRender();
      return;
    }

    const t = e.touches[0];
    if (this._touchMode === 'pan' || this._panning) {
      this._onPointerMove({ clientX: t.clientX, clientY: t.clientY });
      return;
    }
    this._onPointerMove({ clientX: t.clientX, clientY: t.clientY });
  }

  _onTouchEnd(e) {
    if (e.touches.length >= 2) {
      this._beginPinch(e);
      return;
    }
    if (e.touches.length === 1 && this._touchMode === 'pinch') {
      // Continue as one-finger pan after pinch
      const t = e.touches[0];
      this._touchMode = 'pan';
      this._pinch = null;
      this._panning = true;
      this._panStart = { x: t.clientX, y: t.clientY, panX: this.panX, panY: this.panY };
      return;
    }
    this._pinch = null;
    this._touchMode = null;
    this._onPointerUp(e);
  }

  _onPointerDown(e) {
    const { cx, cy } = this._pointerPos(e);

    if (e.button === 1 || (this._spaceDown && (e.button === undefined || e.button === 0))) {
      this._panning = true;
      this._panStart = { x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== undefined && e.button !== 0) return;

    if (this.bgAdjustMode && this.bgImage && this._hitBackgroundImage(cx, cy)) {
      this._bgDragging = true;
      this._bgDragStart = {
        cx,
        cy,
        bgCx: this.bgTransform.cx,
        bgCy: this.bgTransform.cy,
      };
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (this.openingsModalOpen) return;

    if (this.geometryLocked) {
      if (this._selectedEdge !== null && this.closed) {
        const action = this._hitTestEdgeActions(cx, cy);
        if (action === 'openings') {
          this._openOpeningsForSelectedEdge();
          return;
        }
      }
      const targetLocked = this._pickTarget(cx, cy);
      if (targetLocked?.type === 'edge' && this.closed) {
        this._selectedEdge = targetLocked.index;
        this._selectedDiagonal = null;
        this.keypad.hide();
        this._positionEdgeActions();
        this.render();
        return;
      }
      if (this.closed && !targetLocked) {
        this._selectedEdge = null;
        this._hideEdgeActions();
        this.render();
      }
      return;
    }

    if (this._selectedEdge !== null && this.closed) {
      const action = this._hitTestEdgeActions(cx, cy);
      if (action === 'size') {
        this._showKeypadForSelectedEdge();
        return;
      }
      if (action === 'openings') {
        this._openOpeningsForSelectedEdge();
        return;
      }
    }

    if (!this.closed && this._tryCloseContour(cx, cy)) return;

    const target = this._pickTarget(cx, cy);
    if (target?.type === 'vertex') {
      const vIdx = target.index;
      if (!this.closed && vIdx === 0 && this.vertices.length >= 3) {
        this._closeContour();
        return;
      }
      if (this.closed) {
        this._pushHistory();
        this._startLongPress(vIdx);
        this._dragIdx = vIdx;
        this._markGeometryEditing('drag');
      }
      return;
    }

    if (target?.type === 'edge') {
      if (!this.closed) return;
      this._selectedEdge = target.index;
      this._selectedDiagonal = null;
      this.keypad.hide();
      this._positionEdgeActions();
      this.render();
      return;
    }

    if (target?.type === 'diagonal') {
      if (!this.closed) return;
      const diag = target.data;
      this._selectedDiagonal = diag;
      this._selectedEdge = null;
      this._hideEdgeActions();
      const key = `${diag.aIdx}-${diag.bIdx}`;
      this.keypad.show(
        formatDiagonalLabel(diag.a.label, diag.b.label),
        this.diagonalDimensions[key] ?? ''
      );
      return;
    }

    if (this.closed && !target) {
      this._selectedEdge = null;
      this._selectedDiagonal = null;
      this.keypad.hide();
      this._hideEdgeActions();
      this.render();
    }

    if (!this.closed) {
      const w = this.canvasToWorld(cx, cy);
      const snapped = snapPointDraw(w.x, w.y, this.vertices[this.vertices.length - 1], DRAW_GRID_STEP);
      if (this._isTooCloseToExisting(snapped.x, snapped.y)) return;
      if (!this._drawHistorySaved) {
        this._pushHistory();
        this._drawHistorySaved = true;
      }
      this.vertices.push({ x: snapped.x, y: snapped.y, label: labelForIndex(this.vertices.length) });
      this._previewPoint = null;
      this.render();
    }
  }

  _closeContour() {
    if (this.vertices.length < 3) return;
    this._pushHistory();
    this.closed = true;
    this._previewPoint = null;
    this._previewSmooth = null;
    this._drawHistorySaved = false;
    this.edgeDimensions = buildEdgeDimensionsFromVertices(this.vertices);
    this._syncRoomFromShape();
    this.keypad.hide();
    this._markGeometryEditing('close');
    this._showWallHeightModal();
    this.render();
    this._updateUi();
    this._beginPanelSettle();
  }

  _onPointerMove(e) {
    const { cx, cy } = this._pointerPos(e);

    if (this._panning && this._panStart) {
      this.panX = this._panStart.panX + (e.clientX - this._panStart.x);
      this.panY = this._panStart.panY + (e.clientY - this._panStart.y);
      this._scheduleRender();
      return;
    }

    if (this._bgDragging && this._bgDragStart) {
      const startW = this.canvasToWorld(this._bgDragStart.cx, this._bgDragStart.cy);
      const curW = this.canvasToWorld(cx, cy);
      this.bgTransform.cx = this._bgDragStart.bgCx + (curW.x - startW.x);
      this.bgTransform.cy = this._bgDragStart.bgCy + (curW.y - startW.y);
      this._scheduleRender();
      return;
    }

    const w = this.canvasToWorld(cx, cy);

    if (this._dragIdx !== null && this.closed) {
      this._cancelLongPress(false);
      const snapped = snapPointEdit(w.x, w.y, DRAW_GRID_STEP);
      this.vertices[this._dragIdx] = { ...this.vertices[this._dragIdx], x: snapped.x, y: snapped.y };
      this._scheduleRender();
      return;
    }

    if (!this.closed && this.vertices.length > 0) {
      const snapped = snapPointDraw(w.x, w.y, this.vertices[this.vertices.length - 1], DRAW_GRID_STEP);
      if (!this._previewSmooth) this._previewSmooth = { ...snapped };
      this._previewSmooth.x += (snapped.x - this._previewSmooth.x) * PREVIEW_LERP;
      this._previewSmooth.y += (snapped.y - this._previewSmooth.y) * PREVIEW_LERP;
      this._previewPoint = { ...this._previewSmooth };
      this._scheduleRender();
    }

    if (this._longPressIdx !== null) {
      const v = this.worldToCanvas(this.vertices[this._longPressIdx].x, this.vertices[this._longPressIdx].y);
      if (Math.hypot(cx - v.x, cy - v.y) > this._vertexHitRadius() + 4) {
        this._cancelLongPress(false);
      }
    }

    if (this._dragIdx === null && !this._panning && !this._bgDragging) {
      if (this.bgAdjustMode && this.bgImage && this._hitBackgroundImage(cx, cy)) {
        this.canvas.style.cursor = 'grab';
      } else if (this._selectedEdge !== null && this._hitTestEdgeActions(cx, cy)) {
        this.canvas.style.cursor = 'pointer';
      } else if (!this._spaceDown && !this._panning) {
        this.canvas.style.cursor = '';
      }
      const target = this._pickTarget(cx, cy);
      const prev = this._hoverTarget;
      const changed = (prev?.type !== target?.type)
        || (prev?.index !== target?.index)
        || (prev?.wallId !== target?.wallId);
      if (changed) {
        this._hoverTarget = target;
        this._scheduleRender();
      }
    }
  }

  _onPointerUp(e) {
    if (this._bgDragging) {
      this._bgDragging = false;
      this._bgDragStart = null;
      this.canvas.style.cursor = this.bgAdjustMode && this.bgImage ? 'grab' : '';
      return;
    }
    if (this._panning) {
      this._panning = false;
      this._panStart = null;
      this.canvas.style.cursor = this._spaceDown ? 'grab' : '';
      return;
    }
    const wasDrag = this._dragIdx !== null;
    this._cancelLongPress(false);
    this._dragIdx = null;
    if (wasDrag && this.closed && !this._pendingDeleteIdx) {
      this.edgeDimensions = buildEdgeDimensionsFromVertices(this.vertices);
      this._syncRoomFromShape();
      this._beginPanelSettle();
    }
    this.render();
    this._updateUi();
  }

  _startLongPress(idx) {
    this._longPressIdx = idx;
    this._longPressProgress = 0;
    if (!this.closed || this.vertices.length <= 3) return;
    const start = performance.now();
    const tick = (now) => {
      if (this._longPressIdx !== idx) return;
      this._longPressProgress = Math.min(1, (now - start) / LONG_PRESS_MS);
      this._scheduleRender();
      if (this._longPressProgress >= 1) {
        this._pendingDeleteIdx = idx;
        this._q('#sketchDeleteLabel').textContent = 'Удалить этот угол?';
        this._q('#sketchDeleteDialog').hidden = false;
        this._longPressIdx = null;
        return;
      }
      this._longPressRaf = requestAnimationFrame(tick);
    };
    this._longPressRaf = requestAnimationFrame(tick);
  }

  _cancelLongPress(clearProgress = true) {
    if (this._longPressRaf) cancelAnimationFrame(this._longPressRaf);
    this._longPressRaf = null;
    this._longPressIdx = null;
    if (clearProgress) this._longPressProgress = 0;
  }

  _cancelDelete() {
    this._pendingDeleteIdx = null;
    this._longPressProgress = 0;
    this._q('#sketchDeleteDialog').hidden = true;
    this.render();
  }

  _confirmDelete() {
    const idx = this._pendingDeleteIdx;
    this._cancelDelete();
    if (idx === null || this.vertices.length <= 3) return;
    this._pushHistory();
    this.vertices.splice(idx, 1);
    this.vertices.forEach((v, i) => { v.label = labelForIndex(i); });
    this.edgeDimensions = buildEdgeDimensionsFromVertices(this.vertices);
    this._syncRoomFromShape();
    this._markGeometryEditing('delete');
    this.render();
    this._updateUi();
    this._beginPanelSettle();
  }

  _onKeypadConfirm(val) {
    if (this._selectedEdge !== null) {
      this._pushHistory();
      this.edgeDimensions[this._selectedEdge] = val;
      this.vertices = solvePolygonFromConstraints(this.vertices, this.edgeDimensions, this.diagonalDimensions);
      this.edgeDimensions = buildEdgeDimensionsFromVertices(this.vertices);
      this._syncRoomFromShape();
      this._markGeometryEditing('size');
      this._beginPanelSettle();
    } else if (this._selectedDiagonal) {
      const key = `${this._selectedDiagonal.aIdx}-${this._selectedDiagonal.bIdx}`;
      this._pushHistory();
      this.diagonalDimensions[key] = val;
      this.vertices = solvePolygonFromConstraints(this.vertices, this.edgeDimensions, this.diagonalDimensions);
      this.edgeDimensions = buildEdgeDimensionsFromVertices(this.vertices);
      this._syncRoomFromShape();
      this._markGeometryEditing('size');
      this._beginPanelSettle();
    }
    this.keypad.hide();
    this._hideEdgeActions();
    this._selectedEdge = null;
    this._selectedDiagonal = null;
    this.render();
    this._updateUi();
  }

  _hitEdge(cx, cy, threshold) {
    const edges = getEdges(this.vertices);
    let best = null;
    let bestDist = threshold;
    edges.forEach((e, i) => {
      const p1 = this.worldToCanvas(e.a.x, e.a.y);
      const p2 = this.worldToCanvas(e.b.x, e.b.y);
      const dist = this._pointSegDist(cx, cy, p1.x, p1.y, p2.x, p2.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }

  _hitDiagonal(cx, cy, threshold) {
    const diags = triangulateFan(this.vertices);
    let best = null;
    let bestDist = threshold;
    for (const d of diags) {
      const p1 = this.worldToCanvas(d.a.x, d.a.y);
      const p2 = this.worldToCanvas(d.b.x, d.b.y);
      const dist = this._pointSegDist(cx, cy, p1.x, p1.y, p2.x, p2.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best;
  }

  _pointSegDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  _addOpening(type) {
    if (!this.room || !this.selectedWallId) return;
    const opening = createDefaultOpening(this.selectedWallId, type);
    const wall = this.room.walls.find((w) => w.id === this.selectedWallId);
    if (wall) opening.offset = roundMeters(Math.max(0, (wall.length - opening.width) / 2));
    this.room.addOpening(opening);
    this._selectOpening(opening.id);
    this.onRoomChange?.(this._roomChangePayload());
    this._refreshOpeningsPanel();
    requestAnimationFrame(() => {
      this.wallElevation?.focusOpening?.(opening.id);
    });
    this.render();
  }

  _selectOpening(id) {
    this.selectedOpeningId = id;
    if (id) {
      const o = this.room?.getOpening(id);
      if (o) {
        this.selectedWallId = o.wallId;
        this._syncOpeningProps(id);
      }
    } else {
      this._q('#sketchOpeningProps').hidden = true;
    }
    this.wallElevation.selectOpening(id);
    this._refreshOpeningsPanel();
    this.render();
  }

  _syncOpeningProps(id) {
    const o = this.room?.getOpening(id);
    const panel = this._q('#sketchOpeningProps');
    if (!o || !panel) {
      if (panel) panel.hidden = true;
      return;
    }
    panel.hidden = false;
    this._q('#sketchOpeningOffset').value = roundMeters(o.offset);
    this._q('#sketchOpeningWidth').value = roundMeters(o.width);
    this._q('#sketchOpeningHeight').value = roundMeters(o.height);
    this._q('#sketchOpeningSill').value = roundMeters(o.sillHeight);
    const sillWrap = this._q('#sketchSillWrap');
    if (sillWrap) sillWrap.hidden = o.type !== OPENING_TYPES.WINDOW;
  }

  _applyOpeningPropsFromForm() {
    if (!this.selectedOpeningId || !this.room) return;
    const o = this.room.getOpening(this.selectedOpeningId);
    if (!o) return;
    const parse = (id) => parseFloat(String(this._q(`#${id}`)?.value ?? '').replace(',', '.')) || 0;
    o.offset = roundMeters(parse('sketchOpeningOffset'));
    o.width = roundMeters(parse('sketchOpeningWidth'));
    o.height = roundMeters(parse('sketchOpeningHeight'));
    o.sillHeight = roundMeters(parse('sketchOpeningSill'));
    const wall = this.room.walls.find((w) => w.id === o.wallId);
    if (wall) {
      const max = Math.max(0, wall.length - o.width);
      o.offset = Math.max(0, Math.min(max, o.offset));
    }
    this.onRoomChange?.(this._roomChangePayload());
    this._refreshOpeningsPanel();
    this.render();
  }

  _deleteSelectedOpening() {
    if (!this.selectedOpeningId || !this.room) return;
    this.room.removeOpening(this.selectedOpeningId);
    this._selectOpening(null);
    this.onRoomChange?.(this._roomChangePayload());
    this.render();
  }

  _refreshOpeningsPanel() {
    if (!this.room || !this.openingsModalOpen) return;
    this.openingsPlanEditor.setRoom(this.room);
    this.openingsPlanEditor.selectWall(this.selectedWallId);
    if (this.selectedOpeningId) this.openingsPlanEditor.selectOpening(this.selectedOpeningId);
    this.openingsPlanEditor.render();
    this.wallElevation.setRoom(this.room);
    if (this.selectedWallId) this.wallElevation.setWall(this.selectedWallId);
    const wall = this.room.walls.find((w) => w.id === this.selectedWallId);
    const label = this._q('#sketchElevationLabel');
    if (label && wall) {
      label.textContent = `${wall.label} · ${wall.length.toFixed(2)} × ${this.room.wallHeight.toFixed(2)} м`;
    }
    if (this.selectedOpeningId) this.wallElevation.selectOpening(this.selectedOpeningId);
    this._renderWallChips();
  }

  _hideEdgeActions() {
    this._edgeActionRects = null;
    if (this.edgeActionsEl) this.edgeActionsEl.hidden = true;
  }

  _positionEdgeActions() {
    if (this.edgeActionsEl) this.edgeActionsEl.hidden = true;
  }

  _hitTestEdgeActions(cx, cy) {
    if (!this._edgeActionRects) return null;
    for (const [key, r] of Object.entries(this._edgeActionRects)) {
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return key;
    }
    return null;
  }

  _drawEdgeActionButtons(mx, my) {
    const labels = [
      { key: 'size', text: 'Изменить размер' },
      { key: 'openings', text: 'Проёмы', disabled: !this._wallHeightConfirmed },
    ];
    const gap = 6;
    const padX = 10;
    const bh = 26;
    this.ctx.font = '600 11px system-ui';
    const widths = labels.map((l) => this.ctx.measureText(l.text).width + padX * 2);
    const totalW = widths.reduce((s, w) => s + w, 0) + gap * (labels.length - 1);
    let bx = mx - totalW / 2;
    const by = my + 8;
    this._edgeActionRects = {};

    labels.forEach((l, idx) => {
      const bw = widths[idx];
      const disabled = l.disabled === true;
      this.ctx.fillStyle = disabled ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.98)';
      this.ctx.strokeStyle = disabled ? '#e0e0e0' : '#dce5e1';
      this.ctx.lineWidth = 1;
      this.ctx.shadowColor = 'rgba(0,0,0,0.12)';
      this.ctx.shadowBlur = 6;
      this.ctx.fillRect(bx, by, bw, bh);
      this.ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      this.ctx.shadowBlur = 0;
      this.ctx.fillStyle = disabled ? '#999' : ACCENT;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(l.text, bx + bw / 2, by + bh / 2);
      if (!disabled) this._edgeActionRects[l.key] = { x: bx, y: by, w: bw, h: bh };
      bx += bw + gap;
    });
  }

  _showKeypadForSelectedEdge() {
    if (this._selectedEdge === null) return;
    const eData = getEdges(this.vertices)[this._selectedEdge];
    if (!eData) return;
    this.keypad.show(
      formatEdgeLabel(this._selectedEdge, eData.a.label, eData.b.label),
      this.edgeDimensions[this._selectedEdge] ?? eData.length
    );
  }

  _openOpeningsForSelectedEdge() {
    if (this._selectedEdge === null) return;
    this.room?.rebuildWalls();
    const wall = this.room?.walls?.[this._selectedEdge];
    if (wall) this.selectedWallId = wall.id;
    this._openOpeningsModal();
  }

  _updateUi() {
    if (this.doneBtn) this.doneBtn.disabled = !this._canSave();
    if (this.openingsBtn) this.openingsBtn.disabled = !this.closed;

    let bottomText = '—';
    let hintText = 'Кликайте по сетке — шаг 1 м';

    if (this.closed && this.vertices.length >= 3) {
      const area = shoelaceArea(this.vertices);
      const perim = getPerimeter(this.vertices);
      let unset = 0;
      for (let i = 0; i < this.vertices.length; i++) {
        if (!this.edgeDimensions[i] || this.edgeDimensions[i] <= 0) unset++;
      }
      bottomText = `Площадь ${area.toFixed(2)} м² · Периметр ${perim.toFixed(2)} м`;
      if (this._panelMode === 'blur' || this._panelMode === 'computing') {
        hintText = 'Идёт укладка панелей…';
        bottomText += ' · укладка панелей';
      } else if (unset > 0) {
        bottomText += ` · ${unset} сторон без размера`;
        hintText = 'Задайте размеры — кликните по стороне, затем «Изменить размер»';
      } else if (this.geometryLocked) {
        hintText = 'Размеры задаются слева · клик по стороне — проёмы · вкладка «Стены»';
      } else {
        hintText = 'Контур готов · тяните углы или «Настроить стены»';
      }
    } else if (!this.closed && this.vertices.length >= 3) {
      hintText = 'Замкните контур на красной точке';
    }

    if (this.hintTextEl) this.hintTextEl.textContent = hintText;
    if (this.bottomStatsEl) this.bottomStatsEl.textContent = bottomText;
    if (this.zoomLabelEl) {
      const pct = Math.round(this.zoom * 100);
      this.zoomLabelEl.textContent = `${pct}%`;
    }
    if (this.emptyHintEl) {
      this.emptyHintEl.hidden = !(!this.vertices.length && !this.bgImage);
    }
    if (this.bgAdjustMode && this.bgImage) {
      if (this.hintTextEl) {
        this.hintTextEl.textContent = 'Перетащите подложку · колёсико — масштаб · затем рисуйте контур';
      }
    }

    const statusEl = document.getElementById('schemeStatus');
    if (statusEl) {
      if (this._panelMode === 'blur' || this._panelMode === 'computing') {
        statusEl.hidden = false;
        statusEl.textContent = 'Идёт укладка панелей…';
        statusEl.classList.add('is-computing');
      } else {
        statusEl.hidden = true;
        statusEl.classList.remove('is-computing');
      }
    }

    this._updateBgUi();
    this._positionEdgeActions();
  }

  _loadBackgroundImage(file) {
    if (!file.type.startsWith('image/')) {
      this.showToast('Выберите файл изображения');
      return;
    }
    if (this._bgObjectUrl) URL.revokeObjectURL(this._bgObjectUrl);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      this.bgImage = img;
      this._bgObjectUrl = url;
      const { w, h } = this._getCanvasSize();
      const center = this.canvasToWorld(w / 2, h / 2);
      const viewWidthM = w / (PX_PER_M * this.zoom);
      this._bgBaseWidthM = viewWidthM * 0.75;
      this.bgTransform = {
        cx: center.x,
        cy: center.y,
        widthM: this._bgBaseWidthM,
        opacity: 0.45,
      };
      this.bgAdjustMode = true;
      if (this.bgOpacityInput) this.bgOpacityInput.value = '45';
      if (this.bgScaleInput) this.bgScaleInput.value = '100';
      this._updateBgUi();
      this.render();
      this.showToast('Подложка загружена — настройте положение и масштаб');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this.showToast('Не удалось загрузить изображение');
    };
    img.src = url;
  }

  _removeBackgroundImage(updateUi = true) {
    if (this._bgObjectUrl) URL.revokeObjectURL(this._bgObjectUrl);
    this._bgObjectUrl = null;
    this.bgImage = null;
    this.bgAdjustMode = false;
    this._bgDragging = false;
    this._bgDragStart = null;
    if (updateUi) {
      this._updateBgUi();
      this.render();
    }
  }

  _toggleBgAdjustMode() {
    if (!this.bgImage) return;
    this.bgAdjustMode = !this.bgAdjustMode;
    this._updateBgUi();
    this._updateUi();
    this.render();
  }

  _syncBgScaleSlider() {
    if (!this.bgScaleInput || !this._bgBaseWidthM) return;
    const pct = Math.round((this.bgTransform.widthM / this._bgBaseWidthM) * 100);
    this.bgScaleInput.value = String(Math.max(10, Math.min(200, pct)));
  }

  _updateBgUi() {
    const hasBg = !!this.bgImage;
    if (this.bgAdjustBtn) {
      this.bgAdjustBtn.hidden = !hasBg;
      this.bgAdjustBtn.classList.toggle('active', hasBg && this.bgAdjustMode);
    }
    if (this.bgPanel) this.bgPanel.hidden = !hasBg;
    this.canvasWrap?.classList.toggle('sketch-canvas-wrap--bg-adjust', hasBg && this.bgAdjustMode);
  }

  _getBackgroundCanvasRect() {
    if (!this.bgImage) return null;
    const { cx, cy, widthM } = this.bgTransform;
    const aspect = this.bgImage.height / this.bgImage.width;
    const heightM = widthM * aspect;
    const tl = this.worldToCanvas(cx - widthM / 2, cy - heightM / 2);
    const br = this.worldToCanvas(cx + widthM / 2, cy + heightM / 2);
    return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
  }

  _hitBackgroundImage(cx, cy) {
    const r = this._getBackgroundCanvasRect();
    if (!r) return false;
    return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
  }

  _drawBackgroundImage() {
    if (!this.bgImage) return;
    const r = this._getBackgroundCanvasRect();
    if (!r) return;
    this.ctx.save();
    this.ctx.globalAlpha = this.bgTransform.opacity;
    this.ctx.drawImage(this.bgImage, r.x, r.y, r.w, r.h);
    this.ctx.restore();
    if (this.bgAdjustMode) {
      this.ctx.save();
      this.ctx.strokeStyle = '#2196F3';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([6, 4]);
      this.ctx.strokeRect(r.x, r.y, r.w, r.h);
      this.ctx.setLineDash([]);
      this.ctx.restore();
    }
  }

  showToast(msg) {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.toastEl.hidden = true; }, 3500);
  }

  _scheduleRender() {
    if (this._renderRaf) return;
    this._renderRaf = requestAnimationFrame(() => {
      this._renderRaf = null;
      this.render();
    });
  }

  render() {
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = this._getCanvasSize();
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.fillStyle = '#f8faf9';
    this.ctx.fillRect(0, 0, w, h);

    this._drawGrid(w, h);
    this._drawBackgroundImage();

    if (this.vertices.length >= 2) {
      if (this.closed && this.vertices.length >= 3) {
        this.ctx.beginPath();
        const first = this.worldToCanvas(this.vertices[0].x, this.vertices[0].y);
        this.ctx.moveTo(first.x, first.y);
        for (let i = 1; i < this.vertices.length; i++) {
          const p = this.worldToCanvas(this.vertices[i].x, this.vertices[i].y);
          this.ctx.lineTo(p.x, p.y);
        }
        this.ctx.closePath();
        this.ctx.fillStyle = 'rgba(1, 100, 79, 0.08)';
        this.ctx.fill();

        if (this._panelLayout?.panels?.length && (this._panelMode === 'ready' || this._panelMode === 'blur' || this._panelMode === 'computing')) {
          this._drawPanelOverlay({ blurred: this._panelMode === 'blur' || this._panelMode === 'computing' });
        }
        if (this._panelMode === 'blur' || this._panelMode === 'computing') {
          this._drawComputingBlur();
        } else if (this._showFrameOverlay) {
          this._drawFrameOverlay();
        }
      }

      const edges = getEdges(this.vertices);

      if (!this.closed) {
        this.ctx.beginPath();
        const first = this.worldToCanvas(this.vertices[0].x, this.vertices[0].y);
        this.ctx.moveTo(first.x, first.y);
        for (let i = 1; i < this.vertices.length; i++) {
          const p = this.worldToCanvas(this.vertices[i].x, this.vertices[i].y);
          this.ctx.lineTo(p.x, p.y);
        }
        this.ctx.strokeStyle = ACCENT;
        this.ctx.lineWidth = 2.5;
        this.ctx.stroke();
      } else {
        edges.forEach((e, i) => {
          const p1 = this.worldToCanvas(e.a.x, e.a.y);
          const p2 = this.worldToCanvas(e.b.x, e.b.y);
          const isSelected = this._selectedEdge === i;
          const isHover = this._hoverTarget?.type === 'edge' && this._hoverTarget.index === i;
          this.ctx.strokeStyle = isSelected ? '#e67e22' : (isHover ? 'rgba(1, 100, 79, 0.65)' : ACCENT);
          this.ctx.lineWidth = isSelected ? 4 : (isHover ? 3.5 : 2.5);
          this.ctx.beginPath();
          this.ctx.moveTo(p1.x, p1.y);
          this.ctx.lineTo(p2.x, p2.y);
          this.ctx.stroke();
        });
        if (this._selectedEdge !== null || this._selectedDiagonal) {
          this._drawDiagonals();
        }
        if (this._selectedEdge !== null) {
          this._drawSelectedEdgeLabel(this._selectedEdge);
        } else {
          this._drawAllEdgeLabels();
        }
      }
    }

    if (this.closed && this._wallHeightConfirmed && this.vertices.length >= 3) {
      this._drawWallHeightCenter();
    }

    if (!this.closed && this.vertices.length > 0 && this._previewPoint) {
      const last = this.worldToCanvas(this.vertices[this.vertices.length - 1].x, this.vertices[this.vertices.length - 1].y);
      const preview = this.worldToCanvas(this._previewPoint.x, this._previewPoint.y);
      this.ctx.setLineDash([6, 4]);
      this.ctx.strokeStyle = 'rgba(1, 100, 79, 0.5)';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(last.x, last.y);
      this.ctx.lineTo(preview.x, preview.y);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
      this.ctx.fillStyle = 'rgba(1, 100, 79, 0.35)';
      this.ctx.beginPath();
      this.ctx.arc(preview.x, preview.y, 6, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.vertices.forEach((v, i) => {
      const p = this.worldToCanvas(v.x, v.y);
      const isStart = i === 0;
      const canClose = isStart && !this.closed && this.vertices.length >= 3;
      const isHover = this._hoverTarget?.type === 'vertex' && this._hoverTarget.index === i;
      const r = canClose ? 11 : (isStart ? 9 : 8) + (isHover ? 2 : 0);
      this.ctx.fillStyle = canClose ? '#e53935' : (isHover ? '#028a6a' : ACCENT);
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      this.ctx.fill();
      if (canClose) {
        this.ctx.strokeStyle = 'rgba(229, 57, 53, 0.35)';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, this._vertexHitRadius(), 0, Math.PI * 2);
        this.ctx.stroke();
      }
      if (this._longPressIdx === i && this._longPressProgress > 0) {
        this.ctx.strokeStyle = '#e53935';
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this._longPressProgress);
        this.ctx.stroke();
      }
      this.ctx.font = 'bold 11px system-ui';
      this.ctx.fillStyle = '#334';
      this.ctx.textAlign = 'left';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(v.label, p.x + r + 4, p.y);
    });

    this._updateUi();
  }

  _pathPolygon() {
    const first = this.worldToCanvas(this.vertices[0].x, this.vertices[0].y);
    this.ctx.beginPath();
    this.ctx.moveTo(first.x, first.y);
    for (let i = 1; i < this.vertices.length; i++) {
      const p = this.worldToCanvas(this.vertices[i].x, this.vertices[i].y);
      this.ctx.lineTo(p.x, p.y);
    }
    this.ctx.closePath();
  }

  _drawComputingBlur() {
    if (this.vertices.length < 3) return;
    const { w, h } = this._getCanvasSize();
    const reduceMotion = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const phase = this._blurPhase;
    const t = phase / (Math.PI * 2);
    const breathe = 0.5 + 0.5 * Math.sin(phase);
    const b = getBounds(this.vertices);
    const c0 = this.worldToCanvas(b.minX, b.minY);
    const c1 = this.worldToCanvas(b.maxX, b.maxY);
    const minX = Math.min(c0.x, c1.x);
    const maxX = Math.max(c0.x, c1.x);
    const minY = Math.min(c0.y, c1.y);
    const maxY = Math.max(c0.y, c1.y);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    this.ctx.save();
    this._pathPolygon();
    this.ctx.clip();

    // Slightly deeper fill so status stays readable over the shimmer.
    this.ctx.fillStyle = `rgba(214, 230, 224, ${0.78 + breathe * 0.06})`;
    this.ctx.fillRect(0, 0, w, h);
    this.ctx.fillStyle = `rgba(1, 100, 79, ${0.14 + breathe * 0.05})`;
    this.ctx.fillRect(0, 0, w, h);

    // Animated shimmer across the fill.
    if (!reduceMotion) {
      const span = Math.max(maxX - minX, 1);
      const bandW = Math.max(56, span * 0.42);
      const sweep = minX - bandW + (span + bandW * 2) * t;
      const grad = this.ctx.createLinearGradient(sweep, minY, sweep + bandW, maxY);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.45, `rgba(255,255,255,${0.22 + breathe * 0.1})`);
      grad.addColorStop(0.55, `rgba(1,100,79,${0.1 + breathe * 0.05})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      this.ctx.fillStyle = grad;
      this.ctx.fillRect(minX - 4, minY - 4, span + 8, maxY - minY + 8);
    }

    // Status inside the plan — no box, no outline.
    const label = 'Идёт укладка панелей…';
    this.ctx.font = '700 17px "Segoe UI", system-ui, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = '#01382e';
    this.ctx.fillText(label, cx, cy);

    this.ctx.restore();
  }

  _getCutHatchPattern() {
    if (this._cutHatchPattern) return this._cutHatchPattern;
    const tile = document.createElement('canvas');
    tile.width = 10;
    tile.height = 10;
    const t = tile.getContext('2d');
    t.fillStyle = 'rgba(180, 186, 192, 0.85)';
    t.fillRect(0, 0, 10, 10);
    t.strokeStyle = 'rgba(90, 96, 104, 0.55)';
    t.lineWidth = 1.2;
    t.setLineDash([2.5, 2.5]);
    t.beginPath();
    t.moveTo(-2, 12);
    t.lineTo(12, -2);
    t.moveTo(2, 14);
    t.lineTo(14, 2);
    t.stroke();
    this._cutHatchPattern = this.ctx.createPattern(tile, 'repeat');
    return this._cutHatchPattern;
  }

  _drawPanelOverlay({ blurred = false } = {}) {
    const panels = this._panelLayout?.panels;
    if (!panels?.length || this.vertices.length < 3) return;
    const offsetX = this._panelLayout.offsetX ?? 0;
    const offsetY = this._panelLayout.offsetY ?? 0;
    const alpha = blurred ? 0.45 : (this._panelReveal ?? 1);

    this.ctx.save();
    this._pathPolygon();
    this.ctx.clip();
    this.ctx.globalAlpha = alpha;
    if (blurred) this.ctx.filter = 'blur(2.5px)';

    for (const panel of panels) {
      const parts = typeof panel.getParts === 'function'
        ? panel.getParts()
        : [{ x: panel.x, y: panel.y, w: panel.width, h: panel.height }];
      for (const part of parts) {
        const p1 = this.worldToCanvas(part.x + offsetX, part.y + offsetY);
        const p2 = this.worldToCanvas(part.x + part.w + offsetX, part.y + part.h + offsetY);
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const pw = Math.abs(p2.x - p1.x);
        const ph = Math.abs(p2.y - p1.y);
        if (panel.isCut) {
          this.ctx.fillStyle = this._getCutHatchPattern() || 'rgba(180, 186, 192, 0.85)';
        } else {
          this.ctx.fillStyle = 'rgba(64, 68, 73, 0.82)';
        }
        this.ctx.strokeStyle = 'rgba(43, 47, 51, 0.9)';
        this.ctx.lineWidth = 1;
        this.ctx.fillRect(x, y, pw, ph);
        this.ctx.strokeRect(x, y, pw, ph);
      }

      if (!blurred && this._showPanelNumbers && panel.number != null) {
        const largest = parts.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
        const p1 = this.worldToCanvas(largest.x + offsetX, largest.y + offsetY);
        const p2 = this.worldToCanvas(largest.x + largest.w + offsetX, largest.y + largest.h + offsetY);
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const pw = Math.abs(p2.x - p1.x);
        const ph = Math.abs(p2.y - p1.y);
        if (pw > 12 && ph > 10) {
          this.ctx.filter = 'none';
          this.ctx.fillStyle = '#fff';
          this.ctx.font = '600 10px system-ui';
          this.ctx.textAlign = 'center';
          this.ctx.textBaseline = 'middle';
          this.ctx.fillText(String(panel.number), x + pw / 2, y + ph / 2);
          if (blurred) this.ctx.filter = 'blur(2.5px)';
        }
      }
    }
    this.ctx.filter = 'none';
    this.ctx.restore();
  }

  _drawFrameOverlay() {
    if (!this._showFrameOverlay || this.vertices.length < 3) return;
    const b = getBounds(this.vertices);
    const origin = this.worldToCanvas(b.minX, b.minY);
    const scale = PX_PER_M * this.zoom;
    const roomLike = this.room || { vertices: this.vertices };
    const bounds = getCeilingFrameBounds(roomLike);
    const clipLocal = this.vertices.map((v) => ({ x: v.x - b.minX, y: v.y - b.minY }));

    this.ctx.save();
    this.ctx.translate(origin.x, origin.y);
    drawFrameGrid(this.ctx, bounds, scale, {
      showHangers: true,
      clipPolygon: clipLocal,
    });
    this.ctx.restore();
  }

  _drawAllEdgeLabels() {
    const edges = getEdges(this.vertices);
    edges.forEach((e, i) => {
      const dim = this.edgeDimensions[i] ?? e.length;
      if (!dim || dim <= 0) return;
      const p1 = this.worldToCanvas(e.a.x, e.a.y);
      const p2 = this.worldToCanvas(e.b.x, e.b.y);
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      let nx = -(p2.y - p1.y);
      let ny = p2.x - p1.x;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const b = getBounds(this.vertices);
      const cx = (this.worldToCanvas(b.minX, b.minY).x + this.worldToCanvas(b.maxX, b.maxY).x) / 2;
      const cy = (this.worldToCanvas(b.minX, b.minY).y + this.worldToCanvas(b.maxX, b.maxY).y) / 2;
      if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
      const ox = mx + nx * 16;
      const oy = my + ny * 16;
      this.ctx.font = '600 12px system-ui';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      const text = `${Number(dim).toFixed(2)} м`;
      const tw = this.ctx.measureText(text).width + 10;
      this.ctx.fillStyle = 'rgba(255,255,255,0.94)';
      this.ctx.fillRect(ox - tw / 2, oy - 9, tw, 18);
      this.ctx.fillStyle = '#445';
      this.ctx.fillText(text, ox, oy);
    });
  }

  _drawWallHeightCenter() {
    const b = getBounds(this.vertices);
    const midTop = this.worldToCanvas((b.minX + b.maxX) / 2, b.minY);
    const text = `h = ${Number(this.wallHeightValue).toFixed(2)} м`;
    this.ctx.font = '600 13px system-ui';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    const tw = this.ctx.measureText(text).width + 16;
    const x = midTop.x;
    const y = midTop.y - 22;
    this.ctx.fillStyle = 'rgba(255,255,255,0.96)';
    this.ctx.fillRect(x - tw / 2, y - 12, tw, 24);
    this.ctx.strokeStyle = 'rgba(1,100,79,0.28)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x - tw / 2, y - 12, tw, 24);
    this.ctx.fillStyle = ACCENT;
    this.ctx.fillText(text, x, y);
  }

  _drawSelectedEdgeLabel(i) {
    const edges = getEdges(this.vertices);
    const e = edges[i];
    if (!e) return;
    const p1 = this.worldToCanvas(e.a.x, e.a.y);
    const p2 = this.worldToCanvas(e.b.x, e.b.y);
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    const dim = this.edgeDimensions[i];
    this.ctx.font = 'bold 13px system-ui';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'bottom';
    if (dim && dim > 0) {
      const text = `${dim.toFixed(2)} м`;
      const tw = this.ctx.measureText(text).width + 14;
      this.ctx.fillStyle = '#fff';
      this.ctx.fillRect(mx - tw / 2, my - 26, tw, 20);
      this.ctx.fillStyle = '#334';
      this.ctx.fillText(text, mx, my - 10);
    } else {
      this.ctx.fillStyle = '#e67e22';
      this.ctx.fillText('?', mx, my - 6);
    }
    this._drawEdgeActionButtons(mx, my);
  }

  _drawPlanOpenings() {
    if (!this.room) return;
    for (const opening of this.room.openings) {
      const wall = this.room.walls.find((w) => w.id === opening.wallId);
      if (!wall) continue;
      const p1 = this.worldToCanvas(wall.planStart.x, wall.planStart.y);
      const p2 = this.worldToCanvas(wall.planEnd.x, wall.planEnd.y);
      const t1 = opening.offset / wall.length;
      const t2 = (opening.offset + opening.width) / wall.length;
      const x1 = p1.x + (p2.x - p1.x) * t1;
      const y1 = p1.y + (p2.y - p1.y) * t1;
      const x2 = p1.x + (p2.x - p1.x) * t2;
      const y2 = p1.y + (p2.y - p1.y) * t2;
      const active = opening.id === this.selectedOpeningId;
      this.ctx.strokeStyle = active ? '#2196F3' : '#e67e22';
      this.ctx.lineWidth = active ? 5 : 4;
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();
    }
  }

  _drawGrid(w, h) {
    const pxPerM = PX_PER_M * this.zoom;
    let stepM = 1;
    while (stepM * pxPerM < 20 && stepM < 10) stepM *= 2;

    const topLeft = this.canvasToWorld(0, 0);
    const bottomRight = this.canvasToWorld(w, h);
    const startX = Math.floor(topLeft.x / stepM) * stepM;
    const endX = Math.ceil(bottomRight.x / stepM) * stepM;
    const startY = Math.floor(topLeft.y / stepM) * stepM;
    const endY = Math.ceil(bottomRight.y / stepM) * stepM;

    this.ctx.setLineDash([4, 4]);
    this.ctx.lineWidth = 1.2;

    for (let xm = startX; xm <= endX + stepM * 0.001; xm += stepM) {
      const p = this.worldToCanvas(xm, 0);
      const x = Math.round(p.x) + 0.5;
      const isMajor = stepM === 1 && Math.abs(Math.round(xm) % 5) === 0;
      this.ctx.strokeStyle = isMajor ? GRID_MAJOR_COLOR : GRID_COLOR;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, h);
      this.ctx.stroke();
    }

    for (let ym = startY; ym <= endY + stepM * 0.001; ym += stepM) {
      const p = this.worldToCanvas(0, ym);
      const y = Math.round(p.y) + 0.5;
      const isMajor = stepM === 1 && Math.abs(Math.round(ym) % 5) === 0;
      this.ctx.strokeStyle = isMajor ? GRID_MAJOR_COLOR : GRID_COLOR;
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(w, y);
      this.ctx.stroke();
    }
    this.ctx.setLineDash([]);
  }

  _drawDiagonals() {
    const diags = triangulateFan(this.vertices);
    this.ctx.setLineDash([4, 4]);
    this.ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    this.ctx.lineWidth = 1.5;
    for (const d of diags) {
      const p1 = this.worldToCanvas(d.a.x, d.a.y);
      const p2 = this.worldToCanvas(d.b.x, d.b.y);
      const isSelected = this._selectedDiagonal
        && this._selectedDiagonal.aIdx === d.aIdx
        && this._selectedDiagonal.bIdx === d.bIdx;
      if (isSelected) {
        this.ctx.strokeStyle = '#e67e22';
        this.ctx.lineWidth = 2;
      } else {
        this.ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        this.ctx.lineWidth = 1;
      }
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();
    }
    this.ctx.setLineDash([]);
  }

  _isTooCloseToExisting(x, y, skipIdx = -1) {
    return this.vertices.some((v, i) => {
      if (i === skipIdx) return false;
      return Math.hypot(v.x - x, v.y - y) < MIN_VERTEX_DIST;
    });
  }
}

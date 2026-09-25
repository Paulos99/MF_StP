import {
  DRAW_GRID_STEP,
  FINE_GRID_STEP,
  FINE_ZOOM_ENTER_VEL,
  METER_MAGNET_M,
  cloneVertices,
  createCutCornerVertices,
  createLShapeVertices,
  createMirrorLShapeVertices,
  createPlusShapeVertices,
  createTShapeVertices,
  createUShapeVertices,
  createZShapeVertices,
  formatMetersDisplay,
  getBounds,
  getEdges,
  labelForIndex,
  shoelaceArea,
  getPerimeter,
  resolveAdaptiveDrawStep,
  shouldFineZoom,
  snapPoint,
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
const LONG_PRESS_MS = 500;
const TOUCH_PAN_THRESHOLD = 12;
const MIN_VERTEX_DIST = 0.5;
const PREVIEW_LERP = 0.22;
const SNAP_PULSE_MS = 140;
const LABEL_PULSE_MS = 160;
const FINE_TICK_FADE_MS = 180;
const FINE_TICK_RADIUS_M = 0.75;
const FINE_ZOOM_FACTOR = 1.5;
const FINE_ZOOM_IN_MS = 1040;
const FINE_ZOOM_OUT_MS = 640;
const FINE_ZOOM_OUT_FAST_MS = 280;
const PANEL_SETTLE_MS = 2500;
const PANEL_REVEAL_MS = 400;

export class SketchEditor {
  constructor(hostEl, {
    onApply,
    onClose,
    onRoomChange,
    onGeometryEdit,
    onGeometrySettle,
    onMobileStepDone,
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
    this.onMobileStepDone = onMobileStepDone;
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
    this._snapStep = DRAW_GRID_STEP;
    this._snapVelocity = 0;
    this._snapLastSample = null;
    this._snapPointerType = 'mouse';
    this._snapPulseUntil = 0;
    this._snapPulseFrom = 1;
    this._labelAnimUntil = 0;
    this._labelAnimValue = null;
    this._fineTicksAlpha = 0;
    this._previewTarget = null;
    this._zoomSlowDwellMs = 0;
    this._zoomWanted = false;
    this._zoomBeforeFine = null;
    this._fineZoomMul = 1;
    this._fineZoomTarget = 1;
    this._zoomAnchorWorld = null;
    this._zoomAnimRaf = null;
    this._zoomAnimFast = false;
    this._zoomAnimFromMul = 1;
    this._zoomAnimToMul = 1;
    this._zoomAnimStart = 0;
    this._zoomAnimDuration = FINE_ZOOM_IN_MS;
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
    this._touchMode = null; // 'pan' | 'pinch' | 'pendingPan' | 'pendingDraw' | 'draw' | null
    this._touchHits = false;
    this._drawStroke = null; // { fromScreen, anchorWorld } while rubber-banding a wall
    this._drawFollowZoom = null; // base zoom before length-follow (restored on place)
    this._resizeObserver = null;

    this.bgImage = null;
    this._bgObjectUrl = null;
    this.bgTransform = { cx: 4, cy: 3, widthM: 10, opacity: 0.45 };
    this._bgBaseWidthM = 10;
    this.bgAdjustMode = false;
    this._bgDragging = false;
    this._bgDragStart = null;
    this._bgCalibrate = null; // null | { a: {x,y}|null, b: {x,y}|null }
    this._bgScaleLocked = false;
    this.bgUploadInput = this._q('#sketchBgUploadInput');
    this.bgAdjustBtn = this._q('#sketchBgAdjustBtn');
    this.bgPanel = this._q('#sketchBgPanel');
    this.bgOpacityInput = this._q('#sketchBgOpacity');
    this.bgScaleInput = this._q('#sketchBgScale');
    this.bgWidthInput = this._q('#sketchBgWidthM');
    this.bgHintEl = this._q('#sketchBgHint');
    this.bgCalibBtn = this._q('#sketchBgCalibBtn');
    this.bgCalibRow = this._q('#sketchBgCalibRow');
    this.bgCalibLengthInput = this._q('#sketchBgCalibLength');
    this.bgCalibApplyBtn = this._q('#sketchBgCalibApply');
    this.bgCalibCancelBtn = this._q('#sketchBgCalibCancel');
    this.bgScaleRow = this._q('#sketchBgScaleRow');
    this.bgWidthRow = this._q('#sketchBgWidthRow');
    this.bgLockedBadge = this._q('#sketchBgLockedBadge');

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
    const exitMobileStepOrClose = (save) => {
      if (this.inline && this.isMobileStep()) {
        if (save && this._canSave()) this._emitApply();
        this.setMobileSketchStep(false);
        this.onMobileStepDone?.({ saved: !!save });
        return;
      }
      this.close(!!save);
    };
    this._q('#sketchDoneBtn')?.addEventListener('click', () => exitMobileStepOrClose(true));
    this._q('#sketchMobileDoneBtn')?.addEventListener('click', () => exitMobileStepOrClose(true));
    this._q('#sketchMobileBackBtn')?.addEventListener('click', () => exitMobileStepOrClose(true));
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
    this.bgCalibBtn?.addEventListener('click', () => this._startBgCalibration());
    this.bgCalibApplyBtn?.addEventListener('click', () => this._applyBgCalibrationLength());
    this.bgCalibCancelBtn?.addEventListener('click', () => this._cancelBgCalibration());
    this.bgCalibLengthInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._applyBgCalibrationLength();
      }
    });
    this.bgOpacityInput?.addEventListener('input', () => {
      if (!this.bgImage) return;
      this.bgTransform.opacity = (parseInt(this.bgOpacityInput.value, 10) || 45) / 100;
      this.render();
    });
    this.bgScaleInput?.addEventListener('input', () => {
      if (!this.bgImage || this._bgScaleLocked) {
        this._syncBgScaleSlider();
        return;
      }
      const pct = parseInt(this.bgScaleInput.value, 10) || 100;
      this.bgTransform.widthM = this._bgBaseWidthM * (pct / 100);
      this._syncBgWidthInput();
      this.render();
    });
    this.bgWidthInput?.addEventListener('change', () => this._applyBgWidthInput());
    this.bgWidthInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._applyBgWidthInput();
      }
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

    this.canvas.addEventListener('mousedown', (e) => {
      this._touchHits = false;
      this._onPointerDown(e);
    });
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
      if (e.key === 'Escape') {
        if (this._bgCalibrate) {
          this._cancelBgCalibration();
          e.preventDefault();
          return;
        }
        if (this.bgAdjustMode && this.bgImage) {
          if (!this._bgScaleLocked) {
            this.showToast('Сначала откалибруйте масштаб по размеру стены');
            if (!this._bgCalibrate) this._startBgCalibration();
            e.preventDefault();
            return;
          }
          this._setBgAdjustMode(false);
          this.showToast('План зафиксирован — чертите контур');
          e.preventDefault();
          return;
        }
        if (this.host?.classList.contains('is-fullscreen')) {
          if (this.isMobileStep()) {
            this.setMobileSketchStep(false);
            this.onMobileStepDone?.({ saved: false });
          } else {
            this.setFullscreen(false);
          }
          e.preventDefault();
          return;
        }
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
    // Inline UX: высота задаётся в сайдбаре — попап не дублируем
    if (this.inline) {
      this._confirmWallHeightFromSidebar();
      return;
    }
    if (!this.wallHeightModal) return;
    if (this.wallHeightPopup) this.wallHeightPopup.value = String(this.wallHeightValue);
    this.wallHeightModal.hidden = false;
    requestAnimationFrame(() => this.wallHeightModal.classList.add('is-open'));
  }

  _confirmWallHeightFromSidebar() {
    const fromSidebar = parseFloat(document.getElementById('drawHeight')?.value);
    const wh = (fromSidebar > 0 ? fromSidebar : Number(this.wallHeightValue)) || 2.7;
    this.wallHeightValue = wh;
    this._wallHeightConfirmed = true;
    if (this.room) this.room.wallHeight = wh;
    this.onRoomChange?.(this._roomChangePayload());
    this.render();
    this._updateUi();
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
    // Сразу пересчитать стены с проёмами — иначе схема на вкладке «Стены» остаётся старой
    // (особенно в dims, где onRoomChange раньше не доходил до auto-recalc).
    this.onGeometrySettle?.({ reason: 'openings-done' });
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
    this._previewSmooth = null;
    this._drawHistorySaved = false;
    this._resetAdaptiveSnap();
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
    // Колёсико всегда зумит камеру (вид), никогда не меняет масштаб подложки —
    // иначе после калибровки «отдаление» случайно ломает размер комнаты.
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    if (this._zoomBeforeFine != null) {
      const wx = (cx - this.panX) / (PX_PER_M * this.zoom);
      const wy = (cy - this.panY) / (PX_PER_M * this.zoom);
      this._zoomBeforeFine = Math.max(
        MIN_ZOOM / FINE_ZOOM_FACTOR,
        Math.min(MAX_ZOOM / FINE_ZOOM_FACTOR, this._zoomBeforeFine * factor)
      );
      this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this._zoomBeforeFine * this._fineZoomMul));
      this.panX = cx - wx * PX_PER_M * this.zoom;
      this.panY = cy - wy * PX_PER_M * this.zoom;
      this.render();
      return;
    }
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
    if (this._zoomAnimRaf) {
      cancelAnimationFrame(this._zoomAnimRaf);
      this._zoomAnimRaf = null;
    }
    this._zoomBeforeFine = null;
    this._fineZoomMul = 1;
    this._fineZoomTarget = 1;
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

  /** Screen (client) coords for a world point — for demo cursor. */
  worldToClient(wx, wy) {
    const c = this.worldToCanvas(wx, wy);
    const rect = this.canvas.getBoundingClientRect();
    const { w, h } = this._getCanvasSize();
    const scaleX = w > 0 ? rect.width / w : 1;
    const scaleY = h > 0 ? rect.height / h : 1;
    return {
      x: rect.left + c.x * scaleX,
      y: rect.top + c.y * scaleY,
    };
  }

  /** Simulate a draw tap at world meters (used by onboarding demo). */
  demoTapWorld(wx, wy) {
    if (!this.canvas || this.geometryLocked) return;
    this._suppressDrawTutorial = true;
    try {
      const client = this.worldToClient(wx, wy);
      this._onPointerDown({ clientX: client.x, clientY: client.y, button: 0 });
      this._onPointerUp({ clientX: client.x, clientY: client.y, button: 0 });
    } finally {
      this._suppressDrawTutorial = false;
    }
  }

  /** Prepare empty canvas framed for a demo room. */
  prepareDemoDrawView(bounds = { minX: -0.5, minY: -0.5, maxX: 6.5, maxY: 5.5 }) {
    if (this.closed || this.vertices.length) this.clear();
    this.geometryLocked = false;
    this.host?.classList.remove('sketch-geometry-locked');
    const { w, h } = this._getCanvasSize();
    const pad = 0.8;
    const contentW = bounds.maxX - bounds.minX + pad * 2;
    const contentH = bounds.maxY - bounds.minY + pad * 2;
    const sx = w / (contentW * PX_PER_M);
    const sy = h / (contentH * PX_PER_M);
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(sx, sy) * 0.9));
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    this.panX = w / 2 - cx * PX_PER_M * this.zoom;
    this.panY = h / 2 - cy * PX_PER_M * this.zoom;
    this.render();
  }

  isFullscreen() {
    return !!this.host?.classList.contains('is-fullscreen');
  }

  isMobileStep() {
    return !!this.host?.classList.contains('is-mobile-step');
  }

  /**
   * @param {boolean} on
   * @param {{ mobileStep?: boolean }} [opts]
   */
  setFullscreen(on, { mobileStep = false } = {}) {
    const host = this.host;
    if (!host) return;
    const next = !!on;
    const was = host.classList.contains('is-fullscreen');
    host.classList.toggle('is-fullscreen', next);
    // Mobile dedicated sketch step: chrome above/below canvas + Готово
    const useMobileStep = next && !!mobileStep;
    host.classList.toggle('is-mobile-step', useMobileStep);
    if (!next) host.classList.remove('is-mobile-step');
    document.body.classList.toggle('sketch-fullscreen-open', next);
    document.body.classList.toggle('sketch-mobile-step-open', useMobileStep);

    const stepBar = this._q('#sketchMobileStepBar');
    if (stepBar) stepBar.hidden = !useMobileStep;
    const doneBtn = this._q('#sketchDoneBtn');
    if (doneBtn) doneBtn.hidden = !useMobileStep;
    const editBtn = this._q('#sketchMobileEditBtn');
    // Show «Изменить схему» on mobile summary (draw mode, not fullscreen)
    if (editBtn) {
      const showEdit = !next && host.classList.contains('is-mobile-summary');
      editBtn.hidden = !showEdit;
    }
    const stub = this._q('#sketchMobileSummaryStub');
    if (stub) {
      const showStub = !next && host.classList.contains('is-mobile-summary');
      stub.hidden = !showStub;
    }

    const btn = this._q('#sketchFitBtn');
    if (btn) {
      btn.title = next ? 'Свернуть' : 'На весь экран';
      btn.setAttribute('aria-label', btn.title);
      btn.classList.toggle('is-active', next);
    }
    if (was !== next || useMobileStep) {
      requestAnimationFrame(() => {
        this.render();
        this.fitToScreen();
      });
    }
  }

  toggleFullscreen() {
    this.setFullscreen(!this.isFullscreen(), { mobileStep: false });
  }

  /** Enter / leave the phone fullscreen sketch step. */
  setMobileSketchStep(on) {
    if (on) this.setFullscreen(true, { mobileStep: true });
    else this.setFullscreen(false, { mobileStep: false });
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

  _isCoarsePointer() {
    return this._touchHits
      || window.matchMedia?.('(pointer: coarse)')?.matches
      || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
  }

  _vertexHitRadius() {
    const coarse = this._isCoarsePointer();
    const phone = window.matchMedia?.('(max-width: 899px)')?.matches;
    const min = coarse || phone ? 32 : 22;
    const scale = coarse || phone ? 18 : 14;
    const boost = coarse || phone ? 8 : 0;
    return Math.max(min, scale * Math.sqrt(this.zoom)) + boost;
  }

  _edgeHitThreshold() {
    const coarse = this._isCoarsePointer();
    const phone = window.matchMedia?.('(max-width: 899px)')?.matches;
    const min = coarse || phone ? 26 : 16;
    const scale = coarse || phone ? 16 : 12;
    const boost = coarse || phone ? 6 : 0;
    return Math.max(min, scale * this.zoom) + boost;
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
      const edgeThresh = this._edgeHitThreshold();
      const edge = this._hitEdge(cx, cy, edgeThresh);
      if (edge !== null) return { type: 'edge', index: edge };
      const diag = this._hitDiagonal(cx, cy, edgeThresh);
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
    this._drawStroke = null;
    this._cancelLongPress(false);
    this._dragIdx = null;
  }

  /** Can rubber-band draw with one finger (open contour, ≥1 vertex). */
  _canTouchDrawStroke() {
    return !this.closed
      && this.vertices.length > 0
      && !this.openingsModalOpen
      && !this.bgAdjustMode
      && !this.geometryLocked;
  }

  /**
   * Auto zoom/pan while drawing a wall: short walls → zoom in for 5 cm;
   * long walls (tens of meters) → zoom out so the whole segment + finger stay in view.
   * Zoom pivots around the last vertex so the rubber-band end stays under the finger.
   */
  _updateDrawFollowCamera(fromWorld, fingerCx, fingerCy) {
    if (!fromWorld) return;
    const { w, h } = this._getCanvasSize();
    if (w < 8 || h < 8) return;

    // World under finger with current camera
    const tip = this.canvasToWorld(fingerCx, fingerCy);
    const len = Math.hypot(tip.x - fromWorld.x, tip.y - fromWorld.y);

    // Fit the segment with padding; floor for very short strokes
    const span = Math.max(len, 0.35);
    const padM = Math.max(0.45, span * 0.22);
    const fitZoom = Math.min(
      (w * 0.82) / ((span + padM * 2) * PX_PER_M),
      (h * 0.78) / ((span + padM * 2) * PX_PER_M)
    );

    // Short wall: keep ~5 cm readable (≥10 CSS-px on the canvas buffer scale≈1)
    let precisionZoom = fitZoom;
    if (len < 4.5) {
      const pxPer5cm = 11;
      precisionZoom = pxPer5cm / (FINE_GRID_STEP * PX_PER_M);
    }

    // Blend: as length grows, favour fit; when short, favour precision
    const t = Math.min(1, Math.max(0, (len - 1.2) / 8));
    let desired = precisionZoom * (1 - t) + fitZoom * t;
    // Extreme lengths (50–80 m): fit dominates
    if (len > 20) desired = fitZoom;
    // Allow deeper zoom-out / zoom-in while rubber-banding than normal pan limits
    const drawMin = 0.06;
    const drawMax = 6;
    desired = Math.max(drawMin, Math.min(drawMax, desired));

    // Smooth toward target so zoom doesn't jump every frame
    const prev = this.zoom;
    const next = prev + (desired - prev) * 0.28;
    if (Math.abs(next - prev) < 0.0008 && len > 0.05) {
      // Still re-anchor tip under finger if pan drifted
    } else {
      this._setZoomAroundWorld(fromWorld, next);
    }

    // Keep rubber-band tip under the finger after zoom
    const after = this.worldToCanvas(tip.x, tip.y);
    this.panX += fingerCx - after.x;
    this.panY += fingerCy - after.y;

    // Ensure start vertex stays on-screen with a margin
    const start = this.worldToCanvas(fromWorld.x, fromWorld.y);
    const margin = 36;
    let shiftX = 0;
    let shiftY = 0;
    if (start.x < margin) shiftX = margin - start.x;
    else if (start.x > w - margin) shiftX = (w - margin) - start.x;
    if (start.y < margin) shiftY = margin - start.y;
    else if (start.y > h - margin) shiftY = (h - margin) - start.y;
    if (shiftX || shiftY) {
      this.panX += shiftX;
      this.panY += shiftY;
    }
  }

  _updateTouchDrawPreview(clientX, clientY) {
    const { cx, cy } = this._clientToCanvas(clientX, clientY);
    const from = this.vertices[this.vertices.length - 1];
    if (!from) return;

    this._updateDrawFollowCamera(from, cx, cy);

    const w = this.canvasToWorld(cx, cy);
    this._updateAdaptiveSnap(w.x, w.y, {
      isTouch: true,
      fromPoint: from,
      anchorCanvas: { cx, cy },
      allowZoom: false, // length-follow camera owns zoom on touch draw
      forceMeterSnap: false,
    });
    const step = this._snapStep;
    const snapped = snapPointDraw(w.x, w.y, from, step);
    if (!this._previewSmooth) this._previewSmooth = { ...snapped };
    this._previewSmooth.x += (snapped.x - this._previewSmooth.x) * PREVIEW_LERP;
    this._previewSmooth.y += (snapped.y - this._previewSmooth.y) * PREVIEW_LERP;
    this._previewPoint = { ...this._previewSmooth };
    this._previewTarget = snapped;
    this._notePreviewLength(snapped);
    this._ensurePreviewSettleAnim();
    this._scheduleRender();
  }

  _placeVertexAtClient(clientX, clientY) {
    const { cx, cy } = this._clientToCanvas(clientX, clientY);
    if (!this.closed && this._tryCloseContour(cx, cy)) return true;
    this._onPointerDown({ clientX, clientY, button: 0 });
    this._onPointerUp({ clientX, clientY, button: 0 });
    return true;
  }

  _onTouchStart(e) {
    e.preventDefault();
    this._touchHits = true;
    if (e.touches.length >= 2) {
      this._touchPanCandidate = null;
      this._drawStroke = null;
      this._beginPinch(e);
      return;
    }
    if (this._touchMode === 'pinch') return;

    const t = e.touches[0];
    const { cx, cy } = this._clientToCanvas(t.clientX, t.clientY);
    const target = this._pickTarget(cx, cy);

    // One-finger pan on empty space when contour is closed
    if (this.closed && !target && !this.openingsModalOpen && !this.bgAdjustMode) {
      this._touchMode = 'pan';
      this._panning = true;
      this._panStart = { x: t.clientX, y: t.clientY, panX: this.panX, panY: this.panY };
      this._touchPanCandidate = null;
      this._drawStroke = null;
      this._selectedEdge = null;
      this._selectedDiagonal = null;
      this.keypad.hide();
      this._hideEdgeActions();
      this.render();
      return;
    }

    // Before first point: short tap places; drag pans / pinch zooms
    if (
      !this.closed
      && this.vertices.length === 0
      && !target
      && !this.openingsModalOpen
      && !this.bgAdjustMode
      && !this.geometryLocked
    ) {
      this._touchMode = 'pendingPan';
      this._touchPanCandidate = {
        x: t.clientX,
        y: t.clientY,
        panX: this.panX,
        panY: this.panY,
        cx,
        cy,
      };
      return;
    }

    // After first point: drag draws the wall (line follows finger); tap places
    if (this._canTouchDrawStroke() && !target) {
      this._touchMode = 'pendingDraw';
      this._touchPanCandidate = {
        x: t.clientX,
        y: t.clientY,
        panX: this.panX,
        panY: this.panY,
        cx,
        cy,
      };
      this._drawStroke = {
        startX: t.clientX,
        startY: t.clientY,
        anchor: { ...this.vertices[this.vertices.length - 1] },
      };
      return;
    }

    this._touchMode = null;
    this._touchPanCandidate = null;
    this._drawStroke = null;
    this._onPointerDown({ clientX: t.clientX, clientY: t.clientY, button: 0 });
  }

  _onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length >= 2) {
      this._touchPanCandidate = null;
      this._drawStroke = null;
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

    // Pending draw → commit to rubber-band once past threshold
    if (this._touchMode === 'pendingDraw' && this._touchPanCandidate) {
      const cand = this._touchPanCandidate;
      const dist = Math.hypot(t.clientX - cand.x, t.clientY - cand.y);
      if (dist >= TOUCH_PAN_THRESHOLD) {
        this._touchMode = 'draw';
        this._touchPanCandidate = null;
        this._panning = false;
        if (this._drawFollowZoom == null) this._drawFollowZoom = this.zoom;
        this._updateTouchDrawPreview(t.clientX, t.clientY);
        return;
      }
      return;
    }

    if (this._touchMode === 'draw') {
      this._updateTouchDrawPreview(t.clientX, t.clientY);
      return;
    }

    if (this._touchMode === 'pendingPan' && this._touchPanCandidate) {
      const cand = this._touchPanCandidate;
      const dist = Math.hypot(t.clientX - cand.x, t.clientY - cand.y);
      if (dist >= TOUCH_PAN_THRESHOLD) {
        this._touchMode = 'pan';
        this._panning = true;
        this._panStart = { x: cand.x, y: cand.y, panX: cand.panX, panY: cand.panY };
        this._touchPanCandidate = null;
        this._previewPoint = null;
      } else {
        return;
      }
    }

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
      this._touchPanCandidate = null;
      this._drawStroke = null;
      return;
    }

    // Tap (no drag) while drawing → place vertex at touch
    if (e.touches.length === 0 && this._touchMode === 'pendingDraw' && this._touchPanCandidate) {
      const cand = this._touchPanCandidate;
      this._touchPanCandidate = null;
      this._touchMode = null;
      this._drawStroke = null;
      this._placeVertexAtClient(cand.x, cand.y);
      return;
    }

    // Rubber-band release → place at snapped preview / finger
    if (e.touches.length === 0 && this._touchMode === 'draw') {
      const changed = e.changedTouches?.[0];
      const x = changed?.clientX ?? this._drawStroke?.startX;
      const y = changed?.clientY ?? this._drawStroke?.startY;
      this._touchMode = null;
      this._drawStroke = null;
      this._touchPanCandidate = null;
      if (x != null && y != null) {
        // Prefer snapped preview tip if available
        if (this._previewTarget) {
          const client = this.worldToClient(this._previewTarget.x, this._previewTarget.y);
          this._placeVertexAtClient(client.x, client.y);
        } else {
          this._placeVertexAtClient(x, y);
        }
      }
      this._drawFollowZoom = null;
      return;
    }

    // Tap (no drag) on empty space before first point → place vertex
    if (e.touches.length === 0 && this._touchMode === 'pendingPan' && this._touchPanCandidate) {
      const cand = this._touchPanCandidate;
      this._touchPanCandidate = null;
      this._touchMode = null;
      this._onPointerDown({ clientX: cand.x, clientY: cand.y, button: 0 });
      this._onPointerUp({ clientX: cand.x, clientY: cand.y, button: 0 });
      return;
    }

    this._pinch = null;
    this._touchPanCandidate = null;
    this._drawStroke = null;
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

    if (this._bgCalibrate) {
      const w = this.canvasToWorld(cx, cy);
      this._onBgCalibrateClick(w.x, w.y);
      return;
    }

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
      const from = this.vertices[this.vertices.length - 1] ?? null;
      const isFirstPoint = !from;
      let snapped;
      if (isFirstPoint) {
        // Первая точка — всегда к ближайшему перекрестию 1 м
        this._snapStep = DRAW_GRID_STEP;
        snapped = snapPoint(w.x, w.y, DRAW_GRID_STEP);
      } else {
        const step = resolveAdaptiveDrawStep({
          x: w.x,
          y: w.y,
          fromPoint: from,
          magnetM: METER_MAGNET_M,
          currentStep: this._snapStep,
        });
        this._snapStep = step;
        snapped = snapPointDraw(w.x, w.y, from, step);
      }
      if (this._isTooCloseToExisting(snapped.x, snapped.y)) return;
      if (!this._drawHistorySaved) {
        this._pushHistory();
        this._drawHistorySaved = true;
      }
      this.vertices.push({ x: snapped.x, y: snapped.y, label: labelForIndex(this.vertices.length) });
      this._previewPoint = null;
      this._previewSmooth = null;
      this._previewTarget = null;
      this._exitFineZoomAfterPlace(snapped);
      this.render();
      if (isFirstPoint) this._maybeStartDrawTutorial();
    }
  }

  _maybeStartDrawTutorial() {
    if (this._suppressDrawTutorial) return;
    if (this.onboarding?.active) return;
    if (!this.onboarding?.shouldAutoStart?.()) return;
    // Небольшой delay, чтобы клик успел завершиться до оверлея
    window.setTimeout(() => {
      if (this._suppressDrawTutorial) return;
      if (this.closed || this.vertices.length < 1) return;
      this.onboarding?.start(false);
    }, 80);
  }

  _closeContour() {
    if (this.vertices.length < 3) return;
    this._pushHistory();
    this.closed = true;
    this._previewPoint = null;
    this._previewSmooth = null;
    this._drawHistorySaved = false;
    this._resetAdaptiveSnap();
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
    const isTouch = e.pointerType === 'touch' || this._isCoarsePointer();
    const drawing = !this.closed;
    const from = (drawing && this.vertices.length > 0)
      ? this.vertices[this.vertices.length - 1]
      : null;
    // Автозум только пока рисуем контур (не на первой точке и не после замыкания)
    this._updateAdaptiveSnap(w.x, w.y, {
      isTouch,
      fromPoint: from,
      anchorCanvas: { cx, cy },
      allowZoom: drawing && this.vertices.length > 0,
      forceMeterSnap: drawing && this.vertices.length === 0,
    });
    const step = this._snapStep;

    if (this._dragIdx !== null && this.closed) {
      this._cancelLongPress(false);
      const snapped = snapPointEdit(w.x, w.y, step);
      this.vertices[this._dragIdx] = { ...this.vertices[this._dragIdx], x: snapped.x, y: snapped.y };
      this._ensurePreviewSettleAnim();
      this._scheduleRender();
      return;
    }

    if (drawing && this.vertices.length === 0) {
      const snapped = snapPoint(w.x, w.y, DRAW_GRID_STEP);
      this._previewPoint = snapped;
      this._previewTarget = snapped;
      this._previewSmooth = snapped;
      this._scheduleRender();
    } else if (drawing && this.vertices.length > 0) {
      const snapped = snapPointDraw(w.x, w.y, from, step);
      if (!this._previewSmooth) this._previewSmooth = { ...snapped };
      this._previewSmooth.x += (snapped.x - this._previewSmooth.x) * PREVIEW_LERP;
      this._previewSmooth.y += (snapped.y - this._previewSmooth.y) * PREVIEW_LERP;
      this._previewPoint = { ...this._previewSmooth };
      this._previewTarget = snapped;
      this._notePreviewLength(snapped);
      this._ensurePreviewSettleAnim();
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

  _updateAdaptiveSnap(worldX, worldY, {
    isTouch = false,
    fromPoint = null,
    anchorCanvas = null,
    allowZoom = true,
    forceMeterSnap = false,
  } = {}) {
    const now = performance.now();
    this._snapPointerType = isTouch ? 'touch' : 'mouse';
    const prev = this._snapLastSample;
    if (prev && now > prev.t) {
      const dt = (now - prev.t) / 1000;
      const dist = Math.hypot(worldX - prev.x, worldY - prev.y);
      const instant = dist / Math.max(dt, 1e-4);
      this._snapVelocity = this._snapVelocity * 0.55 + instant * 0.45;
      const enterVel = isTouch ? FINE_ZOOM_ENTER_VEL * 0.75 : FINE_ZOOM_ENTER_VEL;
      if (this._snapVelocity <= enterVel) {
        this._zoomSlowDwellMs += now - prev.t;
      } else {
        this._zoomSlowDwellMs = 0;
      }
    } else {
      this._snapVelocity = 0;
      this._zoomSlowDwellMs = 0;
    }
    this._snapLastSample = { x: worldX, y: worldY, t: now };

    if (forceMeterSnap) {
      this._snapStep = DRAW_GRID_STEP;
      this._updateSnapLegend();
      if (this._zoomWanted || this._fineZoomTarget > 1.01 || this._fineZoomMul > 1.01) {
        this._zoomWanted = false;
        this._leaveFineZoom(false);
      }
      return;
    }

    const magnet = isTouch ? METER_MAGNET_M * 1.25 : METER_MAGNET_M;
    const next = resolveAdaptiveDrawStep({
      x: worldX,
      y: worldY,
      fromPoint,
      magnetM: magnet,
      currentStep: this._snapStep,
    });

    if (next !== this._snapStep) {
      this._snapStep = next;
      this._snapPulseFrom = next <= FINE_GRID_STEP ? 1.35 : 0.75;
      this._snapPulseUntil = now + SNAP_PULSE_MS;
      this._updateSnapLegend();
    }

    if (!allowZoom) {
      if (this._zoomWanted || this._fineZoomTarget > 1.01 || this._fineZoomMul > 1.01) {
        this._zoomWanted = false;
        this._leaveFineZoom(false);
      }
      return;
    }

    const inFineSnap = next <= FINE_GRID_STEP;
    const zoomWanted = shouldFineZoom({
      inFineSnap,
      velocity: this._snapVelocity,
      dwellMs: this._zoomSlowDwellMs,
      zoomActive: this._zoomWanted || this._fineZoomMul > 1.02,
    });

    if (zoomWanted) {
      this._zoomWanted = true;
      this._enterFineZoom({ x: worldX, y: worldY }, anchorCanvas);
    } else if (this._zoomWanted || this._fineZoomTarget > 1.01 || this._fineZoomMul > 1.01) {
      this._zoomWanted = false;
      this._leaveFineZoom(false);
    }
  }

  _setZoomAroundWorld(anchorWorld, newZoom) {
    if (!anchorWorld) {
      this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
      return;
    }
    const before = this.worldToCanvas(anchorWorld.x, anchorWorld.y);
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    const after = this.worldToCanvas(anchorWorld.x, anchorWorld.y);
    this.panX += before.x - after.x;
    this.panY += before.y - after.y;
  }

  _easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
  }

  _startZoomTransition(toMul, durationMs) {
    if (this._zoomBeforeFine == null) return;
    // Уже едем к этой цели — не перезапускаем анимацию каждый mousemove
    if (Math.abs(this._fineZoomTarget - toMul) < 0.004 && this._zoomAnimRaf) return;
    const from = this._fineZoomMul;
    if (Math.abs(from - toMul) < 0.004) {
      this._fineZoomMul = toMul;
      this._fineZoomTarget = toMul;
      return;
    }
    this._zoomAnimFromMul = from;
    this._zoomAnimToMul = toMul;
    this._fineZoomTarget = toMul;
    this._zoomAnimStart = performance.now();
    this._zoomAnimDuration = durationMs;
    this._ensureFineZoomAnim();
  }

  _enterFineZoom(anchorWorld, anchorCanvas) {
    if (this._zoomBeforeFine == null) {
      const mul = Math.max(this._fineZoomMul, 1);
      this._zoomBeforeFine = this.zoom / mul;
      this._fineZoomMul = this.zoom / this._zoomBeforeFine;
      if (anchorWorld) this._zoomAnchorWorld = { ...anchorWorld };
      else if (anchorCanvas) {
        this._zoomAnchorWorld = this.canvasToWorld(anchorCanvas.cx, anchorCanvas.cy);
      }
    }
    this._zoomAnimFast = false;
    this._startZoomTransition(FINE_ZOOM_FACTOR, FINE_ZOOM_IN_MS);
  }

  _leaveFineZoom(fast) {
    this._zoomWanted = false;
    this._zoomAnimFast = !!fast;
    if (this._zoomBeforeFine == null) {
      this._fineZoomMul = 1;
      this._fineZoomTarget = 1;
      return;
    }
    this._startZoomTransition(1, fast ? FINE_ZOOM_OUT_FAST_MS : FINE_ZOOM_OUT_MS);
  }

  _exitFineZoomAfterPlace(anchorWorld) {
    this._snapStep = DRAW_GRID_STEP;
    this._snapLastSample = null;
    this._snapVelocity = 0;
    this._zoomSlowDwellMs = 0;
    this._fineTicksAlpha = 0;
    this._zoomWanted = false;
    if (anchorWorld) this._zoomAnchorWorld = { ...anchorWorld };
    this._updateSnapLegend();
    this._leaveFineZoom(true);
  }

  _ensureFineZoomAnim() {
    if (this._zoomAnimRaf) return;
    const tick = (now) => {
      this._zoomAnimRaf = null;
      if (this._zoomBeforeFine == null) {
        this._fineZoomMul = 1;
        this._fineZoomTarget = 1;
        return;
      }
      const elapsed = now - this._zoomAnimStart;
      const t = Math.min(1, elapsed / Math.max(16, this._zoomAnimDuration));
      const eased = this._easeInOutCubic(t);
      this._fineZoomMul = this._zoomAnimFromMul
        + (this._zoomAnimToMul - this._zoomAnimFromMul) * eased;
      const targetZoom = this._zoomBeforeFine * this._fineZoomMul;
      this._setZoomAroundWorld(this._zoomAnchorWorld, targetZoom);
      this._scheduleRender();
      if (t < 1) {
        this._zoomAnimRaf = requestAnimationFrame(tick);
      } else {
        this._fineZoomMul = this._zoomAnimToMul;
        this._fineZoomTarget = this._zoomAnimToMul;
        if (this._fineZoomTarget <= 1.001) {
          this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this._zoomBeforeFine));
          this._zoomBeforeFine = null;
          this._fineZoomMul = 1;
          this._zoomAnimFast = false;
        }
      }
    };
    this._zoomAnimRaf = requestAnimationFrame(tick);
  }

  _notePreviewLength(snapped) {
    if (!this.vertices.length) return;
    const last = this.vertices[this.vertices.length - 1];
    const len = Math.hypot(snapped.x - last.x, snapped.y - last.y);
    const rounded = Math.round(len / FINE_GRID_STEP) * FINE_GRID_STEP;
    const key = rounded.toFixed(2);
    if (this._labelAnimValue !== key) {
      this._labelAnimValue = key;
      this._labelAnimUntil = performance.now() + LABEL_PULSE_MS;
    }
  }

  _ensurePreviewSettleAnim() {
    if (this._previewAnimRaf) return;
    const tick = () => {
      this._previewAnimRaf = null;
      let needs = false;
      const now = performance.now();
      if (this._previewSmooth && this._previewTarget) {
        const dx = this._previewTarget.x - this._previewSmooth.x;
        const dy = this._previewTarget.y - this._previewSmooth.y;
        if (Math.hypot(dx, dy) > 0.001) {
          this._previewSmooth.x += dx * PREVIEW_LERP;
          this._previewSmooth.y += dy * PREVIEW_LERP;
          this._previewPoint = { ...this._previewSmooth };
          needs = true;
        } else {
          this._previewSmooth = { ...this._previewTarget };
          this._previewPoint = { ...this._previewTarget };
        }
      }
      const targetAlpha = this._snapStep <= FINE_GRID_STEP ? 1 : 0;
      if (Math.abs(this._fineTicksAlpha - targetAlpha) > 0.01) {
        const dir = targetAlpha > this._fineTicksAlpha ? 1 : -1;
        this._fineTicksAlpha = Math.max(0, Math.min(1, this._fineTicksAlpha + dir * (16 / FINE_TICK_FADE_MS)));
        needs = true;
      } else {
        this._fineTicksAlpha = targetAlpha;
      }
      if (now < this._snapPulseUntil || now < this._labelAnimUntil) needs = true;
      if (needs) {
        this._scheduleRender();
        this._previewAnimRaf = requestAnimationFrame(tick);
      }
    };
    this._previewAnimRaf = requestAnimationFrame(tick);
  }

  _updateSnapLegend() {
    if (!this.gridLegendEl) return;
    this.gridLegendEl.textContent = this._snapStep <= FINE_GRID_STEP
      ? 'шаг 5 см'
      : '1 клетка = 1 м';
  }

  _resetAdaptiveSnap() {
    this._snapStep = DRAW_GRID_STEP;
    this._snapVelocity = 0;
    this._snapLastSample = null;
    this._zoomSlowDwellMs = 0;
    this._zoomWanted = false;
    this._fineTicksAlpha = 0;
    this._previewTarget = null;
    if (this._zoomAnimRaf) {
      cancelAnimationFrame(this._zoomAnimRaf);
      this._zoomAnimRaf = null;
    }
    if (this._zoomBeforeFine != null) {
      this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this._zoomBeforeFine));
      this._zoomBeforeFine = null;
    }
    this._fineZoomMul = 1;
    this._fineZoomTarget = 1;
    this._zoomAnchorWorld = null;
    this._zoomAnimFast = false;
    this._updateSnapLegend();
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
    this._snapLastSample = null;
    this._snapVelocity = 0;
    if (this.closed) {
      this._snapStep = DRAW_GRID_STEP;
      this._fineTicksAlpha = 0;
      this._updateSnapLegend();
      if (this._fineZoomMul > 1.01 || this._fineZoomTarget > 1.01) {
        this._leaveFineZoom(true);
      }
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

  _addOpening(type, { offset } = {}) {
    if (!this.room || !this.selectedWallId) return;
    const opening = createDefaultOpening(this.selectedWallId, type);
    const wall = this.room.walls.find((w) => w.id === this.selectedWallId);
    if (wall) {
      const max = Math.max(0, wall.length - opening.width);
      if (offset != null && Number.isFinite(offset)) {
        opening.offset = roundMeters(Math.max(0, Math.min(max, offset)));
      } else {
        opening.offset = roundMeters(Math.max(0, (wall.length - opening.width) / 2));
      }
    }
    this.room.addOpening(opening);
    this._selectOpening(opening.id);
    this.onRoomChange?.(this._roomChangePayload());
    this._refreshOpeningsPanel();
    requestAnimationFrame(() => {
      this.wallElevation?.focusOpening?.(opening.id);
    });
    this.render();
  }

  /** Demo helper: move selected (or last) opening to the left/right side of its wall. */
  _placeOpeningAside(side = 'left', openingId = null) {
    if (!this.room) return;
    const id = openingId || this.selectedOpeningId;
    const opening = this.room.getOpening(id) || this.room.openings.at(-1);
    if (!opening) return;
    const wall = this.room.walls.find((w) => w.id === opening.wallId);
    if (!wall) return;
    const margin = 0.7;
    const max = Math.max(0, wall.length - opening.width);
    opening.offset = roundMeters(
      side === 'right' ? Math.max(0, max - margin) : Math.min(max, margin),
    );
    this._selectOpening(opening.id);
    this.onRoomChange?.(this._roomChangePayload());
    this._syncOpeningProps(opening.id);
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
    const coarse = this._isCoarsePointer();
    const gap = coarse ? 8 : 6;
    const padX = coarse ? 14 : 10;
    const bh = coarse ? 44 : 32;
    this.ctx.font = coarse ? '600 13px system-ui' : '600 11px system-ui';
    const widths = labels.map((l) => Math.max(
      coarse ? 120 : 0,
      this.ctx.measureText(l.text).width + padX * 2
    ));
    const totalW = widths.reduce((s, w) => s + w, 0) + gap * (labels.length - 1);
    let bx = mx - totalW / 2;
    const by = my + 10;
    this._edgeActionRects = {};

    labels.forEach((l, idx) => {
      const bw = widths[idx];
      const disabled = l.disabled === true;
      this.ctx.fillStyle = disabled ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.98)';
      this.ctx.strokeStyle = disabled ? '#e0e0e0' : '#dce5e1';
      this.ctx.lineWidth = 1;
      this.ctx.shadowColor = 'rgba(0,0,0,0.12)';
      this.ctx.shadowBlur = 6;
      const r = 8;
      this.ctx.beginPath();
      if (typeof this.ctx.roundRect === 'function') {
        this.ctx.roundRect(bx, by, bw, bh, r);
      } else {
        this.ctx.rect(bx, by, bw, bh);
      }
      this.ctx.fill();
      this.ctx.stroke();
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
    const touchUi = this._isCoarsePointer() || window.matchMedia?.('(max-width: 899px)')?.matches;
    const fine = this._snapStep <= FINE_GRID_STEP;
    let hintText = touchUi
      ? (this.vertices.length === 0
        ? 'Тап — первая точка · двумя пальцами — масштаб'
        : (fine
          ? 'Тяните стену · шаг 5 см · масштаб сам подстроится'
          : 'Тяните палец — линия стены · отпустите, чтобы поставить'))
      : (fine ? 'Шаг 5 см · ведите медленно для зума' : 'Шаг 1 м у линий · между клетками — сразу 5 см');

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
        hintText = touchUi
          ? 'Тап по стороне → «Изменить размер»'
          : 'Задайте размеры — кликните по стороне, затем «Изменить размер»';
      } else if (this.geometryLocked) {
        hintText = touchUi
          ? 'Тап по стороне — проёмы · размеры слева'
          : 'Размеры задаются слева · клик по стороне — проёмы · вкладка «Стены»';
      } else {
        hintText = touchUi
          ? 'Тяните углы · pinch — масштаб'
          : 'Контур готов · тяните углы или «Настроить стены»';
      }
    } else if (!this.closed && this.vertices.length >= 3) {
      hintText = touchUi
        ? 'Тяните к красной точке или тапните её — замкнуть'
        : 'Замкните контур на красной точке';
    }

    if (this.hintTextEl) this.hintTextEl.textContent = hintText;
    if (this.bottomStatsEl) this.bottomStatsEl.textContent = bottomText;
    const summaryStats = this._q('#sketchMobileSummaryStats');
    const summaryTitle = this._q('#sketchMobileSummaryTitle');
    if (summaryStats) {
      const hasStats = !!bottomText && bottomText !== '—';
      summaryStats.textContent = hasStats
        ? bottomText
        : (this.closed ? 'Контур замкнут — можно уточнить параметры' : 'Нажмите «Изменить схему», чтобы нарисовать');
    }
    if (summaryTitle) {
      summaryTitle.textContent = (this.closed || (bottomText && bottomText !== '—'))
        ? 'Схема готова'
        : 'Схема монтажа';
    }
    if (this.zoomLabelEl) {
      const pct = Math.round(this.zoom * 100);
      this.zoomLabelEl.textContent = `${pct}%`;
    }
    if (this.emptyHintEl) {
      this.emptyHintEl.hidden = !(!this.vertices.length && !this.bgImage);
    }
    if (this.bgAdjustMode && this.bgImage && !this._bgCalibrate) {
      if (this.hintTextEl) {
        this.hintTextEl.textContent = this._bgScaleLocked
          ? 'Сдвиньте план · колёсико — вид · «Зафиксировать и чертить»'
          : 'Сначала калибровка по размеру стены';
      }
    } else if (this._bgCalibrate) {
      if (this.hintTextEl) {
        if (!this._bgCalibrate.a) this.hintTextEl.textContent = 'Калибровка: кликните первый конец стены';
        else if (!this._bgCalibrate.b) this.hintTextEl.textContent = 'Калибровка: кликните второй конец стены';
        else this.hintTextEl.textContent = 'Введите длину отрезка в панели слева';
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
    this._updateSnapLegend();
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
      this._cancelBgCalibration(false);
      this._bgScaleLocked = false;
      this.bgAdjustMode = true;
      if (this.bgOpacityInput) this.bgOpacityInput.value = '45';
      if (this.bgScaleInput) this.bgScaleInput.value = '100';
      this._syncBgWidthInput();
      this._updateBgUi();
      this._updateUi();
      this.render();
      this._startBgCalibration();
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
    this._bgScaleLocked = false;
    this._cancelBgCalibration(false);
    if (updateUi) {
      this._updateBgUi();
      this._updateUi();
      this.render();
    }
  }

  _setBgAdjustMode(on) {
    if (!this.bgImage && on) return;
    this.bgAdjustMode = !!on;
    if (!this.bgAdjustMode) this._bgDragging = false;
    this._updateBgUi();
    this._updateUi();
    this.render();
  }

  _toggleBgAdjustMode() {
    if (!this.bgImage) return;
    if (this._bgCalibrate) this._cancelBgCalibration(false);
    if (this.bgAdjustMode) {
      // Зафиксировать и чертить
      if (!this._bgScaleLocked) {
        this.showToast('Сначала откалибруйте масштаб по размеру стены');
        this._startBgCalibration();
        return;
      }
      this._setBgAdjustMode(false);
      this.showToast('План зафиксирован — чертите контур');
      return;
    }
    // Снова только сдвиг (масштаб уже зафиксирован)
    this._setBgAdjustMode(true);
    this.showToast(this._bgScaleLocked
      ? 'Только сдвиг плана — масштаб зафиксирован'
      : 'Сдвиньте план · масштаб меняйте только калибровкой');
  }

  _syncBgScaleSlider() {
    if (!this.bgScaleInput || !this._bgBaseWidthM) return;
    const pct = Math.round((this.bgTransform.widthM / this._bgBaseWidthM) * 100);
    this.bgScaleInput.value = String(Math.max(10, Math.min(400, pct)));
  }

  _syncBgWidthInput() {
    if (!this.bgWidthInput) return;
    this.bgWidthInput.value = String(Math.round(this.bgTransform.widthM * 100) / 100);
  }

  _applyBgWidthInput() {
    if (!this.bgImage || !this.bgWidthInput) return;
    if (this._bgScaleLocked) {
      this._syncBgWidthInput();
      this.showToast('Масштаб зафиксирован — перекалибруйте, чтобы изменить');
      return;
    }
    const raw = parseFloat(String(this.bgWidthInput.value).replace(',', '.'));
    if (!Number.isFinite(raw) || raw < 0.5) {
      this._syncBgWidthInput();
      return;
    }
    this.bgTransform.widthM = Math.min(200, raw);
    this._syncBgScaleSlider();
    this._syncBgWidthInput();
    this.render();
  }

  _startBgCalibration() {
    if (!this.bgImage) return;
    this.bgAdjustMode = true;
    // Перекалибровка снимает lock до успешного «Применить»
    this._bgScaleLocked = false;
    this._bgCalibrate = { a: null, b: null };
    if (this.bgCalibRow) this.bgCalibRow.hidden = true;
    if (this.bgCalibLengthInput) this.bgCalibLengthInput.value = '';
    this._updateBgUi();
    this._updateUi();
    this.render();
    this.showToast('Кликните первый конец стены с известным размером');
  }

  _cancelBgCalibration(update = true) {
    this._bgCalibrate = null;
    if (this.bgCalibRow) this.bgCalibRow.hidden = true;
    if (this.bgCalibLengthInput) this.bgCalibLengthInput.value = '';
    if (update) {
      this._updateBgUi();
      this._updateUi();
      this.render();
    }
  }

  _onBgCalibrateClick(x, y) {
    if (!this._bgCalibrate) return;
    if (!this._bgCalibrate.a) {
      this._bgCalibrate.a = { x, y };
      this.showToast('Кликните второй конец стены');
      this._updateBgUi();
      this.render();
      return;
    }
    if (!this._bgCalibrate.b) {
      this._bgCalibrate.b = { x, y };
      const dist = Math.hypot(
        this._bgCalibrate.b.x - this._bgCalibrate.a.x,
        this._bgCalibrate.b.y - this._bgCalibrate.a.y
      );
      if (dist < 0.05) {
        this._bgCalibrate.b = null;
        this.showToast('Точки слишком близко — укажите длиннее отрезок');
        this.render();
        return;
      }
      if (this.bgCalibRow) this.bgCalibRow.hidden = false;
      if (this.bgCalibLengthInput) {
        this.bgCalibLengthInput.focus();
        this.bgCalibLengthInput.select?.();
      }
      this._updateBgUi();
      this.render();
      this.showToast('Введите реальную длину отрезка (м или мм)');
    }
  }

  /** Parse "4.8" / "4,8" / "4800" → meters (values ≥ 100 treated as mm). */
  _parseCalibLengthToMeters(raw) {
    if (raw == null) return null;
    const cleaned = String(raw).trim().replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!Number.isFinite(num) || num <= 0) return null;
    if (num >= 100) return num / 1000;
    return num;
  }

  _applyBgCalibrationLength() {
    if (!this.bgImage || !this._bgCalibrate?.a || !this._bgCalibrate?.b) return;
    const realM = this._parseCalibLengthToMeters(this.bgCalibLengthInput?.value);
    if (!realM || realM < 0.05) {
      this.showToast('Укажите длину, например 4,8 или 4800');
      this.bgCalibLengthInput?.focus();
      return;
    }
    const a = this._bgCalibrate.a;
    const b = this._bgCalibrate.b;
    const worldDist = Math.hypot(b.x - a.x, b.y - a.y);
    if (worldDist < 0.05) {
      this.showToast('Слишком короткий отрезок');
      return;
    }
    const scale = realM / worldDist;
    this.bgTransform.widthM = Math.max(0.5, Math.min(200, this.bgTransform.widthM * scale));
    // Новая база % слайдера = текущий калиброванный размер
    this._bgBaseWidthM = this.bgTransform.widthM;
    this._bgScaleLocked = true;
    this._syncBgScaleSlider();
    this._syncBgWidthInput();
    this._cancelBgCalibration(false);
    // Остаёмся в adjust: можно сдвинуть план, масштаб уже lock
    this.bgAdjustMode = true;
    this._updateBgUi();
    this._updateUi();
    this.render();
    this.showToast('Масштаб зафиксирован — сдвиньте план, затем «Зафиксировать и чертить»');
  }

  _updateBgUi() {
    const hasBg = !!this.bgImage;
    const calibrating = !!this._bgCalibrate;
    const locked = this._bgScaleLocked;
    if (this.bgAdjustBtn) {
      this.bgAdjustBtn.hidden = !hasBg;
      this.bgAdjustBtn.classList.toggle('active', hasBg && this.bgAdjustMode && !calibrating);
      this.bgAdjustBtn.classList.toggle('sketch-bg-panel__toggle--done', hasBg && this.bgAdjustMode);
      if (!hasBg) {
        this.bgAdjustBtn.textContent = 'Зафиксировать и чертить';
      } else if (this.bgAdjustMode) {
        this.bgAdjustBtn.textContent = 'Зафиксировать и чертить';
      } else {
        this.bgAdjustBtn.textContent = 'Сдвинуть план';
      }
    }
    if (this.bgCalibBtn) {
      this.bgCalibBtn.hidden = !hasBg;
      this.bgCalibBtn.classList.toggle('active', calibrating);
      this.bgCalibBtn.textContent = calibrating
        ? 'Калибровка…'
        : (locked ? 'Перекалибровать' : 'Калибровать по размеру');
    }
    if (this.bgPanel) this.bgPanel.hidden = !hasBg;
    if (this.bgLockedBadge) this.bgLockedBadge.hidden = !(hasBg && locked && !calibrating);
    if (this.bgScaleRow) this.bgScaleRow.hidden = !hasBg || locked || calibrating;
    if (this.bgWidthRow) this.bgWidthRow.hidden = !hasBg || locked || calibrating;
    if (this.bgScaleInput) this.bgScaleInput.disabled = locked;
    if (this.bgWidthInput) this.bgWidthInput.disabled = locked;
    if (this.bgHintEl && hasBg) {
      if (calibrating && !this._bgCalibrate.a) {
        this.bgHintEl.textContent = 'Кликните первый конец стены с известным размером на плане.';
      } else if (calibrating && this._bgCalibrate.a && !this._bgCalibrate.b) {
        this.bgHintEl.textContent = 'Кликните второй конец той же стены.';
      } else if (calibrating && this._bgCalibrate.a && this._bgCalibrate.b) {
        this.bgHintEl.textContent = 'Введите длину: 4,8 или 4800 (мм). Масштаб зафиксируется.';
      } else if (this.bgAdjustMode && locked) {
        this.bgHintEl.textContent = 'Масштаб зафиксирован. Перетащите план на место. Колёсико — только вид камеры. Затем «Зафиксировать и чертить».';
      } else if (this.bgAdjustMode) {
        this.bgHintEl.textContent = 'Сначала «Калибровать по размеру». Колёсико не меняет размер плана — только вид.';
      } else {
        this.bgHintEl.textContent = 'Чертите контур. «Сдвинуть план» — только перемещение (масштаб не сбросится).';
      }
    }
    this.canvasWrap?.classList.toggle('sketch-canvas-wrap--bg-adjust', hasBg && this.bgAdjustMode && !calibrating);
    this.canvasWrap?.classList.toggle('sketch-canvas-wrap--bg-calib', calibrating);
    if (hasBg) {
      this._syncBgScaleSlider();
      this._syncBgWidthInput();
    }
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
    if (this.bgAdjustMode && !this._bgCalibrate) {
      this.ctx.save();
      this.ctx.strokeStyle = '#2196F3';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([6, 4]);
      this.ctx.strokeRect(r.x, r.y, r.w, r.h);
      this.ctx.setLineDash([]);
      this.ctx.restore();
    }
    this._drawBgCalibrationOverlay();
  }

  _drawBgCalibrationOverlay() {
    if (!this._bgCalibrate) return;
    const { a, b } = this._bgCalibrate;
    const drawMark = (p, label) => {
      const c = this.worldToCanvas(p.x, p.y);
      this.ctx.fillStyle = '#e67e22';
      this.ctx.beginPath();
      this.ctx.arc(c.x, c.y, 7, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.fillStyle = '#fff';
      this.ctx.font = 'bold 11px system-ui, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(label, c.x, c.y + 0.5);
    };
    if (a && b) {
      const pa = this.worldToCanvas(a.x, a.y);
      const pb = this.worldToCanvas(b.x, b.y);
      this.ctx.save();
      this.ctx.strokeStyle = '#e67e22';
      this.ctx.lineWidth = 2.5;
      this.ctx.setLineDash([6, 4]);
      this.ctx.beginPath();
      this.ctx.moveTo(pa.x, pa.y);
      this.ctx.lineTo(pb.x, pb.y);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
      this.ctx.restore();
    }
    if (a) drawMark(a, '1');
    if (b) drawMark(b, '2');
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

    if (!this.closed && this._previewPoint && this.vertices.length === 0) {
      const preview = this.worldToCanvas(this._previewPoint.x, this._previewPoint.y);
      const r = 7;
      this.ctx.fillStyle = 'rgba(1, 100, 79, 0.4)';
      this.ctx.beginPath();
      this.ctx.arc(preview.x, preview.y, r, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.strokeStyle = 'rgba(1, 100, 79, 0.85)';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(preview.x, preview.y, r + 3, 0, Math.PI * 2);
      this.ctx.stroke();
      // Crosshair to emphasize 1 m grid intersection
      this.ctx.beginPath();
      this.ctx.moveTo(preview.x - 12, preview.y);
      this.ctx.lineTo(preview.x + 12, preview.y);
      this.ctx.moveTo(preview.x, preview.y - 12);
      this.ctx.lineTo(preview.x, preview.y + 12);
      this.ctx.stroke();
    } else if (!this.closed && this.vertices.length > 0 && this._previewPoint) {
      const lastV = this.vertices[this.vertices.length - 1];
      const last = this.worldToCanvas(lastV.x, lastV.y);
      const preview = this.worldToCanvas(this._previewPoint.x, this._previewPoint.y);
      const target = this._previewTarget || this._previewPoint;

      if (this._fineTicksAlpha > 0.01) {
        this._drawFineSnapTicks(lastV, target, this._fineTicksAlpha);
      }

      this.ctx.setLineDash([6, 4]);
      this.ctx.strokeStyle = 'rgba(1, 100, 79, 0.5)';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(last.x, last.y);
      this.ctx.lineTo(preview.x, preview.y);
      this.ctx.stroke();
      this.ctx.setLineDash([]);

      const now = performance.now();
      let pulse = 1;
      if (now < this._snapPulseUntil) {
        const t = 1 - (this._snapPulseUntil - now) / SNAP_PULSE_MS;
        const ease = t * t * (3 - 2 * t);
        pulse = this._snapPulseFrom + (1 - this._snapPulseFrom) * ease;
      }
      const r = 6 * pulse;
      this.ctx.fillStyle = this._snapStep <= FINE_GRID_STEP
        ? 'rgba(1, 100, 79, 0.55)'
        : 'rgba(1, 100, 79, 0.35)';
      this.ctx.beginPath();
      this.ctx.arc(preview.x, preview.y, r, 0, Math.PI * 2);
      this.ctx.fill();
      if (this._snapStep <= FINE_GRID_STEP) {
        this.ctx.strokeStyle = 'rgba(1, 100, 79, 0.75)';
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.arc(preview.x, preview.y, r + 3, 0, Math.PI * 2);
        this.ctx.stroke();
      }

      this._drawPreviewLengthBadge(last, preview, lastV, target);
    } else if (this._dragIdx !== null && this.closed && this._fineTicksAlpha > 0.01) {
      const v = this.vertices[this._dragIdx];
      if (v) this._drawFineSnapTicks(v, v, this._fineTicksAlpha, true);
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

  _drawFineSnapTicks(fromPoint, atPoint, alpha, crossOnly = false) {
    const a = Math.max(0, Math.min(1, alpha));
    if (a < 0.01) return;
    const dx = Math.abs(atPoint.x - fromPoint.x);
    const dy = Math.abs(atPoint.y - fromPoint.y);
    const axis = crossOnly ? 'both' : (dx >= dy ? 'h' : 'v');
    const r = FINE_TICK_RADIUS_M;
    const step = FINE_GRID_STEP;

    this.ctx.save();
    this.ctx.globalAlpha = a * 0.85;

    const drawTickAt = (wx, wy, major) => {
      const p = this.worldToCanvas(wx, wy);
      const len = major ? 7 : 4;
      this.ctx.strokeStyle = major ? 'rgba(1, 100, 79, 0.55)' : 'rgba(1, 100, 79, 0.28)';
      this.ctx.lineWidth = major ? 1.5 : 1;
      this.ctx.beginPath();
      if (axis === 'h') {
        this.ctx.moveTo(p.x, p.y - len);
        this.ctx.lineTo(p.x, p.y + len);
      } else if (axis === 'v') {
        this.ctx.moveTo(p.x - len, p.y);
        this.ctx.lineTo(p.x + len, p.y);
      } else {
        this.ctx.moveTo(p.x, p.y - len);
        this.ctx.lineTo(p.x, p.y + len);
        this.ctx.moveTo(p.x - len, p.y);
        this.ctx.lineTo(p.x + len, p.y);
      }
      this.ctx.stroke();
    };

    if (axis === 'h' || axis === 'both') {
      const y = axis === 'both' ? atPoint.y : fromPoint.y;
      const i0 = Math.ceil((atPoint.x - r) / step - 1e-9);
      const i1 = Math.floor((atPoint.x + r) / step + 1e-9);
      for (let i = i0; i <= i1; i++) {
        const x = i * step;
        const major = Math.abs(i * step - Math.round(i * step)) < 1e-9;
        drawTickAt(x, y, major);
      }
    }
    if (axis === 'v' || axis === 'both') {
      const x = axis === 'both' ? atPoint.x : fromPoint.x;
      const i0 = Math.ceil((atPoint.y - r) / step - 1e-9);
      const i1 = Math.floor((atPoint.y + r) / step + 1e-9);
      for (let i = i0; i <= i1; i++) {
        const y = i * step;
        const major = Math.abs(i * step - Math.round(i * step)) < 1e-9;
        drawTickAt(x, y, major);
      }
    }

    this.ctx.restore();
  }

  _drawPreviewLengthBadge(lastCanvas, previewCanvas, lastWorld, previewWorld) {
    const len = Math.hypot(previewWorld.x - lastWorld.x, previewWorld.y - lastWorld.y);
    if (len < 0.04) return;
    const mx = (lastCanvas.x + previewCanvas.x) / 2;
    const my = (lastCanvas.y + previewCanvas.y) / 2;
    const text = `${formatMetersDisplay(len)} м`;
    this.ctx.save();
    this.ctx.font = '600 12px system-ui, sans-serif';
    const metrics = this.ctx.measureText(text);
    const padX = 8;
    const padY = 5;
    const bw = metrics.width + padX * 2;
    const bh = 12 + padY * 2;
    const now = performance.now();
    let scale = 1;
    if (now < this._labelAnimUntil) {
      const t = 1 - (this._labelAnimUntil - now) / LABEL_PULSE_MS;
      const ease = t * t * (3 - 2 * t);
      scale = 1.12 - 0.12 * ease;
    }
    this.ctx.translate(mx, my - 14);
    this.ctx.scale(scale, scale);
    this.ctx.translate(-bw / 2, -bh / 2);
    this.ctx.fillStyle = ACCENT;
    this._roundRectPath(-0, 0, bw, bh, 8);
    this.ctx.fill();
    this.ctx.fillStyle = '#fff';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(text, bw / 2, bh / 2 + 0.5);
    this.ctx.restore();
  }

  _roundRectPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    this.ctx.beginPath();
    this.ctx.moveTo(x + rr, y);
    this.ctx.arcTo(x + w, y, x + w, y + h, rr);
    this.ctx.arcTo(x + w, y + h, x, y + h, rr);
    this.ctx.arcTo(x, y + h, x, y, rr);
    this.ctx.arcTo(x, y, x + w, y, rr);
    this.ctx.closePath();
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

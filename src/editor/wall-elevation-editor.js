import { OPENING_TYPES } from '../core/constants.js';
import { roundMeters } from '../core/geometry.js';

const ACCENT = '#01644f';
const DOOR_COLOR = '#e67e22';
const WINDOW_COLOR = '#2196F3';
const MIN_USER_ZOOM = 0.6;
const MAX_USER_ZOOM = 4;

export class WallElevationEditor {
  constructor(canvas, {
    onOpeningSelect,
    onOpeningChange,
    onWallClick,
  } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.room = null;
    this.wallId = null;
    this.selectedOpeningId = null;
    this.onOpeningSelect = onOpeningSelect;
    this.onOpeningChange = onOpeningChange;
    this.onWallClick = onWallClick;
    this._dragOpeningId = null;
    this._dragGrabDelta = 0;
    this.userZoom = 1;
    this.panX = 0;
    this.panY = 0;
    this._baseScale = 40;
    this._layout = null;
    this._panning = false;
    this._panStart = null;
    this._pinch = null;
    this._touchMode = null;

    this._boundDown = this.handlePointerDown.bind(this);
    this._boundMove = this.handlePointerMove.bind(this);
    this._boundUp = this.handlePointerUp.bind(this);
    this._boundTouchStart = this._onTouchStart.bind(this);
    this._boundTouchMove = this._onTouchMove.bind(this);
    this._boundTouchEnd = this._onTouchEnd.bind(this);

    canvas.addEventListener('mousedown', this._boundDown);
    window.addEventListener('mousemove', this._boundMove);
    window.addEventListener('mouseup', this._boundUp);
    canvas.addEventListener('touchstart', this._boundTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this._boundTouchMove, { passive: false });
    canvas.addEventListener('touchend', this._boundTouchEnd);
    canvas.addEventListener('touchcancel', this._boundTouchEnd);
    canvas.style.touchAction = 'none';

    this._resizeObserver = null;
    this._roRaf = null;
    this._sizeCw = 0;
    this._sizeCh = 0;
    if (canvas.parentElement && typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        if (this._roRaf) return;
        this._roRaf = requestAnimationFrame(() => {
          this._roRaf = null;
          if (this.getWall()) this.render();
        });
      });
      this._resizeObserver.observe(canvas.parentElement);
    }
  }

  destroy() {
    this._resizeObserver?.disconnect();
    this.canvas.removeEventListener('mousedown', this._boundDown);
    window.removeEventListener('mousemove', this._boundMove);
    window.removeEventListener('mouseup', this._boundUp);
    this.canvas.removeEventListener('touchstart', this._boundTouchStart);
    this.canvas.removeEventListener('touchmove', this._boundTouchMove);
    this.canvas.removeEventListener('touchend', this._boundTouchEnd);
    this.canvas.removeEventListener('touchcancel', this._boundTouchEnd);
  }

  setRoom(room) {
    this.room = room;
  }

  setWall(wallId, { resetView = true } = {}) {
    const changed = this.wallId !== wallId;
    this.wallId = wallId;
    if (changed) this.selectedOpeningId = null;
    if (changed && resetView) {
      this.userZoom = 1;
      this.panX = 0;
      this.panY = 0;
    }
    this.render();
  }

  selectOpening(openingId) {
    this.selectedOpeningId = openingId;
    this.render();
  }

  focusOpening(openingId) {
    this.selectedOpeningId = openingId;
    // Стена должна целиком оставаться в кадре — без принудительного zoom 1.6
    this.userZoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.render();
  }

  getWall() {
    return this.room?.walls.find((w) => w.id === this.wallId) ?? null;
  }

  getScale() {
    return this._baseScale * this.userZoom;
  }

  /** Масштаб и отступы так, чтобы стена + подписи влезли в canvas */
  _computeBaseScale(wall, viewW, viewH) {
    const padX = 32;
    const padT = 28;
    const padB = 28;
    const maxW = Math.max(80, viewW - padX * 2);
    const maxH = Math.max(80, viewH - padT - padB);
    const sx = maxW / Math.max(wall.length, 0.1);
    const sy = maxH / Math.max(this.room.wallHeight, 0.1);
    return Math.max(10, Math.min(140, Math.min(sx, sy)));
  }

  render() {
    const wall = this.getWall();
    if (!wall || !this.room) return;

    const parent = this.canvas.parentElement;
    // clientWidth/Height = content box; getBoundingClientRect + padding давали петлю роста canvas
    const rawW = Math.round(parent?.clientWidth || 560);
    const rawH = Math.round(parent?.clientHeight || 360);
    const cw = Math.max(240, Math.min(rawW || 560, Math.ceil((window.innerWidth || 1200) * 1.2)));
    const ch = Math.max(200, Math.min(rawH || 360, Math.ceil((window.innerHeight || 900) * 1.2)));
    this._baseScale = this._computeBaseScale(wall, cw, ch);
    const s = this.getScale();
    const ww = wall.length * s;
    const wh = this.room.wallHeight * s;
    const padX = 16;
    const padT = 22;
    const padB = 22;
    const ox0 = Math.max(padX, (cw - ww) / 2);
    const oy0 = Math.max(padT, (ch - wh - padB + padT) / 2);
    this._originOx = ox0;
    this._originOy = oy0;
    const ox = ox0 + this.panX;
    const oy = oy0 + this.panY;

    this._layout = { ox, oy, s, ww, wh, cw, ch, ox0, oy0 };

    const dpr = window.devicePixelRatio || 1;
    if (this._sizeCw !== cw || this._sizeCh !== ch) {
      this._sizeCw = cw;
      this._sizeCh = ch;
      this.canvas.width = Math.round(cw * dpr);
      this.canvas.height = Math.round(ch * dpr);
    }
    // Не задаём style.width в px — иначе при padding родителя и width:100% снова раздувает layout
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, cw, ch);

    this.ctx.fillStyle = '#eef2f3';
    this.ctx.fillRect(0, 0, cw, ch);

    this.ctx.fillStyle = '#f5f7f8';
    this.ctx.fillRect(ox, oy, ww, wh);
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(ox, oy, ww, wh);

    this.ctx.fillStyle = '#5f6b73';
    this.ctx.font = '12px system-ui';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(`${wall.label} · ${wall.length.toFixed(2)} м × ${this.room.wallHeight.toFixed(2)} м`, Math.max(8, ox), Math.max(14, oy - 10));

    this.ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    this.ctx.lineWidth = 1;
    for (let m = 1; m < wall.length; m++) {
      const x = ox + m * s;
      this.ctx.beginPath();
      this.ctx.moveTo(x, oy);
      this.ctx.lineTo(x, oy + wh);
      this.ctx.stroke();
    }
    for (let m = 1; m < this.room.wallHeight; m++) {
      const y = oy + wh - m * s;
      this.ctx.beginPath();
      this.ctx.moveTo(ox, y);
      this.ctx.lineTo(ox + ww, y);
      this.ctx.stroke();
    }

    const openings = this.room.getOpeningsForWall(wall.id);
    for (const o of openings) {
      const box = this._openingBox(o, ox, oy, s, wh);
      const active = o.id === this.selectedOpeningId || o.id === this._dragOpeningId;
      const isDoor = o.type === OPENING_TYPES.DOOR;
      this.ctx.fillStyle = isDoor
        ? (active ? '#ffb74d' : DOOR_COLOR)
        : (active ? '#64b5f6' : WINDOW_COLOR);
      this.ctx.globalAlpha = 0.85;
      this.ctx.fillRect(box.x, box.y, box.w, box.h);
      this.ctx.globalAlpha = 1;
      this.ctx.strokeStyle = active ? ACCENT : '#333';
      this.ctx.lineWidth = active ? 2.5 : 1.5;
      this.ctx.strokeRect(box.x, box.y, box.w, box.h);

      if (active) {
        const handleR = 10;
        this.ctx.fillStyle = '#fff';
        this.ctx.strokeStyle = ACCENT;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(box.x + box.w / 2, box.y + box.h / 2, handleR, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
      }

      this.ctx.fillStyle = '#fff';
      this.ctx.font = 'bold 11px system-ui';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(isDoor ? 'Дверь' : 'Окно', box.x + box.w / 2, box.y + box.h / 2);
    }

    this.ctx.fillStyle = '#8899a4';
    this.ctx.font = '10px system-ui';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('пол', ox + ww / 2, oy + wh + 16);
  }

  _openingBox(o, ox, oy, s, wh) {
    const x = ox + o.offset * s;
    const w = Math.max(o.width * s, 28);
    let y;
    let h;
    if (o.type === OPENING_TYPES.DOOR) {
      h = Math.max(o.height * s, 28);
      y = oy + wh - h;
    } else {
      h = Math.max(o.height * s, 28);
      y = oy + wh - (o.sillHeight + o.height) * s;
    }
    return { x, y, w, h };
  }

  _clientToCanvas(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.clientWidth ? (this._layout?.cw || this.canvas.clientWidth) / this.canvas.clientWidth : 1;
    const scaleY = this.canvas.clientHeight ? (this._layout?.ch || this.canvas.clientHeight) / this.canvas.clientHeight : 1;
    return {
      cx: (e.clientX - rect.left) * scaleX,
      cy: (e.clientY - rect.top) * scaleY,
    };
  }

  hitTestOpening(cx, cy) {
    const wall = this.getWall();
    if (!wall || !this.room || !this._layout) return null;
    const { ox, oy, s, wh } = this._layout;
    const pad = 12;
    let best = null;
    for (const o of this.room.getOpeningsForWall(wall.id)) {
      const box = this._openingBox(o, ox, oy, s, wh);
      if (
        cx >= box.x - pad
        && cx <= box.x + box.w + pad
        && cy >= box.y - pad
        && cy <= box.y + box.h + pad
      ) {
        best = o;
      }
    }
    return best;
  }

  _touchDistance(t0, t1) {
    return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
  }

  _touchMidpoint(t0, t1) {
    return { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
  }

  _beginPinch(e) {
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    const mid = this._touchMidpoint(t0, t1);
    const { cx, cy } = this._clientToCanvas(mid);
    this._touchMode = 'pinch';
    this._pinch = {
      startDist: Math.max(1, this._touchDistance(t0, t1)),
      startZoom: this.userZoom,
      startPanX: this.panX,
      startPanY: this.panY,
      cx,
      cy,
      lastMid: mid,
    };
    this._panning = false;
    this._dragOpeningId = null;
  }

  _onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length >= 2) {
      this._beginPinch(e);
      return;
    }
    const t = e.touches[0];
    this.handlePointerDown({ clientX: t.clientX, clientY: t.clientY, button: 0, isTouch: true });
  }

  _onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length >= 2) {
      if (this._touchMode !== 'pinch') this._beginPinch(e);
      const pinch = this._pinch;
      if (!pinch) return;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.max(1, this._touchDistance(t0, t1));
      const factor = dist / pinch.startDist;
      const mid = this._touchMidpoint(t0, t1);
      const { cx, cy } = this._clientToCanvas(mid);

      // Zoom around midpoint
      const worldX = (pinch.cx - 40 - pinch.startPanX) / (this._baseScale * pinch.startZoom);
      const worldY = (pinch.cy - 30 - pinch.startPanY) / (this._baseScale * pinch.startZoom);
      this.userZoom = Math.max(MIN_USER_ZOOM, Math.min(MAX_USER_ZOOM, pinch.startZoom * factor));
      const s = this._baseScale * this.userZoom;
      const ox0 = this._originOx ?? 16;
      const oy0 = this._originOy ?? 22;
      this.panX = cx - ox0 - worldX * s;
      this.panY = cy - oy0 - worldY * s;

      this.panX += mid.x - pinch.lastMid.x;
      this.panY += mid.y - pinch.lastMid.y;
      pinch.lastMid = mid;
      this.render();
      return;
    }
    const t = e.touches[0];
    this.handlePointerMove({ clientX: t.clientX, clientY: t.clientY });
  }

  _onTouchEnd(e) {
    if (e.touches.length >= 2) {
      this._beginPinch(e);
      return;
    }
    if (e.touches.length === 1 && this._touchMode === 'pinch') {
      const t = e.touches[0];
      this._touchMode = 'pan';
      this._pinch = null;
      this._panning = true;
      this._panStart = { x: t.clientX, y: t.clientY, panX: this.panX, panY: this.panY };
      return;
    }
    this._pinch = null;
    this._touchMode = null;
    this.handlePointerUp();
  }

  handlePointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const { cx, cy } = this._clientToCanvas(e);
    const hit = this.hitTestOpening(cx, cy);
    if (hit) {
      const s = this.getScale();
      const ox = (this._layout?.ox ?? 40);
      this._dragOpeningId = hit.id;
      this._dragGrabDelta = (cx - ox) / s - hit.offset;
      this.selectedOpeningId = hit.id;
      this.onOpeningSelect?.(hit.id);
      this.canvas.style.cursor = 'grabbing';
      this._panning = false;
      this.render();
      return;
    }

    // Empty wall area → pan (especially useful when zoomed)
    this._panning = true;
    this._panStart = { x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
    this._touchMode = 'pan';
    if (this.selectedOpeningId) {
      this.selectedOpeningId = null;
      this.onOpeningSelect?.(null);
      this.render();
    }
  }

  handlePointerMove(e) {
    if (this._panning && this._panStart) {
      this.panX = this._panStart.panX + (e.clientX - this._panStart.x);
      this.panY = this._panStart.panY + (e.clientY - this._panStart.y);
      this.render();
      return;
    }
    if (!this._dragOpeningId || !this.room) return;
    const opening = this.room.getOpening(this._dragOpeningId);
    const wall = this.getWall();
    if (!opening || !wall) return;
    const { cx } = this._clientToCanvas(e);
    const s = this.getScale();
    const ox = this._layout?.ox ?? 40;
    let offset = (cx - ox) / s - this._dragGrabDelta;
    const max = Math.max(0, wall.length - opening.width);
    opening.offset = roundMeters(Math.max(0, Math.min(max, offset)));
    this.render();
  }

  handlePointerUp() {
    if (this._panning) {
      this._panning = false;
      this._panStart = null;
      this.canvas.style.cursor = '';
      return;
    }
    if (!this._dragOpeningId) return;
    const openingId = this._dragOpeningId;
    this._dragOpeningId = null;
    this._dragGrabDelta = 0;
    this.canvas.style.cursor = '';
    this.onOpeningChange?.(openingId);
    this.render();
  }
}

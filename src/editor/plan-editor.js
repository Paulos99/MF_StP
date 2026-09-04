import { getBounds, getEdges, triangulateFan } from '../core/polygon-geometry.js';
import { roundMeters } from '../core/geometry.js';

export class PlanEditor {
  static OPENING_COLOR = '#e67e22';
  static OPENING_ACTIVE_COLOR = '#2196F3';
  static ACCENT = '#01644f';

  constructor(canvas, {
    onWallSelect,
    onOpeningSelect,
    onOpeningChange,
    interactiveOpenings = false,
  } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.room = null;
    this.selectedWallId = null;
    this.selectedOpeningId = null;
    this.interactiveOpenings = interactiveOpenings;
    this.onWallSelect = onWallSelect;
    this.onOpeningSelect = onOpeningSelect;
    this.onOpeningChange = onOpeningChange;
    this.scale = 40;
    this._dragOpeningId = null;
    this._dragGrabDelta = 0;
    this._boundPointerDown = this.handlePointerDown.bind(this);
    this._boundPointerMove = this.handlePointerMove.bind(this);
    this._boundPointerUp = this.handlePointerUp.bind(this);
    this._boundTouchStart = (e) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) this.handlePointerDown({ clientX: t.clientX, clientY: t.clientY, button: 0 });
    };
    this._boundTouchMove = (e) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) this.handlePointerMove({ clientX: t.clientX, clientY: t.clientY });
    };
    this._boundTouchEnd = () => this.handlePointerUp();
    canvas.addEventListener('mousedown', this._boundPointerDown);
    window.addEventListener('mousemove', this._boundPointerMove);
    window.addEventListener('mouseup', this._boundPointerUp);
    canvas.addEventListener('touchstart', this._boundTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this._boundTouchMove, { passive: false });
    canvas.addEventListener('touchend', this._boundTouchEnd);
    canvas.addEventListener('touchcancel', this._boundTouchEnd);
    canvas.style.touchAction = 'none';
    this._resizeObserver = null;
    if (canvas.parentElement && typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        if (this._roRaf) return;
        this._roRaf = requestAnimationFrame(() => {
          this._roRaf = null;
          if (this.room?.vertices?.length) this.render();
        });
      });
      this._resizeObserver.observe(canvas.parentElement);
    }
  }

  destroy() {
    this._resizeObserver?.disconnect();
    this.canvas.removeEventListener('mousedown', this._boundPointerDown);
    window.removeEventListener('mousemove', this._boundPointerMove);
    window.removeEventListener('mouseup', this._boundPointerUp);
    this.canvas.removeEventListener('touchstart', this._boundTouchStart);
    this.canvas.removeEventListener('touchmove', this._boundTouchMove);
    this.canvas.removeEventListener('touchend', this._boundTouchEnd);
    this.canvas.removeEventListener('touchcancel', this._boundTouchEnd);
  }

  setRoom(room) {
    this.room = room;
    if (room?.walls?.length && !this.selectedWallId) {
      this.selectedWallId = room.walls[0].id;
    }
  }

  selectWall(wallId) {
    this.selectedWallId = wallId;
    this.render();
  }

  selectOpening(openingId) {
    this.selectedOpeningId = openingId;
    if (openingId) {
      const opening = this.room?.openings.find((o) => o.id === openingId);
      if (opening) this.selectedWallId = opening.wallId;
    }
    this.render();
  }

  getScale() {
    if (!this.room?.vertices?.length) return this.scale;
    const b = getBounds(this.room.vertices);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    return Math.max(25, Math.min(70, Math.min(320 / Math.max(w, 0.5), 240 / Math.max(h, 0.5))));
  }

  getOrigin() {
    if (!this.room?.vertices?.length) return { ox: 30, oy: 30, s: this.getScale() };
    const b = getBounds(this.room.vertices);
    const s = this.getScale();
    return { ox: 30 - b.minX * s, oy: 30 - b.minY * s, s };
  }

  wallToCanvas(wall) {
    const ox = this._renderOx ?? this.getOrigin().ox;
    const oy = this._renderOy ?? this.getOrigin().oy;
    const s = this._renderS ?? this.getOrigin().s;
    return {
      x1: ox + wall.planStart.x * s,
      y1: oy + wall.planStart.y * s,
      x2: ox + wall.planEnd.x * s,
      y2: oy + wall.planEnd.y * s,
      s,
      ox,
      oy,
    };
  }

  canvasToWallDistance(cx, cy, wall) {
    const { x1, y1, x2, y2 } = this.wallToCanvas(wall);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return { dist: Math.hypot(cx - x1, cy - y1), t: 0 };
    let t = ((cx - x1) * dx + (cy - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const dist = Math.hypot(cx - (x1 + t * dx), cy - (y1 + t * dy));
    return { dist, t };
  }

  pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  hitTestOpening(cx, cy, threshold) {
    if (!this.room) return null;
    const hit = threshold ?? this._wallHitThreshold();
    let best = null;
    let bestDist = hit;
    for (const opening of this.room.openings) {
      const wall = this.room.walls.find((w) => w.id === opening.wallId);
      if (!wall) continue;
      const { x1, y1, x2, y2 } = this.wallToCanvas(wall);
      const t1 = opening.offset / wall.length;
      const t2 = (opening.offset + opening.width) / wall.length;
      const px1 = x1 + (x2 - x1) * t1;
      const py1 = y1 + (y2 - y1) * t1;
      const px2 = x1 + (x2 - x1) * t2;
      const py2 = y1 + (y2 - y1) * t2;
      const dist = this.pointToSegmentDistance(cx, cy, px1, py1, px2, py2);
      if (dist < bestDist) {
        bestDist = dist;
        best = opening;
      }
    }
    return best;
  }

  _isCoarsePointer() {
    return window.matchMedia?.('(pointer: coarse)')?.matches
      || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
  }

  _wallHitThreshold() {
    return this._isCoarsePointer() ? 28 : 22;
  }

  clampOpeningOffset(opening, wall, offset) {
    const max = Math.max(0, wall.length - opening.width);
    return Math.max(0, Math.min(max, offset));
  }

  setOpeningOffset(opening, wall, offset) {
    opening.offset = roundMeters(this.clampOpeningOffset(opening, wall, offset));
  }

  handlePointerDown(e) {
    if (!this.room) return;
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const wallHit = this._wallHitThreshold();

    if (this.interactiveOpenings) {
      const hit = this.hitTestOpening(cx, cy);
      if (hit) {
        const wall = this.room.walls.find((w) => w.id === hit.wallId);
        if (wall) {
          const { t } = this.canvasToWallDistance(cx, cy, wall);
          this._dragOpeningId = hit.id;
          this._dragGrabDelta = t * wall.length - hit.offset;
          this.selectedOpeningId = hit.id;
          this.selectedWallId = hit.wallId;
          this.onOpeningSelect?.(hit.id);
          this.canvas.style.cursor = 'grabbing';
          this.render();
          return;
        }
      }
    }

    for (const wall of this.room.walls) {
      const { x1, y1, x2, y2 } = this.wallToCanvas(wall);
      const dist = this.pointToSegmentDistance(cx, cy, x1, y1, x2, y2);
      if (dist < wallHit) {
        this.selectedWallId = wall.id;
        this.selectedOpeningId = null;
        this.onWallSelect?.(wall.id);
        this.render();
        return;
      }
    }
  }

  handlePointerMove(e) {
    if (!this._dragOpeningId || !this.room) return;
    const opening = this.room.openings.find((o) => o.id === this._dragOpeningId);
    if (!opening) return;
    const wall = this.room.walls.find((w) => w.id === opening.wallId);
    if (!wall) return;

    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const { t } = this.canvasToWallDistance(cx, cy, wall);
    this.setOpeningOffset(opening, wall, t * wall.length - this._dragGrabDelta);
    this.render();
  }

  handlePointerUp() {
    if (!this._dragOpeningId || !this.room) return;
    const opening = this.room.openings.find((o) => o.id === this._dragOpeningId);
    const wall = opening && this.room.walls.find((w) => w.id === opening.wallId);
    if (opening && wall) {
      opening.offset = roundMeters(opening.offset);
      opening.offset = this.clampOpeningOffset(opening, wall, opening.offset);
    }
    const openingId = this._dragOpeningId;
    this._dragOpeningId = null;
    this._dragGrabDelta = 0;
    this.canvas.style.cursor = '';
    this.onOpeningChange?.(openingId);
    this.render();
  }

  render() {
    if (!this.room?.vertices?.length) return;
    const wrap = this.canvas.parentElement;
    const maxW = Math.max(280, wrap?.clientWidth || 400);
    const maxH = Math.max(180, wrap?.clientHeight || 220);
    const b = getBounds(this.room.vertices);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const fitScale = Math.min((maxW - 48) / Math.max(w, 0.5), (maxH - 48) / Math.max(h, 0.5));
    const s2 = Math.max(20, Math.min(80, fitScale));
    const cw = maxW;
    const ch = maxH;
    const ox2 = (cw - w * s2) / 2 - b.minX * s2;
    const oy2 = (ch - h * s2) / 2 - b.minY * s2;

    this.canvas.width = cw * 2;
    this.canvas.height = ch * 2;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.ctx.setTransform(2, 0, 0, 2, 0, 0);

    const ox = ox2;
    const oy = oy2;
    const s = s2;
    this._renderOx = ox;
    this._renderOy = oy;
    this._renderS = s;
    this.ctx.clearRect(0, 0, cw, ch);

    const verts = this.room.vertices;
    this.ctx.beginPath();
    const p0 = { x: ox + verts[0].x * s, y: oy + verts[0].y * s };
    this.ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < verts.length; i++) {
      this.ctx.lineTo(ox + verts[i].x * s, oy + verts[i].y * s);
    }
    this.ctx.closePath();
    this.ctx.fillStyle = 'rgba(1, 100, 79, 0.1)';
    this.ctx.fill();
    this.ctx.strokeStyle = PlanEditor.ACCENT;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    const diags = triangulateFan(verts);
    this.ctx.setLineDash([3, 3]);
    this.ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    this.ctx.lineWidth = 1;
    for (const d of diags) {
      this.ctx.beginPath();
      this.ctx.moveTo(ox + d.a.x * s, oy + d.a.y * s);
      this.ctx.lineTo(ox + d.b.x * s, oy + d.b.y * s);
      this.ctx.stroke();
    }
    this.ctx.setLineDash([]);

    for (const v of verts) {
      this.ctx.fillStyle = PlanEditor.ACCENT;
      this.ctx.beginPath();
      this.ctx.arc(ox + v.x * s, oy + v.y * s, 4, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.fillStyle = '#fff';
      this.ctx.font = 'bold 9px system-ui';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(v.label, ox + v.x * s, oy + v.y * s);
    }

    for (const wall of this.room.walls) {
      const { x1, y1, x2, y2 } = this.wallToCanvas(wall);
      const selected = wall.id === this.selectedWallId;
      this.ctx.strokeStyle = selected ? PlanEditor.ACCENT : '#8899a4';
      this.ctx.lineWidth = selected ? 5 : 3;
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();

      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      this.ctx.fillStyle = selected ? PlanEditor.ACCENT : '#5f6b73';
      this.ctx.font = 'bold 11px system-ui';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(wall.label.replace('Стена ', ''), mx, my - 8);
    }

    this.room.openings.forEach((o) => {
      const wall = this.room.walls.find((w) => w.id === o.wallId);
      if (!wall) return;
      const { x1, y1, x2, y2 } = this.wallToCanvas(wall);
      const t = o.offset / wall.length;
      const t2 = (o.offset + o.width) / wall.length;
      const px1 = x1 + (x2 - x1) * t;
      const py1 = y1 + (y2 - y1) * t;
      const px2 = x1 + (x2 - x1) * t2;
      const py2 = y1 + (y2 - y1) * t2;
      const isActive = o.id === this.selectedOpeningId || o.id === this._dragOpeningId;
      this.ctx.strokeStyle = isActive ? PlanEditor.OPENING_ACTIVE_COLOR : PlanEditor.OPENING_COLOR;
      this.ctx.lineWidth = isActive ? 6 : 4;
      this.ctx.beginPath();
      this.ctx.moveTo(px1, py1);
      this.ctx.lineTo(px2, py2);
      this.ctx.stroke();
    });
  }

  exportToImage() {
    const prevWall = this.selectedWallId;
    const prevOpening = this.selectedOpeningId;
    this.selectedWallId = null;
    this.selectedOpeningId = null;
    this.render();
    const dataUrl = this.canvas.toDataURL('image/png');
    this.selectedWallId = prevWall;
    this.selectedOpeningId = prevOpening;
    this.render();
    return dataUrl;
  }
}

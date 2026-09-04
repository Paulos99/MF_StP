import { OPENING_TYPES } from '../core/constants.js';
import { drawFrameGrid, drawWallFrameGrid, getWallFrameBounds } from './frame-overlay.js';

export class WallVisualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.max(window.devicePixelRatio || 1, 1);
    this.wallResult = null;
    this.wallHeight = 2.7;
    this.showFrame = false;
  }

  setWallResult(wallResult, wallHeight) {
    this.wallResult = wallResult;
    this.wallHeight = wallHeight;
  }

  setFrameOverlay(show) {
    this.showFrame = show;
  }

  resize() {
    if (!this.wallResult) return;
    const wallLen = this.wallResult.wall.length;
    const scale = Math.min(600 / wallLen, 400 / this.wallHeight, 80);
    this.currentScale = Math.max(20, scale);
    const baseW = wallLen * this.currentScale + 80;
    const baseH = this.wallHeight * this.currentScale + 60;
    this.canvas.style.width = `${baseW}px`;
    this.canvas.style.height = `${baseH}px`;
    this.canvas.width = Math.floor(baseW * this.dpr * 2);
    this.canvas.height = Math.floor(baseH * this.dpr * 2);
    this.ctx.setTransform(this.dpr * 2, 0, 0, this.dpr * 2, 0, 0);
  }

  createCutPattern(color) {
    const tile = document.createElement('canvas');
    tile.width = 8;
    tile.height = 8;
    const t = tile.getContext('2d');
    t.fillStyle = color;
    t.fillRect(0, 0, 8, 8);
    t.strokeStyle = 'rgba(255,255,255,0.5)';
    t.beginPath();
    t.moveTo(0, 8);
    t.lineTo(8, 0);
    t.stroke();
    return this.ctx.createPattern(tile, 'repeat');
  }

  /** Рёбра частей, не прикрытые соседней частью той же панели */
  _strokeExternalEdges(parts, ox, oy, wallHpx, s) {
    const eps = 1e-6;
    const edges = [];

    for (const p of parts) {
      edges.push(
        { x1: p.x, y1: p.y, x2: p.x + p.w, y2: p.y, owner: p },
        { x1: p.x, y1: p.y + p.h, x2: p.x + p.w, y2: p.y + p.h, owner: p },
        { x1: p.x, y1: p.y, x2: p.x, y2: p.y + p.h, owner: p },
        { x1: p.x + p.w, y1: p.y, x2: p.x + p.w, y2: p.y + p.h, owner: p }
      );
    }

    const isInternal = (e) => {
      const horizontal = Math.abs(e.y1 - e.y2) < eps;
      for (const q of parts) {
        if (q === e.owner) continue;
        if (horizontal) {
          const onBorder =
            Math.abs(q.y - e.y1) < eps || Math.abs(q.y + q.h - e.y1) < eps;
          if (!onBorder) continue;
          const overlap =
            Math.min(e.x2, q.x + q.w) - Math.max(e.x1, q.x);
          if (overlap > eps) return true;
        } else {
          const onBorder =
            Math.abs(q.x - e.x1) < eps || Math.abs(q.x + q.w - e.x1) < eps;
          if (!onBorder) continue;
          const overlap =
            Math.min(e.y2, q.y + q.h) - Math.max(e.y1, q.y);
          if (overlap > eps) return true;
        }
      }
      return false;
    };

    this.ctx.beginPath();
    for (const e of edges) {
      if (isInternal(e)) continue;
      const sx1 = ox + e.x1 * s;
      const sy1 = oy + wallHpx - e.y1 * s;
      const sx2 = ox + e.x2 * s;
      const sy2 = oy + wallHpx - e.y2 * s;
      this.ctx.moveTo(sx1, sy1);
      this.ctx.lineTo(sx2, sy2);
    }
    this.ctx.stroke();
  }

  render({ showNumbers = true } = {}) {
    if (!this.wallResult) return;
    this.resize();
    const { wall, panels, openings } = this.wallResult;
    const s = this.currentScale;
    const ox = 40;
    const oy = 30;
    const w = wall.length * s;
    const h = this.wallHeight * s;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.fillStyle = '#eef1f2';
    this.ctx.fillRect(ox, oy, w, h);
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(ox, oy, w, h);

    openings.forEach((o) => {
      const bottomY = o.type === OPENING_TYPES.WINDOW ? o.sillHeight : 0;
      const px = ox + o.offset * s;
      const py = oy + h - (bottomY + o.height) * s;
      this.ctx.fillStyle = '#c8d0d4';
      this.ctx.fillRect(px, py, o.width * s, o.height * s);
      this.ctx.strokeStyle = '#8899a4';
      this.ctx.strokeRect(px, py, o.width * s, o.height * s);
      this.ctx.fillStyle = '#5f6b73';
      this.ctx.font = '11px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(o.type === OPENING_TYPES.DOOR ? 'Дверь' : 'Окно', px + (o.width * s) / 2, py + (o.height * s) / 2);
    });

    panels.forEach((panel) => {
      const fill = '#404449';
      const parts = typeof panel.getParts === 'function'
        ? panel.getParts()
        : [{ x: panel.x, y: panel.y, w: panel.width, h: panel.height }];

      this.ctx.fillStyle = panel.isCut ? (this.createCutPattern(fill) || fill) : fill;
      this.ctx.strokeStyle = '#2b2f33';
      this.ctx.lineWidth = 1.2;
      this.ctx.setLineDash(panel.isCut ? [4, 3] : []);

      // Заливка всех частей без внутренних швов
      for (const part of parts) {
        const px = ox + part.x * s;
        const py = oy + h - (part.y + part.h) * s;
        this.ctx.fillRect(px, py, part.w * s, part.h * s);
      }

      // Обводка только внешних рёбер (Г выглядит одной панелью)
      this._strokeExternalEdges(parts, ox, oy, h, s);

      this.ctx.setLineDash([]);

      const largest = parts.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
      const labelW = largest.w * s;
      const labelH = largest.h * s;
      if (showNumbers && labelW > 12 && labelH > 10) {
        const cx = ox + (largest.x + largest.w / 2) * s;
        const cy = oy + h - (largest.y + largest.h / 2) * s;
        this.ctx.fillStyle = '#fff';
        this.ctx.font = 'bold 10px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(String(panel.number), cx, cy);
      }
    });

    if (this.showFrame) {
      this.ctx.save();
      this.ctx.translate(ox, oy);
      drawWallFrameGrid(
        this.ctx,
        getWallFrameBounds(wall.length, this.wallHeight),
        s,
        { showHangers: true, openings }
      );
      this.ctx.restore();
    }

    this.ctx.fillStyle = '#01644f';
    this.ctx.font = 'bold 13px Arial';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(wall.label, ox, oy - 8);
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`${wall.length.toFixed(2)} м`, ox + w / 2, oy + h + 18);
  }
}

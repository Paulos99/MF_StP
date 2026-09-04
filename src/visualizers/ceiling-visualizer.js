import { Orientation } from '../calculators/ceiling-calculator.js';
import { drawFrameGrid } from './frame-overlay.js';
import { getBounds } from '../core/polygon-geometry.js';

export class CeilingVisualizer {
  constructor(canvas, scale = 50) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = scale;
    this.dpr = Math.max(window.devicePixelRatio || 1, 1);
    this.currentPanels = [];
    this.vertices = [];
    this.offsetX = 0;
    this.offsetY = 0;
    this.showFrame = false;
    this.frameBounds = null;
  }

  setRoom(calcOrRoom) {
    if (calcOrRoom?.vertices) {
      this.vertices = calcOrRoom.vertices;
      this.offsetX = calcOrRoom.offsetX ?? 0;
      this.offsetY = calcOrRoom.offsetY ?? 0;
    } else if (calcOrRoom?.length) {
      this.vertices = calcOrRoom;
      this.offsetX = 0;
      this.offsetY = 0;
    }
  }

  setPanels(panels) {
    this.currentPanels = panels;
  }

  setFrameOverlay(show, bounds) {
    this.showFrame = show;
    this.frameBounds = bounds;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  getLocalVertices() {
    return this.vertices.map((v) => ({
      x: v.x - this.offsetX,
      y: v.y - this.offsetY,
    }));
  }

  calculateOptimalScale() {
    const local = this.getLocalVertices();
    if (!local.length) return this.scale;
    const b = getBounds(local);
    const width = b.maxX - b.minX;
    const height = b.maxY - b.minY;
    const isMobile = window.matchMedia?.('(max-width: 899px)').matches;
    const maxW = isMobile ? 360 : 700;
    const maxH = isMobile ? 360 : 500;
    const pad = 80;
    let s = Math.min((maxW - pad) / Math.max(width, 0.5), (maxH - pad) / Math.max(height, 0.5));
    return Math.max(12, Math.min(50, s));
  }

  resize() {
    const local = this.getLocalVertices();
    if (!local.length) return;
    const adaptiveScale = this.calculateOptimalScale();
    const b = getBounds(local);
    const width = b.maxX - b.minX;
    const height = b.maxY - b.minY;
    const baseW = width * adaptiveScale + 100;
    const baseH = height * adaptiveScale + 100;
    this.canvas.style.width = `${baseW}px`;
    this.canvas.style.height = `${baseH}px`;
    const bufferScale = 2;
    this.canvas.width = Math.floor(baseW * this.dpr * bufferScale);
    this.canvas.height = Math.floor(baseH * this.dpr * bufferScale);
    this.ctx.setTransform(this.dpr * bufferScale, 0, 0, this.dpr * bufferScale, 0, 0);
    this.currentScale = adaptiveScale;
  }

  createCutPattern(baseColor) {
    if (!this._cutCache) this._cutCache = {};
    if (this._cutCache[baseColor]) return this._cutCache[baseColor];
    const tile = document.createElement('canvas');
    tile.width = 8;
    tile.height = 8;
    const t = tile.getContext('2d');
    t.fillStyle = baseColor;
    t.fillRect(0, 0, 8, 8);
    t.strokeStyle = 'rgba(255,255,255,0.55)';
    t.lineWidth = 1.5;
    t.setLineDash([2, 3]);
    t.beginPath();
    t.moveTo(0, 8);
    t.lineTo(8, 0);
    t.stroke();
    const pattern = this.ctx.createPattern(tile, 'repeat');
    this._cutCache[baseColor] = pattern;
    return pattern;
  }

  drawRoom() {
    const local = this.getLocalVertices();
    if (!local.length) return;
    const s = this.currentScale || this.scale;

    this.ctx.save();
    this.ctx.translate(50, 50);
    this.ctx.fillStyle = '#f5f7f8';
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(local[0].x * s, local[0].y * s);
    for (let i = 1; i < local.length; i++) {
      this.ctx.lineTo(local[i].x * s, local[i].y * s);
    }
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawPanels(showNumbers) {
    const s = this.currentScale || this.scale;
    const fill = '#404449';
    const stroke = '#2b2f33';
    const local = this.getLocalVertices();

    this.ctx.save();
    this.ctx.translate(50, 50);

    if (local.length >= 3) {
      this.ctx.beginPath();
      this.ctx.moveTo(local[0].x * s, local[0].y * s);
      for (let i = 1; i < local.length; i++) {
        this.ctx.lineTo(local[i].x * s, local[i].y * s);
      }
      this.ctx.closePath();
      this.ctx.clip();
    }

    this.currentPanels.forEach((panel) => {
      const parts = typeof panel.getParts === 'function'
        ? panel.getParts()
        : [{ x: panel.x, y: panel.y, w: panel.width, h: panel.height }];

      this.ctx.fillStyle = panel.isCut ? (this.createCutPattern(fill) || fill) : fill;
      this.ctx.strokeStyle = stroke;
      this.ctx.lineWidth = panel.isCut ? 1.5 : 1.2;
      this.ctx.setLineDash(panel.isCut ? [4, 3] : []);

      // Полный слот + clip по контуру комнаты → подрезка по диагонали без «дыр»
      for (const part of parts) {
        this.ctx.fillRect(part.x * s, part.y * s, part.w * s, part.h * s);
      }

      // Обводку полного AABB для cut не рисуем — она даёт ложный горизонтальный край под диагональю
      if (!panel.isCut) {
        if (parts.length === 1) {
          const p = parts[0];
          this.ctx.strokeRect(p.x * s, p.y * s, p.w * s, p.h * s);
        } else {
          this._strokeExternalEdgesCeil(parts, s);
        }
      }
      this.ctx.setLineDash([]);
    });

    // Номера — отдельным проходом в центре ВИДИМОГО клипа (не AABB слота за контуром)
    if (showNumbers) {
      this.currentPanels.forEach((panel) => {
        const label = this._visibleLabelPos(panel);
        if (!label) return;
        const fontPx = Math.max(8, Math.min(14, label.vh * s * 0.55, label.vw * s * 0.45));
        if (label.vw * s < 8 || label.vh * s < 7) return;
        this.ctx.fillStyle = '#fff';
        this.ctx.font = `bold ${fontPx}px Arial`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(String(panel.number), label.x * s, label.y * s);
      });
    }
    this.ctx.restore();
  }

  /**
   * Центр подписи внутри видимой части панели (clipParts), с небольшим отступом от края.
   */
  _visibleLabelPos(panel) {
    const clips = panel.meta?.clipParts;
    let parts;
    if (Array.isArray(clips) && clips.length) {
      parts = clips;
    } else if (Number.isFinite(panel.meta?.labelX) && Number.isFinite(panel.meta?.labelY)) {
      return {
        x: panel.meta.labelX,
        y: panel.meta.labelY,
        vw: Math.min(panel.width, 0.4),
        vh: Math.min(panel.height, 0.4),
      };
    } else {
      parts =
        typeof panel.getParts === 'function'
          ? panel.getParts()
          : [{ x: panel.x, y: panel.y, w: panel.width, h: panel.height }];
    }

    let best = parts[0];
    let bestArea = best.w * best.h;
    for (let i = 1; i < parts.length; i++) {
      const a = parts[i].w * parts[i].h;
      if (a > bestArea) {
        best = parts[i];
        bestArea = a;
      }
    }
    if (!best || bestArea < 1e-8) return null;

    // Центр крупнейшего видимого куска; чуть внутрь от краёв, если полоска узкая
    const insetX = Math.min(best.w * 0.2, 0.08);
    const insetY = Math.min(best.h * 0.2, 0.08);
    return {
      x: best.x + best.w / 2,
      y: best.y + best.h / 2,
      vw: Math.max(0.02, best.w - insetX * 2),
      vh: Math.max(0.02, best.h - insetY * 2),
    };
  }

  _strokeExternalEdgesCeil(parts, s) {
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
          if (Math.min(e.x2, q.x + q.w) - Math.max(e.x1, q.x) > eps) return true;
        } else {
          const onBorder =
            Math.abs(q.x - e.x1) < eps || Math.abs(q.x + q.w - e.x1) < eps;
          if (!onBorder) continue;
          if (Math.min(e.y2, q.y + q.h) - Math.max(e.y1, q.y) > eps) return true;
        }
      }
      return false;
    };
    this.ctx.beginPath();
    for (const e of edges) {
      if (isInternal(e)) continue;
      this.ctx.moveTo(e.x1 * s, e.y1 * s);
      this.ctx.lineTo(e.x2 * s, e.y2 * s);
    }
    this.ctx.stroke();
  }

  drawDimensions() {
    const local = this.getLocalVertices();
    if (!local.length) return;
    const s = this.currentScale || this.scale;
    const b = getBounds(local);
    const baseX = 50;
    const baseY = 50;
    const w = (b.maxX - b.minX) * s;
    const h = (b.maxY - b.minY) * s;

    this.ctx.save();
    this.ctx.strokeStyle = '#01644f';
    this.ctx.fillStyle = '#01644f';
    this.ctx.lineWidth = 2;
    this.ctx.font = 'bold 13px Arial';

    const topY = baseY - 12;
    this.ctx.beginPath();
    this.ctx.moveTo(baseX, topY);
    this.ctx.lineTo(baseX + w, topY);
    this.ctx.stroke();
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`${(b.maxX - b.minX).toFixed(2)} м`, baseX + w / 2, topY - 6);

    const leftX = baseX - 12;
    this.ctx.beginPath();
    this.ctx.moveTo(leftX, baseY);
    this.ctx.lineTo(leftX, baseY + h);
    this.ctx.stroke();
    this.ctx.save();
    this.ctx.translate(leftX - 8, baseY + h / 2);
    this.ctx.rotate(-Math.PI / 2);
    this.ctx.fillText(`${(b.maxY - b.minY).toFixed(2)} м`, 0, 0);
    this.ctx.restore();
    this.ctx.restore();
  }

  render({ showNumbers = true } = {}) {
    this.clear();
    this.resize();
    this.drawRoom();
    this.drawPanels(showNumbers);
    if (this.showFrame && this.frameBounds) {
      this.ctx.save();
      this.ctx.translate(50, 50);
      const s = this.currentScale || this.scale;
      const local = this.getLocalVertices();
      drawFrameGrid(this.ctx, this.frameBounds, s, {
        showHangers: true,
        clipPolygon: local.length >= 3 ? local : null,
      });
      this.ctx.restore();
    }
    this.drawDimensions();
  }

  exportToImage() {
    return this.canvas.toDataURL('image/png');
  }
}

export { Orientation };

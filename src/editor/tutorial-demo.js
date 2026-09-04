const ACCENT = '#01644f';
const GRID = 'rgba(0,0,0,0.07)';

/** L-образная комната — нормализованные координаты 0..1 */
const L_ROOM = [
  { label: 'A', x: 0.12, y: 0.18 },
  { label: 'B', x: 0.88, y: 0.18 },
  { label: 'C', x: 0.88, y: 0.52 },
  { label: 'D', x: 0.48, y: 0.52 },
  { label: 'E', x: 0.48, y: 0.82 },
  { label: 'F', x: 0.12, y: 0.82 },
];

/** Прямоугольная комната для демо проёмов */
const RECT_ROOM = [
  { x: 0.18, y: 0.22 },
  { x: 0.82, y: 0.22 },
  { x: 0.82, y: 0.78 },
  { x: 0.18, y: 0.78 },
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export class TutorialDemoPlayer {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tutorial-demo-canvas';
    this.container.innerHTML = '';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.mode = 'draw';
    this._raf = null;
    this._startTime = 0;
    this._resizeObserver = null;
    this._bindResize();
  }

  _bindResize() {
    const ro = new ResizeObserver(() => this._resize());
    ro.observe(this.container);
    this._resizeObserver = ro;
  }

  _resize() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(280, rect.width);
    const h = Math.max(160, rect.height || 160);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this._startTime = performance.now();
  }

  start(mode) {
    this.mode = mode;
    this._resize();
    this._startTime = performance.now();
    cancelAnimationFrame(this._raf);
    const tick = (now) => {
      this._draw(now - this._startTime);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  destroy() {
    this.stop();
    this._resizeObserver?.disconnect();
  }

  toCanvas(v) {
    const pad = 24;
    return {
      x: pad + v.x * (this.w - pad * 2),
      y: pad + v.y * (this.h - pad * 2),
    };
  }

  _drawGrid() {
    const step = 40;
    this.ctx.strokeStyle = 'rgba(1, 100, 79, 0.18)';
    this.ctx.lineWidth = 1;
    for (let x = 0; x < this.w; x += step) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.h);
      this.ctx.stroke();
    }
    for (let y = 0; y < this.h; y += step) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.w, y);
      this.ctx.stroke();
    }
  }

  _drawPolygon(verts, { fill = true, closed = true, highlightEdge = -1, edgeLabels = {} } = {}) {
    if (verts.length < 2) return;
    const pts = verts.map((v) => this.toCanvas(v));

    this.ctx.beginPath();
    this.ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      this.ctx.lineTo(pts[i].x, pts[i].y);
    }
    if (closed && verts.length >= 3) this.ctx.closePath();

    if (fill && verts.length >= 3) {
      this.ctx.fillStyle = 'rgba(1, 100, 79, 0.15)';
      this.ctx.fill();
    }

    for (let i = 0; i < (closed ? verts.length : verts.length - 1); i++) {
      const j = (i + 1) % verts.length;
      const isHi = i === highlightEdge;
      this.ctx.strokeStyle = isHi ? '#e67e22' : ACCENT;
      this.ctx.lineWidth = isHi ? 3.5 : 2;
      this.ctx.beginPath();
      this.ctx.moveTo(pts[i].x, pts[i].y);
      this.ctx.lineTo(pts[j].x, pts[j].y);
      this.ctx.stroke();

      if (edgeLabels[i]) {
        const mx = (pts[i].x + pts[j].x) / 2;
        const my = (pts[i].y + pts[j].y) / 2;
        this.ctx.fillStyle = isHi ? '#e67e22' : '#333';
        this.ctx.font = 'bold 11px system-ui';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'bottom';
        this.ctx.fillText(edgeLabels[i], mx, my - 4);
      }
    }
  }

  _drawVertices(verts, { visibleCount = verts.length, activeIdx = -1, pulseIdx = -1, pulseT = 0, hideIdx = -1 } = {}) {
    for (let i = 0; i < visibleCount; i++) {
      if (i === hideIdx) continue;
      const v = verts[i];
      const p = this.toCanvas(v);
      const isA = i === 0;
      const isActive = i === activeIdx;
      const isPulse = i === pulseIdx;

      let r = isA && visibleCount < verts.length ? 9 : 7;
      if (isActive) r = 10;
      if (isPulse) {
        this.ctx.strokeStyle = 'rgba(229, 57, 53, 0.6)';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, r + 6 + pulseT * 14, 0, Math.PI * 2);
        this.ctx.stroke();
      }

      this.ctx.fillStyle = isA && visibleCount < verts.length ? '#e53935' : ACCENT;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  _drawCursor(x, y, { clicking = false, visible = true } = {}) {
    if (!visible) return;
    const scale = clicking ? 0.88 : 1;
    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.scale(scale, scale);

    this.ctx.shadowColor = 'rgba(0,0,0,0.35)';
    this.ctx.shadowBlur = 4;
    this.ctx.shadowOffsetX = 1;
    this.ctx.shadowOffsetY = 2;

    this.ctx.fillStyle = '#fff';
    this.ctx.strokeStyle = '#222';
    this.ctx.lineWidth = 1.2;
    this.ctx.beginPath();
    this.ctx.moveTo(0, 0);
    this.ctx.lineTo(0, 18);
    this.ctx.lineTo(5, 14);
    this.ctx.lineTo(9, 22);
    this.ctx.lineTo(12, 20);
    this.ctx.lineTo(8, 12);
    this.ctx.lineTo(14, 11);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.restore();

    if (clicking) {
      this.ctx.fillStyle = 'rgba(1, 100, 79, 0.35)';
      this.ctx.beginPath();
      this.ctx.arc(x, y, 10, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  _drawKeypadHint(x, y, value = '5.00') {
    this.ctx.fillStyle = '#fff';
    this.ctx.strokeStyle = '#ddd';
    this.ctx.lineWidth = 1;
    this.ctx.shadowColor = 'rgba(0,0,0,0.15)';
    this.ctx.shadowBlur = 8;
    const kw = 72;
    const kh = 48;
    this.ctx.fillRect(x, y, kw, kh);
    this.ctx.strokeRect(x, y, kw, kh);
    this.ctx.shadowBlur = 0;
    this.ctx.fillStyle = ACCENT;
    this.ctx.font = 'bold 14px system-ui';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(value, x + kw / 2, y + kh / 2 + 5);
  }

  _drawEdgeActionButtons(x, y) {
    const labels = ['Размер', 'Проёмы'];
    const gap = 4;
    const pw = 52;
    const ph = 20;
    const totalW = labels.length * pw + (labels.length - 1) * gap;
    let bx = x - totalW / 2;
    const by = y - ph - 6;
    labels.forEach((label) => {
      this.ctx.fillStyle = '#fff';
      this.ctx.strokeStyle = '#d8e0dc';
      this.ctx.lineWidth = 1;
      this.ctx.shadowColor = 'rgba(0,0,0,0.12)';
      this.ctx.shadowBlur = 6;
      this.ctx.fillRect(bx, by, pw, ph);
      this.ctx.strokeRect(bx + 0.5, by + 0.5, pw - 1, ph - 1);
      this.ctx.shadowBlur = 0;
      this.ctx.fillStyle = ACCENT;
      this.ctx.font = '600 9px system-ui';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(label, bx + pw / 2, by + ph / 2);
      bx += pw + gap;
    });
  }

  _drawCameraIcon(x, y, pulse = 0) {
    const r = 14 + pulse * 3;
    this.ctx.fillStyle = '#fff';
    this.ctx.strokeStyle = ACCENT;
    this.ctx.lineWidth = 1.5;
    this.ctx.shadowColor = 'rgba(0,0,0,0.15)';
    this.ctx.shadowBlur = 8;
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.shadowBlur = 0;
    this.ctx.strokeStyle = ACCENT;
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.rect(x - 7, y - 4, 14, 10);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.arc(x, y + 1, 3, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  _drawDeleteDialog(x, y, label = 'D') {
    this.ctx.fillStyle = '#fff';
    this.ctx.strokeStyle = '#ddd';
    this.ctx.shadowColor = 'rgba(0,0,0,0.2)';
    this.ctx.shadowBlur = 10;
    const dw = 120;
    const dh = 52;
    this.ctx.fillRect(x - dw / 2, y - dh / 2, dw, dh);
    this.ctx.strokeRect(x - dw / 2, y - dh / 2, dw, dh);
    this.ctx.shadowBlur = 0;
    this.ctx.fillStyle = '#333';
    this.ctx.font = '11px system-ui';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`Удалить «${label}»?`, x, y - 4);
    this.ctx.fillStyle = '#e53935';
    this.ctx.font = 'bold 10px system-ui';
    this.ctx.fillText('Удалить', x + 24, y + 14);
    this.ctx.fillStyle = '#888';
    this.ctx.fillText('Отмена', x - 24, y + 14);
  }

  _drawDoneBadge() {
    const cx = this.w / 2;
    const cy = this.h / 2 + 10;
    this.ctx.fillStyle = ACCENT;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, 28, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 3;
    this.ctx.lineCap = 'round';
    this.ctx.beginPath();
    this.ctx.moveTo(cx - 10, cy);
    this.ctx.lineTo(cx - 2, cy + 9);
    this.ctx.lineTo(cx + 12, cy - 8);
    this.ctx.stroke();
  }

  _animDraw(elapsed) {
    const cycle = 4500;
    const t = (elapsed % cycle) / cycle;
    const n = L_ROOM.length;

    this._drawGrid();

    const clickDur = 0.08;
    const moveDur = 0.12;
    const stepDur = moveDur + clickDur;
    const closeStart = n * stepDur + 0.15;
    const closeDur = 0.35;
    const holdEnd = closeStart + closeDur + 0.8;

    let visibleCount = 0;
    let cursorX = this.toCanvas(L_ROOM[0]).x - 40;
    let cursorY = this.toCanvas(L_ROOM[0]).y - 40;
    let clicking = false;
    let closePulse = false;

    if (t < closeStart) {
      const step = Math.floor(t / stepDur);
      const localT = (t % stepDur) / stepDur;
      const moveFrac = moveDur / stepDur;

      // Точка и линия появляются только после завершения анимации клика
      visibleCount = step;
      if (localT >= moveFrac) {
        const clickT = (localT - moveFrac) / (1 - moveFrac);
        if (clickT >= 0.95) {
          visibleCount = Math.min(step + 1, n);
        }
      }

      const from = step > 0 ? L_ROOM[step - 1] : { x: L_ROOM[0].x - 0.08, y: L_ROOM[0].y - 0.08 };
      const to = L_ROOM[clamp(step, 0, n - 1)];
      const p = localT < moveFrac
        ? easeInOut(localT / moveFrac)
        : 1;
      const fp = this.toCanvas({ x: lerp(from.x, to.x, p), y: lerp(from.y, to.y, p) });
      cursorX = fp.x;
      cursorY = fp.y;
      clicking = localT >= moveFrac;
    } else if (t < closeStart + closeDur) {
      visibleCount = n;
      const p = this.toCanvas(L_ROOM[0]);
      const from = this.toCanvas(L_ROOM[n - 1]);
      const lt = (t - closeStart) / closeDur;
      cursorX = lerp(from.x, p.x, easeInOut(lt));
      cursorY = lerp(from.y, p.y, easeInOut(lt));
      clicking = lt > 0.85;
      closePulse = lt > 0.85;
    } else if (t < holdEnd) {
      visibleCount = n;
      const p = this.toCanvas(L_ROOM[0]);
      cursorX = p.x;
      cursorY = p.y;
      closePulse = true;
    } else {
      visibleCount = n;
      cursorX = -100;
      cursorY = -100;
    }

    const partial = L_ROOM.slice(0, visibleCount);
    if (visibleCount >= 2) {
      this._drawPolygon(partial, { fill: visibleCount >= 3, closed: visibleCount >= n && t >= closeStart + closeDur * 0.9 });
    }
    this._drawVertices(L_ROOM, {
      visibleCount: t >= closeStart + closeDur ? n : visibleCount,
      pulseIdx: closePulse ? 0 : -1,
      pulseT: closePulse ? 0.5 : 0,
    });
    this._drawCursor(cursorX, cursorY, { clicking, visible: t < holdEnd });
  }

  _animDimension(elapsed) {
    const cycle = 4000;
    const t = (elapsed % cycle) / cycle;
    this._drawGrid();

    const labels = {};
    if (t > 0.45) labels[0] = '5.00 м';
    if (t > 0.88) labels[2] = '3.50 м';
    const highlightEdge =
      t > 0.42 && t < 0.55 ? 0 : (t > 0.82 && t < 0.92 ? 2 : -1);
    this._drawPolygon(L_ROOM, { fill: true, highlightEdge, edgeLabels: labels });
    this._drawVertices(L_ROOM);

    let cx = -100;
    let cy = -100;
    let clicking = false;
    if (t >= 0.1 && t < 0.5) {
      const p0 = this.toCanvas(L_ROOM[0]);
      const p1 = this.toCanvas(L_ROOM[1]);
      const from = { x: p0.x - 30, y: p0.y - 30 };
      const target = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const lt = (t - 0.1) / 0.35;
      cx = lerp(from.x, target.x, easeInOut(clamp(lt, 0, 1)));
      cy = lerp(from.y, target.y, easeInOut(clamp(lt, 0, 1)));
      clicking = lt > 0.85 && lt < 1;
      if (t > 0.42 && t < 0.55) {
        this._drawEdgeActionButtons(target.x, target.y);
        if (t > 0.48) this._drawKeypadHint(target.x + 50, target.y - 36, '5.00');
      }
    } else if (t >= 0.6 && t < 0.9) {
      const p2 = this.toCanvas(L_ROOM[2]);
      const p3 = this.toCanvas(L_ROOM[3]);
      const target = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
      const lt = (t - 0.6) / 0.25;
      cx = lerp(target.x + 40, target.x, easeInOut(clamp(lt, 0, 1)));
      cy = lerp(target.y - 40, target.y, easeInOut(clamp(lt, 0, 1)));
      clicking = lt > 0.85;
    }
    this._drawCursor(cx, cy, { clicking, visible: t < 0.92 });
  }

  _animDrag(elapsed) {
    const cycle = 3500;
    const t = (elapsed % cycle) / cycle;
    this._drawGrid();

    const dragIdx = 3;
    const verts = L_ROOM.map((v) => ({ ...v }));
    const base = L_ROOM[dragIdx];

    let cx = -100;
    let cy = -100;
    let clicking = false;

    if (t < 0.25) {
      const p = this.toCanvas(base);
      const from = { x: p.x + 50, y: p.y + 40 };
      const lt = t / 0.25;
      cx = lerp(from.x, p.x, easeInOut(lt));
      cy = lerp(from.y, p.y, easeInOut(lt));
    } else if (t < 0.75) {
      clicking = true;
      const lt = (t - 0.25) / 0.5;
      verts[dragIdx] = {
        ...base,
        x: lerp(base.x, base.x + 0.12, easeInOut(lt)),
        y: lerp(base.y, base.y - 0.08, easeInOut(lt)),
      };
      const p = this.toCanvas(verts[dragIdx]);
      cx = p.x;
      cy = p.y;
    } else {
      const p = this.toCanvas(verts[dragIdx]);
      cx = p.x + 30;
      cy = p.y + 30;
    }

    this._drawPolygon(verts, { fill: true });
    this._drawVertices(verts, { activeIdx: t >= 0.25 && t < 0.75 ? dragIdx : -1 });
    this._drawCursor(cx, cy, { clicking: t >= 0.25 && t < 0.75, visible: t < 0.9 });
  }

  _animDelete(elapsed) {
    const cycle = 4500;
    const t = (elapsed % cycle) / cycle;
    const deleteIdx = 3;
    const deleted = t > 0.75;
    const verts = deleted ? L_ROOM.filter((_, i) => i !== deleteIdx) : L_ROOM;

    this._drawGrid();
    this._drawPolygon(verts, { fill: true, highlightEdge: deleted ? 2 : -1 });
    this._drawVertices(L_ROOM, {
      pulseIdx: t >= 0.2 && t < 0.55 ? deleteIdx : -1,
      pulseT: t >= 0.2 && t < 0.55 ? ((t - 0.2) / 0.35) : 0,
      hideIdx: deleted ? deleteIdx : -1,
    });

    const p = this.toCanvas(L_ROOM[deleteIdx]);
    const dialogY = p.y - 36;
    const deleteBtn = { x: p.x + 24, y: dialogY + 14 };
    let cx = -100;
    let cy = -100;
    let clicking = false;
    if (t < 0.2) {
      cx = lerp(p.x + 60, p.x, easeInOut(t / 0.2));
      cy = lerp(p.y + 40, p.y, easeInOut(t / 0.2));
    } else if (t < 0.55) {
      cx = p.x;
      cy = p.y;
      clicking = true;
    } else if (t < 0.65) {
      cx = p.x;
      cy = p.y;
      this._drawDeleteDialog(p.x, dialogY, 'D');
    } else if (t < 0.75) {
      this._drawDeleteDialog(p.x, dialogY, 'D');
      const lt = (t - 0.65) / 0.1;
      cx = lerp(p.x, deleteBtn.x, easeInOut(clamp(lt, 0, 1)));
      cy = lerp(p.y, deleteBtn.y, easeInOut(clamp(lt, 0, 1)));
      clicking = lt > 0.85;
    } else {
      cx = deleteBtn.x + 40;
      cy = deleteBtn.y + 40;
    }
    this._drawCursor(cx, cy, { clicking, visible: t < 0.85 });
  }

  _animPhoto(elapsed) {
    const cycle = 3500;
    const t = (elapsed % cycle) / cycle;
    this._drawGrid();
    this._drawPolygon(L_ROOM, { fill: true, edgeLabels: { 0: '5.0 м', 1: '3.5 м', 2: '2.8 м', 3: '2.0 м', 4: '1.5 м', 5: '4.2 м' } });
    this._drawVertices(L_ROOM);

    const camX = this.w - 36;
    const camY = this.h - 28;
    const pulse = t > 0.15 && t < 0.45 ? Math.sin((t - 0.15) * Math.PI / 0.3) * 0.5 : 0;
    this._drawCameraIcon(camX, camY, pulse);

    if (t > 0.5) {
      this.ctx.globalAlpha = easeInOut(clamp((t - 0.5) / 0.35, 0, 1)) * 0.35;
      this.ctx.fillStyle = '#888';
      this.ctx.fillRect(this.w * 0.2, this.h * 0.25, this.w * 0.6, this.h * 0.5);
      this.ctx.globalAlpha = 1;
    }

    let cx = camX;
    let cy = camY + 30;
    let clicking = false;
    if (t > 0.1 && t < 0.4) {
      const lt = (t - 0.1) / 0.3;
      cx = lerp(this.w / 2, camX, easeInOut(clamp(lt, 0, 1)));
      cy = lerp(this.h / 2, camY, easeInOut(clamp(lt, 0, 1)));
      clicking = lt > 0.85;
    }
    this._drawCursor(cx, cy, { clicking, visible: t < 0.85 });
  }

  _drawWheelIcon(x, y, pulse = 0) {
    const r = 12 + pulse * 2;
    this.ctx.fillStyle = '#fff';
    this.ctx.strokeStyle = ACCENT;
    this.ctx.lineWidth = 1.5;
    this.ctx.shadowColor = 'rgba(0,0,0,0.12)';
    this.ctx.shadowBlur = 6;
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.shadowBlur = 0;
    this.ctx.strokeStyle = '#666';
    this.ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.ctx.beginPath();
      this.ctx.moveTo(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4));
      this.ctx.lineTo(x + Math.cos(a) * (r - 1), y + Math.sin(a) * (r - 1));
      this.ctx.stroke();
    }
  }

  _drawPanHand(x, y, grabbing = false) {
    this.ctx.font = `${grabbing ? 22 : 20}px system-ui`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(grabbing ? '✊' : '✋', x, y);
  }

  _animNavigation(elapsed) {
    const cycle = 5000;
    const t = (elapsed % cycle) / cycle;
    this._drawGrid();

    const zoomPhase = t < 0.45;
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;

    if (zoomPhase) {
      const lt = t / 0.45;
      scale = lt < 0.5
        ? lerp(1, 1.35, easeInOut(lt / 0.5))
        : lerp(1.35, 1, easeInOut((lt - 0.5) / 0.5));
    } else {
      const lt = (t - 0.45) / 0.45;
      offsetX = lerp(0, -28, easeInOut(lt));
      offsetY = lerp(0, -18, easeInOut(lt));
    }

    this.ctx.save();
    this.ctx.translate(this.w / 2 + offsetX, this.h / 2 + offsetY);
    this.ctx.scale(scale, scale);
    this.ctx.translate(-this.w / 2, -this.h / 2);
    this._drawPolygon(L_ROOM, { fill: true, edgeLabels: { 0: '5.0 м', 1: '3.5 м' } });
    this._drawVertices(L_ROOM);
    this.ctx.restore();

    if (zoomPhase) {
      const wheelX = this.w - 42;
      const wheelY = this.h - 36;
      const pulse = Math.sin(t * Math.PI * 4) * 0.3;
      this._drawWheelIcon(wheelX, wheelY, pulse);
      this.ctx.fillStyle = '#556';
      this.ctx.font = '600 10px system-ui';
      this.ctx.textAlign = 'right';
      this.ctx.fillText('колёсико', wheelX - 16, wheelY + 4);
      this._drawCursor(wheelX + 18, wheelY + 18, { visible: t < 0.42, clicking: false });
    } else {
      const handX = this.w * 0.55 + offsetX;
      const handY = this.h * 0.5 + offsetY;
      this._drawPanHand(handX, handY, t > 0.6);
      this.ctx.fillStyle = '#556';
      this.ctx.font = '600 10px system-ui';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('зажать колёсико', handX, handY + 28);
    }
  }

  _animSketchOpenings(elapsed) {
    const cycle = 4500;
    const t = (elapsed % cycle) / cycle;
    this._drawGrid();

    const highlightEdge = t > 0.38 && t < 0.78 ? 2 : -1;
    const labels = {};
    if (t > 0.35) labels[2] = '5.00 м';
    this._drawPolygon(RECT_ROOM, { fill: true, highlightEdge, edgeLabels: labels });
    this._drawVertices(RECT_ROOM);

    const p2 = this.toCanvas(RECT_ROOM[2]);
    const p3 = this.toCanvas(RECT_ROOM[3]);
    const mx = (p2.x + p3.x) / 2;
    const my = (p2.y + p3.y) / 2;

    if (t > 0.72) {
      const doorT1 = 0.38;
      const doorT2 = 0.62;
      const x1 = p3.x + (p2.x - p3.x) * doorT1;
      const y1 = p3.y + (p2.y - p3.y) * doorT1;
      const x2 = p3.x + (p2.x - p3.x) * doorT2;
      const y2 = p3.y + (p2.y - p3.y) * doorT2;
      this.ctx.strokeStyle = '#e67e22';
      this.ctx.lineWidth = 5;
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();
      this.ctx.fillStyle = '#e67e22';
      this.ctx.font = '600 9px system-ui';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'top';
      this.ctx.fillText('дверь 0.9 м', (x1 + x2) / 2, Math.max(y1, y2) + 6);
    }

    let cx = -100;
    let cy = -100;
    let clicking = false;

    if (t < 0.35) {
      const lt = t / 0.35;
      cx = lerp(this.w * 0.35, mx, easeInOut(lt));
      cy = lerp(this.h * 0.35, my, easeInOut(lt));
      clicking = lt > 0.85;
    } else if (t < 0.55) {
      cx = mx;
      cy = my;
      this._drawEdgeActionButtons(mx, my - 8);
      clicking = t > 0.48 && t < 0.54;
    } else if (t < 0.75) {
      const btnW = 52;
      const totalW = btnW * 2 + 4;
      const btnX = mx - totalW / 2 + btnW + 4 + btnW / 2;
      const btnY = my - 8 - 20 - 6 - 10;
      const lt = (t - 0.55) / 0.2;
      cx = lerp(mx, btnX, easeInOut(clamp(lt, 0, 1)));
      cy = lerp(my, btnY, easeInOut(clamp(lt, 0, 1)));
      this._drawEdgeActionButtons(mx, my - 8);
      clicking = lt > 0.85;
    } else {
      cx = mx + 40;
      cy = my + 40;
    }

    this._drawCursor(cx, cy, { clicking, visible: t < 0.82 });
  }

  _animDone(elapsed) {
    const cycle = 3000;
    const t = (elapsed % cycle) / cycle;
    this._drawGrid();
    const labels = { 0: '5.0 м', 1: '3.5 м', 2: '2.8 м', 3: '2.0 м', 4: '1.5 м', 5: '4.2 м' };
    this._drawPolygon(L_ROOM, { fill: true, edgeLabels: labels });
    this._drawVertices(L_ROOM);

    if (t > 0.3) {
      this.ctx.globalAlpha = easeInOut(clamp((t - 0.3) / 0.3, 0, 1));
      this._drawDoneBadge();
      this.ctx.globalAlpha = 1;
    }
  }

  _draw(elapsed) {
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.ctx.fillStyle = '#eef2f0';
    this.ctx.fillRect(0, 0, this.w, this.h);

    switch (this.mode) {
      case 'draw': this._animDraw(elapsed); break;
      case 'dimension': this._animDimension(elapsed); break;
      case 'drag': this._animDrag(elapsed); break;
      case 'delete': this._animDelete(elapsed); break;
      case 'navigation': this._animNavigation(elapsed); break;
      case 'photo': this._animPhoto(elapsed); break;
      case 'sketch-openings': this._animSketchOpenings(elapsed); break;
      case 'done': this._animDone(elapsed); break;
      case 'wall-select': this._animWallSelect(elapsed); break;
      case 'wall-opening': this._animWallOpening(elapsed); break;
      case 'wall-form': this._animWallForm(elapsed); break;
      default: this._animDraw(elapsed);
    }
  }

  _drawMiniPlan(highlightWall = -1) {
    const walls = [
      [{ x: 0.15, y: 0.2 }, { x: 0.85, y: 0.2 }],
      [{ x: 0.85, y: 0.2 }, { x: 0.85, y: 0.8 }],
      [{ x: 0.85, y: 0.8 }, { x: 0.15, y: 0.8 }],
      [{ x: 0.15, y: 0.8 }, { x: 0.15, y: 0.2 }],
    ];
    walls.forEach((w, i) => {
      const a = this.toCanvas(w[0]);
      const b = this.toCanvas(w[1]);
      this.ctx.strokeStyle = i === highlightWall ? '#e67e22' : ACCENT;
      this.ctx.lineWidth = i === highlightWall ? 4 : 2;
      this.ctx.beginPath();
      this.ctx.moveTo(a.x, a.y);
      this.ctx.lineTo(b.x, b.y);
      this.ctx.stroke();
    });
    this.ctx.fillStyle = 'rgba(1, 100, 79, 0.12)';
    const poly = walls.flatMap((w) => this.toCanvas(w[0]));
    this.ctx.beginPath();
    poly.forEach((p, i) => (i === 0 ? this.ctx.moveTo(p.x, p.y) : this.ctx.lineTo(p.x, p.y)));
    this.ctx.closePath();
    this.ctx.fill();
  }

  _animWallSelect(elapsed) {
    const cycle = 3000;
    const t = (elapsed % cycle) / cycle;
    this._drawGrid();
    this._drawMiniPlan(t > 0.55 ? 1 : -1);
    const target = this.toCanvas({ x: 0.85, y: 0.5 });
    let cx = -100;
    let cy = -100;
    let clicking = false;
    if (t < 0.5) {
      cx = lerp(this.w * 0.3, target.x, easeInOut(t / 0.5));
      cy = lerp(this.h * 0.3, target.y, easeInOut(t / 0.5));
      clicking = t > 0.42;
    } else {
      cx = target.x + 35;
      cy = target.y;
    }
    this._drawCursor(cx, cy, { clicking, visible: t < 0.85 });
  }

  _drawWallElevation(doorXRatio = 0.55) {
    const x0 = this.w * 0.12;
    const y0 = this.h * 0.22;
    const ww = this.w * 0.76;
    const wh = this.h * 0.56;
    this.ctx.strokeStyle = ACCENT;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x0, y0, ww, wh);
    this.ctx.fillStyle = 'rgba(1, 100, 79, 0.08)';
    this.ctx.fillRect(x0, y0, ww, wh);

    const doorW = ww * 0.18;
    const doorH = wh * 0.35;
    const doorX = x0 + ww * doorXRatio;
    const doorY = y0 + wh - doorH;
    this.ctx.fillStyle = '#fff';
    this.ctx.strokeStyle = ACCENT;
    this.ctx.lineWidth = 2;
    this.ctx.fillRect(doorX, doorY, doorW, doorH);
    this.ctx.strokeRect(doorX, doorY, doorW, doorH);
    this.ctx.fillStyle = '#666';
    this.ctx.font = '10px system-ui';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('дверь', doorX + doorW / 2, doorY + doorH / 2 + 3);
    return { x0, y0, ww, wh, doorW, doorH, doorX, doorY };
  }

  _animWallOpening(elapsed) {
    const cycle = 3500;
    const t = (elapsed % cycle) / cycle;
    this._drawGrid();
    let doorRatio = 0.15;
    if (t >= 0.35 && t < 0.7) {
      doorRatio = lerp(0.15, 0.55, easeInOut((t - 0.35) / 0.35));
    } else if (t >= 0.7) {
      doorRatio = 0.55;
    }
    const { doorW, doorH, doorX, doorY } = this._drawWallElevation(doorRatio);

    let cx = -100;
    let cy = -100;
    let clicking = false;
    if (t < 0.25) {
      cx = lerp(this.w * 0.5, doorX + doorW / 2, easeInOut(t / 0.25));
      cy = lerp(this.h * 0.15, doorY + doorH / 2, easeInOut(t / 0.25));
      clicking = t > 0.18;
    } else if (t < 0.7) {
      clicking = true;
      cx = doorX + doorW / 2;
      cy = doorY + doorH / 2;
    }
    this._drawCursor(cx, cy, { clicking, visible: t < 0.85 });
  }

  _animWallForm(elapsed) {
    const cycle = 3500;
    const t = (elapsed % cycle) / cycle;
    this._drawGrid();
    const { doorW, doorH, doorX, doorY } = this._drawWallElevation(0.55);

    if (t > 0.55) {
      this.ctx.strokeStyle = '#e67e22';
      this.ctx.lineWidth = 3;
      this.ctx.strokeRect(doorX - 2, doorY - 2, doorW + 4, doorH + 4);
    }
    if (t > 0.62) {
      this._drawKeypadHint(Math.min(doorX + doorW + 8, this.w - 80), doorY, '0.90');
    }

    let cx = -100;
    let cy = -100;
    if (t >= 0.15 && t < 0.5) {
      cx = lerp(this.w * 0.7, doorX + doorW / 2, easeInOut((t - 0.15) / 0.3));
      cy = lerp(this.h * 0.7, doorY + doorH / 2, easeInOut((t - 0.15) / 0.3));
    } else if (t >= 0.5) {
      cx = Math.min(doorX + doorW + 40, this.w - 40);
      cy = doorY + 24;
    }
    this._drawCursor(cx, cy, { clicking: t > 0.4 && t < 0.55, visible: t < 0.9 });
  }
}

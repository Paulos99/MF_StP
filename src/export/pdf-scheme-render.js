/**
 * Dedicated print/PDF scheme renderer.
 * Draws floor plans, ceiling layouts and wall elevations onto offscreen canvases
 * with light print styling — not screenshots of the on-screen UI.
 */
import { OPENING_TYPES } from '../core/constants.js';
import { getBounds, rectInsidePolygon } from '../core/polygon-geometry.js';
import {
  drawFrameGrid,
  drawWallFrameGrid,
  getCeilingFrameBounds,
  getWallFrameBounds,
} from '../visualizers/frame-overlay.js';

const BRAND = '#01644f';
const PRINT = {
  bg: '#ffffff',
  roomFill: '#f3f6f5',
  panelFill: '#d9e4e0',
  panelStroke: '#2c3e3a',
  cutFill: '#c5d4cf',
  openingFill: '#e8eef1',
  openingStroke: '#6b7c86',
  dim: BRAND,
  wallStroke: BRAND,
  text: '#24312e',
  muted: '#5f6b73',
};

function createPrintSurface(cssW, cssH, pixelRatio = 2.5) {
  const canvas = document.createElement('canvas');
  const w = Math.max(1, Math.round(cssW));
  const h = Math.max(1, Math.round(cssH));
  canvas.width = Math.round(w * pixelRatio);
  canvas.height = Math.round(h * pixelRatio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.fillStyle = PRINT.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx, w, h };
}

function toDataUrl(canvas) {
  return canvas.toDataURL('image/png');
}

function makeCutPattern(ctx, baseColor) {
  const tile = document.createElement('canvas');
  tile.width = 10;
  tile.height = 10;
  const t = tile.getContext('2d');
  t.fillStyle = baseColor;
  t.fillRect(0, 0, 10, 10);
  t.strokeStyle = 'rgba(44,62,58,0.45)';
  t.lineWidth = 1.2;
  t.beginPath();
  t.moveTo(0, 10);
  t.lineTo(10, 0);
  t.stroke();
  return ctx.createPattern(tile, 'repeat');
}

function strokeExternalEdges(ctx, parts, mapEdge) {
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
        const onBorder = Math.abs(q.y - e.y1) < eps || Math.abs(q.y + q.h - e.y1) < eps;
        if (!onBorder) continue;
        if (Math.min(e.x2, q.x + q.w) - Math.max(e.x1, q.x) > eps) return true;
      } else {
        const onBorder = Math.abs(q.x - e.x1) < eps || Math.abs(q.x + q.w - e.x1) < eps;
        if (!onBorder) continue;
        if (Math.min(e.y2, q.y + q.h) - Math.max(e.y1, q.y) > eps) return true;
      }
    }
    return false;
  };
  ctx.beginPath();
  for (const e of edges) {
    if (isInternal(e)) continue;
    const a = mapEdge(e.x1, e.y1);
    const b = mapEdge(e.x2, e.y2);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
}

function panelParts(panel) {
  if (typeof panel.getParts === 'function') return panel.getParts();
  return [{ x: panel.x, y: panel.y, w: panel.width, h: panel.height }];
}

function visibleLabelMeta(panel) {
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
    parts = panelParts(panel);
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
  return {
    x: best.x + best.w / 2,
    y: best.y + best.h / 2,
    vw: best.w,
    vh: best.h,
  };
}

function shouldShowNumbers(panels, scale) {
  if (!panels?.length) return false;
  if (panels.length > 120) return false;
  let areaSum = 0;
  for (const p of panels) areaSum += Math.max(p.width, 0.01) * Math.max(p.height, 0.01);
  const avgSide = Math.sqrt(areaSum / panels.length) * scale;
  return avgSide >= 14;
}

function drawDimH(ctx, x1, x2, y, label) {
  ctx.save();
  ctx.strokeStyle = PRINT.dim;
  ctx.fillStyle = PRINT.dim;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.moveTo(x1, y - 5);
  ctx.lineTo(x1, y + 5);
  ctx.moveTo(x2, y - 5);
  ctx.lineTo(x2, y + 5);
  ctx.stroke();
  ctx.font = 'bold 13px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, (x1 + x2) / 2, y - 7);
  ctx.restore();
}

function drawDimV(ctx, y1, y2, x, label) {
  ctx.save();
  ctx.strokeStyle = PRINT.dim;
  ctx.fillStyle = PRINT.dim;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y1);
  ctx.lineTo(x, y2);
  ctx.moveTo(x - 5, y1);
  ctx.lineTo(x + 5, y1);
  ctx.moveTo(x - 5, y2);
  ctx.lineTo(x + 5, y2);
  ctx.stroke();
  ctx.font = 'bold 13px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.translate(x - 8, (y1 + y2) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

/**
 * Floor plan (top view) for the summary PDF page.
 */
export function renderPlanSchemeForPdf(room) {
  const verts = room?.vertices ?? [];
  if (verts.length < 3) return null;

  const b = getBounds(verts);
  const rw = Math.max(b.maxX - b.minX, 0.5);
  const rh = Math.max(b.maxY - b.minY, 0.5);
  const padL = 56;
  const padR = 36;
  const padT = 44;
  const padB = 36;
  const maxInnerW = 880;
  const maxInnerH = 620;
  const scale = Math.min(maxInnerW / rw, maxInnerH / rh);
  const { canvas, ctx, w, h } = createPrintSurface(padL + rw * scale + padR, padT + rh * scale + padB);
  const ox = padL - b.minX * scale;
  const oy = padT - b.minY * scale;

  // Room fill
  ctx.beginPath();
  ctx.moveTo(ox + verts[0].x * scale, oy + verts[0].y * scale);
  for (let i = 1; i < verts.length; i++) {
    ctx.lineTo(ox + verts[i].x * scale, oy + verts[i].y * scale);
  }
  ctx.closePath();
  ctx.fillStyle = PRINT.roomFill;
  ctx.fill();
  ctx.strokeStyle = PRINT.wallStroke;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Walls + labels
  for (const wall of room.walls ?? []) {
    const x1 = ox + wall.planStart.x * scale;
    const y1 = oy + wall.planStart.y * scale;
    const x2 = ox + wall.planEnd.x * scale;
    const y2 = oy + wall.planEnd.y * scale;
    ctx.strokeStyle = PRINT.wallStroke;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 12;
    const ny = (dx / len) * 12;
    ctx.fillStyle = PRINT.text;
    ctx.font = 'bold 12px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const short = String(wall.label || '').replace(/^Стена\s+/i, '');
    ctx.fillText(short, mx + nx, my + ny);

    // Length along wall (inside)
    ctx.fillStyle = PRINT.muted;
    ctx.font = '11px Arial, sans-serif';
    ctx.fillText(`${wall.length.toFixed(2)} м`, mx - nx * 0.35, my - ny * 0.35);
  }

  // Openings
  for (const o of room.openings ?? []) {
    const wall = room.walls?.find((w) => w.id === o.wallId);
    if (!wall) continue;
    const x1 = ox + wall.planStart.x * scale;
    const y1 = oy + wall.planStart.y * scale;
    const x2 = ox + wall.planEnd.x * scale;
    const y2 = oy + wall.planEnd.y * scale;
    const t1 = o.offset / wall.length;
    const t2 = (o.offset + o.width) / wall.length;
    ctx.strokeStyle = o.type === OPENING_TYPES.DOOR ? '#c0392b' : '#e67e22';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1);
    ctx.lineTo(x1 + (x2 - x1) * t2, y1 + (y2 - y1) * t2);
    ctx.stroke();
  }

  // Vertex dots (small, no UI chrome)
  for (const v of verts) {
    ctx.fillStyle = BRAND;
    ctx.beginPath();
    ctx.arc(ox + v.x * scale, oy + v.y * scale, 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (v.label) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(v.label, ox + v.x * scale, oy + v.y * scale);
    }
  }

  drawDimH(ctx, padL, padL + rw * scale, 22, `${rw.toFixed(2)} м`);
  drawDimV(ctx, padT, padT + rh * scale, 22, `${rh.toFixed(2)} м`);

  void w;
  void h;
  return toDataUrl(canvas);
}

/**
 * Ceiling panel layout for PDF.
 */
export function renderCeilingSchemeForPdf({
  vertices,
  offsetX = 0,
  offsetY = 0,
  panels = [],
  showFrame = false,
  frameBounds = null,
  showNumbers = true,
}) {
  const local = (vertices ?? []).map((v) => ({ x: v.x - offsetX, y: v.y - offsetY }));
  if (local.length < 3) return null;

  const roomB = getBounds(local);
  // Match on-screen ceiling scheme: frame the room, only a thin fringe for overhang waste.
  // Expanding to full cut-slot AABB previously drew a phantom extra row/column of hatch.
  const OVERHANG_VIEW_PAD_M = 0.08;
  const minX = roomB.minX - OVERHANG_VIEW_PAD_M;
  const minY = roomB.minY - OVERHANG_VIEW_PAD_M;
  const maxX = roomB.maxX + OVERHANG_VIEW_PAD_M;
  const maxY = roomB.maxY + OVERHANG_VIEW_PAD_M;
  const rw = Math.max(maxX - minX, 0.5);
  const rh = Math.max(maxY - minY, 0.5);
  const roomW = Math.max(roomB.maxX - roomB.minX, 0.5);
  const roomH = Math.max(roomB.maxY - roomB.minY, 0.5);
  const padL = 64;
  const padR = 40;
  const padT = 52;
  const padB = 40;
  const maxInnerW = 1100;
  const maxInnerH = 780;
  const scale = Math.min(maxInnerW / rw, maxInnerH / rh);
  const { canvas, ctx } = createPrintSurface(padL + rw * scale + padR, padT + rh * scale + padB);
  const ox = padL;
  const oy = padT;
  const mx = (x) => (x - minX) * scale;
  const my = (y) => (y - minY) * scale;

  const roomPath = () => {
    ctx.beginPath();
    ctx.moveTo(mx(local[0].x), my(local[0].y));
    for (let i = 1; i < local.length; i++) {
      ctx.lineTo(mx(local[i].x), my(local[i].y));
    }
    ctx.closePath();
  };

  /** Clamp a rect to the viewable overhang fringe (room ∪ pad). */
  const clampToView = (x, y, w, h) => {
    const x0 = Math.max(x, minX);
    const y0 = Math.max(y, minY);
    const x1 = Math.min(x + w, maxX);
    const y1 = Math.min(y + h, maxY);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  // Room background
  ctx.save();
  ctx.translate(ox, oy);
  roomPath();
  ctx.fillStyle = PRINT.roomFill;
  ctx.fill();
  ctx.strokeStyle = PRINT.panelStroke;
  ctx.lineWidth = 2;
  ctx.stroke();

  const cutPat = makeCutPattern(ctx, PRINT.cutFill);
  const numbersOk = showNumbers && shouldShowNumbers(panels, scale);
  const isOverhangCut = (panel) =>
    panel.isCut && !rectInsidePolygon(panel.x, panel.y, panel.width, panel.height, local);

  // Pass 1: hatch only the waste fringe outside the room (not a full extra row of slots)
  for (const panel of panels) {
    if (!isOverhangCut(panel)) continue;
    const view = clampToView(panel.x, panel.y, panel.width, panel.height);
    if (!view) continue;
    ctx.fillStyle = cutPat || PRINT.cutFill;
    ctx.fillRect(mx(view.x), my(view.y), view.w * scale, view.h * scale);
  }

  // Pass 2: solid fills inside the room; hatch only fully-inside cut remnants
  ctx.save();
  roomPath();
  ctx.clip();

  for (const panel of panels) {
    const parts = panelParts(panel);
    const overhang = isOverhangCut(panel);
    ctx.fillStyle =
      panel.isCut && !overhang ? cutPat || PRINT.cutFill : PRINT.panelFill;
    ctx.strokeStyle = PRINT.panelStroke;
    ctx.lineWidth = 1.1;
    for (const part of parts) {
      ctx.fillRect(mx(part.x), my(part.y), part.w * scale, part.h * scale);
    }
    if (!panel.isCut) {
      if (parts.length === 1) {
        const p = parts[0];
        ctx.strokeRect(mx(p.x), my(p.y), p.w * scale, p.h * scale);
      } else {
        strokeExternalEdges(ctx, parts, (x, y) => ({ x: mx(x), y: my(y) }));
      }
    }
  }

  if (numbersOk) {
    for (const panel of panels) {
      const label = visibleLabelMeta(panel);
      if (!label) continue;
      const fontPx = Math.max(7, Math.min(12, label.vh * scale * 0.5, label.vw * scale * 0.4));
      if (label.vw * scale < 10 || label.vh * scale < 9) continue;
      ctx.fillStyle = PRINT.text;
      ctx.font = `600 ${fontPx}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(panel.number), mx(label.x), my(label.y));
    }
  }

  if (showFrame && frameBounds) {
    // frame-overlay expects untranslated local metres × scale; shift by view origin
    ctx.save();
    ctx.translate(-minX * scale, -minY * scale);
    drawFrameGrid(ctx, frameBounds, scale, {
      showHangers: scale >= 28,
      clipPolygon: local,
    });
    ctx.restore();
  }
  ctx.restore(); // clip

  // Pass 3: dashed cut outlines, clamped to the same view fringe as the site
  for (const panel of panels) {
    if (!panel.isCut) continue;
    ctx.strokeStyle = PRINT.panelStroke;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([5, 3]);
    const parts = panelParts(panel);
    if (isOverhangCut(panel) || parts.length === 1) {
      const view = clampToView(panel.x, panel.y, panel.width, panel.height);
      if (view) {
        ctx.strokeRect(mx(view.x), my(view.y), view.w * scale, view.h * scale);
      }
    } else {
      strokeExternalEdges(ctx, parts, (x, y) => ({ x: mx(x), y: my(y) }));
    }
    ctx.setLineDash([]);
  }

  // Outer room stroke again (crisp, above hatch/dashes)
  roomPath();
  ctx.strokeStyle = PRINT.panelStroke;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.restore(); // translate

  drawDimH(
    ctx,
    ox + mx(roomB.minX),
    ox + mx(roomB.maxX),
    24,
    `${roomW.toFixed(2)} м`
  );
  drawDimV(
    ctx,
    oy + my(roomB.minY),
    oy + my(roomB.maxY),
    24,
    `${roomH.toFixed(2)} м`
  );

  return toDataUrl(canvas);
}

/**
 * Wall elevation for PDF. Does NOT draw the wall title (page header already has it).
 */
export function renderWallSchemeForPdf({
  wallResult,
  wallHeight,
  showFrame = false,
  showNumbers = true,
}) {
  if (!wallResult?.wall) return null;
  const { wall, panels = [], openings = [] } = wallResult;
  const wh = wallHeight || 2.7;
  const rw = Math.max(wall.length, 0.5);
  const rh = Math.max(wh, 0.5);

  const padL = 56;
  const padR = 36;
  const padT = 36; // no title — leave room only for top clearance
  const padB = 44;
  const maxInnerW = 1100;
  const maxInnerH = 720;
  const scale = Math.min(maxInnerW / rw, maxInnerH / rh, 90);
  const { canvas, ctx } = createPrintSurface(padL + rw * scale + padR, padT + rh * scale + padB);
  const ox = padL;
  const oy = padT;
  const w = rw * scale;
  const h = rh * scale;

  ctx.fillStyle = PRINT.roomFill;
  ctx.fillRect(ox, oy, w, h);
  ctx.strokeStyle = PRINT.panelStroke;
  ctx.lineWidth = 2;
  ctx.strokeRect(ox, oy, w, h);

  for (const o of openings) {
    const bottomY = o.type === OPENING_TYPES.WINDOW ? o.sillHeight : 0;
    const px = ox + o.offset * scale;
    const py = oy + h - (bottomY + o.height) * scale;
    ctx.fillStyle = PRINT.openingFill;
    ctx.fillRect(px, py, o.width * scale, o.height * scale);
    ctx.strokeStyle = PRINT.openingStroke;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px, py, o.width * scale, o.height * scale);
    if (o.width * scale > 36 && o.height * scale > 18) {
      ctx.fillStyle = PRINT.muted;
      ctx.font = '11px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        o.type === OPENING_TYPES.DOOR ? 'Дверь' : 'Окно',
        px + (o.width * scale) / 2,
        py + (o.height * scale) / 2
      );
    }
  }

  const cutPat = makeCutPattern(ctx, PRINT.cutFill);
  const numbersOk = showNumbers && shouldShowNumbers(panels, scale);

  for (const panel of panels) {
    const parts = panelParts(panel);
    ctx.fillStyle = panel.isCut ? cutPat || PRINT.cutFill : PRINT.panelFill;
    ctx.strokeStyle = PRINT.panelStroke;
    ctx.lineWidth = 1.1;
    ctx.setLineDash(panel.isCut ? [5, 3] : []);
    for (const part of parts) {
      const px = ox + part.x * scale;
      const py = oy + h - (part.y + part.h) * scale;
      ctx.fillRect(px, py, part.w * scale, part.h * scale);
    }
    strokeExternalEdges(ctx, parts, (x, y) => ({
      x: ox + x * scale,
      y: oy + h - y * scale,
    }));
    ctx.setLineDash([]);

    if (numbersOk) {
      const largest = parts.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
      const labelW = largest.w * scale;
      const labelH = largest.h * scale;
      if (labelW > 14 && labelH > 12) {
        const cx = ox + (largest.x + largest.w / 2) * scale;
        const cy = oy + h - (largest.y + largest.h / 2) * scale;
        const fontPx = Math.max(7, Math.min(11, labelH * 0.45));
        ctx.fillStyle = PRINT.text;
        ctx.font = `600 ${fontPx}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(panel.number), cx, cy);
      }
    }
  }

  if (showFrame) {
    ctx.save();
    ctx.translate(ox, oy);
    drawWallFrameGrid(ctx, getWallFrameBounds(wall.length, wh), scale, {
      showHangers: scale >= 28,
      openings,
    });
    ctx.restore();
  }

  // Dimensions only — no wall title (avoids overlap with page H1)
  drawDimH(ctx, ox, ox + w, oy + h + 28, `${wall.length.toFixed(2)} м`);
  drawDimV(ctx, oy, oy + h, ox - 28, `${wh.toFixed(2)} м`);

  return toDataUrl(canvas);
}

/**
 * Build all scheme images for a calculation PDF export.
 */
export function buildPdfSchemeImages({
  room,
  ceilingCalc,
  ceilingResult,
  wallResults = [],
  options = {},
  showNumbers = true,
  showFrame = false,
}) {
  const planImage = renderPlanSchemeForPdf(room);

  let ceilingImage = null;
  if (ceilingResult && ceilingCalc && room) {
    const framed = options.ceilingMounting === 'ceiling_framed' && showFrame;
    ceilingImage = renderCeilingSchemeForPdf({
      vertices: room.vertices,
      offsetX: ceilingCalc.offsetX ?? 0,
      offsetY: ceilingCalc.offsetY ?? 0,
      panels: ceilingResult.panels ?? [],
      showFrame: framed,
      frameBounds: framed ? getCeilingFrameBounds(room) : null,
      showNumbers,
    });
  }

  const wallSurfaces = (wallResults ?? []).map((wr) => {
    const framed = options.wallMounting === 'wall_framed' && showFrame;
    return {
      wallResult: wr,
      image: renderWallSchemeForPdf({
        wallResult: wr,
        wallHeight: room.wallHeight,
        showFrame: framed,
        showNumbers,
      }),
    };
  });

  return { planImage, ceilingImage, wallSurfaces };
}

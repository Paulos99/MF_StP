import { roundMeters } from './geometry.js';

export const GRID_STEP = 0.1; // 10 cm — точные размеры
export const DRAW_GRID_STEP = 1.0; // 1 м — построение формы в редакторе
export const VERTEX_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function labelForIndex(i) {
  return VERTEX_LABELS[i % VERTEX_LABELS.length];
}

export function cloneVertices(vertices) {
  return vertices.map((v) => ({ x: v.x, y: v.y, label: v.label }));
}

export function createRectangleVertices(length, width) {
  return [
    { x: 0, y: 0, label: 'A' },
    { x: length, y: 0, label: 'B' },
    { x: length, y: width, label: 'C' },
    { x: 0, y: width, label: 'D' },
  ];
}

export function createLShapeVertices(mainLength = 5, mainWidth = 4, legLength = 2, legWidth = 2) {
  return [
    { x: 0, y: 0, label: 'A' },
    { x: mainLength, y: 0, label: 'B' },
    { x: mainLength, y: mainWidth, label: 'C' },
    { x: legLength, y: mainWidth, label: 'D' },
    { x: legLength, y: mainWidth + legWidth, label: 'E' },
    { x: 0, y: mainWidth + legWidth, label: 'F' },
  ];
}

export function createMirrorLShapeVertices(mainLength = 5, mainWidth = 4, legLength = 2, legWidth = 2) {
  return [
    { x: 0, y: 0, label: 'A' },
    { x: mainLength, y: 0, label: 'B' },
    { x: mainLength, y: mainWidth + legWidth, label: 'C' },
    { x: mainLength - legLength, y: mainWidth + legWidth, label: 'D' },
    { x: mainLength - legLength, y: mainWidth, label: 'E' },
    { x: 0, y: mainWidth, label: 'F' },
  ];
}

export function createUShapeVertices(width = 8, height = 6, wall = 2) {
  return [
    { x: 0, y: height, label: 'A' },
    { x: 0, y: wall, label: 'B' },
    { x: wall, y: wall, label: 'C' },
    { x: width - wall, y: wall, label: 'D' },
    { x: width, y: wall, label: 'E' },
    { x: width, y: height, label: 'F' },
  ];
}

/** Т-образная форма */
export function createTShapeVertices(mainWidth = 6, mainDepth = 2, stemWidth = 2, stemDepth = 4) {
  const stemLeft = (mainWidth - stemWidth) / 2;
  const stemRight = stemLeft + stemWidth;
  return [
    { x: 0, y: 0, label: 'A' },
    { x: mainWidth, y: 0, label: 'B' },
    { x: mainWidth, y: mainDepth, label: 'C' },
    { x: stemRight, y: mainDepth, label: 'D' },
    { x: stemRight, y: mainDepth + stemDepth, label: 'E' },
    { x: stemLeft, y: mainDepth + stemDepth, label: 'F' },
    { x: stemLeft, y: mainDepth, label: 'G' },
    { x: 0, y: mainDepth, label: 'H' },
  ];
}

/** Комната со срезанным углом (пятиугольник) */
export function createCutCornerVertices(width = 6, height = 5, cut = 1.5) {
  return [
    { x: 0, y: 0, label: 'A' },
    { x: width, y: 0, label: 'B' },
    { x: width, y: height - cut, label: 'C' },
    { x: width - cut, y: height, label: 'D' },
    { x: 0, y: height, label: 'E' },
  ];
}

/** Ступенчатая Z-образная форма */
export function createZShapeVertices(topWidth = 4, totalWidth = 7, topDepth = 2, totalDepth = 5) {
  return [
    { x: 0, y: 0, label: 'A' },
    { x: topWidth, y: 0, label: 'B' },
    { x: topWidth, y: topDepth, label: 'C' },
    { x: totalWidth, y: topDepth, label: 'D' },
    { x: totalWidth, y: totalDepth, label: 'E' },
    { x: 0, y: totalDepth, label: 'F' },
  ];
}

/** Крестообразная (+) форма */
export function createPlusShapeVertices(size = 7, arm = 2) {
  const outer = size;
  const inner = arm;
  const mid = (outer - inner) / 2;
  const end = mid + inner;
  return [
    { x: mid, y: 0, label: 'A' },
    { x: end, y: 0, label: 'B' },
    { x: end, y: mid, label: 'C' },
    { x: outer, y: mid, label: 'D' },
    { x: outer, y: end, label: 'E' },
    { x: end, y: end, label: 'F' },
    { x: end, y: outer, label: 'G' },
    { x: mid, y: outer, label: 'H' },
    { x: mid, y: end, label: 'I' },
    { x: 0, y: end, label: 'J' },
    { x: 0, y: mid, label: 'K' },
    { x: mid, y: mid, label: 'L' },
  ];
}

/** Migrate legacy v2 room data to vertices */
export function migrateLegacyRoom(data) {
  if (data.vertices?.length >= 3) {
    return cloneVertices(data.vertices);
  }
  const mainLength = data.mainLength ?? 5;
  const mainWidth = data.mainWidth ?? 4;
  if (data.shape === 'l-shape' && data.legLength > 0 && data.legWidth > 0) {
    return createLShapeVertices(mainLength, mainWidth, data.legLength, data.legWidth);
  }
  return createRectangleVertices(mainLength, mainWidth);
}

export function edgeLength(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function getEdges(vertices) {
  const n = vertices.length;
  if (n < 2) return [];
  return Array.from({ length: n }, (_, i) => {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    return { index: i, a, b, length: edgeLength(a, b) };
  });
}

export function shoelaceArea(vertices) {
  const n = vertices.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y;
  }
  return Math.abs(sum) / 2;
}

export function getPerimeter(vertices) {
  return getEdges(vertices).reduce((s, e) => s + e.length, 0);
}

export function getBounds(vertices) {
  if (!vertices.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of vertices) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
  }
  return { minX, minY, maxX, maxY };
}

export function normalizeVertices(vertices) {
  const b = getBounds(vertices);
  return vertices.map((v) => ({
    ...v,
    x: roundMeters(v.x - b.minX),
    y: roundMeters(v.y - b.minY),
  }));
}

export function snapToGrid(value, step = GRID_STEP) {
  return roundMeters(Math.round(value / step) * step);
}

export function snapPoint(x, y, step = GRID_STEP) {
  return { x: snapToGrid(x, step), y: snapToGrid(y, step) };
}

/** Привязка при рисовании: сетка 1 м + горизонталь/вертикаль от предыдущей точки */
export function snapPointDraw(x, y, fromPoint, step = DRAW_GRID_STEP) {
  if (!fromPoint) return snapPoint(x, y, step);

  const gx = snapToGrid(x, step);
  const gy = snapToGrid(y, step);
  const dx = Math.abs(x - fromPoint.x);
  const dy = Math.abs(y - fromPoint.y);

  if (dx > dy * 1.15) return { x: gx, y: fromPoint.y };
  if (dy > dx * 1.15) return { x: fromPoint.x, y: gy };
  return { x: gx, y: gy };
}

export function snapPointEdit(x, y, step = DRAW_GRID_STEP) {
  return snapPoint(x, y, step);
}

export function pointInPolygon(x, y, vertices) {
  const n = vertices.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function segmentsIntersect(a1, a2, b1, b2) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(a1, a2, b1);
  const d2 = cross(a1, a2, b2);
  const d3 = cross(b1, b2, a1);
  const d4 = cross(b1, b2, a2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

export function hasSelfIntersection(vertices) {
  const n = vertices.length;
  if (n < 4) return false;
  const edges = getEdges(vertices);
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === edges.length - 1)) continue;
      const e1 = edges[i];
      const e2 = edges[j];
      if (segmentsIntersect(e1.a, e1.b, e2.a, e2.b)) return true;
    }
  }
  return false;
}

export function triangulateFan(vertices) {
  const n = vertices.length;
  if (n < 3) return [];
  const diagonals = [];
  for (let i = 2; i < n; i++) {
    diagonals.push({ a: vertices[0], b: vertices[i], aIdx: 0, bIdx: i });
  }
  return diagonals;
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function scaleVerticesToEdge(vertices, edgeIndex, targetLength) {
  if (!vertices.length || edgeIndex < 0) return cloneVertices(vertices);
  const edges = getEdges(vertices);
  const edge = edges[edgeIndex];
  if (!edge || edge.length < 1e-9) return cloneVertices(vertices);
  const scale = targetLength / edge.length;
  const ax = edge.a.x;
  const ay = edge.a.y;
  return vertices.map((v) => ({
    ...v,
    x: roundMeters(ax + (v.x - ax) * scale),
    y: roundMeters(ay + (v.y - ay) * scale),
  }));
}

export function setEdgeLength(vertices, edgeIndex, targetLength) {
  const result = cloneVertices(vertices);
  const n = result.length;
  if (n < 3 || edgeIndex < 0 || edgeIndex >= n) return result;

  const i = edgeIndex;
  const j = (i + 1) % n;
  const a = result[i];
  const b = result[j];
  const len = edgeLength(a, b);
  if (len < 1e-9) return result;

  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  result[j] = {
    ...b,
    x: roundMeters(a.x + ux * targetLength),
    y: roundMeters(a.y + uy * targetLength),
  };
  return result;
}

export function solvePolygonFromConstraints(vertices, edgeTargets = {}, diagonalTargets = {}) {
  let result = cloneVertices(vertices);
  const edgeIndices = Object.keys(edgeTargets).map(Number);
  for (const idx of edgeIndices) {
    const target = edgeTargets[idx];
    if (target > 0) result = setEdgeLength(result, idx, target);
  }
  for (const [key, target] of Object.entries(diagonalTargets)) {
    if (target <= 0) continue;
    const [ai, bi] = key.split('-').map(Number);
    if (ai >= result.length || bi >= result.length) continue;
    const a = result[ai];
    const b = result[bi];
    const len = distance(a, b);
    if (len < 1e-9) continue;
    const scale = target / len;
    const ax = a.x;
    const ay = a.y;
    result = result.map((v, idx) => {
      if (idx === ai) return { ...v };
      return {
        ...v,
        x: roundMeters(ax + (v.x - ax) * scale),
        y: roundMeters(ay + (v.y - ay) * scale),
      };
    });
  }
  return result;
}

export function rectInsidePolygon(x, y, w, h, vertices) {
  const corners = [
    { x, y },
    { x: x + w, y },
    { x, y: y + h },
    { x: x + w, y: y + h },
  ];
  return corners.every((c) => pointInPolygon(c.x, c.y, vertices));
}

export function panelInsidePolygon(x, y, w, h, vertices) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (!pointInPolygon(cx, cy, vertices)) return false;
  return rectInsidePolygon(x, y, w, h, vertices);
}

function addEdgeRectIntersections(xs, ys, x, y, w, h, vertices) {
  const x1 = x;
  const x2 = x + w;
  const y1 = y;
  const y2 = y + h;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    if (Math.abs(b.y - a.y) > 1e-12) {
      for (const yy of [y1, y2]) {
        if (yy > Math.min(a.y, b.y) - 1e-9 && yy < Math.max(a.y, b.y) + 1e-9) {
          const t = (yy - a.y) / (b.y - a.y);
          if (t >= -1e-9 && t <= 1 + 1e-9) {
            const ix = a.x + t * (b.x - a.x);
            if (ix > x1 + 1e-9 && ix < x2 - 1e-9) xs.add(ix);
          }
        }
      }
    }
    if (Math.abs(b.x - a.x) > 1e-12) {
      for (const xx of [x1, x2]) {
        if (xx > Math.min(a.x, b.x) - 1e-9 && xx < Math.max(a.x, b.x) + 1e-9) {
          const t = (xx - a.x) / (b.x - a.x);
          if (t >= -1e-9 && t <= 1 + 1e-9) {
            const iy = a.y + t * (b.y - a.y);
            if (iy > y1 + 1e-9 && iy < y2 - 1e-9) ys.add(iy);
          }
        }
      }
    }
  }
}

export function rectIntersectsPolygon(x, y, w, h, vertices) {
  if (w < 1e-9 || h < 1e-9) return false;
  if (rectInsidePolygon(x, y, w, h, vertices)) return true;

  const corners = [
    { x, y },
    { x: x + w, y },
    { x, y: y + h },
    { x: x + w, y: y + h },
  ];
  if (corners.some((c) => pointInPolygon(c.x, c.y, vertices))) return true;
  if (pointInPolygon(x + w / 2, y + h / 2, vertices)) return true;

  for (const v of vertices) {
    if (v.x >= x - 1e-9 && v.x <= x + w + 1e-9 && v.y >= y - 1e-9 && v.y <= y + h + 1e-9) {
      return true;
    }
  }

  const x2 = x + w;
  const y2 = y + h;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    if (segmentsIntersect(a, b, { x, y }, { x: x2, y })) return true;
    if (segmentsIntersect(a, b, { x, y: y2 }, { x: x2, y: y2 })) return true;
    if (segmentsIntersect(a, b, { x, y }, { x, y: y2 })) return true;
    if (segmentsIntersect(a, b, { x: x2, y }, { x: x2, y: y2 })) return true;
  }
  return false;
}

function mergeAdjacentRects(rects) {
  if (rects.length <= 1) return rects;
  let merged = rects.map((r) => ({ ...r }));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i];
        const b = merged[j];
        if (Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.h - b.h) < 1e-6) {
          if (Math.abs(a.x + a.w - b.x) < 1e-6) {
            merged[i] = { x: a.x, y: a.y, w: a.w + b.w, h: a.h };
            merged.splice(j, 1);
            changed = true;
            break outer;
          }
          if (Math.abs(b.x + b.w - a.x) < 1e-6) {
            merged[i] = { x: b.x, y: a.y, w: a.w + b.w, h: a.h };
            merged.splice(j, 1);
            changed = true;
            break outer;
          }
        }
        if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.w - b.w) < 1e-6) {
          if (Math.abs(a.y + a.h - b.y) < 1e-6) {
            merged[i] = { x: a.x, y: a.y, w: a.w, h: a.h + b.h };
            merged.splice(j, 1);
            changed = true;
            break outer;
          }
          if (Math.abs(b.y + b.h - a.y) < 1e-6) {
            merged[i] = { x: a.x, y: b.y, w: a.w, h: a.h + b.h };
            merged.splice(j, 1);
            changed = true;
            break outer;
          }
        }
      }
    }
  }
  return merged;
}

/** Пересечение прямоугольника с ортогональным полигоном — список прямоугольных фрагментов */
export function intersectRectWithPolygon(x, y, w, h, vertices) {
  if (w < 1e-9 || h < 1e-9) return [];
  if (rectInsidePolygon(x, y, w, h, vertices)) {
    return [{ x, y, w, h }];
  }

  const xs = new Set([x, x + w]);
  const ys = new Set([y, y + h]);
  for (const v of vertices) {
    if (v.x > x + 1e-9 && v.x < x + w - 1e-9) xs.add(v.x);
    if (v.y > y + 1e-9 && v.y < y + h - 1e-9) ys.add(v.y);
  }
  addEdgeRectIntersections(xs, ys, x, y, w, h, vertices);

  const xArr = [...xs].sort((a, b) => a - b);
  const yArr = [...ys].sort((a, b) => a - b);
  const fragments = [];

  for (let i = 0; i < xArr.length - 1; i++) {
    for (let j = 0; j < yArr.length - 1; j++) {
      const fx = xArr[i];
      const fy = yArr[j];
      const fw = xArr[i + 1] - fx;
      const fh = yArr[j + 1] - fy;
      if (fw < 1e-9 || fh < 1e-9) continue;
      // Центр или любой угол внутри / ячейка пересекает полигон — ловим тонкие клинья у диагонали
      const samples = [
        [fx + fw * 0.5, fy + fh * 0.5],
        [fx + fw * 0.01, fy + fh * 0.01],
        [fx + fw * 0.99, fy + fh * 0.01],
        [fx + fw * 0.01, fy + fh * 0.99],
        [fx + fw * 0.99, fy + fh * 0.99],
      ];
      const inside = samples.some(([px, py]) => pointInPolygon(px, py, vertices));
      if (inside) {
        fragments.push({ x: fx, y: fy, w: fw, h: fh });
      }
    }
  }

  return mergeAdjacentRects(fragments);
}

export function formatMetersDisplay(value) {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

export function rectanglesOverlap(x1, y1, x2, y2, x3, y3, x4, y4) {
  return !(x2 <= x3 || x4 <= x1 || y2 <= y3 || y4 <= y1);
}

export function rectIntersectsRect(a, b) {
  return rectanglesOverlap(a.x, a.y, a.x + a.w, a.y + a.h, b.x, b.y, b.x + b.w, b.y + b.h);
}

/** Разбивает прямоугольник на части вокруг препятствия (координаты: x вправо, y вверх от пола) */
export function splitRectAroundObstacle(rect, obs) {
  const ix1 = Math.max(rect.x, obs.x);
  const iy1 = Math.max(rect.y, obs.y);
  const ix2 = Math.min(rect.x + rect.w, obs.x + obs.w);
  const iy2 = Math.min(rect.y + rect.h, obs.y + obs.h);

  if (ix1 >= ix2 - 1e-9 || iy1 >= iy2 - 1e-9) return [rect];

  const parts = [];

  if (rect.y < iy1 - 1e-9) {
    parts.push({ x: rect.x, y: rect.y, w: rect.w, h: iy1 - rect.y });
  }
  if (rect.y + rect.h > iy2 + 1e-9) {
    parts.push({ x: rect.x, y: iy2, w: rect.w, h: rect.y + rect.h - iy2 });
  }
  if (rect.x < ix1 - 1e-9) {
    parts.push({ x: rect.x, y: iy1, w: ix1 - rect.x, h: iy2 - iy1 });
  }
  if (rect.x + rect.w > ix2 + 1e-9) {
    parts.push({ x: ix2, y: iy1, w: rect.x + rect.w - ix2, h: iy2 - iy1 });
  }

  return parts;
}

/** Вычитает проёмы из прямоугольника, возвращает свободные фрагменты */
export function subtractOpeningsFromRect(rect, openings) {
  let parts = [rect];
  for (const obs of openings) {
    const next = [];
    for (const part of parts) {
      if (!rectIntersectsRect(part, obs)) {
        next.push(part);
      } else {
        next.push(...splitRectAroundObstacle(part, obs));
      }
    }
    parts = next;
  }
  return parts.filter((p) => p.w > 1e-6 && p.h > 1e-6);
}

/** Два прямоугольника касаются по ребру с положительной длиной касания */
export function rectsShareEdge(a, b, eps = 1e-6) {
  const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);

  const touchVert =
    Math.abs(a.x + a.w - b.x) <= eps || Math.abs(b.x + b.w - a.x) <= eps;
  if (touchVert && yOverlap > eps) return true;

  const touchHorz =
    Math.abs(a.y + a.h - b.y) <= eps || Math.abs(b.y + b.h - a.y) <= eps;
  if (touchHorz && xOverlap > eps) return true;

  return false;
}

/**
 * Группирует прямоугольники в связные компоненты (касание по ребру).
 * Нужно, чтобы Г-область у угла проёма стала одной панелью, а не двумя кусками.
 */
export function groupConnectedRects(rects, eps = 1e-6) {
  if (!rects.length) return [];
  const n = rects.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(i, j) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[rj] = ri;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (rectsShareEdge(rects[i], rects[j], eps)) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(rects[i]);
  }
  return [...groups.values()];
}

/** AABB набора прямоугольников */
export function boundsOfRects(rects) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of rects) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Помещается ли набор частей в габарит одной панели */
export function fitsInPanelSize(rects, panelLength, panelWidth, eps = 1e-6) {
  const b = boundsOfRects(rects);
  const fitsNormal = b.w <= panelLength + eps && b.h <= panelWidth + eps;
  const fitsRotated = b.w <= panelWidth + eps && b.h <= panelLength + eps;
  return fitsNormal || fitsRotated;
}

/** Площадь прямоугольников */
export function areaOfRects(rects) {
  return rects.reduce((s, p) => s + p.w * p.h, 0);
}

/**
 * Склеивает соседние прямоугольники в более крупные (полная общая сторона).
 * Убирает «ложные» швы внутри одной панели.
 */
export function coalesceRects(rects, eps = 1e-6) {
  let list = rects.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        // вертикальная склейка (один над другим, одинаковая ширина и x)
        if (
          Math.abs(a.x - b.x) <= eps &&
          Math.abs(a.w - b.w) <= eps &&
          (Math.abs(a.y + a.h - b.y) <= eps || Math.abs(b.y + b.h - a.y) <= eps)
        ) {
          const y = Math.min(a.y, b.y);
          const h = Math.max(a.y + a.h, b.y + b.h) - y;
          list.splice(j, 1);
          list.splice(i, 1);
          list.push({ x: a.x, y, w: a.w, h });
          changed = true;
          break outer;
        }
        // горизонтальная склейка
        if (
          Math.abs(a.y - b.y) <= eps &&
          Math.abs(a.h - b.h) <= eps &&
          (Math.abs(a.x + a.w - b.x) <= eps || Math.abs(b.x + b.w - a.x) <= eps)
        ) {
          const x = Math.min(a.x, b.x);
          const w = Math.max(a.x + a.w, b.x + b.w) - x;
          list.splice(j, 1);
          list.splice(i, 1);
          list.push({ x, y: a.y, w, h: a.h });
          changed = true;
          break outer;
        }
      }
    }
  }
  return list;
}

/**
 * AABB минус проёмы даёт ту же площадь, что и parts —
 * между кусками нет «дыры», кроме самих проёмов.
 */
export function partsFillFreeAabb(parts, openings, eps = 1e-3) {
  const aabb = boundsOfRects(parts);
  const free = subtractOpeningsFromRect(aabb, openings);
  return Math.abs(areaOfRects(free) - areaOfRects(parts)) <= eps;
}

export function formatMeters(value, digits = 2) {
  return Number(value).toFixed(digits);
}

/** Округление размеров в метрах (шаг 1 см по умолчанию) */
export function roundMeters(value, step = 0.01) {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value / step) * step;
  const decimals = step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return +rounded.toFixed(decimals);
}

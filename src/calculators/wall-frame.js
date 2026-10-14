import { OPENING_TYPES } from '../core/constants.js';

const EPS = 1e-6;

/** Не ставить последний профиль, если до стены остаётся < 30% шага */
export const LAST_PROFILE_MIN_GAP_RATIO = 0.3;

/** Мин. дистанция между точками крепления (м) — без кластеров */
const BRACKET_MIN_SEP_M = 0.1;

/** Проёмы в координатах стены: x вдоль стены, y от пола вверх */
export function openingsToRects(openings = []) {
  return openings.map((o) => ({
    x: o.offset,
    y: o.type === OPENING_TYPES.WINDOW ? o.sillHeight : 0,
    w: o.width,
    h: o.height,
    type: o.type,
  }));
}

function subtractSegments(segments, cutStart, cutEnd) {
  const result = [];
  for (const [a, b] of segments) {
    if (cutEnd <= a + EPS || cutStart >= b - EPS) {
      result.push([a, b]);
      continue;
    }
    if (a < cutStart - EPS) result.push([a, cutStart]);
    if (cutEnd < b - EPS) result.push([cutEnd, b]);
  }
  return result.filter(([a, b]) => b - a > EPS);
}

function uniqueSorted(values) {
  const sorted = [...values].map((v) => +v.toFixed(6)).sort((a, b) => a - b);
  const out = [];
  for (const v of sorted) {
    if (!out.length || Math.abs(out[out.length - 1] - v) > EPS) out.push(v);
  }
  return out;
}

/** Мин. пролёт между соседними профилями (30% шага) */
export function minProfileClearance(stepM, minGapRatio = LAST_PROFILE_MIN_GAP_RATIO) {
  return minGapRatio * stepM;
}

/**
 * Позиции профилей вдоль оси [0..lengthM] с шагом stepM.
 * Края (0 и lengthM) всегда есть; последний промежуточный не ставится,
 * если до конечного профиля остаётся меньше max(30% шага, 250 мм).
 */
export function getProfilePositions(lengthM, stepM, minGapRatio = LAST_PROFILE_MIN_GAP_RATIO) {
  if (lengthM <= EPS) return [0];
  // 250 мм — чтобы на длинах вроде 5.0 м не оставалась пара 4.8+5.0
  const minGap = Math.max(minProfileClearance(stepM, minGapRatio), 0.25);
  const positions = [0];

  for (let x = stepM; x < lengthM - EPS; x += stepM) {
    if (lengthM - x < minGap - EPS) break;
    positions.push(+x.toFixed(6));
  }

  const last = positions[positions.length - 1];
  if (Math.abs(last - lengthM) > EPS) {
    if (positions.length > 1 && lengthM - last < minGap - EPS) {
      positions.pop();
    }
    positions.push(+lengthM.toFixed(6));
  }

  while (positions.length > 2) {
    const a = positions[positions.length - 2];
    const b = positions[positions.length - 1];
    if (b - a >= minGap - EPS) break;
    positions.splice(positions.length - 2, 1);
  }

  return positions;
}

/** Вертикальные участки стойки в точке x (стойка не проходит через проём) */
export function verticalStudSegmentsAt(x, wallHeight, rects) {
  let segments = [[0, wallHeight]];
  for (const o of rects) {
    if (x <= o.x + EPS || x >= o.x + o.w - EPS) continue;
    segments = subtractSegments(segments, o.y, o.y + o.h);
  }
  return segments;
}

/** Нижняя направляющая: без участков под дверями (проёмы от пола) */
export function floorTrackSegments(wallWidth, openings = []) {
  let segments = [[0, wallWidth]];
  for (const o of openingsToRects(openings)) {
    if (o.y <= EPS) {
      segments = subtractSegments(segments, o.x, o.x + o.w);
    }
  }
  return segments;
}

/**
 * Горизонтальные обрамления проёмов (С623):
 * окно — верх + низ; дверь — только верх (без пола).
 */
export function getOpeningFrameHorizontals(openings = []) {
  const segs = [];
  for (const o of openingsToRects(openings)) {
    const x1 = o.x;
    const x2 = o.x + o.w;
    segs.push({ y: o.y + o.h, x1, x2, kind: 'header' });
    if (o.type === OPENING_TYPES.WINDOW || o.y > EPS) {
      segs.push({ y: o.y, x1, x2, kind: 'sill' });
    }
  }
  return segs;
}

function isStrictlyInsideOpening(x, rects) {
  return rects.some((o) => x > o.x + EPS && x < o.x + o.w - EPS);
}

function farEnoughFromAll(x, positions, minClear) {
  return positions.every((p) => Math.abs(p - x) >= minClear + EPS);
}

/**
 * Стойки по С623:
 * — края стены и косяки проёмов обязательны;
 * — сетка 600 мм снаружи проёмов, без позиций ближе 30% шага к обязательным;
 * — внутри проёма сетку не тащим (иначе короткие «огрызки» у косяков);
 * — над/под проёмом — короткие стойки с шагом от левого косяка.
 */
export function getStudPositions(widthM, stepM, openings = []) {
  // Как у края стены: не ближе 30% шага и не уже 250 мм
  const minClear = Math.max(minProfileClearance(stepM), 0.25);
  const rects = openingsToRects(openings);

  const required = [0, widthM];
  for (const o of openings) {
    if (o.offset >= -EPS && o.offset <= widthM + EPS) required.push(o.offset);
    const right = o.offset + o.width;
    if (right >= -EPS && right <= widthM + EPS) required.push(right);
  }
  let result = uniqueSorted(required);

  // Сетка только вне проёмов и не ближе minClear к обязательным
  for (const x of getProfilePositions(widthM, stepM)) {
    if (result.some((p) => Math.abs(p - x) < EPS)) continue;
    if (isStrictlyInsideOpening(x, rects)) continue;
    if (!farEnoughFromAll(x, result, minClear)) continue;
    result.push(x);
  }
  result = uniqueSorted(result);

  // Короткие стойки в створе проёма (над перемычкой / под подоконником)
  for (const o of rects) {
    const left = o.x;
    const right = o.x + o.w;
    const candidates = [];
    for (let x = left + stepM; x <= right - stepM + EPS; x += stepM) {
      candidates.push(+x.toFixed(6));
    }
    // Широкий проём без попадания шага — одна стойка по центру
    if (!candidates.length && right - left > stepM + EPS) {
      candidates.push(+((left + right) / 2).toFixed(6));
    }
    for (const x of candidates) {
      if (x <= left + EPS || x >= right - EPS) continue;
      if (!farEnoughFromAll(x, result, minClear)) continue;
      result.push(x);
    }
    result = uniqueSorted(result);
  }

  return result;
}

/**
 * Крепления к стене (С623): только на вертикальных стойках, шаг bracketStepM.
 * Короткий сегмент над дверью / под окном без точки шага → одна mid-точка.
 * Без ряда на перемычке/подоконнике.
 */
export function getWallBracketPoints(widthM, heightM, openings = [], stepM = 0.6, bracketStepM = 0.55) {
  const rects = openingsToRects(openings);
  const studPositions = getStudPositions(widthM, stepM, openings);
  const points = [];

  const tooClose = (x, y) => {
    for (const p of points) {
      if (Math.abs(p.x - x) < EPS && Math.abs(p.y - y) < BRACKET_MIN_SEP_M - EPS) return true;
    }
    return false;
  };

  const add = (x, y) => {
    if (x < -EPS || x > widthM + EPS || y < EPS || y > heightM - EPS) return;
    for (const o of rects) {
      if (x > o.x + EPS && x < o.x + o.w - EPS && y > o.y + EPS && y < o.y + o.h - EPS) {
        return;
      }
    }
    if (tooClose(x, y)) return;
    points.push({ x: +x.toFixed(6), y: +y.toFixed(6) });
  };

  for (const x of studPositions) {
    const segments = verticalStudSegmentsAt(x, heightM, rects);
    for (const [y1, y2] of segments) {
      let placed = 0;
      for (let y = y1 + bracketStepM; y < y2 - EPS; y += bracketStepM) {
        add(x, y);
        placed += 1;
      }
      // Короткий сегмент над/под проёмом: хотя бы одно крепление
      if (placed === 0 && y2 - y1 > BRACKET_MIN_SEP_M * 2) {
        add(x, (y1 + y2) / 2);
      }
    }
  }

  return points;
}

/**
 * Метрики каркаса стены с учётом проёмов и обрамления (С623).
 */
export function calcWallFrameMetrics(widthM, heightM, openings = [], stepM = 0.6, bracketStepM = 0.55) {
  const rects = openingsToRects(openings);
  const studPositions = getStudPositions(widthM, stepM, openings);
  const horizontals = getOpeningFrameHorizontals(openings);

  let studLengthM = 0;
  let activeStuds = 0;
  for (const x of studPositions) {
    const segs = verticalStudSegmentsAt(x, heightM, rects);
    const len = segs.reduce((s, [a, b]) => s + (b - a), 0);
    if (len > EPS) {
      studLengthM += len;
      activeStuds += 1;
    }
  }

  const openingFrameM = horizontals.reduce((s, h) => s + (h.x2 - h.x1), 0);
  studLengthM += openingFrameM;

  const topTrackM = widthM;
  const bottomTrackM = floorTrackSegments(widthM, openings).reduce((s, [a, b]) => s + (b - a), 0);
  const trackM = topTrackM + bottomTrackM;

  const bracketPoints = getWallBracketPoints(widthM, heightM, openings, stepM, bracketStepM);
  const connectors = Math.max(0, activeStuds * 2 + horizontals.length * 2);

  return {
    trackM,
    topTrackM,
    bottomTrackM,
    studLengthM,
    studCount: activeStuds,
    studPositions,
    rects,
    horizontals,
    brackets: bracketPoints.length,
    bracketPoints,
    openingFrameM,
    connectors,
  };
}

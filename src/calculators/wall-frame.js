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

/**
 * Позиции профилей вдоль оси [0..lengthM] с шагом stepM.
 * Края (0 и lengthM) всегда есть; последний промежуточный не ставится,
 * если до стены остаётся меньше 30% шага.
 */
export function getProfilePositions(lengthM, stepM, minGapRatio = LAST_PROFILE_MIN_GAP_RATIO) {
  if (lengthM <= EPS) return [0];
  const minGap = minGapRatio * stepM;
  const positions = [0];

  for (let x = stepM; x < lengthM - EPS; x += stepM) {
    if (lengthM - x < minGap - EPS) break;
    positions.push(+x.toFixed(6));
  }

  const last = positions[positions.length - 1];
  if (Math.abs(last - lengthM) > EPS) {
    positions.push(+lengthM.toFixed(6));
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

/**
 * Стойки по С623: сетка 600 мм + косяки проёмов.
 * Стойки сетки ближе 30% шага к косяку убираются (без узких «карманов»).
 */
export function getStudPositions(widthM, stepM, openings = []) {
  const minClear = LAST_PROFILE_MIN_GAP_RATIO * stepM;
  const base = getProfilePositions(widthM, stepM);
  const jambs = [];
  for (const o of openings) {
    if (o.offset >= -EPS && o.offset <= widthM + EPS) jambs.push(o.offset);
    const right = o.offset + o.width;
    if (right >= -EPS && right <= widthM + EPS) jambs.push(right);
  }
  const jambList = uniqueSorted(jambs);

  const cleared = base.filter((x) => {
    // Края стены всегда оставляем
    if (Math.abs(x) < EPS || Math.abs(x - widthM) < EPS) return true;
    for (const j of jambList) {
      if (Math.abs(x - j) < minClear - EPS) return false;
    }
    return true;
  });

  return uniqueSorted([...cleared, ...jambList]);
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

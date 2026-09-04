import { OPENING_TYPES } from '../core/constants.js';

const EPS = 1e-6;

/** Проёмы в координатах стены: x вдоль стены, y от пола вверх */
export function openingsToRects(openings = []) {
  return openings.map((o) => ({
    x: o.offset,
    y: o.type === OPENING_TYPES.WINDOW ? o.sillHeight : 0,
    w: o.width,
    h: o.height,
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

export function getStudPositions(widthM, stepM) {
  const positions = [];
  for (let x = 0; x <= widthM + EPS; x += stepM) {
    positions.push(+Math.min(x, widthM).toFixed(6));
  }
  const last = positions[positions.length - 1];
  if (last < widthM - EPS) positions.push(+widthM.toFixed(6));
  return positions;
}

/**
 * Метрики каркаса стены с учётом проёмов.
 */
export function calcWallFrameMetrics(widthM, heightM, openings = [], stepM = 0.6, bracketStepM = 0.6) {
  const rects = openingsToRects(openings);
  const studPositions = getStudPositions(widthM, stepM);

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

  const topTrackM = widthM;
  const bottomTrackM = floorTrackSegments(widthM, openings).reduce((s, [a, b]) => s + (b - a), 0);
  const trackM = topTrackM + bottomTrackM;

  const bracketPoints = studLengthM / bracketStepM;
  const connectors = Math.max(0, activeStuds * 2);

  return {
    trackM,
    topTrackM,
    bottomTrackM,
    studLengthM,
    studCount: activeStuds,
    studPositions,
    rects,
    brackets: bracketPoints * 2,
    connectors,
  };
}

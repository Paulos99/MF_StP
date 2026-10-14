import { OPENING_TYPES } from '../core/constants.js';

const EPS = 1e-6;

/** Не ставить последний профиль, если до стены остаётся < 30% шага */
export const LAST_PROFILE_MIN_GAP_RATIO = 0.3;

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
    // Не ставим профиль, если до стены < 30% шага
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
 * Горизонтальные обрамления проёмов:
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
 * Стойки: сетка с правилом 30% + обязательные стойки по краям проёмов.
 */
export function getStudPositions(widthM, stepM, openings = []) {
  const base = getProfilePositions(widthM, stepM);
  const edgeXs = [];
  for (const o of openings) {
    edgeXs.push(o.offset);
    edgeXs.push(o.offset + o.width);
  }
  return uniqueSorted([
    ...base,
    ...edgeXs.filter((x) => x >= -EPS && x <= widthM + EPS),
  ]);
}

/**
 * Точки крепления (кронштейны/подвесы) вдоль стоек + над/под проёмами.
 * Над проёмом — всегда; под — только для окон (не от пола).
 */
export function getWallBracketPoints(widthM, heightM, openings = [], stepM = 0.6, bracketStepM = 0.55) {
  const rects = openingsToRects(openings);
  const studPositions = getStudPositions(widthM, stepM, openings);
  const points = [];
  const key = (x, y) => `${x.toFixed(4)}:${y.toFixed(4)}`;
  const seen = new Set();

  const add = (x, y) => {
    if (x < -EPS || x > widthM + EPS || y < EPS || y > heightM - EPS) return;
    // Не ставим крепёж внутри проёма
    for (const o of rects) {
      if (x > o.x + EPS && x < o.x + o.w - EPS && y > o.y + EPS && y < o.y + o.h - EPS) {
        return;
      }
    }
    const k = key(x, y);
    if (seen.has(k)) return;
    seen.add(k);
    points.push({ x: +x.toFixed(6), y: +y.toFixed(6) });
  };

  for (const x of studPositions) {
    const segments = verticalStudSegmentsAt(x, heightM, rects);
    for (const [y1, y2] of segments) {
      for (let y = y1 + bracketStepM; y < y2 - EPS; y += bracketStepM) {
        add(x, y);
      }
    }
  }

  // Обязательные крепления над и под проёмами (на стойках обрамления и промежуточных)
  for (const o of rects) {
    const topY = o.y + o.h;
    const bottomY = o.y;
    const edgeXs = uniqueSorted([
      o.x,
      o.x + o.w,
      ...studPositions.filter((x) => x > o.x + EPS && x < o.x + o.w - EPS),
    ]);

    for (const x of edgeXs) {
      // Над проёмом — на стойке сразу выше перемычки
      if (topY < heightM - EPS) {
        const aboveSegs = verticalStudSegmentsAt(x, heightM, rects).filter(
          ([a, b]) => a <= topY + EPS && b > topY + EPS
        );
        if (aboveSegs.length || Math.abs(x - o.x) < EPS || Math.abs(x - o.x - o.w) < EPS) {
          add(x, Math.min(heightM - EPS, topY + Math.min(bracketStepM * 0.5, (heightM - topY) * 0.5)));
        }
      }

      // Под проёмом — только окно (не дверь от пола)
      if (bottomY > EPS) {
        const belowSegs = verticalStudSegmentsAt(x, heightM, rects).filter(
          ([a, b]) => b >= bottomY - EPS && a < bottomY - EPS
        );
        if (belowSegs.length || Math.abs(x - o.x) < EPS || Math.abs(x - o.x - o.w) < EPS) {
          add(x, Math.max(EPS, bottomY - Math.min(bracketStepM * 0.5, bottomY * 0.5)));
        }
      }
    }

    // Крепления на самой перемычке / подоконной перекладине (шаг подвесов)
    for (let x = o.x; x <= o.x + o.w + EPS; x += bracketStepM) {
      add(Math.min(x, o.x + o.w), topY);
      if (bottomY > EPS) add(Math.min(x, o.x + o.w), bottomY);
    }
    add(o.x + o.w, topY);
    if (bottomY > EPS) add(o.x + o.w, bottomY);
  }

  return points;
}

/**
 * Метрики каркаса стены с учётом проёмов и обрамления.
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

import { MOUNTING_RULES } from '../calculators/mounting-rules.js';
import {
  floorTrackSegments,
  getOpeningFrameHorizontals,
  getProfilePositions,
  getStudPositions,
  getWallBracketPoints,
  openingsToRects,
  verticalStudSegmentsAt,
} from '../calculators/wall-frame.js';
import { getBounds } from '../core/polygon-geometry.js';

const EPS = 1e-6;
const FRAME_COLOR = '#FF6B00';
const FRAME_COLOR_MAIN = '#E65100';
const HANGER_COLOR = '#1565C0';

/**
 * Каркас потолка по логике П113: несущие (подвесы) + поперечные + периметр.
 * @param {CanvasRenderingContext2D} ctx — контекст с уже применённым translate
 * @param {{ widthM, heightM, stepM?, hangerStepM? }} bounds
 * @param {number} scale
 */
export function drawFrameGrid(ctx, bounds, scale, options = {}) {
  const {
    widthM,
    heightM,
    stepM = MOUNTING_RULES.ceiling_framed.profileStepM,
    hangerStepM = MOUNTING_RULES.ceiling_framed.hangerStepM ?? 0.55,
  } = bounds;

  const w = widthM * scale;
  const h = heightM * scale;
  const showHangers = options.showHangers !== false;
  const isWall = options.isWall === true;

  // Несущие — вдоль X (вертикальные линии на плане); поперечные — вдоль Y
  const mainXs = getProfilePositions(widthM, stepM);
  const crossYs = getProfilePositions(heightM, stepM);

  ctx.save();

  const clipPoly = options.clipPolygon;
  if (clipPoly?.length >= 3) {
    ctx.beginPath();
    ctx.moveTo(clipPoly[0].x * scale, clipPoly[0].y * scale);
    for (let i = 1; i < clipPoly.length; i++) {
      ctx.lineTo(clipPoly[i].x * scale, clipPoly[i].y * scale);
    }
    ctx.closePath();
    ctx.clip();
  }

  ctx.globalAlpha = 0.92;

  // Несущие (на них подвесы)
  ctx.strokeStyle = FRAME_COLOR_MAIN;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([]);
  for (const xM of mainXs) {
    const x = xM * scale;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // Поперечные (крабы в пересечениях — без подвесов)
  ctx.strokeStyle = FRAME_COLOR;
  ctx.lineWidth = 2;
  for (const yM of crossYs) {
    const y = yM * scale;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Периметр (ПН)
  ctx.strokeStyle = FRAME_COLOR_MAIN;
  ctx.lineWidth = 3;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  if (showHangers) {
    ctx.fillStyle = HANGER_COLOR;
    if (isWall) {
      const hangerYs = [];
      for (let y = hangerStepM; y < heightM - EPS; y += hangerStepM) {
        hangerYs.push(y);
      }
      for (const xM of mainXs) {
        const x = xM * scale;
        for (const yM of hangerYs) {
          ctx.beginPath();
          ctx.arc(x, yM * scale, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      // П113: подвесы только на несущих, без точек на периметре
      const hangerYs = [];
      for (let y = hangerStepM; y < heightM - EPS; y += hangerStepM) {
        hangerYs.push(y);
      }
      for (const xM of mainXs) {
        const x = xM * scale;
        for (const yM of hangerYs) {
          ctx.beginPath();
          ctx.arc(x, yM * scale, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

export function getCeilingFrameBounds(room) {
  const verts = room.vertices ?? [];
  const b = getBounds(verts);
  return {
    widthM: Math.max(b.maxX - b.minX, 0.1),
    heightM: Math.max(b.maxY - b.minY, 0.1),
    stepM: MOUNTING_RULES.ceiling_framed.profileStepM,
    hangerStepM: MOUNTING_RULES.ceiling_framed.hangerStepM,
  };
}

export function getWallFrameBounds(wallLength, wallHeight) {
  return {
    widthM: wallLength,
    heightM: wallHeight,
    stepM: MOUNTING_RULES.wall_framed.profileStepM,
    hangerStepM: MOUNTING_RULES.wall_framed.bracketStepM,
  };
}

/**
 * Каркас стены по С623: направляющие, стойки без «карманов» у проёмов,
 * обрамление, крепления только на вертикалях с шагом 550 мм.
 */
export function drawWallFrameGrid(ctx, bounds, scale, options = {}) {
  const {
    widthM,
    heightM,
    stepM = MOUNTING_RULES.wall_framed.profileStepM,
    hangerStepM = MOUNTING_RULES.wall_framed.bracketStepM,
  } = bounds;
  const openings = options.openings ?? [];
  const rects = openingsToRects(openings);
  const horizontals = getOpeningFrameHorizontals(openings);

  const w = widthM * scale;
  const h = heightM * scale;

  const roomYToCanvas = (yRoom) => h - yRoom * scale;

  ctx.save();
  ctx.globalAlpha = 0.92;

  // Верхняя направляющая
  ctx.strokeStyle = FRAME_COLOR_MAIN;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.stroke();

  // Нижняя направляющая (с разрывами под дверями)
  ctx.lineWidth = 3;
  for (const [x1, x2] of floorTrackSegments(widthM, openings)) {
    ctx.beginPath();
    ctx.moveTo(x1 * scale, h);
    ctx.lineTo(x2 * scale, h);
    ctx.stroke();
  }

  // Стойки
  ctx.strokeStyle = FRAME_COLOR;
  ctx.lineWidth = 2;
  const studPositions = getStudPositions(widthM, stepM, openings);
  for (const xM of studPositions) {
    const x = xM * scale;
    const segments = verticalStudSegmentsAt(xM, heightM, rects);
    for (const [y1, y2] of segments) {
      ctx.beginPath();
      ctx.moveTo(x, roomYToCanvas(y2));
      ctx.lineTo(x, roomYToCanvas(y1));
      ctx.stroke();
    }
  }

  // Перемычка / подоконная (без подвесов на них)
  ctx.strokeStyle = FRAME_COLOR_MAIN;
  ctx.lineWidth = 2.5;
  for (const seg of horizontals) {
    const y = roomYToCanvas(seg.y);
    ctx.beginPath();
    ctx.moveTo(seg.x1 * scale, y);
    ctx.lineTo(seg.x2 * scale, y);
    ctx.stroke();
  }

  if (options.showHangers !== false) {
    ctx.fillStyle = HANGER_COLOR;
    const points = getWallBracketPoints(widthM, heightM, openings, stepM, hangerStepM);
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x * scale, roomYToCanvas(p.y), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

import { MOUNTING_RULES } from '../calculators/mounting-rules.js';
import {
  calcWallFrameMetrics,
  floorTrackSegments,
  getStudPositions,
  openingsToRects,
  verticalStudSegmentsAt,
} from '../calculators/wall-frame.js';
import { getBounds } from '../core/polygon-geometry.js';

const FRAME_COLOR = '#FF6B00';
const FRAME_COLOR_MAIN = '#E65100';
const HANGER_COLOR = '#1565C0';

/**
 * Рисует сетку каркаса поверх панелей.
 * @param {CanvasRenderingContext2D} ctx — контекст с уже применённым translate
 * @param {{ widthM, heightM, stepM?, hangerStepM? }} bounds
 * @param {number} scale
 */
export function drawFrameGrid(ctx, bounds, scale, options = {}) {
  const {
    widthM,
    heightM,
    stepM = MOUNTING_RULES.ceiling_framed.profileStepM,
    hangerStepM = MOUNTING_RULES.ceiling_framed.hangerStepM ?? 1.0,
  } = bounds;

  const w = widthM * scale;
  const h = heightM * scale;
  const step = stepM * scale;
  const hangerStep = hangerStepM * scale;
  const showHangers = options.showHangers !== false;
  const isWall = options.isWall === true;

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

  // Поперечные линии
  ctx.strokeStyle = FRAME_COLOR;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  for (let x = 0; x <= w + 0.5; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // Несущие линии (для потолка — горизонтальные чуть толще)
  ctx.strokeStyle = FRAME_COLOR_MAIN;
  ctx.lineWidth = 2.5;
  for (let y = 0; y <= h + 0.5; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Периметр
  ctx.strokeStyle = FRAME_COLOR_MAIN;
  ctx.lineWidth = 3;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  if (showHangers) {
    ctx.fillStyle = HANGER_COLOR;
    if (isWall) {
      // Кронштейны вдоль стоек
      for (let x = 0; x <= w + 0.5; x += step) {
        for (let y = hangerStep; y < h; y += hangerStep) {
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      // Подвесы на несущих линиях
      for (let x = 0; x <= w + 0.5; x += step) {
        for (let y = hangerStep; y < h; y += hangerStep) {
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // Точка крепления к перекрытию
        ctx.fillStyle = '#0D47A1';
        ctx.beginPath();
        ctx.arc(x, 0, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = HANGER_COLOR;
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
 * Каркас стены: направляющие сверху/снизу и стойки с шагом, без прохода через проёмы.
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

  const w = widthM * scale;
  const h = heightM * scale;
  const step = stepM * scale;
  const bracketStep = hangerStepM * scale;

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
  const studPositions = getStudPositions(widthM, stepM);
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

  // Кронштейны вдоль стоек
  if (options.showHangers !== false) {
    ctx.fillStyle = HANGER_COLOR;
    for (const xM of studPositions) {
      const x = xM * scale;
      const segments = verticalStudSegmentsAt(xM, heightM, rects);
      for (const [y1, y2] of segments) {
        for (let yRoom = y1 + hangerStepM; yRoom < y2 - EPS; yRoom += hangerStepM) {
          ctx.beginPath();
          ctx.arc(x, roomYToCanvas(yRoom), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

import { MIN_PANEL_FRAGMENT, PANEL_LAYOUT, RESERVES } from '../core/constants.js';
import { Panel, Orientation } from './ceiling-calculator.js';
import { boundsOfRects } from '../core/geometry.js';
import {
  getBounds,
  intersectRectWithPolygon,
  pointInPolygon,
  rectInsidePolygon,
  shoelaceArea,
} from '../core/polygon-geometry.js';

function isAxisAlignedDelta(dx, dy, eps = 1e-3) {
  return Math.abs(dx) <= eps || Math.abs(dy) <= eps;
}

/**
 * Прямые углы контура с ортогональными рёбрами — якоря старта укладки.
 * Только выпуклые (внутренний 90°), не вогнутые 270° у «внутренних» углов креста.
 * Первая панель должна примыкать к обоим рёбрам вершины (не к углу bbox).
 */
export function findOrthogonalStartAnchors(vertices, epsDeg = 12) {
  const n = vertices.length;
  if (n < 3) return [];
  const anchors = [];
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const cur = vertices[i];
    const next = vertices[(i + 1) % n];
    const ax = prev.x - cur.x;
    const ay = prev.y - cur.y;
    const bx = next.x - cur.x;
    const by = next.y - cur.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) continue;
    if (!isAxisAlignedDelta(ax, ay) || !isAxisAlignedDelta(bx, by)) continue;
    const cos = (ax * bx + ay * by) / (la * lb);
    const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    if (Math.abs(angle - 90) > epsDeg) continue;

    // Биссектриса меньшего (90°) угла: если точка на ней внутри полигона — угол выпуклый
    const ux = ax / la;
    const uy = ay / la;
    const vx = bx / lb;
    const vy = by / lb;
    const mx = ux + vx;
    const my = uy + vy;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) continue;
    const tx = cur.x + (mx / ml) * 0.05;
    const ty = cur.y + (my / ml) * 0.05;
    if (!pointInPolygon(tx, ty, vertices)) continue;

    anchors.push({
      index: i,
      x: cur.x,
      y: cur.y,
      label: cur.label || String(i),
    });
  }
  return anchors;
}

export class PolygonPanelCalculator {
  constructor(vertices) {
    this.vertices = vertices;
    this.panelLength = PANEL_LAYOUT.length;
    this.panelWidth = PANEL_LAYOUT.width;
    const b = getBounds(vertices);
    this.offsetX = b.minX;
    this.offsetY = b.minY;
    this.localVertices = vertices.map((v) => ({
      x: v.x - this.offsetX,
      y: v.y - this.offsetY,
      label: v.label,
    }));
  }

  getTotalArea() {
    return shoelaceArea(this.vertices);
  }

  getPolygonFragments(x, y, width, height) {
    return intersectRectWithPolygon(x, y, width, height, this.localVertices);
  }

  isFragmentWorthPlacing(w, h) {
    // ≤5 см не кладём — зазор закрывают обрезками на объекте
    return w > MIN_PANEL_FRAGMENT + 1e-9 && h > MIN_PANEL_FRAGMENT + 1e-9;
  }

  isFragmentCut(frag, slotX, slotY, slotW, slotH, orientation, slotIsCut) {
    if (slotIsCut) return true;
    if (!rectInsidePolygon(frag.x, frag.y, frag.w, frag.h, this.localVertices)) return true;
    const clipped =
      Math.abs(frag.x - slotX) > 1e-4 ||
      Math.abs(frag.y - slotY) > 1e-4 ||
      Math.abs(frag.w - slotW) > 1e-4 ||
      Math.abs(frag.h - slotH) > 1e-4;
    if (clipped) return true;
    return orientation === Orientation.HORIZONTAL
      ? !this.isFullHorizontalPanel(frag.w, frag.h)
      : !this.isFullVerticalPanel(frag.w, frag.h);
  }

  tryPlacePanel(panels, x, y, width, height, orientation, isCut) {
    if (width < 1e-6 || height < 1e-6) return null;
    // Подрезка = целый слот панели с обрезкой контуром, не набор мелких прямоугольников
    const fullSlot =
      this.isFullHorizontalPanel(width, height) || this.isFullVerticalPanel(width, height);
    if (!fullSlot) return null;

    const fragments = this.getPolygonFragments(x, y, width, height);
    if (!fragments.length) return null;

    const coveredArea = fragments.reduce((s, f) => s + f.w * f.h, 0);
    if (coveredArea < 1e-8) return null;

    // Тонкая кромка ≤5 см (как 5×5 м → хвост 5 см) — не тратим ряд целых панелей
    const clipBounds = boundsOfRects(fragments);
    if (Math.min(clipBounds.w, clipBounds.h) <= MIN_PANEL_FRAGMENT + 1e-9) return null;

    const fullyInside = rectInsidePolygon(x, y, width, height, this.localVertices);
    const cut = !!isCut || !fullyInside;

    let cx = 0;
    let cy = 0;
    for (const f of fragments) {
      cx += (f.x + f.w / 2) * f.w * f.h;
      cy += (f.y + f.h / 2) * f.w * f.h;
    }
    cx /= coveredArea;
    cy /= coveredArea;

    const panel = new Panel(x, y, width, height, orientation, 0, cut, {
      coveredArea,
      labelX: cx,
      labelY: cy,
      // Клип внутри комнаты — для коллизий (AABB слота выходит за контур и не должен блокировать соседей)
      clipParts: fragments,
    });
    if (this.checkPanelCollision(panel, panels)) return null;
    panels.push(panel);
    return panel;
  }

  checkPanelCollision(panel, panels) {
    const aParts =
      panel.meta?.clipParts?.length > 0
        ? panel.meta.clipParts
        : this.getPolygonFragments(panel.x, panel.y, panel.width, panel.height);

    for (const existing of panels) {
      const bParts =
        existing.meta?.clipParts?.length > 0
          ? existing.meta.clipParts
          : this.getPolygonFragments(existing.x, existing.y, existing.width, existing.height);

      for (const a of aParts) {
        for (const b of bParts) {
          if (
            !(
              a.x + a.w <= b.x + 1e-6 ||
              b.x + b.w <= a.x + 1e-6 ||
              a.y + a.h <= b.y + 1e-6 ||
              b.y + b.h <= a.y + 1e-6
            )
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  isFullHorizontalPanel(width, height) {
    return Math.abs(width - this.panelLength) < 1e-4 && Math.abs(height - this.panelWidth) < 1e-4;
  }

  isFullVerticalPanel(width, height) {
    return Math.abs(width - this.panelWidth) < 1e-4 && Math.abs(height - this.panelLength) < 1e-4;
  }

  renumberPanels(panels) {
    const sorted = [...panels].sort((a, b) => {
      const yDiff = a.y - b.y;
      if (Math.abs(yDiff) > 1e-6) return yDiff;
      return a.x - b.x;
    });
    sorted.forEach((p, i) => {
      p.number = i + 1;
    });
    return sorted;
  }

  /**
   * Полные слоты размера slotSize с фазой через anchor.
   * Слоты могут начинаться до min и заканчиваться после max — лишнее клипается контуром.
   */
  _axisStopsAnchored(min, max, slotSize, anchor) {
    const stops = [];
    if (max - min < 1e-9) return stops;

    let start = anchor;
    const k = Math.floor((min - anchor) / slotSize + 1e-12);
    start = anchor + k * slotSize;
    // Один слот до min, чтобы накрыть кромку (например вершину A)
    while (start > min - slotSize + 1e-9) start -= slotSize;
    while (start + slotSize <= min + 1e-9) start += slotSize;

    // Пока слот пересекает [min, max]
    for (let s = start; s < max - 1e-9; s += slotSize) {
      stops.push({ start: s, size: slotSize });
    }
    // Если последний слот не дотянул до max — ещё один с выходом за край
    const last = stops[stops.length - 1];
    if (!last || last.start + last.size < max - 1e-9) {
      const next = last ? last.start + slotSize : start;
      if (!last || Math.abs(next - last.start) > 1e-9) {
        stops.push({ start: next, size: slotSize });
      }
    }
    return stops;
  }

  /** Якоря старта: ортогональные 90° вершины; fallback — углы bbox */
  getStartAnchors() {
    const b = getBounds(this.localVertices);
    const fromVerts = findOrthogonalStartAnchors(this.localVertices);
    if (fromVerts.length) return fromVerts;

    return [
      { index: -1, x: 0, y: 0, label: 'bbox-bl' },
      { index: -1, x: b.maxX, y: 0, label: 'bbox-br' },
      { index: -1, x: 0, y: b.maxY, label: 'bbox-tl' },
      { index: -1, x: b.maxX, y: b.maxY, label: 'bbox-tr' },
    ];
  }

  fillHorizontalLayout(panels = [], anchor = { x: 0, y: 0 }) {
    const b = getBounds(this.localVertices);
    const ax = anchor?.x ?? 0;
    const ay = anchor?.y ?? 0;
    const xs = this._axisStopsAnchored(0, b.maxX, this.panelLength, ax);
    const ys = this._axisStopsAnchored(0, b.maxY, this.panelWidth, ay);

    for (const { start: y, size: rowHeight } of ys) {
      for (const { start: x, size: pw } of xs) {
        this.tryPlacePanel(panels, x, y, pw, rowHeight, Orientation.HORIZONTAL, false);
      }
    }
    return this.renumberPanels(panels);
  }

  fillVerticalLayout(panels = [], anchor = { x: 0, y: 0 }) {
    const b = getBounds(this.localVertices);
    const ax = anchor?.x ?? 0;
    const ay = anchor?.y ?? 0;
    const xs = this._axisStopsAnchored(0, b.maxX, this.panelWidth, ax);
    const ys = this._axisStopsAnchored(0, b.maxY, this.panelLength, ay);

    for (const { start: x, size: colWidth } of xs) {
      for (const { start: y, size: ph } of ys) {
        this.tryPlacePanel(panels, x, y, colWidth, ph, Orientation.VERTICAL, false);
      }
    }
    return this.renumberPanels(panels);
  }

  /** Комбинированная: вертикальная полоса от якоря по Y, дальше горизонталь с той же фазой X */
  calculateScheme3(anchor = { x: 0, y: 0 }) {
    const panels = [];
    const b = getBounds(this.localVertices);
    const ax = anchor?.x ?? 0;
    const ay = anchor?.y ?? 0;

    const ysFull = this._axisStopsAnchored(0, b.maxY, this.panelLength, ay);
    const firstStrip = ysFull[0];
    const stripH = firstStrip ? firstStrip.size : this.panelLength;
    const y0 = firstStrip ? firstStrip.start : 0;

    if (stripH > MIN_PANEL_FRAGMENT + 1e-9) {
      const xs = this._axisStopsAnchored(0, b.maxX, this.panelWidth, ax);
      for (const { start: x, size: colWidth } of xs) {
        this.tryPlacePanel(panels, x, y0, colWidth, stripH, Orientation.VERTICAL, false);
      }
    }

    const restFrom = y0 + stripH;
    if (restFrom < b.maxY - MIN_PANEL_FRAGMENT + 1e-6) {
      const ys = this._axisStopsAnchored(restFrom, b.maxY, this.panelWidth, ay);
      const xs = this._axisStopsAnchored(0, b.maxX, this.panelLength, ax);
      for (const { start: y, size: rowHeight } of ys) {
        for (const { start: x, size: pw } of xs) {
          this.tryPlacePanel(panels, x, y, pw, rowHeight, Orientation.HORIZONTAL, false);
        }
      }
    }

    return this.renumberPanels(panels);
  }

  _pointCoveredByPanel(px, py, panels) {
    for (const p of panels) {
      const parts =
        p.meta?.clipParts?.length > 0
          ? p.meta.clipParts
          : p.getParts();
      for (const part of parts) {
        if (
          px >= part.x - 1e-6 &&
          px <= part.x + part.w + 1e-6 &&
          py >= part.y - 1e-6 &&
          py <= part.y + part.h + 1e-6
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Добивка пустот: перебираем ВСЕ ячейки сетки, пересекающие контур.
   * Кладем только полные слоты 75×55 (клип по комнате при отрисовке).
   */
  fillCoverageGaps(panels, orientation, anchor = { x: 0, y: 0 }) {
    const b = getBounds(this.localVertices);
    const ax = anchor?.x ?? 0;
    const ay = anchor?.y ?? 0;
    const slotW =
      orientation === Orientation.VERTICAL ? this.panelWidth : this.panelLength;
    const slotH =
      orientation === Orientation.VERTICAL ? this.panelLength : this.panelWidth;

    const xs = this._axisStopsAnchored(0, b.maxX, slotW, ax);
    const ys = this._axisStopsAnchored(0, b.maxY, slotH, ay);

    const slotKey = (x, y) => `${x.toFixed(4)}:${y.toFixed(4)}`;
    const occupied = new Set(panels.map((p) => slotKey(p.x, p.y)));

    const trySlot = (sx, sy) => {
      const key = slotKey(sx, sy);
      if (occupied.has(key)) return false;
      const frags = this.getPolygonFragments(sx, sy, slotW, slotH);
      if (!frags.length) return false;
      // Нужна укладка, если есть непокрытая точка внутри клипа
      const uncovered = frags.some((f) => {
        const samples = [
          [f.x + f.w * 0.5, f.y + f.h * 0.5],
          [f.x + f.w * 0.25, f.y + f.h * 0.25],
          [f.x + f.w * 0.75, f.y + f.h * 0.25],
          [f.x + f.w * 0.25, f.y + f.h * 0.75],
          [f.x + f.w * 0.75, f.y + f.h * 0.75],
        ];
        return samples.some(
          ([px, py]) =>
            pointInPolygon(px, py, this.localVertices) &&
            !this._pointCoveredByPanel(px, py, panels)
        );
      });
      if (!uncovered) {
        occupied.add(key);
        return false;
      }
      const before = panels.length;
      this.tryPlacePanel(panels, sx, sy, slotW, slotH, orientation, true);
      if (panels.length > before) {
        occupied.add(key);
        return true;
      }
      return false;
    };

    for (let pass = 0; pass < 4; pass++) {
      let placed = 0;
      for (const col of xs) {
        for (const row of ys) {
          if (trySlot(col.start, row.start)) placed += 1;
        }
      }
      // Точечный скан на случай слотов вне текущего списка stops
      const step = 0.05;
      for (let y = -slotH; y < b.maxY + slotH; y += step) {
        for (let x = -slotW; x < b.maxX + slotW; x += step) {
          const px = x + step / 2;
          const py = y + step / 2;
          if (!pointInPolygon(px, py, this.localVertices)) continue;
          if (this._pointCoveredByPanel(px, py, panels)) continue;
          const sx = ax + Math.floor((px - ax) / slotW + 1e-12) * slotW;
          const sy = ay + Math.floor((py - ay) / slotH + 1e-12) * slotH;
          if (trySlot(sx, sy)) placed += 1;
        }
      }
      if (!placed) break;
    }

    return this.renumberPanels(panels);
  }

  /**
   * Gap-fill произвольными полосками отключён.
   * Пустоты закрывает fillCoverageGaps полными слотами.
   */
  fillGapPanels(panels) {
    return this.renumberPanels(panels);
  }

  hasNonOrthogonalEdges(eps = 1e-3) {
    const v = this.localVertices;
    const n = v.length;
    for (let i = 0; i < n; i++) {
      const a = v[i];
      const b = v[(i + 1) % n];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dx > eps && dy > eps) return true;
    }
    return false;
  }

  /** Полные слоты не отфильтровываем по площади клипа — иначе дыры у диагонали */
  filterThinPanels(panels) {
    return this.renumberPanels(panels);
  }

  scorePanels(panels, anchors = []) {
    const fullArea = this.panelLength * this.panelWidth;
    const fullPanels = panels.filter((p) => !p.isCut).length;
    const cutPanels = panels.filter((p) => p.isCut).length;
    const total = panels.length;
    const crumbs = panels.filter((p) => p.getArea() < fullArea * 0.35 - 1e-9).length;

    let cornerCrumbs = 0;
    let flushCorners = 0;
    for (const a of anchors) {
      if (a.index < 0) continue;
      if (this.isAnchorFlushFull(panels, a)) flushCorners += 1;
      for (const p of panels) {
        const touchesX = Math.abs(p.x - a.x) < 1e-3 || Math.abs(p.x + p.width - a.x) < 1e-3;
        const touchesY = Math.abs(p.y - a.y) < 1e-3 || Math.abs(p.y + p.height - a.y) < 1e-3;
        if (!touchesX || !touchesY) continue;
        if (!p.isCut) continue;
        if (Math.min(p.width, p.height) < 0.35 - 1e-9) cornerCrumbs += 1;
      }
    }

    return {
      fullPanels,
      cutPanels,
      total,
      crumbs,
      cornerCrumbs,
      flushCorners,
      openingTouches: cutPanels,
    };
  }

  compareScores(a, b) {
    // Сначала покрытие — иначе схема с дырами у диагонали может выиграть по fullPanels
    const covA = a.coverage ?? 0;
    const covB = b.coverage ?? 0;
    if (Math.abs(covA - covB) > 0.5) return covB - covA;
    if (a.fullPanels !== b.fullPanels) return b.fullPanels - a.fullPanels;
    if (a.flushCorners !== b.flushCorners) return b.flushCorners - a.flushCorners;
    if (a.cornerCrumbs !== b.cornerCrumbs) return a.cornerCrumbs - b.cornerCrumbs;
    if (a.cutPanels !== b.cutPanels) return a.cutPanels - b.cutPanels;
    if (a.total !== b.total) return a.total - b.total;
    return 0;
  }

  /** Панель касается якоря углом и является целой (правило «старт от прямого угла») */
  isAnchorFlushFull(panels, anchor, eps = 1e-3) {
    if (!anchor) return true;
    const ax = anchor.x;
    const ay = anchor.y;
    for (const p of panels) {
      if (p.isCut) continue;
      const touchesX = Math.abs(p.x - ax) < eps || Math.abs(p.x + p.width - ax) < eps;
      const touchesY = Math.abs(p.y - ay) < eps || Math.abs(p.y + p.height - ay) < eps;
      if (!touchesX || !touchesY) continue;
      const fullH = this.isFullHorizontalPanel(p.width, p.height);
      const fullV = this.isFullVerticalPanel(p.width, p.height);
      if (fullH || fullV) return true;
    }
    return false;
  }

  calculateBestScheme() {
    const anchors = this.getStartAnchors();
    // Горизонталь первой: при равном скоре сохраняется схема от внешнего угла вроде A
    const builders = [
      {
        name: 'Горизонтальная',
        build: (a) => this.fillHorizontalLayout([], a),
        orient: Orientation.HORIZONTAL,
      },
      {
        name: 'Вертикальная',
        build: (a) => this.fillVerticalLayout([], a),
        orient: Orientation.VERTICAL,
      },
      {
        name: 'Комбинированная',
        build: (a) => this.calculateScheme3(a),
        orient: Orientation.HORIZONTAL,
        alsoOrient: Orientation.VERTICAL,
      },
    ];
    const requireFlush = anchors.some((a) => a.index >= 0);

    let best = null;
    let bestScore = null;

    const finalize = (panels, builder, anchor) => {
      let next = this.fillCoverageGaps(panels, builder.orient, anchor);
      if (builder.alsoOrient) {
        next = this.fillCoverageGaps(next, builder.alsoOrient, anchor);
      }
      return this.filterThinPanels(next);
    };

    for (const anchor of anchors) {
      for (const builder of builders) {
        let panels = finalize(builder.build(anchor), builder, anchor);
        if (requireFlush && !this.isAnchorFlushFull(panels, anchor)) {
          continue;
        }
        const stats = this.getStatistics(panels);
        const score = this.scorePanels(panels, anchors);
        score.coverage = Number(stats.coveragePercent) || 0;
        if (!bestScore || this.compareScores(score, bestScore) < 0) {
          bestScore = score;
          best = {
            name: `${builder.name} (${anchor.label || 'anchor'})`,
            panels,
            stats,
            anchor,
          };
        }
      }
    }

    if (!best) {
      for (const anchor of anchors) {
        for (const builder of builders) {
          const panels = finalize(builder.build(anchor), builder, anchor);
          const stats = this.getStatistics(panels);
          const score = this.scorePanels(panels, anchors);
          score.coverage = Number(stats.coveragePercent) || 0;
          if (!bestScore || this.compareScores(score, bestScore) < 0) {
            bestScore = score;
            best = {
              name: `${builder.name} (${anchor.label || 'anchor'})`,
              panels,
              stats,
              anchor,
            };
          }
        }
      }
    }

    return best || {
      name: 'Вертикальная',
      panels: this.filterThinPanels(this.fillVerticalLayout([])),
      stats: this.getStatistics([]),
    };
  }

  getStatistics(panels) {
    const horizontal = panels.filter((p) => p.orientation === Orientation.HORIZONTAL).length;
    const vertical = panels.filter((p) => p.orientation === Orientation.VERTICAL).length;
    const fullPanels = panels.filter((p) => !p.isCut).length;
    const cutPanels = panels.filter((p) => p.isCut).length;
    const totalPanels = panels.length;
    const roomArea = this.getTotalArea();

    let coverageAreaActual = panels.reduce((s, p) => s + p.getArea(), 0);
    coverageAreaActual = Math.min(coverageAreaActual, roomArea);

    const panelsToPurchase = totalPanels;
    const withReserve = Math.ceil(panelsToPurchase * (1 + RESERVES.panels));
    const dowelsBase = totalPanels * RESERVES.dowelsPerPanel;
    const dowelsWithReserve = Math.ceil(dowelsBase * (1 + RESERVES.dowels));
    const workTimeMinutes = Math.round(totalPanels);
    const workTimeHours = Math.floor(workTimeMinutes / 60);
    const remainingMinutes = workTimeMinutes % 60;

    const coveragePercent =
      roomArea > 0 ? Math.min(100, (coverageAreaActual / roomArea) * 100) : 0;

    return {
      total: totalPanels,
      fullPanels,
      cutPanels,
      panelsToPurchase,
      horizontal,
      vertical,
      coverageArea: coverageAreaActual.toFixed(2),
      coveragePercent: coveragePercent.toFixed(1),
      withReserve,
      dowels: { base: dowelsBase, withReserve: dowelsWithReserve },
      workTime: {
        minutes: workTimeMinutes,
        hours: workTimeHours,
        remainingMinutes,
        formatted:
          workTimeHours > 0
            ? `${workTimeHours} ч ${remainingMinutes} мин`
            : `${workTimeMinutes} мин`,
      },
    };
  }
}

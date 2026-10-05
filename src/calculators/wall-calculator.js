import {
  PANEL_LAYOUT,
  OPENING_TYPES,
  RESERVES,
  MIN_PANEL_FRAGMENT,
} from '../core/constants.js';
import {
  subtractOpeningsFromRect,
  groupConnectedRects,
  boundsOfRects,
  fitsInPanelSize,
  rectsShareEdge,
  coalesceRects,
  partsFillFreeAabb,
} from '../core/geometry.js';
import { Panel, Orientation } from './ceiling-calculator.js';

/**
 * Укладка панелей на одной стене (развёртка: X — длина стены, Y — высота от пола).
 * Приоритет: максимум целых → минимум подрезанных → меньше панелей всего.
 * Старт предпочтительно от пола; сетка может сдвигаться под края проёмов.
 */
export class WallSurfaceCalculator {
  constructor(wallLength, wallHeight, openings = [], wallId = '', wallLabel = '') {
    this.wallLength = wallLength;
    this.wallHeight = wallHeight;
    this.openings = openings;
    this.wallId = wallId;
    this.wallLabel = wallLabel;
    this.panelLength = PANEL_LAYOUT.length;
    this.panelWidth = PANEL_LAYOUT.width;
  }

  getOpeningRects() {
    return this.openings.map((o) => {
      const bottomY = o.type === OPENING_TYPES.WINDOW ? o.sillHeight : 0;
      return {
        x: o.offset,
        y: bottomY,
        w: o.width,
        h: o.height,
        type: o.type,
      };
    });
  }

  isFragmentWorthPlacing(part) {
    // ≤5 см не кладём — зазор закрывают обрезками на объекте
    return part.w > MIN_PANEL_FRAGMENT + 1e-9 && part.h > MIN_PANEL_FRAGMENT + 1e-9;
  }

  isFullPanel(width, height, orientation) {
    if (orientation === Orientation.HORIZONTAL) {
      return (
        Math.abs(width - this.panelLength) < 1e-4 &&
        Math.abs(height - this.panelWidth) < 1e-4
      );
    }
    return (
      Math.abs(width - this.panelWidth) < 1e-4 &&
      Math.abs(height - this.panelLength) < 1e-4
    );
  }

  panelMeta(extra = {}) {
    return {
      wallId: this.wallId,
      wallLabel: this.wallLabel,
      ...extra,
    };
  }

  /** Связные компоненты слота минус проёмы → одна панель на компонент (Г = 1 панель) */
  panelsFromCell(cell, openings, orientation) {
    const raw = subtractOpeningsFromRect(cell, openings).filter((p) =>
      this.isFragmentWorthPlacing(p)
    );
    if (!raw.length) return [];

    const components = groupConnectedRects(raw);
    const result = [];

    for (const parts of components) {
      const filtered = parts.filter((p) => this.isFragmentWorthPlacing(p));
      if (!filtered.length) continue;

      if (!fitsInPanelSize(filtered, this.panelLength, this.panelWidth)) {
        for (const part of filtered) {
          const isCut = !this.isFullPanel(part.w, part.h, orientation);
          result.push(
            new Panel(part.x, part.y, part.w, part.h, orientation, 0, isCut, this.panelMeta())
          );
        }
        continue;
      }

      const aabb = boundsOfRects(filtered);
      const coalesced = coalesceRects(filtered);
      const isCut =
        coalesced.length > 1 ||
        !this.isFullPanel(aabb.w, aabb.h, orientation) ||
        coalesced.some(
          (p) =>
            Math.abs(p.x - aabb.x) > 1e-4 ||
            Math.abs(p.y - aabb.y) > 1e-4 ||
            Math.abs(p.w - aabb.w) > 1e-4 ||
            Math.abs(p.h - aabb.h) > 1e-4
        );

      const panel = Panel.fromParts(
        coalesced,
        orientation,
        0,
        isCut,
        this.panelMeta()
      );
      if (panel) result.push(panel);
    }

    return result;
  }

  /**
   * Остановки оси с отступом startPad слева/снизу:
   * зазор &lt;5 см не кладём; далее целые слоты; остаток ≥5 см — cut.
   */
  _axisStops(total, slotSize, startPad = 0) {
    const stops = [];
    if (total < MIN_PANEL_FRAGMENT - 1e-6) return stops;

    let pad = startPad;
    if (pad < 0) pad = 0;
    if (pad > total) pad = total;
    // Нормализуем в [0, slotSize)
    if (pad >= slotSize - 1e-9) pad %= slotSize;

    let pos = 0;
    if (pad > MIN_PANEL_FRAGMENT + 1e-9) {
      stops.push({ start: 0, size: pad });
      pos = pad;
    } else if (pad > 1e-6) {
      // ≤5 см — технологический зазор, целые начинаются после него
      pos = pad;
    }

    while (pos + slotSize <= total + 1e-9) {
      stops.push({ start: pos, size: slotSize });
      pos += slotSize;
    }
    const rem = total - pos;
    if (rem > MIN_PANEL_FRAGMENT + 1e-9) {
      stops.push({ start: pos, size: rem });
    }
    return stops;
  }

  /** Кандидаты сдвига: 0, остаток с противоположной стороны, края проёмов */
  _offsetCandidates(total, slotSize, edges) {
    const set = new Set([0]);
    const fullCount = Math.floor((total + 1e-9) / slotSize);
    const rem = total - fullCount * slotSize;
    if (rem > MIN_PANEL_FRAGMENT + 1e-9) {
      set.add(+rem.toFixed(6));
    }
    for (const edge of edges) {
      if (!Number.isFinite(edge)) continue;
      if (edge <= 1e-6 || edge >= total - 1e-6) continue;
      set.add(+(edge % slotSize).toFixed(6));
    }
    return [...set].filter((v) => v >= -1e-9 && v < slotSize - 1e-9);
  }

  buildLayout(orientation, padX, padY) {
    const openings = this.getOpeningRects();
    const panels = [];
    const slotW = orientation === Orientation.VERTICAL ? this.panelWidth : this.panelLength;
    const slotH = orientation === Orientation.VERTICAL ? this.panelLength : this.panelWidth;
    const xs = this._axisStops(this.wallLength, slotW, padX);
    const ys = this._axisStops(this.wallHeight, slotH, padY);

    for (const { start: x, size: w } of xs) {
      for (const { start: y, size: h } of ys) {
        for (const panel of this.panelsFromCell({ x, y, w, h }, openings, orientation)) {
          panels.push(panel);
        }
      }
    }

    const merged = this.mergeAdjacentPanels(panels, openings, orientation);
    return this._finalizePanels(merged);
  }

  panelsTouch(a, b) {
    for (const pa of a.getParts()) {
      for (const pb of b.getParts()) {
        if (rectsShareEdge(pa, pb, 1e-4)) return true;
      }
    }
    return false;
  }

  canMergePanels(a, b, openings) {
    // Две целые не склеиваем
    if (!a.isCut && !b.isCut) return false;
    if (!this.panelsTouch(a, b)) return false;

    const parts = coalesceRects([...a.getParts(), ...b.getParts()]);
    if (!fitsInPanelSize(parts, this.panelLength, this.panelWidth)) return false;
    if (!partsFillFreeAabb(parts, openings)) return false;
    return true;
  }

  mergeTwoPanels(a, b, orientation) {
    const parts = coalesceRects([...a.getParts(), ...b.getParts()]);
    const aabb = boundsOfRects(parts);
    const orient = a.orientation || b.orientation || orientation;
    const isCut =
      parts.length > 1 ||
      !this.isFullPanel(aabb.w, aabb.h, orient) ||
      parts.some(
        (p) =>
          Math.abs(p.x - aabb.x) > 1e-4 ||
          Math.abs(p.y - aabb.y) > 1e-4 ||
          Math.abs(p.w - aabb.w) > 1e-4 ||
          Math.abs(p.h - aabb.h) > 1e-4
      );

    return Panel.fromParts(parts, orient, 0, isCut, this.panelMeta());
  }

  /**
   * Жадно склеивает соседние подрезки, если вместе влезают в одну 75×55.
   * Убирает лишние швы сетки (101–104 → одна; 106+107 → одна Г/полоса).
   */
  mergeAdjacentPanels(panels, openings, orientation) {
    let list = panels.slice();
    let changed = true;
    let guard = 0;
    while (changed && guard < 500) {
      guard += 1;
      changed = false;
      let best = null;

      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (!this.canMergePanels(list[i], list[j], openings)) continue;
          const merged = this.mergeTwoPanels(list[i], list[j], orientation);
          if (!merged) continue;
          // Предпочитаем склейку, дающую целую панель, затем большую площадь
          const gainFull = merged.isCut ? 0 : 1;
          const area = merged.getArea();
          if (
            !best ||
            gainFull > best.gainFull ||
            (gainFull === best.gainFull && area > best.area)
          ) {
            best = { i, j, merged, gainFull, area };
          }
        }
      }

      if (best) {
        const next = [];
        for (let k = 0; k < list.length; k++) {
          if (k === best.i || k === best.j) continue;
          next.push(list[k]);
        }
        next.push(best.merged);
        list = next;
        changed = true;
      }
    }
    return list;
  }

  countOpeningTouches(panels, openings) {
    let count = 0;
    const eps = 0.02;
    for (const panel of panels) {
      const touches = panel.getParts().some((part) =>
        openings.some((o) => this._touchesOpeningBorder(part, o, eps))
      );
      if (touches) count += 1;
    }
    return count;
  }

  _touchesOpeningBorder(part, o, eps) {
    const pr = { x1: part.x, y1: part.y, x2: part.x + part.w, y2: part.y + part.h };
    const or_ = { x1: o.x, y1: o.y, x2: o.x + o.w, y2: o.y + o.h };

    const yOverlap = Math.min(pr.y2, or_.y2) - Math.max(pr.y1, or_.y1);
    const xOverlap = Math.min(pr.x2, or_.x2) - Math.max(pr.x1, or_.x1);

    if (yOverlap > eps) {
      if (Math.abs(pr.x2 - or_.x1) <= eps || Math.abs(pr.x1 - or_.x2) <= eps) return true;
    }
    if (xOverlap > eps) {
      if (Math.abs(pr.y2 - or_.y1) <= eps || Math.abs(pr.y1 - or_.y2) <= eps) return true;
    }
    return false;
  }

  scoreLayout(panels, openings) {
    const fullPanels = panels.filter((p) => !p.isCut).length;
    const cutPanels = panels.filter((p) => p.isCut).length;
    const total = panels.length;
    const openingTouches = this.countOpeningTouches(panels, openings);
    // Доп. штраф за составные (Г) — это всё же подрезка
    const multiPart = panels.filter((p) => p.parts && p.parts.length > 1).length;
    return { fullPanels, cutPanels, total, openingTouches, multiPart };
  }

  /**
   * 1) больше целых
   * 2) меньше подрезанных
   * 3) меньше панелей всего
   * 4) меньше касаний проёмов / составных
   */
  compareScores(a, b) {
    if (a.fullPanels !== b.fullPanels) return b.fullPanels - a.fullPanels;
    if (a.cutPanels !== b.cutPanels) return a.cutPanels - b.cutPanels;
    if (a.total !== b.total) return a.total - b.total;
    if (a.multiPart !== b.multiPart) return a.multiPart - b.multiPart;
    return a.openingTouches - b.openingTouches;
  }

  _finalizePanels(panels) {
    panels.sort((a, b) => {
      const xDiff = a.x - b.x;
      if (Math.abs(xDiff) > 1e-6) return xDiff;
      return a.y - b.y;
    });
    panels.forEach((p, i) => {
      p.number = i + 1;
    });
    return panels;
  }

  calculateLayout() {
    const openings = this.getOpeningRects();
    const xEdges = openings.flatMap((o) => [o.x, o.x + o.w]);
    const yEdges = openings.flatMap((o) => [o.y, o.y + o.h]);

    const orientations = [Orientation.VERTICAL, Orientation.HORIZONTAL];
    let best = null;
    let bestScore = null;

    for (const orientation of orientations) {
      const slotW = orientation === Orientation.VERTICAL ? this.panelWidth : this.panelLength;
      const slotH = orientation === Orientation.VERTICAL ? this.panelLength : this.panelWidth;
      const padsX = this._offsetCandidates(this.wallLength, slotW, xEdges);
      const padsY = this._offsetCandidates(this.wallHeight, slotH, yEdges);

      // Предпочитаем старт от пола: padY = 0 перебираем первым
      padsY.sort((a, b) => a - b);
      padsX.sort((a, b) => a - b);

      for (const padX of padsX) {
        for (const padY of padsY) {
          const panels = this.buildLayout(orientation, padX, padY);
          const score = this.scoreLayout(panels, openings);
          if (!bestScore || this.compareScores(score, bestScore) < 0) {
            best = panels;
            bestScore = score;
          }
        }
      }
    }

    return best || [];
  }

  getNetArea() {
    const gross = this.wallLength * this.wallHeight;
    const openingsArea = this.openings.reduce((s, o) => s + o.width * o.height, 0);
    return Math.max(0, gross - openingsArea);
  }
}

export class WallCalculator {
  constructor(room) {
    this.room = room;
  }

  calculateAllWalls() {
    const results = [];
    let globalNumber = 1;

    for (const wall of this.room.walls) {
      const openings = this.room.getOpeningsForWall(wall.id);
      const calc = new WallSurfaceCalculator(
        wall.length,
        this.room.wallHeight,
        openings,
        wall.id,
        wall.label
      );
      const panels = calc.calculateLayout();
      panels.forEach((p) => {
        p.number = globalNumber++;
        p.meta = { ...p.meta, wallId: wall.id, wallLabel: wall.label };
      });

      results.push({
        wall,
        panels,
        netArea: calc.getNetArea(),
        grossArea: wall.length * this.room.wallHeight,
        openings,
      });
    }

    return results;
  }

  getCombinedStatistics(wallResults) {
    const allPanels = wallResults.flatMap((w) => w.panels);
    const total = allPanels.length;
    const fullPanels = allPanels.filter((p) => !p.isCut).length;
    const cutPanels = allPanels.filter((p) => p.isCut).length;
    const netArea = wallResults.reduce((s, w) => s + w.netArea, 0);
    let coverageArea = allPanels.reduce((s, p) => s + p.getArea(), 0);
    coverageArea = Math.min(coverageArea, netArea);

    const withReserve = Math.ceil(total * (1 + RESERVES.panels));
    const dowelsBase = total * RESERVES.dowelsPerPanel;
    const dowelsWithReserve = Math.ceil(dowelsBase * (1 + RESERVES.dowels));
    const workTimeMinutes = Math.round(total);
    const workTimeHours = Math.floor(workTimeMinutes / 60);
    const remainingMinutes = workTimeMinutes % 60;
    const coveragePercent = netArea > 0 ? Math.min(100, (coverageArea / netArea) * 100) : 0;

    return {
      total,
      fullPanels,
      cutPanels,
      panelsToPurchase: total,
      coverageArea: coverageArea.toFixed(2),
      coveragePercent: coveragePercent.toFixed(1),
      netArea: netArea.toFixed(2),
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

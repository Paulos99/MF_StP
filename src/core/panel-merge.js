import {
  boundsOfRects,
  fitsInPanelSize,
  rectsShareEdge,
  coalesceRects,
  partsFillFreeAabb,
} from './geometry.js';
import { Panel, Orientation } from '../calculators/ceiling-calculator.js';
import { PANEL_LAYOUT } from './constants.js';

function panelsTouch(a, b, eps = 1e-4) {
  for (const pa of a.getParts()) {
    for (const pb of b.getParts()) {
      if (rectsShareEdge(pa, pb, eps)) return true;
    }
  }
  return false;
}

function isFullPanel(width, height, orientation, panelLength, panelWidth) {
  if (orientation === Orientation.HORIZONTAL) {
    return Math.abs(width - panelLength) < 1e-4 && Math.abs(height - panelWidth) < 1e-4;
  }
  return Math.abs(width - panelWidth) < 1e-4 && Math.abs(height - panelLength) < 1e-4;
}

export function canMergePanels(
  a,
  b,
  openings = [],
  panelLength = PANEL_LAYOUT.length,
  panelWidth = PANEL_LAYOUT.width
) {
  if (!a.isCut && !b.isCut) return false;
  if (!panelsTouch(a, b)) return false;
  const parts = coalesceRects([...a.getParts(), ...b.getParts()]);
  if (!fitsInPanelSize(parts, panelLength, panelWidth)) return false;
  if (!partsFillFreeAabb(parts, openings)) return false;
  return true;
}

export function mergeTwoPanels(
  a,
  b,
  orientation,
  meta = {},
  panelLength = PANEL_LAYOUT.length,
  panelWidth = PANEL_LAYOUT.width
) {
  const parts = coalesceRects([...a.getParts(), ...b.getParts()]);
  const aabb = boundsOfRects(parts);
  const orient = a.orientation || b.orientation || orientation || Orientation.HORIZONTAL;
  const isCut =
    parts.length > 1 ||
    !isFullPanel(aabb.w, aabb.h, orient, panelLength, panelWidth) ||
    parts.some(
      (p) =>
        Math.abs(p.x - aabb.x) > 1e-4 ||
        Math.abs(p.y - aabb.y) > 1e-4 ||
        Math.abs(p.w - aabb.w) > 1e-4 ||
        Math.abs(p.h - aabb.h) > 1e-4
    );
  return Panel.fromParts(parts, orient, 0, isCut, { ...a.meta, ...b.meta, ...meta });
}

/**
 * Жадно склеивает соседние подрезки, если вместе влезают в одну панель 75×55.
 * openings=[] для потолка; на стенах — прямоугольники проёмов.
 */
export function mergeAdjacentPanels(
  panels,
  openings = [],
  orientation = Orientation.HORIZONTAL,
  options = {}
) {
  const panelLength = options.panelLength ?? PANEL_LAYOUT.length;
  const panelWidth = options.panelWidth ?? PANEL_LAYOUT.width;
  const meta = options.meta ?? {};

  let list = panels.slice();
  let changed = true;
  let guard = 0;
  while (changed && guard < 500) {
    guard += 1;
    changed = false;
    let best = null;

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (!canMergePanels(list[i], list[j], openings, panelLength, panelWidth)) continue;
        const merged = mergeTwoPanels(
          list[i],
          list[j],
          orientation,
          meta,
          panelLength,
          panelWidth
        );
        if (!merged) continue;
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

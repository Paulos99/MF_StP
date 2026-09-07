/**
 * Assert continuous ceiling packing for the irregular ~9×6 diagonal room
 * and a simple rectangle (≤5 cm edge trim allowed).
 */
import { PolygonPanelCalculator } from '../src/calculators/polygon-ceiling-calculator.js';
import { getBounds, pointInPolygon } from '../src/core/polygon-geometry.js';
import { Orientation } from '../src/calculators/ceiling-calculator.js';
import { MIN_PANEL_FRAGMENT } from '../src/core/constants.js';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
}

/** Largest uncovered axis-aligned square side inside the room (m). */
function maxUncoveredSquareSide(calc, panels, step = 0.05) {
  const b = getBounds(calc.localVertices);
  const uncovered = [];
  for (let y = step / 2; y < b.maxY; y += step) {
    for (let x = step / 2; x < b.maxX; x += step) {
      if (!pointInPolygon(x, y, calc.localVertices)) continue;
      if (!calc._pointCoveredByPanel(x, y, panels)) uncovered.push([x, y]);
    }
  }
  if (!uncovered.length) return 0;
  // For each uncovered sample, grow Chebyshev ball until hitting covered/outside
  let maxSide = 0;
  for (const [cx, cy] of uncovered) {
    let r = step;
    for (; r < 1.0; r += step) {
      let ok = true;
      for (let dy = -r; dy <= r + 1e-9 && ok; dy += step) {
        for (let dx = -r; dx <= r + 1e-9; dx += step) {
          const x = cx + dx;
          const y = cy + dy;
          if (!pointInPolygon(x, y, calc.localVertices)) continue;
          if (calc._pointCoveredByPanel(x, y, panels)) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) break;
    }
    maxSide = Math.max(maxSide, Math.max(0, r - step) * 2);
  }
  return maxSide;
}

function sameOrientRowGaps(panels) {
  const rows = new Map();
  for (const p of panels) {
    const yk = (Math.round(p.y * 1000) / 1000).toFixed(3);
    if (!rows.has(yk)) rows.set(yk, []);
    rows.get(yk).push(p);
  }
  const ykeys = [...rows.keys()].sort((a, b) => Number(a) - Number(b));
  const gaps = [];
  for (let i = 0; i < ykeys.length - 1; i++) {
    const row = rows.get(ykeys[i]);
    const next = rows.get(ykeys[i + 1]);
    if (row[0].orientation !== next[0].orientation) continue;
    if (row[0].orientation !== Orientation.HORIZONTAL) continue;
    const maxBottom = Math.max(...row.map((p) => p.y + p.height));
    const gap = Number(ykeys[i + 1]) - maxBottom;
    if (gap > 0.01) gaps.push(gap);
  }
  return gaps;
}

function checkRoom(name, verts, { checkScheme3 = false } = {}) {
  const calc = new PolygonPanelCalculator(verts);
  const best = calc.calculateBestScheme();
  const panels = best.panels;
  const stats = best.stats;
  const nums = [...panels].map((p) => p.number).sort((a, b) => a - b);
  const contiguous =
    nums.length === 0 ||
    (nums[0] === 1 && nums.every((n, i) => n === i + 1));

  const voidSide = maxUncoveredSquareSide(calc, panels);
  const rg = sameOrientRowGaps(panels);

  console.log(
    `${name}: scheme=${best.name} panels=${panels.length} cov=${stats.coveragePercent}% maxVoidSide=${voidSide.toFixed(3)}m rowGaps=${rg.map((g) => g.toFixed(3)).join(',') || 'none'}`
  );

  assert(contiguous, `${name}: panel numbers not contiguous`);
  assert(
    Number(stats.coveragePercent) >= 99.0,
    `${name}: coverage ${stats.coveragePercent}% too low`
  );
  assert(
    voidSide <= MIN_PANEL_FRAGMENT + 0.02,
    `${name}: interior void side ${voidSide.toFixed(3)}m exceeds ~5cm trim`
  );
  assert(
    rg.every((g) => g <= MIN_PANEL_FRAGMENT + 0.02),
    `${name}: horizontal row gaps ${rg}`
  );

  if (checkScheme3) {
    for (const a of calc.getStartAnchors()) {
      let p = calc.calculateScheme3(a);
      p = calc.fillCoverageGaps(p, Orientation.HORIZONTAL, a);
      p = calc.fillCoverageGaps(p, Orientation.VERTICAL, a);
      const rg3 = sameOrientRowGaps(p.filter((x) => x.orientation === Orientation.HORIZONTAL));
      // Vertical strip must abut first horizontal row
      const verts = p.filter((x) => x.orientation === Orientation.VERTICAL);
      const hors = p.filter((x) => x.orientation === Orientation.HORIZONTAL);
      if (verts.length && hors.length) {
        const stripBottom = Math.max(...verts.map((v) => v.y + v.height));
        const firstH = Math.min(...hors.map((h) => h.y));
        const seam = firstH - stripBottom;
        assert(
          Math.abs(seam) <= 0.02 || seam < 0,
          `${name}: scheme3@${a.label} strip/H seam gap ${seam.toFixed(3)}m`
        );
      }
      assert(
        rg3.every((g) => g <= 0.02),
        `${name}: scheme3@${a.label} H row gaps ${rg3}`
      );
    }
  }
}

checkRoom(
  'diag-9x6',
  [
    { x: 0, y: 0, label: 'A' },
    { x: 3, y: 0, label: 'F' },
    { x: 6, y: 3, label: 'E' },
    { x: 9, y: 3, label: 'D' },
    { x: 9, y: 6, label: 'C' },
    { x: 0, y: 6, label: 'B' },
  ],
  { checkScheme3: true }
);

checkRoom('rect-5x4', [
  { x: 0, y: 0, label: 'A' },
  { x: 5, y: 0, label: 'B' },
  { x: 5, y: 4, label: 'C' },
  { x: 0, y: 4, label: 'D' },
]);

if (!process.exitCode) console.log('OK: all ceiling layout assertions passed');

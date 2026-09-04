import { PANEL, RESERVES } from '../core/constants.js';
import { calculateFrameMaterials, formatFrameMaterials, mergeFrameTotals, MOUNTING_RULES } from './mounting-rules.js';
import { getBounds } from '../core/polygon-geometry.js';

export function applyPricing(stats) {
  if (!stats) return stats;
  stats.totalCostWithoutReserve = stats.panelsToPurchase * PANEL.priceRub;
  stats.totalCostWithReserve = stats.withReserve * PANEL.priceRub;
  stats.totalCost = stats.totalCostWithReserve;
  return stats;
}

export function buildBOM({ room, ceilingResult, wallResult, options }) {
  const {
    calcCeiling = true,
    calcWalls = true,
    ceilingMounting = 'ceiling_frameless',
    wallMounting = 'wall_framed',
  } = options;

  const bom = {
    ceiling: null,
    walls: null,
    total: null,
    ceilingMounting,
    wallMounting,
  };

  if (calcCeiling && ceilingResult) {
    const stats = applyPricing({ ...ceilingResult.stats });
    const b = getBounds(room.vertices ?? []);
    const frameW = b.maxX - b.minX;
    const frameH = b.maxY - b.minY;
    const frame =
      ceilingMounting === 'ceiling_framed'
        ? calculateFrameMaterials(
            'ceiling_framed',
            frameW,
            frameH,
            { panelCount: ceilingResult.stats?.total ?? ceilingResult.panels?.length ?? 0 }
          )
        : null;

    bom.ceiling = {
      stats,
      schemeName: ceilingResult.name,
      panels: ceilingResult.panels,
      frame,
      mountingLabel: MOUNTING_RULES[ceilingMounting]?.label ?? ceilingMounting,
      area: room.getTotalArea(),
    };
  }

  if (calcWalls && wallResult) {
    const stats = applyPricing({ ...wallResult.stats });
    let totalFrame = null;
    if (wallMounting === 'wall_framed') {
      const wallFrames = wallResult.wallResults.map((wr) =>
        calculateFrameMaterials('wall_framed', wr.wall.length, room.wallHeight, {
          panelCount: wr.panels?.length ?? 0,
          openings: wr.openings ?? [],
        })
      );
      totalFrame = mergeFrameTotals(wallFrames);
    }

    const wallsArea = wallResult.wallResults.reduce((s, wr) => s + wr.netArea, 0);

    bom.walls = {
      stats,
      wallResults: wallResult.wallResults,
      frame: totalFrame,
      mountingLabel: MOUNTING_RULES[wallMounting]?.label ?? wallMounting,
      area: wallsArea,
    };
  }

  const panelsTotal =
    (bom.ceiling?.stats.withReserve ?? 0) + (bom.walls?.stats.withReserve ?? 0);
  const costTotal =
    (bom.ceiling?.stats.totalCost ?? 0) + (bom.walls?.stats.totalCost ?? 0);
  const dowelsTotal =
    (bom.ceiling?.stats.dowels?.withReserve ?? 0) + (bom.walls?.stats.dowels?.withReserve ?? 0);

  bom.total = {
    panelsWithReserve: panelsTotal,
    totalCost: costTotal,
    dowelsWithReserve: dowelsTotal,
    frame: mergeFrameTotals([bom.ceiling?.frame, bom.walls?.frame].filter(Boolean)),
    profileLengthM:
      (bom.ceiling?.frame?.totalProfileLengthM ?? 0) +
      (bom.walls?.frame?.totalProfileLengthM ?? 0),
  };

  return bom;
}

/** Статистика по одной стене для PDF и отчётов */
export function buildWallSurfaceStats(wr, mountingType, wallHeight) {
  const panels = wr.panels ?? [];
  const total = panels.length;
  const fullPanels = panels.filter((p) => !p.isCut).length;
  const cutPanels = panels.filter((p) => p.isCut).length;
  const rules = MOUNTING_RULES[mountingType] ?? MOUNTING_RULES.wall_frameless;
  const dowelsPerPanel = rules.dowelsPerPanel ?? RESERVES.dowelsPerPanel;
  const panelReserve = rules.reserve?.panels ?? RESERVES.panels;
  const dowelReserve = rules.reserve?.dowels ?? RESERVES.dowels;
  const withReserve = Math.ceil(total * (1 + panelReserve));
  const dowels = Math.ceil(total * dowelsPerPanel * (1 + dowelReserve));
  const frame =
    mountingType === 'wall_framed'
      ? calculateFrameMaterials('wall_framed', wr.wall.length, wallHeight, {
          panelCount: panels.length,
          openings: wr.openings ?? [],
        })
      : null;

  return {
    total,
    fullPanels,
    cutPanels,
    withReserve,
    panelsToPurchase: total,
    dowels: { base: total * dowelsPerPanel, withReserve: dowels },
    netArea: wr.netArea,
    grossArea: wr.grossArea,
    openingsCount: wr.openings?.length ?? 0,
    frame,
    totalCost: withReserve * PANEL.priceRub,
    mountingLabel: rules.label,
  };
}

export function formatResultsText(bom, room) {
  const lines = [];
  lines.push(`Размер панели (габарит): ${PANEL.nominal.length.toFixed(2).replace('.', ',')}×${PANEL.nominal.width.toFixed(2).replace('.', ',')} м`);
  lines.push(`РРЦ панели: ${PANEL.priceRub.toLocaleString('ru-RU')} ₽`);
  lines.push('');

  if (bom.ceiling) {
    const s = bom.ceiling.stats;
    lines.push('── ПОТОЛОК ──');
    lines.push(`Монтаж: ${bom.ceiling.mountingLabel}`);
    lines.push(`Схема: ${bom.ceiling.schemeName}`);
    lines.push(`Площадь: ${bom.ceiling.area.toFixed(2)} м²`);
    lines.push(`Панелей: ${s.total} (${s.fullPanels ?? s.total ?? 0} целых + ${s.cutPanels ?? 0} подрез.)`);
    lines.push(`К закупке: ${s.panelsToPurchase} шт.`);
    lines.push(`Дюбели: ${s.dowels.withReserve} шт.`);
    if (bom.ceiling.frame) {
      lines.push('Каркас:');
      lines.push(...formatFrameMaterials(bom.ceiling.frame, '  '));
    }
    lines.push(`Стоимость панелей: ${s.totalCost.toLocaleString('ru-RU')} ₽`);
    lines.push('');
  }

  if (bom.walls) {
    const s = bom.walls.stats;
    lines.push('── СТЕНЫ ──');
    lines.push(`Монтаж: ${bom.walls.mountingLabel}`);
    lines.push(`Чистая площадь стен: ${bom.walls.area.toFixed(2)} м²`);
    lines.push(`Панелей: ${s.total} (${s.fullPanels ?? s.total ?? 0} целых + ${s.cutPanels ?? 0} подрез.)`);
    lines.push(`К закупке: ${s.panelsToPurchase} шт.`);
    lines.push(`Дюбели: ${s.dowels.withReserve} шт.`);
    if (bom.walls.frame) {
      lines.push('Каркас (суммарно по стенам):');
      lines.push(...formatFrameMaterials(bom.walls.frame, '  '));
    }
    lines.push(`Стоимость панелей: ${s.totalCost.toLocaleString('ru-RU')} ₽`);
    lines.push('');
  }

  if (bom.total) {
    lines.push('── ИТОГО ──');
    lines.push(`Панелей к закупке: ${bom.total.panelsWithReserve} шт.`);
    lines.push(`Дюбели: ${bom.total.dowelsWithReserve} шт.`);
    if (bom.total.frame?.items?.length) {
      lines.push('Каркас (всего по проекту):');
      lines.push(...formatFrameMaterials(bom.total.frame, '  '));
    } else if (bom.total.profileLengthM > 0) {
      lines.push(`Профиль суммарно: ${bom.total.profileLengthM.toFixed(2)} м`);
    }
    lines.push(`Общая стоимость панелей: ${bom.total.totalCost.toLocaleString('ru-RU')} ₽`);
  }

  return lines.join('\n');
}

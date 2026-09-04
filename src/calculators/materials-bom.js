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
  const total = wr.panelCount ?? panels.length;
  const fullPanels = wr.panelCount != null
    ? wr.panelCount
    : panels.filter((p) => !p.isCut).length;
  const cutPanels = wr.panelCount != null
    ? 0
    : panels.filter((p) => p.isCut).length;
  const rules = MOUNTING_RULES[mountingType] ?? MOUNTING_RULES.wall_frameless;
  const dowelsPerPanel = rules.dowelsPerPanel ?? RESERVES.dowelsPerPanel;
  const panelReserve = rules.reserve?.panels ?? RESERVES.panels;
  const dowelReserve = rules.reserve?.dowels ?? RESERVES.dowels;
  const withReserve = Math.ceil(total * (1 + panelReserve));
  const dowels = Math.ceil(total * dowelsPerPanel * (1 + dowelReserve));
  const frame =
    mountingType === 'wall_framed'
      ? calculateFrameMaterials('wall_framed', wr.wall.length, wallHeight, {
          panelCount: total,
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

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPanelSplit(stats, { isEstimate = false } = {}) {
  const total = stats?.panelsToPurchase ?? stats?.total ?? 0;
  const full = stats?.fullPanels ?? 0;
  const cut = stats?.cutPanels ?? 0;
  if (isEstimate) {
    return {
      primary: String(total),
      detail: null,
    };
  }
  if (cut > 0) {
    return {
      primary: String(total),
      detail: `${full} целых · ${cut} с подрезкой`,
    };
  }
  return {
    primary: String(total),
    detail: 'без подрезки',
  };
}

function metricHtml(value, label, detail = null) {
  return `<div class="results-kpi">
    <span class="results-kpi__value">${escHtml(value)}</span>
    <span class="results-kpi__label">${escHtml(label)}</span>
    ${detail ? `<span class="results-kpi__detail">${escHtml(detail)}</span>` : ''}
  </div>`;
}

function frameListHtml(frame, title) {
  if (!frame) return '';
  const lines = formatFrameMaterials(frame, '');
  if (!lines.length) return '';
  return `<div class="results-frame">
    <div class="results-frame__title">${escHtml(title)}</div>
    <ul class="results-frame__list">${lines.map((line) => `<li>${escHtml(line.trim())}</li>`).join('')}</ul>
  </div>`;
}

/** Структурированный HTML отчёта для колонки «Результаты» */
export function formatResultsHtml(bom, { isAreaEstimate = false } = {}) {
  if (!bom) return '';
  const parts = [];

  if (isAreaEstimate) {
    parts.push('<p class="results-report__note">Оценка по площади — раскладка и подрезка не считаются</p>');
  }

  if (bom.ceiling?.stats) {
    const s = bom.ceiling.stats;
    const panels = formatPanelSplit(s, { isEstimate: isAreaEstimate });
    const area = Number(s.coverageArea ?? s.netArea ?? bom.ceiling.area ?? 0);
    parts.push(`<section class="results-block">
      <header class="results-block__head">
        <h3 class="results-block__title">Потолок</h3>
        <span class="results-block__tag">${isAreaEstimate ? 'оценка' : escHtml(bom.ceiling.mountingLabel || '')}</span>
      </header>
      <div class="results-kpis">
        ${metricHtml(panels.primary, 'панелей', panels.detail)}
        ${metricHtml(area.toFixed(2), 'м²')}
        ${metricHtml(s.dowels?.withReserve ?? 0, 'дюбелей')}
      </div>
      ${frameListHtml(bom.ceiling.frame, 'Каркас потолка')}
    </section>`);
  }

  if (bom.walls?.stats) {
    const s = bom.walls.stats;
    const panels = formatPanelSplit(s, { isEstimate: isAreaEstimate });
    const wallRows = (bom.walls.wallResults ?? [])
      .map((wr) => {
        const n = wr.panelCount ?? wr.panels?.length ?? 0;
        const area = Number(wr.netArea ?? 0);
        return `<li class="results-wall-row">
          <span class="results-wall-row__name">${escHtml(wr.wall?.label || 'Стена')}</span>
          <span class="results-wall-row__area">${area.toFixed(2)} м²</span>
          <strong class="results-wall-row__panels">${n} пан.</strong>
        </li>`;
      })
      .join('');

    parts.push(`<section class="results-block">
      <header class="results-block__head">
        <h3 class="results-block__title">Стены</h3>
        <span class="results-block__tag">${isAreaEstimate ? 'оценка' : escHtml(bom.walls.mountingLabel || '')}</span>
      </header>
      <div class="results-kpis">
        ${metricHtml(panels.primary, 'панелей', panels.detail)}
        ${metricHtml(Number(bom.walls.area || 0).toFixed(2), 'м²')}
        ${metricHtml(s.dowels?.withReserve ?? 0, 'дюбелей')}
      </div>
      ${wallRows ? `<ul class="results-wall-list">${wallRows}</ul>` : ''}
      ${frameListHtml(bom.walls.frame, 'Каркас стен')}
    </section>`);
  }

  if (bom.total?.dowelsWithReserve || bom.total?.frame?.items?.length) {
    parts.push(`<section class="results-block results-block--summary">
      <header class="results-block__head">
        <h3 class="results-block__title">Итого по крепежу</h3>
      </header>
      <div class="results-kpis">
        ${bom.total?.dowelsWithReserve ? metricHtml(bom.total.dowelsWithReserve, 'дюбелей') : ''}
      </div>
      ${frameListHtml(bom.total?.frame, 'Каркас')}
    </section>`);
  }

  if (!parts.length) return '';
  return `<div class="results-report">${parts.join('')}</div>`;
}

export function formatResultsText(bom, room, options = {}) {
  const isAreaEstimate = options.isAreaEstimate
    ?? (bom?.ceiling?.schemeName === 'По площади');
  // Текстовый fallback (копирование / отладка)
  const lines = [];
  if (isAreaEstimate) lines.push('Оценка по площади (без раскладки и подрезки)');

  if (bom?.ceiling?.stats) {
    const s = bom.ceiling.stats;
    lines.push('Потолок');
    lines.push(`Панели: ${s.panelsToPurchase ?? s.total ?? 0}`);
    if (!isAreaEstimate && (s.cutPanels ?? 0) > 0) {
      lines.push(`  из них ${s.fullPanels ?? 0} целых, ${s.cutPanels} с подрезкой`);
    }
    lines.push(`Площадь: ${Number(s.coverageArea ?? s.netArea ?? bom.ceiling.area ?? 0).toFixed(2)} м²`);
    lines.push(`Дюбели: ${s.dowels?.withReserve ?? 0}`);
    lines.push('');
  }

  if (bom?.walls?.stats) {
    const s = bom.walls.stats;
    lines.push('Стены');
    lines.push(`Панели: ${s.panelsToPurchase ?? s.total ?? 0}`);
    if (!isAreaEstimate && (s.cutPanels ?? 0) > 0) {
      lines.push(`  из них ${s.fullPanels ?? 0} целых, ${s.cutPanels} с подрезкой`);
    }
    lines.push(`Площадь: ${Number(bom.walls.area || 0).toFixed(2)} м²`);
    lines.push(`Дюбели: ${s.dowels?.withReserve ?? 0}`);
    (bom.walls.wallResults ?? []).forEach((wr) => {
      const n = wr.panelCount ?? wr.panels?.length ?? 0;
      lines.push(`  ${wr.wall?.label}: ${Number(wr.netArea || 0).toFixed(2)} м² · ${n} пан.`);
    });
    lines.push('');
  }

  if (bom?.total?.dowelsWithReserve) {
    lines.push(`Дюбели всего: ${bom.total.dowelsWithReserve} шт.`);
  }

  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n').trim();
}

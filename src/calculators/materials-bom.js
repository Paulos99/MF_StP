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
          panelCount: wr.panelCount ?? wr.panels?.length ?? 0,
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

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}

function fmtArea(n) {
  const v = typeof n === 'string' ? parseFloat(n) : Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${v.toFixed(2)} м²`;
}

function isAreaEstimate(bom, mode) {
  if (mode === 'area') return true;
  return bom?.ceiling?.schemeName === 'По площади'
    || bom?.walls?.wallResults?.some((wr) => wr.panelCount != null && !(wr.panels?.length));
}

function panelsBreakdown(stats, { areaMode = false } = {}) {
  const total = stats?.panelsToPurchase ?? stats?.total ?? stats?.fullPanels ?? 0;
  const full = stats?.fullPanels ?? total;
  const cut = stats?.cutPanels ?? 0;
  const withReserve = stats?.withReserve ?? total;

  if (areaMode || cut === 0) {
    return {
      primary: fmtNum(total),
      primaryUnit: 'панелей',
      detail: withReserve > total
        ? `к закупке с запасом 5%: <strong>${fmtNum(withReserve)}</strong>`
        : '',
    };
  }

  return {
    primary: fmtNum(total),
    primaryUnit: 'панелей',
    detail: `${fmtNum(full)} целых · ${fmtNum(cut)} с подрезкой`
      + (withReserve > total ? ` · к закупке <strong>${fmtNum(withReserve)}</strong>` : ''),
  };
}

function renderFrameBlock(title, frame) {
  if (!frame?.items?.length) return '';
  const rows = formatFrameMaterials(frame, '')
    .map((line) => `<li>${esc(line.trim())}</li>`)
    .join('');
  return `
    <div class="rb-frame">
      <div class="rb-frame__title">${esc(title)}</div>
      <ul class="rb-frame__list">${rows}</ul>
    </div>`;
}

/** Структурированный HTML отчёта для правой колонки */
export function renderResultsHtml(bom, { mode = null } = {}) {
  if (!bom?.ceiling && !bom?.walls) {
    return `<div class="rb-empty">Выполните расчёт — здесь появятся детали по поверхностям.</div>`;
  }

  const areaMode = isAreaEstimate(bom, mode);
  const parts = [];

  if (bom.ceiling?.stats) {
    const s = bom.ceiling.stats;
    const pb = panelsBreakdown(s, { areaMode });
    const area = s.netArea ?? s.coverageArea ?? bom.ceiling.area;
    const meta = areaMode
      ? `Оценка по площади · ${fmtArea(area)}`
      : `${esc(bom.ceiling.schemeName || 'Схема')} · ${esc(bom.ceiling.mountingLabel || '')} · ${fmtArea(area)}`;

    parts.push(`
      <section class="rb-block">
        <header class="rb-block__head">
          <h3 class="rb-block__title">Потолок</h3>
          <span class="rb-block__meta">${meta}</span>
        </header>
        <div class="rb-metric">
          <div class="rb-metric__value">${pb.primary}<span class="rb-metric__unit">${pb.primaryUnit}</span></div>
          ${pb.detail ? `<div class="rb-metric__detail">${pb.detail}</div>` : ''}
        </div>
        <div class="rb-kv">
          <span>Дюбели</span>
          <strong>${fmtNum(s.dowels?.withReserve ?? 0)} шт.</strong>
        </div>
        ${renderFrameBlock('Каркас потолка', bom.ceiling.frame)}
      </section>`);
  } else if (bom.ceiling?.area && !bom.ceiling?.stats) {
    // quick area fallback
    parts.push(`
      <section class="rb-block">
        <header class="rb-block__head">
          <h3 class="rb-block__title">Потолок</h3>
          <span class="rb-block__meta">Оценка по площади · ${fmtArea(bom.ceiling.area)}</span>
        </header>
      </section>`);
  }

  if (bom.walls?.stats) {
    const s = bom.walls.stats;
    const pb = panelsBreakdown(s, { areaMode });
    const meta = areaMode
      ? `Оценка по площади · ${fmtArea(bom.walls.area)}`
      : `${esc(bom.walls.mountingLabel || '')} · ${fmtArea(bom.walls.area)}`;

    const wallRows = (bom.walls.wallResults || []).map((wr) => {
      const n = wr.panelCount ?? wr.panels?.length ?? 0;
      const area = wr.netArea;
      return `
        <div class="rb-wall">
          <div class="rb-wall__main">
            <span class="rb-wall__name">${esc(wr.wall?.label || 'Стена')}</span>
            <span class="rb-wall__area">${fmtArea(area)}</span>
          </div>
          <strong class="rb-wall__panels">${fmtNum(n)}<span class="rb-wall__panels-unit">пан.</span></strong>
        </div>`;
    }).join('');

    parts.push(`
      <section class="rb-block">
        <header class="rb-block__head">
          <h3 class="rb-block__title">Стены</h3>
          <span class="rb-block__meta">${meta}</span>
        </header>
        <div class="rb-metric">
          <div class="rb-metric__value">${pb.primary}<span class="rb-metric__unit">${pb.primaryUnit}</span></div>
          ${pb.detail ? `<div class="rb-metric__detail">${pb.detail}</div>` : ''}
        </div>
        ${wallRows ? `<div class="rb-walls">${wallRows}</div>` : ''}
        <div class="rb-kv">
          <span>Дюбели</span>
          <strong>${fmtNum(s.dowels?.withReserve ?? 0)} шт.</strong>
        </div>
        ${renderFrameBlock('Каркас стен', bom.walls.frame)}
      </section>`);
  }

  if (bom.total?.dowelsWithReserve || bom.total?.frame?.items?.length) {
    parts.push(`
      <section class="rb-block rb-block--total">
        <header class="rb-block__head">
          <h3 class="rb-block__title">Итого по крепежу</h3>
        </header>
        ${bom.total?.dowelsWithReserve ? `
          <div class="rb-kv rb-kv--lg">
            <span>Дюбели всего</span>
            <strong>${fmtNum(bom.total.dowelsWithReserve)} шт.</strong>
          </div>` : ''}
        ${renderFrameBlock('Каркас всего', bom.total?.frame)}
      </section>`);
  }

  return `<div class="rb">${parts.join('')}</div>`;
}

/** Текстовый отчёт (PDF / запасной вывод) */
export function formatResultsText(bom, room, { mode = null } = {}) {
  const areaMode = isAreaEstimate(bom, mode);
  const lines = [];

  if (bom.ceiling?.stats) {
    const s = bom.ceiling.stats;
    const area = s.netArea ?? s.coverageArea ?? bom.ceiling.area;
    lines.push('Потолок');
    if (areaMode) {
      lines.push(`Оценка по площади · ${fmtArea(area)}`);
      lines.push(`Панелей: ${s.panelsToPurchase ?? s.fullPanels ?? 0}`);
    } else {
      lines.push(`${bom.ceiling.schemeName} · ${bom.ceiling.mountingLabel}`);
      const cut = s.cutPanels ?? 0;
      lines.push(cut > 0
        ? `${s.fullPanels ?? 0} целых + ${cut} с подрезкой`
        : `Панелей: ${s.panelsToPurchase ?? s.fullPanels ?? 0}`);
    }
    lines.push(`Дюбели: ${s.dowels?.withReserve ?? 0}`);
    if (bom.ceiling.frame) {
      lines.push('Каркас потолка:');
      lines.push(...formatFrameMaterials(bom.ceiling.frame, '  '));
    }
    lines.push('');
  }

  if (bom.walls?.stats) {
    const s = bom.walls.stats;
    lines.push('Стены');
    lines.push(areaMode
      ? `Оценка по площади · ${fmtArea(bom.walls.area)}`
      : `${bom.walls.mountingLabel} · ${fmtArea(bom.walls.area)}`);
    const cut = s.cutPanels ?? 0;
    lines.push((areaMode || cut === 0)
      ? `Панелей: ${s.panelsToPurchase ?? s.fullPanels ?? 0}`
      : `${s.fullPanels ?? 0} целых + ${cut} с подрезкой`);
    if (bom.walls.wallResults?.length) {
      bom.walls.wallResults.forEach((wr) => {
        const n = wr.panelCount ?? wr.panels?.length ?? 0;
        lines.push(`  ${wr.wall.label}: ${n} пан.${wr.netArea != null ? ` (${fmtArea(wr.netArea)})` : ''}`);
      });
    }
    lines.push(`Дюбели: ${s.dowels?.withReserve ?? 0}`);
    if (bom.walls.frame) {
      lines.push('Каркас стен:');
      lines.push(...formatFrameMaterials(bom.walls.frame, '  '));
    }
    lines.push('');
  }

  if (bom.total?.dowelsWithReserve) {
    lines.push(`Дюбели всего: ${bom.total.dowelsWithReserve} шт.`);
  }
  if (bom.total?.frame?.items?.length) {
    lines.push('Каркас итого:');
    lines.push(...formatFrameMaterials(bom.total.frame, '  '));
  }

  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n').trim();
}

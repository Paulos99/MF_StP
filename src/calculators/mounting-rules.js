/**
 * Правила монтажа MultiFRAME.
 * Параметры каркаса — по типовой схеме подвесного каркаса (шаг 600 мм).
 * Уточните по официальной инструкции StP при получении.
 */
import { calcWallFrameMetrics } from './wall-frame.js';

export const MOUNTING_RULES = {
  ceiling_frameless: {
    label: 'Бескаркасный потолок',
    dowelsPerPanel: 2,
    reserve: { panels: 0.05, dowels: 0.15 },
    note: 'Панели крепятся непосредственно к перекрытию дюбель-гвоздями',
  },
  ceiling_framed: {
    label: 'Каркасный потолок',
    profileStepM: 0.6,
    hangerStepM: 1.0,
    screwsPerPanel: 4,
    perimeterProfileSku: 'MultiFrame профиль периметральный',
    mainProfileSku: 'MultiFrame профиль несущий',
    crossProfileSku: 'MultiFrame профиль поперечный',
    hangerSku: 'Подвес прямой',
    connectorSku: 'Соединитель (краб)',
    anchorSku: 'Анкер подвеса к перекрытию',
    panelFastenerSku: 'Саморез крепления панели к каркасу',
    reserve: { panels: 0.05, dowels: 0.15, profiles: 0.1, fasteners: 0.1 },
    note: 'Каркас: периметр + несущие и поперечные профили, подвесы через 1 м',
  },
  wall_frameless: {
    label: 'Бескаркасные стены',
    dowelsPerPanel: 2,
    reserve: { panels: 0.05, dowels: 0.15 },
    note: 'Панели крепятся непосредственно к стене дюбель-гвоздями',
  },
  wall_framed: {
    label: 'Каркасные стены',
    profileStepM: 0.6,
    bracketStepM: 0.6,
    screwsPerPanel: 4,
    verticalProfileSku: 'MultiFrame профиль стоечный',
    trackProfileSku: 'MultiFrame профиль направляющий',
    bracketSku: 'Кронштейн к стене',
    connectorSku: 'Соединитель профиля',
    panelFastenerSku: 'Саморез крепления панели к каркасу',
    reserve: { panels: 0.05, dowels: 0.15, profiles: 0.1, fasteners: 0.1 },
    note: 'Каркас: направляющие сверху/снизу + стойки с шагом 600 мм',
  },
};

function withReserve(value, reserveKey, rules) {
  const r = rules.reserve?.[reserveKey] ?? 0.1;
  return value * (1 + r);
}

function roundQty(n) {
  return Math.ceil(n);
}

/**
 * @param {string} surfaceType
 * @param {number} widthM
 * @param {number} heightM
 * @param {{ panelCount?: number }} options
 */
export function calculateFrameMaterials(surfaceType, widthM, heightM, options = {}) {
  const rules = MOUNTING_RULES[surfaceType];
  if (!rules?.profileStepM) return null;

  const step = rules.profileStepM;
  const panelCount = options.panelCount ?? 0;

  if (surfaceType === 'ceiling_framed') {
    const perimeterM = 2 * (widthM + heightM);
    const mainRuns = Math.ceil(widthM / step) + 1;
    const crossRuns = Math.ceil(heightM / step) + 1;
    const mainLengthM = mainRuns * heightM;
    const crossLengthM = crossRuns * widthM;
    const hangersPerMain = Math.max(1, Math.ceil(heightM / (rules.hangerStepM ?? 1)));
    const hangers = mainRuns * hangersPerMain;
    const connectors = mainRuns * crossRuns;
    const anchors = hangers;
    const panelScrews = panelCount * (rules.screwsPerPanel ?? 4);

    const items = [
      {
        key: 'perimeter',
        label: 'Профиль периметральный',
        unit: 'м',
        qty: +withReserve(perimeterM, 'profiles', rules).toFixed(2),
      },
      {
        key: 'main',
        label: 'Профиль несущий',
        unit: 'м',
        qty: +withReserve(mainLengthM, 'profiles', rules).toFixed(2),
      },
      {
        key: 'cross',
        label: 'Профиль поперечный',
        unit: 'м',
        qty: +withReserve(crossLengthM, 'profiles', rules).toFixed(2),
      },
      {
        key: 'hangers',
        label: 'Подвесы прямые',
        unit: 'шт',
        qty: roundQty(withReserve(hangers, 'fasteners', rules)),
      },
      {
        key: 'anchors',
        label: 'Анкеры подвеса к перекрытию',
        unit: 'шт',
        qty: roundQty(withReserve(anchors, 'fasteners', rules)),
      },
      {
        key: 'connectors',
        label: 'Соединители (крабы)',
        unit: 'шт',
        qty: roundQty(withReserve(connectors, 'fasteners', rules)),
      },
    ];

    if (panelCount > 0) {
      items.push({
        key: 'screws',
        label: 'Саморезы крепления панелей',
        unit: 'шт',
        qty: roundQty(withReserve(panelScrews, 'fasteners', rules)),
      });
    }

    const totalProfileLengthM = items
      .filter((i) => i.unit === 'м')
      .reduce((s, i) => s + i.qty, 0);

    return {
      items,
      perimeterLengthM: +withReserve(perimeterM, 'profiles', rules).toFixed(2),
      mainProfileLengthM: +withReserve(mainLengthM, 'profiles', rules).toFixed(2),
      crossProfileLengthM: +withReserve(crossLengthM, 'profiles', rules).toFixed(2),
      totalProfileLengthM: +totalProfileLengthM.toFixed(2),
      hangers: roundQty(withReserve(hangers, 'fasteners', rules)),
      anchors: roundQty(withReserve(anchors, 'fasteners', rules)),
      connectors: roundQty(withReserve(connectors, 'fasteners', rules)),
      panelScrews: panelCount > 0 ? roundQty(withReserve(panelScrews, 'fasteners', rules)) : 0,
      profileStepM: step,
      mainRuns,
      crossRuns,
      isPlaceholder: true,
    };
  }

  if (surfaceType === 'wall_framed') {
    const openings = options.openings ?? [];
    const metrics = calcWallFrameMetrics(
      widthM,
      heightM,
      openings,
      step,
      rules.bracketStepM ?? step
    );
    const trackM = metrics.trackM;
    const studLengthM = metrics.studLengthM;
    const studCount = metrics.studCount;
    const brackets = roundQty(withReserve(metrics.brackets, 'fasteners', rules));
    const connectors = Math.max(0, metrics.connectors);
    const panelScrews = panelCount * (rules.screwsPerPanel ?? 4);

    const items = [
      {
        key: 'track',
        label: 'Профиль направляющий (верх + низ)',
        unit: 'м',
        qty: +withReserve(trackM, 'profiles', rules).toFixed(2),
      },
      {
        key: 'stud',
        label: 'Профиль стоечный',
        unit: 'м',
        qty: +withReserve(studLengthM, 'profiles', rules).toFixed(2),
      },
      {
        key: 'brackets',
        label: 'Кронштейны к стене',
        unit: 'шт',
        qty: brackets,
      },
      {
        key: 'connectors',
        label: 'Соединители профиля',
        unit: 'шт',
        qty: roundQty(withReserve(connectors, 'fasteners', rules)),
      },
    ];

    if (panelCount > 0) {
      items.push({
        key: 'screws',
        label: 'Саморезы крепления панелей',
        unit: 'шт',
        qty: roundQty(withReserve(panelScrews, 'fasteners', rules)),
      });
    }

    const totalProfileLengthM = +withReserve(trackM + studLengthM, 'profiles', rules).toFixed(2);

    return {
      items,
      trackLengthM: +withReserve(trackM, 'profiles', rules).toFixed(2),
      studLengthM: +withReserve(studLengthM, 'profiles', rules).toFixed(2),
      totalProfileLengthM,
      brackets,
      connectors: roundQty(withReserve(connectors, 'fasteners', rules)),
      panelScrews: panelCount > 0 ? roundQty(withReserve(panelScrews, 'fasteners', rules)) : 0,
      profileStepM: step,
      studCount,
      isPlaceholder: true,
    };
  }

  return null;
}

export function formatFrameMaterials(frame, indent = '') {
  if (!frame?.items?.length) return [];
  return frame.items.map((item) => `${indent}${item.label}: ${item.qty} ${item.unit}`);
}

export function mergeFrameTotals(frames) {
  const valid = frames.filter(Boolean);
  if (!valid.length) return null;

  const merged = {
    items: [],
    totalProfileLengthM: 0,
    hangers: 0,
    anchors: 0,
    brackets: 0,
    connectors: 0,
    panelScrews: 0,
    isPlaceholder: true,
  };

  const itemMap = new Map();
  for (const frame of valid) {
    merged.totalProfileLengthM += frame.totalProfileLengthM ?? 0;
    merged.hangers += frame.hangers ?? 0;
    merged.anchors += frame.anchors ?? 0;
    merged.brackets += frame.brackets ?? 0;
    merged.connectors += frame.connectors ?? 0;
    merged.panelScrews += frame.panelScrews ?? 0;

    for (const item of frame.items ?? []) {
      const prev = itemMap.get(item.key) ?? { ...item, qty: 0 };
      prev.qty = item.unit === 'м' ? +(prev.qty + item.qty).toFixed(2) : prev.qty + item.qty;
      itemMap.set(item.key, prev);
    }
  }

  merged.totalProfileLengthM = +merged.totalProfileLengthM.toFixed(2);
  merged.items = [...itemMap.values()];
  return merged;
}

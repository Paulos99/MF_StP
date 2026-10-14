/**
 * Правила монтажа MultiFRAME.
 * Стены — по аналогии с Кнауф С623; потолок — с П113.
 * Продуктовые шаги: профили 600 мм, подвесы/кронштейны 550 мм.
 */
import {
  calcWallFrameMetrics,
  getProfilePositions,
} from './wall-frame.js';

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
    hangerStepM: 0.55,
    screwsPerPanel: 4,
    perimeterProfileSku: 'MultiFrame профиль периметральный',
    mainProfileSku: 'MultiFrame профиль несущий',
    crossProfileSku: 'MultiFrame профиль поперечный',
    hangerSku: 'Подвес прямой',
    connectorSku: 'Соединитель (краб)',
    anchorSku: 'Анкер подвеса к перекрытию',
    panelFastenerSku: 'Саморез крепления панели к каркасу',
    reserve: { panels: 0.05, dowels: 0.15, profiles: 0.1, fasteners: 0.1 },
    note: 'По П113: периметр + несущие/поперечные 600 мм, подвесы только на несущих через 550 мм',
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
    bracketStepM: 0.55,
    screwsPerPanel: 4,
    verticalProfileSku: 'MultiFrame профиль стоечный',
    trackProfileSku: 'MultiFrame профиль направляющий',
    bracketSku: 'Кронштейн к стене',
    connectorSku: 'Соединитель профиля',
    panelFastenerSku: 'Саморез крепления панели к каркасу',
    reserve: { panels: 0.05, dowels: 0.15, profiles: 0.1, fasteners: 0.1 },
    note: 'По С623: направляющие + стойки 600 мм, обрамление проёмов, крепления на стойках 550 мм',
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
 * Подвесы по П113: только на несущих профилях (ось X), шаг hangerStepM.
 * На поперечных и на периметре (y≈0 / y≈height) не ставим.
 */
export function getCeilingHangerPoints(widthM, heightM, stepM, hangerStepM) {
  const mainXs = getProfilePositions(widthM, stepM);
  const along = [];
  for (let y = hangerStepM; y < heightM - 1e-6; y += hangerStepM) {
    along.push(+y.toFixed(6));
  }
  if (!along.length && heightM > 1e-6) along.push(+(heightM / 2).toFixed(6));
  const points = [];
  for (const x of mainXs) {
    for (const y of along) {
      points.push({ x, y });
    }
  }
  return points;
}

/**
 * @param {string} surfaceType
 * @param {number} widthM
 * @param {number} heightM
 * @param {{ panelCount?: number, openings?: object[] }} options
 */
export function calculateFrameMaterials(surfaceType, widthM, heightM, options = {}) {
  const rules = MOUNTING_RULES[surfaceType];
  if (!rules?.profileStepM) return null;

  const step = rules.profileStepM;
  const panelCount = options.panelCount ?? 0;

  if (surfaceType === 'ceiling_framed') {
    const perimeterM = 2 * (widthM + heightM);
    const mainXs = getProfilePositions(widthM, step);
    const crossYs = getProfilePositions(heightM, step);
    const mainRuns = mainXs.length;
    const crossRuns = crossYs.length;
    const mainLengthM = mainRuns * heightM;
    const crossLengthM = crossRuns * widthM;
    const hangerStep = rules.hangerStepM ?? 0.55;
    const hangerPoints = getCeilingHangerPoints(widthM, heightM, step, hangerStep);
    const hangers = hangerPoints.length;
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
      hangerStepM: hangerStep,
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
      rules.bracketStepM ?? 0.55
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

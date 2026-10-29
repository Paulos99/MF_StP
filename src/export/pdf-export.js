import { OPENING_TYPES } from '../core/constants.js';
import { buildWallSurfaceStats } from '../calculators/materials-bom.js';
import { getBounds } from '../core/polygon-geometry.js';

const BRAND = '#01644f';
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
/** Полезная высота тела страницы (A4 − шапка − футер − паддинги) */
const BODY_USABLE_MM = 210;

function formatRub(value) {
  return `${Number(value).toLocaleString('ru-RU')} ₽`;
}

function formatDate() {
  const date = new Date();
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getFullYear()).slice(-2)}`;
}

function pageShell({ title, subtitle, bodyHtml, pageLabel }) {
  return `
    <div class="pdf-page" style="
      width:${PAGE_WIDTH_MM}mm;
      height:${PAGE_HEIGHT_MM}mm;
      box-sizing:border-box;
      background:#fff;
      font-family:Segoe UI,Arial,sans-serif;
      color:#333;
      display:flex;
      flex-direction:column;
      overflow:hidden;
    ">
      <div style="background:${BRAND};color:#fff;padding:10px 14px;flex-shrink:0">
        <div style="font-size:18px;font-weight:bold;line-height:1.2">StP MultiFRAME</div>
        <div style="font-size:11px;margin-top:3px;opacity:0.9">${title}</div>
        ${subtitle ? `<div style="font-size:10px;margin-top:1px;opacity:0.75">${subtitle}</div>` : ''}
      </div>
      <div style="padding:10px 14px 8px;flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;box-sizing:border-box">
        ${bodyHtml}
      </div>
      <div style="padding:4px 14px 8px;font-size:9px;color:#8899a4;text-align:right;flex-shrink:0;border-top:1px solid #eef1f3">${pageLabel}</div>
    </div>`;
}

function statsBlock(rows, { compact = false, columns = 1 } = {}) {
  const filtered = rows.filter(Boolean);
  const pad = compact ? '2px 0' : '4px 0';
  const font = compact ? '10px' : '11px';
  const items = filtered
    .map(
      (row) => `
      <div style="display:flex;justify-content:space-between;gap:8px;padding:${pad};border-bottom:1px solid #eef1f3;font-size:${font};line-height:1.25;break-inside:avoid">
        <span style="color:#5f6b73;min-width:0">${row.label}</span>
        <strong style="text-align:right;white-space:nowrap;flex-shrink:0">${row.value}</strong>
      </div>`
    )
    .join('');

  if (columns === 2 && filtered.length > 8) {
    const mid = Math.ceil(filtered.length / 2);
    const left = filtered.slice(0, mid);
    const right = filtered.slice(mid);
    const col = (list) =>
      list
        .map(
          (row) => `
        <div style="display:flex;justify-content:space-between;gap:6px;padding:${pad};border-bottom:1px solid #eef1f3;font-size:${font};line-height:1.25">
          <span style="color:#5f6b73;min-width:0">${row.label}</span>
          <strong style="text-align:right;white-space:nowrap;flex-shrink:0">${row.value}</strong>
        </div>`
        )
        .join('');
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px;margin-bottom:8px;flex-shrink:0">${col(left)}${col(right)}</div>`;
  }

  return `<div style="margin-bottom:8px;flex-shrink:0">${items}</div>`;
}

function schemeBlock(image, alt, maxHeightMm) {
  return `
    <div style="
      flex:1 1 auto;
      min-height:0;
      max-height:${maxHeightMm}mm;
      overflow:hidden;
      margin-top:6px;
      display:flex;
      flex-direction:column;
    ">
      <div style="font-size:11px;font-weight:600;color:${BRAND};margin:0 0 4px;flex-shrink:0">Схема укладки</div>
      <div style="
        flex:1;
        min-height:0;
        overflow:hidden;
        display:flex;
        align-items:center;
        justify-content:center;
        border:1px solid #e1e5e8;
        border-radius:6px;
        background:#fff;
        padding:3px;
        box-sizing:border-box;
      ">
        <img src="${image}" alt="${alt}" style="max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block"/>
      </div>
    </div>`;
}

/** Высота схемы под оставшееся место на странице */
function schemeMaxHeightMm(rowCount, extraMm = 0) {
  const titleMm = 12;
  const rowMm = 5.6;
  const statsMm = Math.min(rowCount, 18) * rowMm + 6;
  const remaining = BODY_USABLE_MM - titleMm - statsMm - extraMm;
  return Math.round(Math.max(68, Math.min(132, remaining)));
}

function reportCoverageArea(bom) {
  return (bom.ceiling?.area ?? 0) + (bom.walls?.area ?? 0);
}

function buildSchemeSummaryBody({ bom, room, dateStr, planImage }) {
  const bounds = getBounds(room.vertices ?? []);
  const sizeLabel = `${(bounds.maxX - bounds.minX).toFixed(1)}×${(bounds.maxY - bounds.minY).toFixed(1)} м (${room.vertices?.length ?? 0} сторон)`;

  let surfacesList = '';
  if (bom.ceiling) surfacesList += `<li>Потолок — ${bom.ceiling.stats.withReserve} пан.</li>`;
  if (bom.walls?.wallResults) {
    bom.walls.wallResults.forEach((wr) => {
      const ws = buildWallSurfaceStats(wr, bom.wallMounting, room.wallHeight);
      surfacesList += `<li>${wr.wall.label} — ${ws.withReserve} пан.</li>`;
    });
  }

  const planBlock = planImage
    ? `<div style="flex:0 0 72mm;text-align:center">
        <div style="font-size:11px;font-weight:600;color:${BRAND};margin-bottom:4px">План помещения</div>
        <img src="${planImage}" alt="План помещения" style="max-width:100%;max-height:58mm;object-fit:contain;border:1px solid #e1e5e8;border-radius:6px;background:#fff;padding:3px;box-sizing:border-box"/>
      </div>`
    : '';

  const paramsBlock = statsBlock(
    [
      { label: 'Форма помещения', value: `Полигон, ${sizeLabel}` },
      { label: 'Высота стен', value: `${room.wallHeight.toFixed(2)} м` },
      { label: 'Площадь потолка', value: `${room.getTotalArea().toFixed(2)} м²` },
      { label: 'Площадь стен (чистая)', value: `${room.getTotalWallArea().toFixed(2)} м²` },
      { label: 'Проёмов', value: `${room.openings.length} шт.` },
      { label: 'Размер панели', value: '0,75×0,55 м' },
    ],
    { compact: true }
  );

  const totalsRows = totalsRowsList(bom);

  return `
    <div style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden">
      <h1 style="text-align:center;font-size:15px;margin:0 0 4px;color:${BRAND};flex-shrink:0">СВОДНЫЙ РАСЧЁТ</h1>
      <p style="font-size:10px;color:#5f6b73;margin:0 0 8px;text-align:center;flex-shrink:0">Дата: ${dateStr}</p>
      <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:8px;flex-shrink:0">
        <div style="flex:1;min-width:0">${paramsBlock}</div>
        ${planBlock}
      </div>
      <h2 style="font-size:12px;color:${BRAND};margin:0 0 4px;flex-shrink:0">Итого по проекту</h2>
      ${statsBlock(totalsRows, { compact: true, columns: 2 })}
      <h2 style="font-size:12px;color:${BRAND};margin:4px 0 2px;flex-shrink:0">Состав отчёта</h2>
      <ul style="font-size:10px;line-height:1.45;margin:0;padding-left:16px;color:#333;flex-shrink:0">${surfacesList}</ul>
      <p style="font-size:9px;color:#8899a4;margin:6px 0 0;line-height:1.35;flex-shrink:0">
        Каждая поверхность — на отдельной странице со схемой укладки и спецификацией.
      </p>
    </div>`;
}

function buildAreaSummaryBody({ bom, dateStr }) {
  const ceilingArea = bom.ceiling?.area ?? 0;
  const wallsArea = bom.walls?.area ?? 0;
  const wallCount = bom.walls?.wallResults?.length ?? 0;

  let surfacesList = '';
  if (bom.ceiling) {
    surfacesList += `<li>Потолок — ${ceilingArea.toFixed(2)} м² · ${bom.ceiling.stats.withReserve} пан.</li>`;
  }
  if (bom.walls?.wallResults) {
    bom.walls.wallResults.forEach((wr, i) => {
      const label = wr.wall?.label || `Стена ${i + 1}`;
      const area = wr.netArea ?? 0;
      const withReserve = buildWallSurfaceStats(
        wr,
        bom.wallMounting || 'wall_frameless',
        2.7
      ).withReserve;
      surfacesList += `<li>${label} — ${area.toFixed(2)} м² · ${withReserve} пан.</li>`;
    });
  }

  return `
    <h1 style="text-align:center;font-size:15px;margin:0 0 6px;color:${BRAND}">ПРИБЛИЗИТЕЛЬНЫЙ РАСЧЁТ ПО ПЛОЩАДИ</h1>
    <p style="font-size:10px;color:#5f6b73;margin:0 0 8px;text-align:center">Дата: ${dateStr}</p>
    ${statsBlock(
      [
        bom.ceiling ? { label: 'Площадь потолка', value: `${ceilingArea.toFixed(2)} м²` } : null,
        wallsArea > 0 ? { label: 'Площадь стен', value: `${wallsArea.toFixed(2)} м²` } : null,
        wallCount > 0 ? { label: 'Стен в расчёте', value: `${wallCount} шт.` } : null,
        { label: 'Размер панели', value: '0,75×0,55 м' },
        { label: 'Тип расчёта', value: 'Оценка по площади (без схемы)' },
      ],
      { compact: true }
    )}
    <h2 style="font-size:12px;color:${BRAND};margin:0 0 4px">Итого по проекту</h2>
    ${statsBlock(totalsRowsList(bom), { compact: true, columns: 2 })}
    <h2 style="font-size:12px;color:${BRAND};margin:8px 0 4px">Состав отчёта</h2>
    <ul style="font-size:10px;line-height:1.45;margin:0;padding-left:16px;color:#333">${surfacesList || '<li>Нет поверхностей</li>'}</ul>`;
}

function totalsRowsList(bom) {
  return [
    bom.ceiling
      ? {
          label: `Потолок (${bom.ceiling.mountingLabel})`,
          value: `${bom.ceiling.stats.withReserve} пан. · ${formatRub(bom.ceiling.stats.totalCost)}`,
        }
      : null,
    bom.walls
      ? {
          label: `Стены (${bom.walls.mountingLabel})`,
          value: `${bom.walls.stats.withReserve} пан. · ${formatRub(bom.walls.stats.totalCost)}`,
        }
      : null,
    bom.total
      ? {
          label: 'Всего панелей к закупке',
          value: `${bom.total.panelsWithReserve} шт.`,
        }
      : null,
    bom.total
      ? {
          label: 'Дюбели (с запасом 15%)',
          value: `${bom.total.dowelsWithReserve} шт.`,
        }
      : null,
    ...frameStatsRows(bom.total?.frame),
    bom.total
      ? {
          label: 'Общая стоимость панелей',
          value: formatRub(bom.total.totalCost),
        }
      : null,
  ];
}

function frameStatsRows(frame) {
  if (!frame?.items?.length) return [];
  return frame.items.map((item) => ({
    label: item.label,
    value: `${item.qty} ${item.unit}`,
  }));
}

function buildCeilingBody({ bom, ceilingImage }) {
  const s = bom.ceiling.stats;
  const frame = bom.ceiling.frame;
  const rows = [
    { label: 'Монтаж', value: bom.ceiling.mountingLabel },
    { label: 'Схема укладки', value: bom.ceiling.schemeName },
    { label: 'Площадь', value: `${bom.ceiling.area.toFixed(2)} м²` },
    { label: 'Панелей', value: `${s.total} шт. (${s.fullPanels} целых + ${s.cutPanels} подрез.)` },
    { label: 'К закупке', value: `${s.withReserve} шт.` },
    { label: 'Дюбели (с запасом 15%)', value: `${s.dowels.withReserve} шт.` },
    ...frameStatsRows(frame),
    { label: 'Стоимость панелей', value: formatRub(s.totalCost) },
  ];
  const maxH = schemeMaxHeightMm(rows.filter(Boolean).length);

  return `
    <div style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden">
      <h1 style="font-size:14px;margin:0 0 6px;color:${BRAND};flex-shrink:0">Потолок</h1>
      ${statsBlock(rows, { compact: true, columns: 2 })}
      ${
        ceilingImage
          ? schemeBlock(ceilingImage, 'Схема потолка', maxH)
          : `<div style="margin-top:8px;padding:10px;border:1px dashed #c5d0d6;border-radius:6px;background:#f7faf9;color:#5f6b73;font-size:11px;line-height:1.4;flex-shrink:0">
              Схема укладки не строится — расчёт выполнен по площади.
            </div>`
      }
    </div>`;
}

function formatOpeningLine(o) {
  const type = o.type === OPENING_TYPES.DOOR ? 'Дверь' : 'Окно';
  let detail = `${type} ${o.width}×${o.height} м, отступ ${o.offset.toFixed(2)} м`;
  if (o.type === OPENING_TYPES.WINDOW) {
    detail += `, подоконник ${o.sillHeight.toFixed(2)} м`;
  }
  return detail;
}

function buildWallBody({ wr, stats, image, mountingLabel, areaEstimate = false }) {
  const wallHeight =
    wr.grossArea && wr.wall?.length ? wr.grossArea / wr.wall.length : null;
  const openingsLines =
    wr.openings?.length > 0
      ? wr.openings.map((o) => formatOpeningLine(o)).join(' · ')
      : 'нет';

  const sizeRow = areaEstimate
    ? { label: 'Площадь (оценка)', value: `${(wr.netArea ?? stats.netArea).toFixed(2)} м²` }
    : { label: 'Размер стены', value: `${wr.wall.length.toFixed(2)} × ${wallHeight.toFixed(2)} м` };

  const rows = [
    { label: 'Монтаж', value: mountingLabel },
    sizeRow,
    !areaEstimate ? { label: 'Площадь брутто', value: `${wr.grossArea.toFixed(2)} м²` } : null,
    { label: 'Площадь чистая', value: `${stats.netArea.toFixed(2)} м²` },
    !areaEstimate ? { label: 'Проёмов', value: `${stats.openingsCount} шт.` } : null,
    {
      label: 'Панелей',
      value: `${stats.total} шт. (${stats.fullPanels} целых + ${stats.cutPanels} подрез.)`,
    },
    { label: 'К закупке', value: `${stats.withReserve} шт.` },
    { label: 'Дюбели (с запасом 15%)', value: `${stats.dowels.withReserve} шт.` },
    ...frameStatsRows(stats.frame),
    { label: 'Стоимость панелей', value: formatRub(stats.totalCost) },
  ];

  const openingsBlock = areaEstimate
    ? ''
    : `<div style="font-size:10px;line-height:1.35;margin:0 0 2px;color:#333;flex-shrink:0">
        <span style="color:${BRAND};font-weight:600">Проёмы:</span> ${openingsLines}
      </div>`;

  const extrasMm = areaEstimate ? 0 : 10;
  const maxH = schemeMaxHeightMm(rows.filter(Boolean).length, extrasMm);

  return `
    <div style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden">
      <h1 style="font-size:14px;margin:0 0 6px;color:${BRAND};flex-shrink:0">${wr.wall.label}</h1>
      ${statsBlock(rows, { compact: true, columns: 2 })}
      ${openingsBlock}
      ${
        image
          ? schemeBlock(image, wr.wall.label, maxH)
          : areaEstimate
            ? `<div style="margin-top:8px;padding:10px;border:1px dashed #c5d0d6;border-radius:6px;background:#f7faf9;color:#5f6b73;font-size:11px;line-height:1.4;flex-shrink:0">
                Схема укладки не строится — стена задана площадью.
              </div>`
            : ''
      }
    </div>`;
}

async function renderPageToPdf(doc, html, { isFirstPage, pageW, pageH }) {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff;';
  container.innerHTML = html;
  document.body.appendChild(container);

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const [{ default: html2canvas }] = await Promise.all([
    import('html2canvas'),
  ]);

  const pageEl = container.querySelector('.pdf-page') ?? container;
  // Жёстко фиксируем размер страницы перед снимком — без «раздувания» контентом
  const cssW = Math.round((PAGE_WIDTH_MM / 25.4) * 96);
  const cssH = Math.round((PAGE_HEIGHT_MM / 25.4) * 96);
  pageEl.style.width = `${cssW}px`;
  pageEl.style.height = `${cssH}px`;
  pageEl.style.overflow = 'hidden';

  await new Promise((r) => requestAnimationFrame(r));

  const canvas = await html2canvas(pageEl, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    width: cssW,
    height: cssH,
    windowWidth: cssW,
    windowHeight: cssH,
  });

  document.body.removeChild(container);

  if (!isFirstPage) doc.addPage();

  const imgData = canvas.toDataURL('image/jpeg', 0.92);
  doc.addImage(imgData, 'JPEG', 0, 0, pageW, pageH);
}

export async function exportCalculationPDF({
  bom,
  room,
  ceilingImage,
  wallSurfaces = [],
  planImage = null,
  areaEstimate = false,
}) {
  const [{ jsPDF }] = await Promise.all([
    import('jspdf'),
  ]);

  const dateStr = formatDate();
  const pages = [];

  const includeCeilingPage = Boolean(bom.ceiling);
  const totalPages = 1 + (includeCeilingPage ? 1 : 0) + wallSurfaces.length;

  let pageNum = 1;

  pages.push(
    pageShell({
      title: `Расчёт материалов | ${dateStr}`,
      subtitle: areaEstimate ? 'Оценка по площади' : 'Сводная страница',
      bodyHtml: areaEstimate
        ? buildAreaSummaryBody({ bom, dateStr })
        : buildSchemeSummaryBody({ bom, room, dateStr, planImage }),
      pageLabel: `Страница ${pageNum} из ${totalPages}`,
    })
  );
  pageNum += 1;

  if (includeCeilingPage) {
    pages.push(
      pageShell({
        title: `Расчёт материалов | ${dateStr}`,
        subtitle: 'Потолок',
        bodyHtml: buildCeilingBody({ bom, ceilingImage: areaEstimate ? null : ceilingImage }),
        pageLabel: `Страница ${pageNum} из ${totalPages}`,
      })
    );
    pageNum += 1;
  }

  for (const { wallResult, image } of wallSurfaces) {
    const stats = buildWallSurfaceStats(wallResult, bom.wallMounting, room.wallHeight);
    pages.push(
      pageShell({
        title: `Расчёт материалов | ${dateStr}`,
        subtitle: 'Развёртка стены',
        bodyHtml: buildWallBody({
          wr: wallResult,
          stats,
          image: areaEstimate ? null : image,
          mountingLabel: bom.walls?.mountingLabel ?? stats.mountingLabel,
          areaEstimate,
        }),
        pageLabel: `Страница ${pageNum} из ${totalPages}`,
      })
    );
    pageNum += 1;
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  for (let i = 0; i < pages.length; i += 1) {
    await renderPageToPdf(doc, pages[i], { isFirstPage: i === 0, pageW, pageH });
  }

  const area = Math.round(
    areaEstimate
      ? reportCoverageArea(bom)
      : room.getTotalArea() + room.getTotalWallArea()
  );
  const prefix = areaEstimate ? 'MultiFrame_area' : 'MultiFrame';
  doc.save(`${prefix}_${area}m2_${dateStr.replace(/\./g, '-')}.pdf`);
}

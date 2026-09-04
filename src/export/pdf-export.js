import { OPENING_TYPES } from '../core/constants.js';
import { buildWallSurfaceStats } from '../calculators/materials-bom.js';
import { formatFrameMaterials } from '../calculators/mounting-rules.js';
import { getBounds } from '../core/polygon-geometry.js';

const BRAND = '#01644f';
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

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
      <div style="background:${BRAND};color:#fff;padding:14px 16px;flex-shrink:0">
        <div style="font-size:22px;font-weight:bold">StP MultiFRAME</div>
        <div style="font-size:12px;margin-top:4px;opacity:0.9">${title}</div>
        ${subtitle ? `<div style="font-size:11px;margin-top:2px;opacity:0.75">${subtitle}</div>` : ''}
      </div>
      <div style="padding:14px 16px 36px;flex:1;display:flex;flex-direction:column;min-height:0">
        ${bodyHtml}
      </div>
      <div style="padding:6px 16px 10px;font-size:10px;color:#8899a4;text-align:right;flex-shrink:0">${pageLabel}</div>
    </div>`;
}

function statsBlock(rows) {
  const items = rows
    .filter(Boolean)
    .map(
      (row) => `
      <div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #e8ecef;font-size:12px">
        <span style="color:#5f6b73">${row.label}</span>
        <strong style="text-align:right">${row.value}</strong>
      </div>`
    )
    .join('');
  return `<div style="margin-bottom:14px">${items}</div>`;
}

function buildSummaryBody({ bom, room, dateStr, planImage }) {
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
    ? `<div style="flex:0 0 92mm;text-align:center">
        <div style="font-size:13px;font-weight:600;color:${BRAND};margin-bottom:6px">План помещения</div>
        <img src="${planImage}" alt="План помещения" style="max-width:100%;max-height:78mm;object-fit:contain;border:1px solid #e1e5e8;border-radius:8px;background:#fff"/>
        <div style="font-size:10px;color:#8899a4;margin-top:4px;line-height:1.4">Стены и проёмы (вид сверху)</div>
      </div>`
    : '';

  const paramsBlock = statsBlock([
    { label: 'Форма помещения', value: `Полигон, ${sizeLabel}` },
    { label: 'Высота стен', value: `${room.wallHeight.toFixed(2)} м` },
    { label: 'Площадь потолка', value: `${room.getTotalArea().toFixed(2)} м²` },
    { label: 'Площадь стен (чистая)', value: `${room.getTotalWallArea().toFixed(2)} м²` },
    { label: 'Проёмов', value: `${room.openings.length} шт.` },
    { label: 'Размер панели (габарит)', value: '0,75×0,55 м' },
  ]);

  return `
    <h1 style="text-align:center;font-size:18px;margin:0 0 10px;color:${BRAND}">СВОДНЫЙ РАСЧЁТ</h1>
    <p style="font-size:11px;color:#5f6b73;margin:0 0 12px;text-align:center">Дата: ${dateStr}</p>
    <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:12px">
      <div style="flex:1;min-width:0">${paramsBlock}</div>
      ${planBlock}
    </div>
    <h2 style="font-size:14px;color:${BRAND};margin:0 0 8px">Итого по проекту</h2>
    ${statsBlock([
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
    ])}
    <h2 style="font-size:14px;color:${BRAND};margin:12px 0 8px">Состав отчёта</h2>
    <ul style="font-size:12px;line-height:1.7;margin:0;padding-left:18px;color:#333">${surfacesList}</ul>
    <p style="font-size:11px;color:#8899a4;margin-top:14px;line-height:1.5">
      Каждая поверхность — на отдельной странице со схемой укладки и спецификацией расходников.
    </p>`;
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

  return `
    <h1 style="font-size:17px;margin:0 0 12px;color:${BRAND}">Потолок</h1>
    ${statsBlock([
      { label: 'Монтаж', value: bom.ceiling.mountingLabel },
      { label: 'Схема укладки', value: bom.ceiling.schemeName },
      { label: 'Площадь', value: `${bom.ceiling.area.toFixed(2)} м²` },
      { label: 'Панелей', value: `${s.total} шт. (${s.fullPanels} целых + ${s.cutPanels} подрез.)` },
      { label: 'К закупке', value: `${s.withReserve} шт.` },
      { label: 'Дюбели (с запасом 15%)', value: `${s.dowels.withReserve} шт.` },
      ...frameStatsRows(frame),
      { label: 'Стоимость панелей', value: formatRub(s.totalCost) },
    ])}
    <div style="flex:1;display:flex;align-items:center;justify-content:center;min-height:0;margin-top:8px">
      <img src="${ceilingImage}" alt="Схема потолка" style="max-width:100%;max-height:175mm;object-fit:contain;border:1px solid #e1e5e8;border-radius:8px"/>
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

function buildWallBody({ wr, stats, image, mountingLabel }) {
  const wallHeight = wr.grossArea / wr.wall.length;
  const openingsHtml =
    wr.openings?.length > 0
      ? wr.openings.map((o) => `<li>${formatOpeningLine(o)}</li>`).join('')
      : '<li>Проёмов нет</li>';

  return `
    <h1 style="font-size:17px;margin:0 0 12px;color:${BRAND}">${wr.wall.label}</h1>
    ${statsBlock([
      { label: 'Монтаж', value: mountingLabel },
      { label: 'Размер стены', value: `${wr.wall.length.toFixed(2)} × ${wallHeight.toFixed(2)} м` },
      { label: 'Площадь брутто', value: `${wr.grossArea.toFixed(2)} м²` },
      { label: 'Площадь чистая', value: `${stats.netArea.toFixed(2)} м²` },
      { label: 'Проёмов', value: `${stats.openingsCount} шт.` },
      { label: 'Панелей', value: `${stats.total} шт. (${stats.fullPanels} целых + ${stats.cutPanels} подрез.)` },
      { label: 'К закупке', value: `${stats.withReserve} шт.` },
      { label: 'Дюбели (с запасом 15%)', value: `${stats.dowels.withReserve} шт.` },
      ...frameStatsRows(stats.frame),
      { label: 'Стоимость панелей', value: formatRub(stats.totalCost) },
    ])}
    <h2 style="font-size:13px;color:${BRAND};margin:0 0 6px">Проёмы на стене</h2>
    <ul style="font-size:11px;line-height:1.6;margin:0 0 12px;padding-left:18px;color:#333">${openingsHtml}</ul>
    <div style="flex:1;display:flex;align-items:center;justify-content:center;min-height:0">
      <img src="${image}" alt="${wr.wall.label}" style="max-width:100%;max-height:150mm;object-fit:contain;border:1px solid #e1e5e8;border-radius:8px"/>
    </div>`;
}

async function renderPageToPdf(doc, html, { isFirstPage, pageW, pageH }) {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff';
  container.innerHTML = html;
  document.body.appendChild(container);

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const [{ default: html2canvas }] = await Promise.all([
    import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm'),
  ]);

  const pageEl = container.querySelector('.pdf-page') ?? container;
  const canvas = await html2canvas(pageEl, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
  });

  document.body.removeChild(container);

  if (!isFirstPage) doc.addPage();

  const imgData = canvas.toDataURL('image/jpeg', 0.92);
  const imgH = (canvas.height * pageW) / canvas.width;
  const drawH = Math.min(imgH, pageH);
  doc.addImage(imgData, 'JPEG', 0, 0, pageW, drawH);
}

export async function exportCalculationPDF({
  bom,
  room,
  ceilingImage,
  wallSurfaces = [],
  planImage = null,
}) {
  const [{ jsPDF }] = await Promise.all([
    import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm'),
  ]);

  const dateStr = formatDate();
  const pages = [];

  const totalPages =
    1 +
    (bom.ceiling && ceilingImage ? 1 : 0) +
    wallSurfaces.length;

  let pageNum = 1;

  pages.push(
    pageShell({
      title: `Расчёт материалов | ${dateStr}`,
      subtitle: 'Сводная страница',
      bodyHtml: buildSummaryBody({ bom, room, dateStr, planImage }),
      pageLabel: `Страница ${pageNum} из ${totalPages}`,
    })
  );
  pageNum += 1;

  if (bom.ceiling && ceilingImage) {
    pages.push(
      pageShell({
        title: `Расчёт материалов | ${dateStr}`,
        subtitle: 'Потолок',
        bodyHtml: buildCeilingBody({ bom, ceilingImage }),
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
        subtitle: wallResult.wall.label,
        bodyHtml: buildWallBody({
          wr: wallResult,
          stats,
          image,
          mountingLabel: bom.walls?.mountingLabel ?? stats.mountingLabel,
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

  const area = Math.round(room.getTotalArea() + room.getTotalWallArea());
  doc.save(`MultiFrame_${area}m2_${dateStr.replace(/\./g, '-')}.pdf`);
}

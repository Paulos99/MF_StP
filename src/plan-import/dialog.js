import { retireWorker } from './retire-worker.js';
import { MAX_SIDE, checkFile, imageDimensions, parseDimensions, calibratedGeometry, distance, validatePolygon } from './core.js';

const el = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
/** A detached draft: this module cannot access or mutate the calculator's room. */
export function openPlanImport({ onApply, onClose = () => {} }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'plan-import';
  dialog.setAttribute('aria-label', 'План по фото');
  dialog.innerHTML = `
    <header><h2>План по фото</h2><button type="button" data-id="close" aria-label="Закрыть">×</button></header>
    <p>Проверьте контур и масштаб. Распознавание может ошибаться. До «Применить» комната не изменится.</p>
    <details><summary>Как работает?</summary><p>Загрузите план, найдите контуры и выберите одну комнату. Если контур не найден, обведите его по углам. Перетащите углы для правки. Отметьте две точки известного отрезка и введите его длину. Проверьте каждую стену перед применением. Фото под углом сначала выровняйте. Внутренние колонны и отверстия не учитываются.</p></details>
    <p class="plan-import__privacy">Всё считается в браузере. Файл никуда не отправляется. OCR загружает бесплатные модули с этого сайта только по кнопке.</p>
    <label>Фото или скан (PNG, JPEG, WebP, до 12 МБ и 16 Мп)<input data-id="file" type="file" accept="image/png,image/jpeg,image/webp"></label>
    <div class="plan-import__actions"><button type="button" data-id="detect" disabled>Найти контуры</button><button type="button" data-id="ocr" disabled>Прочитать размеры (OCR)</button><button type="button" data-id="stop" hidden>Остановить</button></div>
    <p data-id="status" role="status" aria-live="polite">Выберите изображение. PDF пока не поддерживается.</p><progress data-id="progress" max="1" hidden></progress>
    <section data-id="review" hidden>
      <label>Выберите комнату<select data-id="candidate"><option value="">Контур не выбран</option></select></label>
      <div class="plan-import__actions"><button type="button" data-id="draw">Обвести заново</button><button type="button" data-id="undo">Убрать последний угол</button><button type="button" data-id="finish">Замкнуть контур</button><button type="button" data-id="calibrate">Задать масштаб по двум точкам</button></div>
      <p data-id="hint">Выберите найденный контур или обведите комнату.</p>
      <canvas data-id="canvas" aria-label="Изображение плана с углами и размерами"></canvas>
      <details><summary>Углы (пиксели): правка без перетаскивания</summary><div data-id="vertices"></div></details>
      <fieldset><legend>Известный отрезок</legend><p data-id="segment">Отметьте две точки на изображении.</p><label>Длина<input data-id="length" type="text" inputmode="decimal" autocomplete="off" placeholder="Например, 3500"></label><label>Единицы<select data-id="unit"><option value="">Выберите</option><option value="mm">мм</option><option value="cm">см</option><option value="m">м</option></select></label></fieldset>
      <details open><summary>Текст OCR, не размеры стен</summary><p>Числа могут быть площадью, номером комнаты или ошибкой. Выберите число только для известного отрезка. При отсутствии единиц выберите их вручную.</p><div data-id="words"></div></details>
      <p data-id="validation"></p><ol data-id="dimensions"></ol>
      <label class="plan-import__check"><input data-id="confirmed" type="checkbox">Я проверил контур, единицы и размеры всех стен</label>
      <p><strong>Применение заменит контур текущей комнаты и удалит все её окна и двери.</strong> Подложка и история правок схемы будут очищены. Высота, материал и остальные настройки сохранятся.</p>
      <button type="button" data-id="apply" disabled>Применить к комнате</button>
    </section>
    <footer><button type="button" data-id="cancel">Отмена</button></footer>`;
  document.body.append(dialog);
  const q = id => dialog.querySelector(`[data-id="${id}"]`);
  const canvas = q('canvas'), ctx = canvas.getContext('2d');
  let image = null, points = [], candidates = [], words = [], calibration = {}, mode = 'edit', closed = false;
  let worker = null, workerKind = null, timer = null, loadId = 0, disposed = false, busy = false, dragging = -1, result = null;
  const status = text => { q('status').textContent = text; };
  function stop(message, { finished = false } = {}) {
    const previous = worker, kind = workerKind;
    worker = null; workerKind = null; // Ignore stale messages before retiring.
    retireWorker(previous, { cooperative: kind === 'ocr', finished });
    clearTimeout(timer); busy = false;
    q('confirmed').disabled = false;
    q('progress').hidden = true; q('stop').hidden = true;
    for (const id of ['detect', 'ocr']) q(id).disabled = !image;
    if (message) status(message);
  }
  function releaseImage() { if (image) image.width = image.height = 1; image = null; }
  function cleanup() {
    if (disposed) return;
    disposed = true; loadId++; stop(); releaseImage(); canvas.width = canvas.height = 1;
    dialog.close(); dialog.remove(); onClose();
  }
  dialog.addEventListener('cancel', e => { e.preventDefault(); cleanup(); });
  q('close').onclick = q('cancel').onclick = cleanup;
  q('stop').onclick = () => stop('Распознавание остановлено. Можно исправить контур вручную.');
  function invalidate() { q('confirmed').checked = false; update(); }
  function update() {
    result = null;
    try {
      const invalidCoordinate = [...q('vertices').querySelectorAll('input')].some(input => !input.value.trim() || !Number.isFinite(Number(input.value)) || Number(input.value) < 0 || Number(input.value) > Number(input.max));
      if (invalidCoordinate) throw new Error('Проверьте координаты: они должны быть внутри изображения.');
      if (!closed) throw new Error('Выберите или замкните контур.');
      result = calibratedGeometry(points, { ...calibration, length: q('length').value, unit: q('unit').value });
      q('validation').textContent = `Площадь: ${result.area.toFixed(2)} м². Проверьте стены:`;
    } catch (e) { q('validation').textContent = e.message; }
    q('apply').disabled = !result || !q('confirmed').checked || busy;
    q('dimensions').replaceChildren();
    if (result) Object.values(result.edgeDimensions).forEach((v, i) => q('dimensions').append(el('li', `${i + 1}: ${v.toFixed(3)} м`)));
    q('segment').textContent = calibration.a && calibration.b ? `Отрезок отмечен (${distance(calibration.a, calibration.b).toFixed(0)} пикс.). Введите его реальную длину.` : 'Отметьте две точки на изображении.';
    paint();
  }
  function paint() {
    if (!image) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0);
    ctx.font = `${Math.max(14, canvas.width / 55)}px sans-serif`;
    for (const word of words) {
      const { x0, y0, x1, y1 } = word.bbox;
      ctx.strokeStyle = '#a64b00'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
    if (!points.length) candidates.forEach((candidate, i) => {
      ctx.strokeStyle = '#007466'; ctx.lineWidth = 2; ctx.setLineDash([7, 4]); ctx.beginPath();
      candidate.points.forEach((p, j) => j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      const p = candidate.points[0]; label(`Контур ${i + 1}`, p.x + 8, p.y + 22);
    });
    ctx.lineWidth = Math.max(2, canvas.width / 350); ctx.strokeStyle = '#007466'; ctx.fillStyle = '#007466';
    if (points.length) {
      ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      if (closed) ctx.closePath(); ctx.stroke();
      points.forEach((p, i) => {
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
        label(String(i + 1), p.x + 9, p.y - 9);
        if (closed && result) {
          const b = points[(i + 1) % points.length];
          label(`${result.edgeDimensions[i].toFixed(2)} м`, (p.x + b.x) / 2, (p.y + b.y) / 2);
        }
      });
    }
    if (calibration.a) {
      ctx.strokeStyle = '#b90052'; ctx.beginPath(); ctx.arc(calibration.a.x, calibration.a.y, 6, 0, Math.PI * 2); ctx.stroke();
      if (calibration.b) { ctx.beginPath(); ctx.moveTo(calibration.a.x, calibration.a.y); ctx.lineTo(calibration.b.x, calibration.b.y); ctx.stroke(); }
    }
  }
  function label(text, x, y) {
    const w = ctx.measureText(text).width;
    ctx.fillStyle = '#fff'; ctx.fillRect(x - 2, y - 16, w + 4, 20);
    ctx.fillStyle = '#004e45'; ctx.fillText(text, x, y);
  }
  function vertexInputs() {
    q('vertices').replaceChildren();
    points.forEach((p, i) => {
      const row = el('div', `${i + 1}. `); row.className = 'plan-import__vertex';
      for (const axis of ['x', 'y']) {
        const lab = el('label', axis.toUpperCase()); const input = document.createElement('input');
        input.type = 'number'; input.min = '0'; input.max = String(axis === 'x' ? canvas.width : canvas.height); input.step = '1'; input.value = p[axis].toFixed(0);
        input.oninput = input.onchange = () => {
          const v = Number(input.value);
          if (input.value.trim() && Number.isFinite(v) && v >= 0 && v <= Number(input.max)) p[axis] = v;
          invalidate();
        };
        lab.append(input); row.append(lab);
      }
      q('vertices').append(row);
    });
  }
  function clearScale() { calibration = {}; q('length').value = ''; q('unit').value = ''; }
  q('draw').onclick = () => { points = []; closed = false; mode = 'draw'; clearScale(); q('hint').textContent = 'Нажимайте на углы по порядку, затем «Замкнуть контур».'; vertexInputs(); invalidate(); };
  q('undo').onclick = () => { points.pop(); closed = false; mode = 'draw'; vertexInputs(); invalidate(); };
  q('finish').onclick = () => { const error = validatePolygon(points); if (error) { status(error); return; } closed = true; mode = 'edit'; q('hint').textContent = 'Перетащите углы для правки. Затем задайте масштаб.'; invalidate(); };
  q('calibrate').onclick = () => { mode = 'calibrate'; clearScale(); q('hint').textContent = 'Нажмите на начало и конец отрезка с известной длиной.'; invalidate(); };
  const position = e => { const r = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(canvas.width, (e.clientX - r.left) * canvas.width / r.width)), y: Math.max(0, Math.min(canvas.height, (e.clientY - r.top) * canvas.height / r.height)) }; };
  canvas.onpointerdown = e => {
    if (busy || (e.button !== undefined && e.button !== 0)) return;
    const p = position(e);
    if (mode === 'calibrate') {
      const radius = 16 * canvas.width / canvas.getBoundingClientRect().width;
      const nearest = points.reduce((best, v) => distance(v, p) < distance(best, p) ? v : best, points[0] ?? p);
      const mark = points.length && distance(nearest, p) <= radius ? { ...nearest } : p;
      if (!calibration.a) calibration.a = mark; else { calibration.b = mark; mode = 'edit'; }
      invalidate();
    }
    else if (mode === 'draw') { if (points.length >= 64) return; points.push(p); vertexInputs(); invalidate(); }
    else {
      const radius = 24 * canvas.width / canvas.getBoundingClientRect().width;
      dragging = points.findIndex(v => distance(v, p) < radius);
      if (dragging >= 0) { canvas.setPointerCapture(e.pointerId); q('confirmed').checked = false; }
    }
  };
  canvas.onpointermove = e => { if (dragging >= 0) { points[dragging] = position(e); result = null; q('apply').disabled = true; paint(); } };
  canvas.onpointerup = canvas.onpointercancel = () => { if (dragging >= 0) { dragging = -1; vertexInputs(); invalidate(); } };
  q('length').oninput = q('unit').onchange = invalidate;
  q('confirmed').onchange = update;
  q('candidate').onchange = () => {
    const item = candidates[Number(q('candidate').value)];
    points = q('candidate').value !== '' && item ? item.points.map(p => ({ ...p })) : [];
    closed = points.length >= 3; mode = 'edit'; clearScale(); vertexInputs(); invalidate();
  };
  q('file').onchange = async () => {
    const id = ++loadId, file = q('file').files[0]; stop(); releaseImage(); points = []; words = []; candidates = []; closed = false; mode = 'edit'; dragging = -1; clearScale(); vertexInputs();
    q('hint').textContent = 'Выберите найденный контур или обведите комнату.';
    q('review').hidden = true; q('candidate').replaceChildren(el('option', 'Контур не выбран')); q('candidate').firstChild.value = ''; q('words').replaceChildren(); stop(); invalidate();
    if (!file) return;
    let bitmap;
    try {
      checkFile(file);
      imageDimensions(await file.slice(0, 256 * 1024).arrayBuffer(), file.type);
      if (disposed || id !== loadId) return;
      status('Подготовка изображения…');
      bitmap = await createImageBitmap(file);
      if (disposed || id !== loadId) return;
      const ratio = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      // Composite transparency on white so the CV and OCR see the same pixels.
      const draft = document.createElement('canvas'); draft.width = canvas.width; draft.height = canvas.height;
      const dc = draft.getContext('2d'); dc.fillStyle = '#fff'; dc.fillRect(0, 0, draft.width, draft.height); dc.drawImage(bitmap, 0, 0, draft.width, draft.height); image = draft;
      q('review').hidden = false; stop(); vertexInputs(); invalidate(); status('Изображение готово. Найдите контуры или обведите комнату вручную.');
    } catch (e) { if (!disposed && id === loadId) status(e.message); }
    finally { bitmap?.close(); }
  };
  function start(kind) {
    if (!image || busy) return;
    busy = true; q('confirmed').checked = false; q('confirmed').disabled = true; q('apply').disabled = true;
    q('detect').disabled = q('ocr').disabled = true; q('stop').hidden = false; q('progress').hidden = false; q('progress').removeAttribute('value');
    status(kind === 'ocr' ? 'OCR: загрузка модулей и чтение текста. На слабом телефоне это может занять минуту.' : 'Поиск замкнутых светлых областей…');
    let current;
    try { current = new Worker(new URL(`plan-import/${kind}.worker.js`, document.baseURI), kind === 'detect' ? { type: 'module' } : {}); }
    catch { stop('Браузер не поддерживает распознавание. Обведите комнату вручную.'); update(); return; }
    worker = current; workerKind = kind;
    timer = setTimeout(() => stop('Время распознавания истекло. Обведите комнату и введите размер вручную.'), kind === 'ocr' ? 90000 : 15000);
    current.onerror = () => { if (worker === current) { stop('Распознавание недоступно. Обведите комнату и задайте масштаб вручную.'); update(); } };
    current.onmessage = ({ data }) => {
      if (worker !== current || disposed) return;
      if ('progress' in data) { q('progress').value = data.progress; return; }
      if (data.error) { stop('Не удалось распознать. Обведите комнату и задайте масштаб вручную.'); update(); return; }
      stop(null, { finished: true });
      if (kind === 'detect') {
        candidates = data.candidates;
        points = []; closed = false; mode = 'edit'; clearScale(); vertexInputs();
        q('candidate').replaceChildren(el('option', 'Выберите контур')); q('candidate').firstChild.value = '';
        candidates.forEach((c, i) => { const option = el('option', `Контур ${i + 1} (${c.points.length} углов)`); option.value = String(i); q('candidate').append(option); });
        // Always require explicit selection, including a single detected region.
        status(candidates.length ? `Найдено контуров: ${candidates.length}. Выберите нужную комнату и проверьте углы.` : 'Замкнутые контуры не найдены. Обведите комнату вручную.');
      } else {
        words = data.words.filter(w => parseDimensions(w.text).length);
        q('words').replaceChildren();
        words.forEach(word => parseDimensions(word.text).forEach(candidate => {
          const button = el('button', `${candidate.raw} (OCR ${Math.round(word.confidence)}%, ${word.confidence < 60 ? 'низкая уверенность' : 'проверьте'})`); button.type = 'button';
          button.onclick = () => { q('length').value = candidate.value; q('unit').value = candidate.unit ?? ''; invalidate(); };
          q('words').append(button);
        }));
        status(words.length ? 'Текст отмечен коричневым. Он не привязан к стенам. Проверьте каждое число.' : 'Числа не найдены. Введите известную длину вручную.');
      }
      update();
    };
    try {
      if (kind === 'detect') {
        const pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height);
        current.postMessage({ buffer: pixels.data.buffer, width: image.width, height: image.height }, [pixels.data.buffer]);
      } else current.postMessage({ image: image.toDataURL('image/png') });
    } catch { stop('Не удалось прочитать изображение. Попробуйте другой файл.'); update(); }
  }
  q('detect').onclick = () => start('detect'); q('ocr').onclick = () => start('ocr');
  q('apply').onclick = () => {
    if (disposed) return;
    update();
    if (!result || !q('confirmed').checked || busy) return;
    // The caller receives geometry only; no image, OCR text, or guessed dimensions.
    onApply({ vertices: result.vertices.map(p => ({ ...p })), edgeDimensions: { ...result.edgeDimensions } });
    cleanup();
  };
  dialog.showModal();
  return { close: cleanup };
}

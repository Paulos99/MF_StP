/** Pure, bounded helpers shared by the worker and deterministic tests. No room state. */
export const MAX_SIDE = 1000;
export const MAX_FILE_BYTES = 12 * 1024 * 1024;
export function checkFile(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Выберите PNG, JPEG или WebP. PDF пока не поддерживается.');
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('Размер файла должен быть не больше 12 МБ.');
}
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function area(points) {
  return Math.abs(points.reduce((s, a, i) => { const b = points[(i + 1) % points.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;
}
function cross(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function intersects(a, b, c, d) {
  const sign = v => Math.abs(v) < 1e-8 ? 0 : Math.sign(v);
  const on = (p, q, r) => sign(cross(p, q, r)) === 0 && r.x >= Math.min(p.x, q.x) - 1e-8 && r.x <= Math.max(p.x, q.x) + 1e-8 && r.y >= Math.min(p.y, q.y) - 1e-8 && r.y <= Math.max(p.y, q.y) + 1e-8;
  return (sign(cross(a, b, c)) * sign(cross(a, b, d)) < 0 && sign(cross(c, d, a)) * sign(cross(c, d, b)) < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}
export function validatePolygon(points) {
  if (points.length < 3 || points.length > 64) return 'Нужно от 3 до 64 углов.';
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return 'Проверьте координаты углов.';
  for (let i = 0; i < points.length; i++) {
    if (distance(points[i], points[(i + 1) % points.length]) < 0.01) return 'Два соседних угла совпадают.';
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (intersects(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) return 'Стороны контура пересекаются.';
    }
  }
  if (area(points) < 0.001) return 'Контур не образует площадь.';
  return null;
}
export function parseDimensions(text) {
  // Text candidates, NEVER an edge assignment. Unitless numbers remain unitless.
  const result = [];
  const re = /(?<![\d.,])\d{1,5}(?:[.,]\d{1,3})?\s*(?:мм|см|mm|cm|м|m)?(?![\d.,])/giu;
  for (const match of text.matchAll(re)) {
    const raw = match[0].trim();
    const unit = raw.match(/мм|см|mm|cm|м|m/iu)?.[0].toLowerCase() ?? null;
    const value = Number(raw.match(/[\d.,]+/)[0].replace(',', '.'));
    if (value > 0) result.push({ raw, value, unit: ['мм', 'mm'].includes(unit) ? 'mm' : ['см', 'cm'].includes(unit) ? 'cm' : unit ? 'm' : null });
  }
  return result;
}
export function calibratedGeometry(points, calibration) {
  const error = validatePolygon(points);
  if (error) throw new Error(error);
  const factor = { m: 1, cm: 0.01, mm: 0.001 }[calibration.unit];
  const length = Number(String(calibration.length).replace(',', '.')) * factor;
  const span = calibration.a && calibration.b ? distance(calibration.a, calibration.b) : 0;
  if (!factor || !Number.isFinite(length) || length <= 0 || span < 10) throw new Error('Отметьте две точки не ближе 10 пикселей и укажите длину с единицами.');
  const scale = length / span;
  const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y));
  const vertices = points.map(p => ({ x: (p.x - minX) * scale, y: (p.y - minY) * scale }));
  const invalid = validatePolygon(vertices);
  if (invalid) throw new Error(invalid);
  const lengths = vertices.map((p, i) => distance(p, vertices[(i + 1) % vertices.length]));
  if (lengths.some(v => v < 0.02 || v > 100) || area(vertices) > 10000) throw new Error('Проверьте масштаб: допустимы стены от 2 см до 100 м и площадь до 10 000 м².');
  return { vertices, edgeDimensions: Object.fromEntries(lengths.map((v, i) => [i, v])), scale, area: area(vertices) };
}
/** Find enclosed light regions. No promise of BTI/photo reliability; open doors may leak. */
export function detectContours(rgba, width, height, progress = () => {}) {
  if (width < 20 || height < 20 || width > MAX_SIDE || height > MAX_SIDE || rgba.length !== width * height * 4) throw new Error('Неподдерживаемый размер изображения.');
  const n = width * height, dark = new Uint8Array(n), blocked = new Uint8Array(n), seen = new Uint8Array(n), queue = new Int32Array(n);
  for (let i = 0; i < n; i++) dark[i] = rgba[i * 4 + 3] > 50 && (rgba[i * 4] * .299 + rgba[i * 4 + 1] * .587 + rgba[i * 4 + 2] * .114) < 165 ? 1 : 0;
  // One-pixel dilation closes tiny scan defects, never large door openings.
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    blocked[i] = dark[i] | dark[i - 1] | dark[i + 1] | dark[i - width] | dark[i + width];
  }
  const candidates = [];
  const members = new Uint8Array(n); let traced = 0;
  for (let seed = 0; seed < n; seed++) {
    if (blocked[seed] || seen[seed]) continue;
    let read = 0, count = 1, border = false;
    queue[0] = seed; seen[seed] = 1;
    while (read < count) {
      const p = queue[read++], x = p % width, y = Math.floor(p / width);
      if (!x || !y || x === width - 1 || y === height - 1) border = true;
      for (const q of [x ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y ? p - width : -1, y < height - 1 ? p + width : -1]) {
        if (q >= 0 && !seen[q] && !blocked[q]) { seen[q] = 1; queue[count++] = q; }
      }
    }
    if (border || count < Math.max(200, n * .005)) continue;
    // Trace clockwise unit boundary edges, selecting the exterior (largest loop).
    if (++traced > 32) break;
    members.fill(0);
    for (let k = 0; k < count; k++) members[queue[k]] = 1;
    const edges = new Map();
    const add = (x, y, xx, yy) => { const key = y * (width + 1) + x; const a = edges.get(key) ?? []; a.push([xx, yy]); edges.set(key, a); };
    for (const p of queue.subarray(0, count)) {
      const x = p % width, y = Math.floor(p / width);
      if (!members[p - width]) add(x, y, x + 1, y);
      if (!members[p + 1]) add(x + 1, y, x + 1, y + 1);
      if (!members[p + width]) add(x + 1, y + 1, x, y + 1);
      if (!members[p - 1]) add(x, y + 1, x, y);
    }
    if (edges.size > 8000) continue;
    let best = [];
    while (edges.size) {
      const start = edges.keys().next().value; let key = start, points = [], guard = 0;
      do {
        points.push({ x: key % (width + 1), y: Math.floor(key / (width + 1)) });
        const nexts = edges.get(key); if (!nexts) break;
        const next = nexts.pop(); if (!nexts.length) edges.delete(key);
        key = next[1] * (width + 1) + next[0];
      } while (key !== start && ++guard <= n * 4);
      if (key !== start) continue;
      points = points.filter((p, i, a) => cross(a[(i + a.length - 1) % a.length], p, a[(i + 1) % a.length]) !== 0);
      if (points.length > 1000) continue;
      // Remove the tiny stair steps introduced at rectangular corners by dilation.
      let changed = true;
      while (changed && points.length > 3) {
        changed = false;
        for (let i = 0; i < points.length; i++) {
          const a = points[(i + points.length - 1) % points.length], b = points[i], c = points[(i + 1) % points.length];
          if (Math.abs(cross(a, c, b)) / Math.max(1, distance(a, c)) < 1.5) { points.splice(i, 1); changed = true; break; }
        }
      }
      if (area(points) > area(best)) best = points;
    }
    if (!validatePolygon(best)) candidates.push({ points: best, pixelArea: area(best) });
    progress(Math.min(.95, seed / n));
  }
  return candidates.sort((a, b) => b.pixelArea - a.pixelArea).slice(0, 12);
}
/** Header-only guard before decoding. SVG/GIF and malformed headers are rejected. */
export function imageDimensions(buffer, type) {
  const v = new DataView(buffer), bytes = new Uint8Array(buffer);
  const ascii = (at, text) => [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  let width, height;
  if (type === 'image/png' && v.byteLength >= 24 && bytes[0] === 137 && ascii(1, 'PNG')) {
    width = v.getUint32(16); height = v.getUint32(20);
    for (let p = 8; p + 12 <= v.byteLength;) {
      if (ascii(p + 4, 'acTL')) throw new Error('Анимированные изображения не поддерживаются.');
      if (ascii(p + 4, 'IDAT')) break;
      const length = v.getUint32(p); if (length > v.byteLength - p - 12) break;
      p += 12 + length;
    }
  }
  if (type === 'image/jpeg' && v.byteLength > 4 && v.getUint16(0) === 0xffd8) {
    let p = 2;
    while (p + 4 <= v.byteLength) {
      if (bytes[p++] !== 255) break;
      while (bytes[p] === 255) p++;
      const marker = bytes[p++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const size = v.getUint16(p);
      if (size < 2 || p + size > v.byteLength) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 7) { height = v.getUint16(p + 3); width = v.getUint16(p + 5); break; }
      p += size;
    }
  }
  if (type === 'image/webp' && v.byteLength >= 30 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    if (ascii(12, 'VP8X')) {
      if (bytes[20] & 2) throw new Error('Анимированные изображения не поддерживаются.');
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16); height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (ascii(12, 'VP8 ') && v.byteLength >= 30) { width = v.getUint16(26, true) & 0x3fff; height = v.getUint16(28, true) & 0x3fff; }
    else if (ascii(12, 'VP8L') && bytes[20] === 0x2f) { const bits = v.getUint32(21, true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
  }
  if (!width || !height) throw new Error('Не удалось прочитать изображение. Сохраните его как обычный PNG или JPEG.');
  if (width * height > 16000000 || Math.max(width, height) > 16000) throw new Error('Изображение слишком большое. Уменьшите его до 16 мегапикселей.');
  return { width, height };
}

// Real OCR smoke test in Node, using exactly the locally distributed models/core.
// Browser worker nesting, mobile layout and cancellation still need desktop QA.
import { createWorker } from 'tesseract.js';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { parseDimensions } from '../src/plan-import/core.js';
const worker = await createWorker('eng+rus', 1, {
  langPath: resolve('public/ocr/lang'), cacheMethod: 'none',
});
try {
  const { data } = await worker.recognize('scripts/fixtures/plan-import/ocr-dimensions.png', {}, { blocks: true });
  const parsed = parseDimensions(data.text);
  assert.ok(parsed.some(c => c.value === 4000 && c.unit === 'mm'), data.text);
  assert.ok(parsed.some(c => c.value === 300 && c.unit === 'cm'), data.text);
  assert.ok(parsed.some(c => c.value === 2.7 && [null, 'm'].includes(c.unit)), data.text);
  assert.ok(data.blocks?.[0]?.paragraphs?.[0]?.lines?.[0]?.words?.[0]?.bbox);
  console.log(JSON.stringify({ text: data.text, confidence: data.confidence, parsed }, null, 2));
} finally { await worker.terminate(); }

// Track children immediately, including before createWorker() resolves. Normal
// cancellation explicitly terminates each child, rather than relying solely on
// browser orphan-worker cleanup (which has differed between browser versions).
const NativeWorker = self.Worker;
const children = new Set();
self.Worker = class extends NativeWorker {
  constructor(...args) { super(...args); children.add(this); }
  terminate() { children.delete(this); return super.terminate(); }
};
const terminateChildren = () => { for (const child of children) child.terminate(); };
let cancelled = false;
importScripts('../ocr/tesseract.min.js');
self.onmessage = async ({ data }) => {
  if (data.cancel) {
    cancelled = true; terminateChildren(); self.postMessage({ cancelled: true }); return;
  }
  let worker;
  try {
    const root = new URL('../ocr/', self.location.href).href;
    worker = await Tesseract.createWorker('eng+rus', 1, {
      workerPath: root + 'worker.min.js', corePath: root + 'core/', langPath: root + 'lang',
      workerBlobURL: false, cacheMethod: 'none',
      logger: m => { if (!cancelled) self.postMessage({ progress: m.progress ?? 0, status: m.status }); },
    });
    if (cancelled) return;
    const result = await worker.recognize(data.image, {}, { blocks: true });
    if (cancelled) return;
    const words = [];
    for (const block of result.data.blocks ?? []) for (const para of block.paragraphs ?? []) for (const line of para.lines ?? []) {
      // Keep neighboring numbers/units together; these are text lines, not edges.
      words.push({ text: line.text, confidence: line.confidence, bbox: line.bbox });
    }
    // Release the child BEFORE publishing a result; the document may retire the
    // host immediately after receiving this message.
    await worker.terminate(); worker = null; terminateChildren();
    self.postMessage({ words, confidence: result.data.confidence });
  } catch (e) {
    terminateChildren();
    if (!cancelled) self.postMessage({ error: e.message });
  } finally {
    if (worker) await worker.terminate();
    terminateChildren();
  }
};

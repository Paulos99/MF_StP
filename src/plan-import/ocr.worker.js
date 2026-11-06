// Host worker owns Tesseract's child worker, including during initialization.
// Terminating this host cancels the worker tree, not just a UI promise.
importScripts('../ocr/tesseract.min.js');
self.onmessage = async ({ data }) => {
  let worker;
  try {
    const root = new URL('../ocr/', self.location.href).href;
    worker = await Tesseract.createWorker('eng+rus', 1, {
      workerPath: root + 'worker.min.js', corePath: root + 'core/', langPath: root + 'lang',
      workerBlobURL: false, cacheMethod: 'none',
      logger: m => self.postMessage({ progress: m.progress ?? 0, status: m.status }),
    });
    const result = await worker.recognize(data.image, {}, { blocks: true });
    const words = [];
    for (const block of result.data.blocks ?? []) for (const para of block.paragraphs ?? []) for (const line of para.lines ?? []) {
      // Keep neighboring numbers/units together; these are text lines, not edges.
      words.push({ text: line.text, confidence: line.confidence, bbox: line.bbox });
    }
    self.postMessage({ words, confidence: result.data.confidence });
  } catch (e) { self.postMessage({ error: e.message }); }
  finally { if (worker) await worker.terminate(); }
};

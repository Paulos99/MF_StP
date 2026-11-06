import { detectContours } from './core.js';
self.onmessage = ({ data }) => {
  try {
    const candidates = detectContours(new Uint8ClampedArray(data.buffer), data.width, data.height, value => self.postMessage({ progress: value }));
    self.postMessage({ candidates });
  } catch (e) { self.postMessage({ error: e.message }); }
};

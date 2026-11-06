/** Invalidate UI ownership first, then explicitly stop OCR children before its host.
 * The short hard fallback also handles failed startup/importScripts or browser bugs.
 */
export function retireWorker(worker, { cooperative = false, finished = false } = {}) {
  if (!worker) return;
  if (!cooperative || finished) { worker.terminate(); return; }
  let timer;
  let retired = false;
  const finish = () => {
    if (retired) return;
    retired = true; clearTimeout(timer);
    worker.onmessage = null; worker.onerror = null;
    worker.terminate();
  };
  worker.onmessage = ({ data }) => { if (data?.cancelled) finish(); };
  worker.onerror = finish;
  timer = setTimeout(finish, 500);
  try { worker.postMessage({ cancel: true }); } catch { finish(); }
}

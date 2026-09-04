export const SHARE_VERSION = 4;

export function encodeProjectState(state) {
  try {
    const json = JSON.stringify(state);
    return btoa(unescape(encodeURIComponent(json)));
  } catch {
    return '';
  }
}

export function decodeProjectState(hash) {
  try {
    const json = decodeURIComponent(escape(atob(hash)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Старые ссылки: scheme → dims */
export function normalizeInputMode(mode) {
  if (mode === 'scheme') return 'dims';
  if (mode === 'dims' || mode === 'draw' || mode === 'area') return mode;
  return null;
}

export function buildProjectPayload({ room, options, step, inputMode, areaValue, areaWalls }) {
  return {
    v: SHARE_VERSION,
    room,
    options,
    step: step ?? 1,
    inputMode: normalizeInputMode(inputMode) ?? 'dims',
    areaValue: areaValue ?? null,
    areaWalls: areaWalls ?? [],
  };
}

export function buildShareUrl(state) {
  const encoded = encodeProjectState(state);
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = `calc=${encoded}`;
  return url.toString();
}

export function readShareFromUrl() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash.startsWith('calc=')) return null;
  const data = decodeProjectState(hash.slice(5));
  if (data) data.inputMode = normalizeInputMode(data.inputMode);
  return data;
}

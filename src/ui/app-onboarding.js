import {
  GuidedTour,
  openMobileSidebar,
  closeMobileSidebar,
  tourIsMobileLayout,
} from './guided-tour.js';
import { VirtualCursor, sleep } from './virtual-cursor.js';
import { SKETCH_TUTORIAL_KEY } from '../editor/sketch-onboarding.js';

export const APP_TUTORIAL_KEY = 'mf-app-tutorial-v4';

/** L-room in meters (1 m grid). */
const DEMO_ROOM = [
  { x: 0, y: 0 },
  { x: 5, y: 0 },
  { x: 5, y: 2 },
  { x: 2, y: 2 },
  { x: 2, y: 4 },
  { x: 0, y: 4 },
];

const CURSOR_MS = 980;

let appTourApi = null;
let demoHooks = null;
let demoAbort = null;
let nextWaiters = [];

function $(sel) {
  return document.querySelector(sel);
}

function $$(sel) {
  return [...document.querySelectorAll(sel)];
}

function aborted() {
  return demoAbort?.signal?.aborted;
}

function throwIfAborted() {
  if (aborted()) throw new DOMException('aborted', 'AbortError');
}

function clearNextWaiters(err) {
  const list = nextWaiters.splice(0, nextWaiters.length);
  list.forEach((w) => (err ? w.reject(err) : w.resolve()));
}

function waitForUserNext(tour) {
  throwIfAborted();
  tour.nextBtn.hidden = false;
  tour.prevBtn.hidden = true;
  tour.nextBtn.disabled = false;
  return new Promise((resolve, reject) => {
    nextWaiters.push({ resolve, reject });
    const onAbort = () => {
      demoAbort.signal.removeEventListener('abort', onAbort);
      reject(new DOMException('aborted', 'AbortError'));
    };
    demoAbort.signal.addEventListener('abort', onAbort, { once: true });
  });
}

function wireNextButton(tour) {
  tour.nextBtn.onclick = () => {
    const list = nextWaiters.splice(0, nextWaiters.length);
    list.forEach((w) => w.resolve());
  };
}

async function narrate(tour, opts) {
  throwIfAborted();
  await tour.narrate(opts);
  // Keep spotlight stable after layout shifts (drawer / collapse)
  await sleep(80);
  tour._position?.(resolveTargetSafe(opts.target), opts);
}

function resolveTargetSafe(selector) {
  if (!selector) return null;
  if (selector instanceof Element) return selector;
  if (typeof selector === 'function') return selector();
  return document.querySelector(selector);
}

function revealSharedOptions() {
  const sharedReveal = $('#sharedReveal');
  if (!sharedReveal) return;
  sharedReveal.classList.add('is-open');
  sharedReveal.querySelector('.shared-reveal__collapse')?.removeAttribute('inert');
  const shared = $('#sharedCalcOptions');
  shared?.setAttribute('aria-hidden', 'false');
}

async function ensureSidebarForParams() {
  if (tourIsMobileLayout()) {
    openMobileSidebar();
    await sleep(320);
  }
  revealSharedOptions();
  await sleep(120);
}

async function drawRoomWithCursor(cursor, editor) {
  if (!editor) return;
  editor.prepareDemoDrawView({ minX: -0.5, minY: -0.5, maxX: 6, maxY: 5 });
  await sleep(160);

  for (const pt of DEMO_ROOM) {
    throwIfAborted();
    const screen = editor.worldToClient(pt.x, pt.y);
    await cursor.moveTo(screen, { duration: CURSOR_MS });
    await sleep(80);
    cursor.el?.classList.add('is-pressing');
    cursor.ripple?.classList.remove('is-burst');
    void cursor.ripple?.offsetWidth;
    cursor.ripple?.classList.add('is-burst');
    await sleep(120);
    editor.demoTapWorld(pt.x, pt.y);
    await sleep(200);
    cursor.el?.classList.remove('is-pressing');
  }

  throwIfAborted();
  const start = DEMO_ROOM[0];
  await cursor.moveTo(editor.worldToClient(start.x, start.y), { duration: CURSOR_MS * 0.9 });
  await sleep(100);
  cursor.el?.classList.add('is-pressing');
  cursor.ripple?.classList.add('is-burst');
  await sleep(120);
  editor.demoTapWorld(start.x, start.y);
  await sleep(160);
  cursor.el?.classList.remove('is-pressing');

  await sleep(350);
  demoHooks?.runCalculation?.({ silent: true });
  await sleep(450);
}

async function selectCeilingAndTwoWalls(cursor, tour) {
  await ensureSidebarForParams();

  await narrate(tour, {
    title: 'Что считать',
    text: 'Сначала снимем лишнее, затем оставим потолок и две стены — смета сразу пересчитается.',
    target: '#sharedCalcOptions',
    scrollBlock: 'center',
    stepLabel: '5 / 8',
  });

  const deselect = $('#deselectAllWallsBtn');
  if (deselect) {
    await cursor.click(deselect, { duration: CURSOR_MS });
    await sleep(280);
  }

  await narrate(tour, {
    title: 'Что считать',
    text: 'Оставляем потолок и две стены — типичный фрагмент объекта.',
    target: '#surfaceChips',
    scrollBlock: 'center',
    stepLabel: '5 / 8',
  });

  const ceilingLabel = $('#calcCeiling')?.closest('label') || $('#calcCeiling');
  const ceiling = $('#calcCeiling');
  if (ceiling && !ceiling.checked && ceilingLabel) {
    await cursor.click(ceilingLabel, { duration: CURSOR_MS });
    await sleep(220);
  } else if (ceilingLabel) {
    await cursor.moveTo(ceilingLabel, { duration: CURSOR_MS * 0.85 });
    await sleep(180);
  }

  const wallLabels = $$('#wallSurfacesList label.surface-chip')
    .filter((lab) => lab.querySelector('input[type="checkbox"]'));
  const toPick = wallLabels.slice(0, 2);
  for (const lab of toPick) {
    throwIfAborted();
    const input = lab.querySelector('input[type="checkbox"]');
    if (input?.checked) continue;
    await cursor.click(lab, { duration: CURSOR_MS });
    await sleep(260);
  }

  demoHooks?.runCalculation?.({ silent: true });
  await sleep(350);

  await narrate(tour, {
    title: 'Что считать',
    text: 'Готово: в расчёте только выбранные поверхности.',
    target: '#sharedCalcOptions',
    scrollBlock: 'center',
    stepLabel: '5 / 8',
  });
}

function stepLabel(i, total) {
  return `${i} / ${total}`;
}

function buildSteps() {
  const total = 8;
  return [
    {
      id: 'welcome',
      async play(cursor, tour) {
        await narrate(tour, {
          title: 'Калькулятор MultiFRAME',
          text: 'Считает панели и комплектующие для звукоизоляции потолка и стен — со схемой раскладки и сметой.',
          target: '.app-header',
          radius: 16,
          stepLabel: stepLabel(1, total),
        });
        await cursor.moveTo($('#appHelpBtn') || $('.app-header'), { duration: CURSOR_MS });
        await sleep(200);
      },
    },
    {
      id: 'mode',
      async play(cursor, tour) {
        const mobile = tourIsMobileLayout();
        if (mobile && !document.body.classList.contains('mobile-sidebar-open')) {
          await narrate(tour, {
            title: 'Способ ввода',
            text: 'Откроем параметры и выберем «Нарисовать схему».',
            target: '#mobileParamsBtn',
            aboveFooter: true,
            radius: 14,
            stepLabel: stepLabel(2, total),
          });
          await cursor.click($('#mobileParamsBtn'), { duration: CURSOR_MS });
          await sleep(280);
        }

        await narrate(tour, {
          title: 'Способ ввода',
          text: 'Для сложной формы комнаты удобнее рисовать схему.',
          textMobile: 'Выбираем «Нарисовать схему».',
          target: '#entryDrawBtn',
          stepLabel: stepLabel(2, total),
        });

        if (demoHooks?.getInputMode?.() !== 'draw') {
          const btn = $('#entryDrawBtn');
          if (btn) await cursor.click(btn, { duration: CURSOR_MS });
          else demoHooks?.setInputMode?.('draw', { confirmSwitch: false });
          await sleep(320);
        }

        if (mobile) {
          closeMobileSidebar();
          await sleep(220);
        }
      },
    },
    {
      id: 'draw-layout',
      async play(cursor, tour) {
        await narrate(tour, {
          title: 'Контур и раскладка',
          text: 'Курсор рисует комнату по сетке 1 м. После замыкания сразу появляется раскладка панелей.',
          target: '#sketchCanvas',
          stepLabel: stepLabel(3, total),
        });
        const editor = demoHooks?.getSketchEditor?.();
        await drawRoomWithCursor(cursor, editor);
        await narrate(tour, {
          title: 'Контур и раскладка',
          text: 'Схема готова — панели MultiFRAME уже на плане.',
          target: '.scheme-card',
          stepLabel: stepLabel(3, total),
        });
        await cursor.moveTo($('.scheme-card') || { x: window.innerWidth * 0.5, y: window.innerHeight * 0.42 }, { duration: CURSOR_MS });
        await sleep(180);
      },
    },
    {
      id: 'openings',
      async play(cursor, tour) {
        if (tourIsMobileLayout()) closeMobileSidebar();
        const openingsBtn = $('#sketchOpeningsBtn');
        await narrate(tour, {
          title: 'Проёмы в стенах',
          text: 'Двери и окна задаются в редакторе стен — так смета точнее.',
          target: openingsBtn || '.scheme-card',
          radius: 12,
          stepLabel: stepLabel(4, total),
        });

        const editor = demoHooks?.getSketchEditor?.();
        if (openingsBtn && !openingsBtn.disabled) {
          await cursor.click(openingsBtn, { duration: CURSOR_MS });
          await sleep(400);
        } else {
          editor?._openOpeningsModal?.();
          await sleep(350);
        }

        const sheet = $('.sketch-openings-modal__sheet') || $('#sketchOpeningsModal');
        await narrate(tour, {
          title: 'Проёмы в стенах',
          text: 'Выберите стену, добавьте дверь или окно и подгоните размеры. Сейчас закроем редактор.',
          target: sheet,
          radius: 14,
          stepLabel: stepLabel(4, total),
        });
        await sleep(400);

        const done = $('#sketchOpeningsDoneBtn') || $('#sketchOpeningsCloseBtn');
        if (done) await cursor.click(done, { duration: CURSOR_MS });
        else editor?._closeOpeningsModal?.();
        await sleep(320);
      },
    },
    {
      id: 'surfaces',
      async play(cursor, tour) {
        await selectCeilingAndTwoWalls(cursor, tour);
      },
    },
    {
      id: 'results',
      async play(cursor, tour) {
        if (tourIsMobileLayout()) {
          closeMobileSidebar();
          await sleep(220);
        }
        await narrate(tour, {
          title: 'Смета и PDF',
          text: 'Детальный список материалов и выгрузка в PDF — для клиента или прораба.',
          target: '#resultsAside',
          stepLabel: stepLabel(6, total),
        });
        const aside = $('#resultsAside');
        if (aside) await cursor.moveTo(aside, { duration: CURSOR_MS });
        const pdf = $('#downloadBtn');
        if (pdf) {
          await cursor.moveTo(pdf, { duration: CURSOR_MS * 0.9 });
          pdf.classList.add('tour-demo-pulse');
          await sleep(420);
          pdf.classList.remove('tour-demo-pulse');
        }
      },
    },
    {
      id: 'buy',
      async play(cursor, tour) {
        const buy = $('#buyMultiframeBtn') || $('.stat-card-button');
        await narrate(tour, {
          title: 'Купить MultiFRAME',
          text: 'Когда цифры устраивают — можно перейти к покупке панелей.',
          target: buy || '.workspace-stats',
          radius: 14,
          stepLabel: stepLabel(7, total),
        });
        if (buy) {
          await cursor.moveTo(buy, { duration: CURSOR_MS });
          buy.classList.add('tour-demo-pulse');
          await sleep(480);
          buy.classList.remove('tour-demo-pulse');
        }
      },
    },
    {
      id: 'help',
      async play(cursor, tour) {
        await narrate(tour, {
          title: 'Обучение всегда под рукой',
          text: 'Значок «?» в шапке запускает демо снова. Удачных расчётов!',
          target: '#appHelpBtn',
          radius: 22,
          stepLabel: stepLabel(8, total),
        });
        const help = $('#appHelpBtn');
        if (help) await cursor.moveTo(help, { duration: CURSOR_MS });
        await sleep(220);
      },
    },
  ];
}

async function runDemo(tour) {
  const cursor = new VirtualCursor(tour.root);
  demoAbort = new AbortController();
  demoHooks?.onDemoStart?.();
  clearNextWaiters();
  const STEPS = buildSteps();

  try {
    await tour.start([], {
      force: true,
      storageKey: APP_TUTORIAL_KEY,
      demoMode: true,
      onComplete: () => {
        try { localStorage.setItem(SKETCH_TUTORIAL_KEY, 'done'); } catch { /* ignore */ }
        demoHooks?.onDemoEnd?.();
      },
      onSkip: () => {
        try { localStorage.setItem(SKETCH_TUTORIAL_KEY, 'done'); } catch { /* ignore */ }
        demoHooks?.onDemoEnd?.();
      },
    });

    tour.skipBtn.textContent = 'Пропустить';
    wireNextButton(tour);
    cursor.show();

    for (let i = 0; i < STEPS.length; i++) {
      throwIfAborted();
      const step = STEPS[i];
      const isLast = i === STEPS.length - 1;
      tour.nextBtn.textContent = isLast ? 'Готово' : 'Далее';
      tour.nextBtn.disabled = true;

      await step.play(cursor, tour);

      throwIfAborted();
      tour.nextBtn.disabled = false;
      tour.nextBtn.focus?.({ preventScroll: true });

      if (isLast) {
        await waitForUserNext(tour);
        cursor.hide();
        tour.complete();
      } else {
        await waitForUserNext(tour);
      }
    }
  } catch (err) {
    if (err?.name !== 'AbortError') console.warn('[onboarding demo]', err);
    demoHooks?.onDemoEnd?.();
  } finally {
    clearNextWaiters(new DOMException('aborted', 'AbortError'));
    cursor.destroy();
    demoAbort = null;
    if (tour.skipBtn) tour.skipBtn.textContent = 'Пропустить';
    tour.nextBtn.onclick = () => tour.next();
  }
}

export function setupAppOnboarding(hooks = {}) {
  demoHooks = hooks;
  const tour = GuidedTour.getShared();

  const start = async ({ force = false } = {}) => {
    if (tour.isActive() && !force) return false;
    if (!force && !tour.shouldAutoStart(APP_TUTORIAL_KEY)) return false;
    demoAbort?.abort?.();
    return runDemo(tour);
  };

  const maybeAutoStart = () => {
    if (!tour.shouldAutoStart(APP_TUTORIAL_KEY)) return;
    setTimeout(() => {
      if (tour.isActive()) return;
      start({ force: false });
    }, 480);
  };

  const helpBtn = document.getElementById('appHelpBtn');
  helpBtn?.addEventListener('click', () => {
    demoAbort?.abort?.();
    if (tour.isActive()) {
      tour.skip({ silent: true });
      demoHooks?.onDemoEnd?.();
    }
    start({ force: true });
  });

  const origSkip = tour.skip.bind(tour);
  tour.skip = (opts) => {
    demoAbort?.abort?.();
    clearNextWaiters(new DOMException('aborted', 'AbortError'));
    origSkip(opts);
  };

  appTourApi = { start, maybeAutoStart, tour };
  return appTourApi;
}

export function getAppOnboarding() {
  return appTourApi;
}

export function dismissAppTourIfActive() {
  const tour = GuidedTour.getShared();
  if (tour.isActive() && tour.storageKey === APP_TUTORIAL_KEY) {
    demoAbort?.abort?.();
    clearNextWaiters(new DOMException('aborted', 'AbortError'));
    tour.skip({ silent: true });
    tour.markDone(APP_TUTORIAL_KEY);
  }
}

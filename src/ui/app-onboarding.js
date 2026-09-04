import {
  GuidedTour,
  openMobileSidebar,
  closeMobileSidebar,
  tourIsMobileLayout,
} from './guided-tour.js';
import { VirtualCursor, sleep } from './virtual-cursor.js';
import { SKETCH_TUTORIAL_KEY } from '../editor/sketch-onboarding.js';

export const APP_TUTORIAL_KEY = 'mf-app-tutorial-v5';

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
}

function revealSharedOptions() {
  const sharedReveal = $('#sharedReveal');
  if (!sharedReveal) return;
  sharedReveal.classList.add('is-open');
  sharedReveal.querySelector('.shared-reveal__collapse')?.removeAttribute('inert');
  $('#sharedCalcOptions')?.setAttribute('aria-hidden', 'false');
}

async function ensureSidebarForParams() {
  if (tourIsMobileLayout()) {
    openMobileSidebar();
    await sleep(320);
  }
  revealSharedOptions();
  await sleep(100);
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

async function demoOpenings(cursor, tour) {
  if (tourIsMobileLayout()) closeMobileSidebar();

  const openingsBtn = $('#sketchOpeningsBtn');
  const editor = demoHooks?.getSketchEditor?.();
  const sheet = () => $('.sketch-openings-modal__sheet') || $('#sketchOpeningsModal');

  await narrate(tour, {
    title: 'Проёмы в стенах',
    text: 'Откроем редактор стен и добавим дверь и окно — они сразу учитываются в смете.',
    target: openingsBtn || '.scheme-card',
    radius: 12,
    stepLabel: '4 / 8',
  });

  if (openingsBtn && !openingsBtn.disabled) {
    await cursor.click(openingsBtn, { duration: CURSOR_MS });
  } else {
    editor?._openOpeningsModal?.();
  }
  await sleep(450);

  // Park card once at modal — further updates via setCopy only
  await narrate(tour, {
    title: 'Проёмы в стенах',
    text: 'Добавляем дверь на выбранную стену.',
    target: sheet(),
    radius: 14,
    stepLabel: '4 / 8',
  });

  const doorBtn = $('#sketchAddDoorBtn');
  if (doorBtn) {
    await cursor.click(doorBtn, { duration: CURSOR_MS });
    await sleep(500);
  } else {
    editor?._addOpening?.('door');
    await sleep(350);
  }

  tour.setCopy({
    title: 'Проёмы в стенах',
    text: 'И окно на ту же стену — на развёртке видны оба проёма.',
    stepLabel: '4 / 8',
  });
  tour.refreshSpotlight(sheet(), { radius: 14 });

  const winBtn = $('#sketchAddWindowBtn');
  if (winBtn) {
    await cursor.click(winBtn, { duration: CURSOR_MS });
    await sleep(550);
  } else {
    editor?._addOpening?.('window');
    await sleep(350);
  }

  // Point at elevation so openings are visible
  const elev = $('.sketch-openings-elevation') || $('#sketchWallCanvas')?.parentElement;
  if (elev) {
    tour.setCopy({
      title: 'Проёмы в стенах',
      text: 'Дверь и окно на развёртке стены. Закрываем редактор — расчёт обновится.',
      stepLabel: '4 / 8',
    });
    await cursor.moveTo(elev, { duration: CURSOR_MS });
    await sleep(450);
  }

  const done = $('#sketchOpeningsDoneBtn') || $('#sketchOpeningsCloseBtn');
  if (done) await cursor.click(done, { duration: CURSOR_MS });
  else editor?._closeOpeningsModal?.();
  await sleep(400);

  demoHooks?.runCalculation?.({ silent: true });
  await sleep(300);

  // Show walls tab so openings cutouts are visible on elevation scheme
  const wallsBtn = document.querySelector('#resultsTabs .tab-btn[data-tab="walls"]');
  if (wallsBtn) {
    wallsBtn.hidden = false;
    await narrate(tour, {
      title: 'Проёмы в стенах',
      text: 'На вкладке «Стены» раскладка учитывает двери и окна.',
      target: '.scheme-card',
      stepLabel: '4 / 8',
    });
    await cursor.click(wallsBtn, { duration: CURSOR_MS });
    demoHooks?.setSchemeView?.('walls');
    await sleep(550);
  }
}

async function demoSurfaces(cursor, tour) {
  await ensureSidebarForParams();

  // Single narrate — keep card/spotlight parked on options block
  await narrate(tour, {
    title: 'Что считать',
    text: 'Снимаем все стены, затем оставляем потолок и две стены.',
    target: '#sharedCalcOptions',
    scrollBlock: 'center',
    stepLabel: '5 / 8',
    pad: 12,
    radius: 14,
  });

  const deselect = $('#deselectAllWallsBtn');
  if (deselect) {
    await cursor.click(deselect, { duration: CURSOR_MS });
    await sleep(280);
  }

  tour.setCopy({
    title: 'Что считать',
    text: 'Оставляем потолок и две стены — смета пересчитается.',
    stepLabel: '5 / 8',
  });
  // Soft refresh spotlight size if chips reflowed — don't move card
  tour.refreshSpotlight('#sharedCalcOptions', { pad: 12, radius: 14 });

  const ceilingLabel = $('#calcCeiling')?.closest('label');
  const ceiling = $('#calcCeiling');
  if (ceiling && !ceiling.checked && ceilingLabel) {
    await cursor.click(ceilingLabel, { duration: CURSOR_MS });
    await sleep(220);
  }

  const wallLabels = $$('#wallSurfacesList label.surface-chip')
    .filter((lab) => lab.querySelector('input[type="checkbox"]'));
  for (const lab of wallLabels.slice(0, 2)) {
    throwIfAborted();
    const input = lab.querySelector('input[type="checkbox"]');
    if (input?.checked) continue;
    await cursor.click(lab, { duration: CURSOR_MS });
    await sleep(260);
  }

  demoHooks?.runCalculation?.({ silent: true });
  await sleep(350);

  tour.setCopy({
    title: 'Что считать',
    text: 'В расчёте только выбранные поверхности.',
    stepLabel: '5 / 8',
  });
  tour.refreshSpotlight('#sharedCalcOptions', { pad: 12, radius: 14 });
  await sleep(200);
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
        tour.setCopy({
          title: 'Контур и раскладка',
          text: 'Схема готова — панели MultiFRAME уже на плане.',
          stepLabel: stepLabel(3, total),
        });
        tour.refreshSpotlight('.scheme-card', { radius: 12 });
        await cursor.moveTo($('.scheme-card') || { x: window.innerWidth * 0.5, y: window.innerHeight * 0.42 }, { duration: CURSOR_MS });
        await sleep(180);
      },
    },
    {
      id: 'openings',
      async play(cursor, tour) {
        await demoOpenings(cursor, tour);
      },
    },
    {
      id: 'surfaces',
      async play(cursor, tour) {
        await demoSurfaces(cursor, tour);
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

async function finishDemo(tour, cursor, { completed }) {
  cursor.hide();
  if (completed) tour.complete();
  // Reset UI after teardown callbacks
  await sleep(50);
  demoHooks?.resetAfterDemo?.();
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
        demoHooks?.resetAfterDemo?.();
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
        await finishDemo(tour, cursor, { completed: true });
      } else {
        await waitForUserNext(tour);
      }
    }
  } catch (err) {
    if (err?.name !== 'AbortError') console.warn('[onboarding demo]', err);
    demoHooks?.onDemoEnd?.();
    // skip path already resets; abort from help restart should not reset mid-way if restarting
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
      // Don't reset when restarting help — reset only after full skip/complete
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

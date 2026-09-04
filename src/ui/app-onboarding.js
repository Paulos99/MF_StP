import {
  GuidedTour,
  openMobileSidebar,
  closeMobileSidebar,
  tourIsMobileLayout,
} from './guided-tour.js';
import { VirtualCursor, sleep } from './virtual-cursor.js';
import { SKETCH_TUTORIAL_KEY } from '../editor/sketch-onboarding.js';

export const APP_TUTORIAL_KEY = 'mf-app-tutorial-v3';

/** Simple L-room in meters (1 m grid). Last click closes on first point. */
const DEMO_ROOM = [
  { x: 0, y: 0 },
  { x: 5, y: 0 },
  { x: 5, y: 2 },
  { x: 2, y: 2 },
  { x: 2, y: 4 },
  { x: 0, y: 4 },
];

let appTourApi = null;
let demoHooks = null;
let demoAbort = null;
let nextWaiters = [];

function $(sel) {
  return document.querySelector(sel);
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

async function drawRoomWithCursor(cursor, editor) {
  if (!editor) return;
  editor.prepareDemoDrawView({ minX: -0.5, minY: -0.5, maxX: 6, maxY: 5 });
  await sleep(200);

  for (const pt of DEMO_ROOM) {
    throwIfAborted();
    const screen = editor.worldToClient(pt.x, pt.y);
    await cursor.moveTo(screen, { duration: 1500 });
    await sleep(120);
    cursor.el?.classList.add('is-pressing');
    cursor.ripple?.classList.remove('is-burst');
    void cursor.ripple?.offsetWidth;
    cursor.ripple?.classList.add('is-burst');
    await sleep(160);
    editor.demoTapWorld(pt.x, pt.y);
    await sleep(280);
    cursor.el?.classList.remove('is-pressing');
  }

  // Close on start point
  throwIfAborted();
  const start = DEMO_ROOM[0];
  const closeScreen = editor.worldToClient(start.x, start.y);
  await cursor.moveTo(closeScreen, { duration: 1200 });
  await sleep(150);
  cursor.el?.classList.add('is-pressing');
  cursor.ripple?.classList.add('is-burst');
  await sleep(160);
  editor.demoTapWorld(start.x, start.y);
  await sleep(200);
  cursor.el?.classList.remove('is-pressing');

  await sleep(400);
  demoHooks?.runCalculation?.({ silent: true });
  await sleep(500);
}

const STEPS = [
  {
    id: 'mode',
    title: 'Режим схемы',
    text: 'Для сложной формы выбираем «Нарисовать схему».',
    textMobile: 'Откройте параметры и выберите «Нарисовать схему».',
    async play(cursor, tour) {
      const mobile = tourIsMobileLayout();
      if (mobile && !document.body.classList.contains('mobile-sidebar-open')) {
        await narrate(tour, {
          title: this.title,
          text: this.textMobile,
          target: '#mobileParamsBtn',
          aboveFooter: true,
          radius: 14,
          stepLabel: '1 / 6',
        });
        await cursor.click($('#mobileParamsBtn'), { duration: 1300 });
        await sleep(300);
      }

      await narrate(tour, {
        title: this.title,
        text: this.text,
        textMobile: this.textMobile,
        target: '#entryDrawBtn',
        stepLabel: '1 / 6',
      });

      if (demoHooks?.getInputMode?.() !== 'draw') {
        const btn = $('#entryDrawBtn');
        if (btn) await cursor.click(btn, { duration: 1400 });
        else demoHooks?.setInputMode?.('draw', { confirmSwitch: false });
        await sleep(350);
      }

      if (mobile) {
        closeMobileSidebar();
        await sleep(250);
      }
    },
  },
  {
    id: 'draw',
    title: 'Рисуем комнату',
    text: 'Курсор ставит углы по сетке 1 м и замыкает контур.',
    async play(cursor, tour) {
      await narrate(tour, {
        title: this.title,
        text: this.text,
        target: '#sketchCanvas',
        stepLabel: '2 / 6',
      });
      const editor = demoHooks?.getSketchEditor?.();
      await drawRoomWithCursor(cursor, editor);
    },
  },
  {
    id: 'layout',
    title: 'Раскладка панелей',
    text: 'Контур готов — на схеме сразу видна раскладка MultiFRAME.',
    async play(cursor, tour) {
      if (tourIsMobileLayout()) closeMobileSidebar();
      await narrate(tour, {
        title: this.title,
        text: this.text,
        target: '.scheme-card',
        stepLabel: '3 / 6',
      });
      await cursor.moveTo($('.scheme-card') || { x: window.innerWidth * 0.5, y: window.innerHeight * 0.45 }, { duration: 1200 });
      await sleep(200);
    },
  },
  {
    id: 'surfaces',
    title: 'Потолок и стены',
    text: 'Отметьте поверхности и тип монтажа — смета подстроится.',
    async play(cursor, tour) {
      if (tourIsMobileLayout()) {
        openMobileSidebar();
        await sleep(280);
      }
      $('#sharedReveal')?.classList.add('is-open');
      $('#sharedReveal')?.querySelector('.shared-reveal__collapse')?.removeAttribute('inert');

      await narrate(tour, {
        title: this.title,
        text: this.text,
        target: '#sharedCalcOptions',
        scrollBlock: 'center',
        stepLabel: '4 / 6',
      });
      const el = $('#sharedCalcOptions');
      if (el) await cursor.moveTo(el, { duration: 1300 });
      await sleep(200);
    },
  },
  {
    id: 'results',
    title: 'Смета и PDF',
    text: 'Список материалов и выгрузка в PDF — для клиента или прораба.',
    async play(cursor, tour) {
      if (tourIsMobileLayout()) {
        closeMobileSidebar();
        await sleep(250);
      }
      await narrate(tour, {
        title: this.title,
        text: this.text,
        target: '#resultsAside',
        stepLabel: '5 / 6',
      });
      const aside = $('#resultsAside');
      if (aside) await cursor.moveTo(aside, { duration: 1300 });
      const pdf = $('#downloadBtn');
      if (pdf) {
        await cursor.moveTo(pdf, { duration: 1100 });
        pdf.classList.add('tour-demo-pulse');
        await sleep(500);
        pdf.classList.remove('tour-demo-pulse');
      }
    },
  },
  {
    id: 'buy',
    title: 'Купить MultiFRAME',
    text: 'Когда цифры устраивают — переход к покупке. Повторить обучение: «?» в шапке.',
    async play(cursor, tour) {
      const buy = $('#buyMultiframeBtn') || $('.stat-card-button');
      await narrate(tour, {
        title: this.title,
        text: this.text,
        target: buy || '#appHelpBtn',
        radius: 14,
        stepLabel: '6 / 6',
      });
      if (buy) {
        await cursor.moveTo(buy, { duration: 1400 });
        buy.classList.add('tour-demo-pulse');
        await sleep(600);
        buy.classList.remove('tour-demo-pulse');
      }
    },
  },
];

async function runDemo(tour) {
  const cursor = new VirtualCursor(tour.root);
  demoAbort = new AbortController();
  demoHooks?.onDemoStart?.();
  clearNextWaiters();

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
    // restore default next handler for non-demo tours
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

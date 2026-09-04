import {
  GuidedTour,
  openMobileSidebar,
  closeMobileSidebar,
  tourIsMobileLayout,
} from './guided-tour.js';
import { VirtualCursor, sleep, waitFor } from './virtual-cursor.js';
import { SKETCH_TUTORIAL_KEY } from '../editor/sketch-onboarding.js';

export const APP_TUTORIAL_KEY = 'mf-app-tutorial-v2';

let appTourApi = null;
let demoHooks = null;
let demoAbort = null;

function $(sel) {
  return document.querySelector(sel);
}

function aborted() {
  return demoAbort?.signal?.aborted;
}

async function pause(ms) {
  if (aborted()) throw new DOMException('aborted', 'AbortError');
  await waitFor(ms, { signal: demoAbort.signal });
}

async function narrate(tour, opts) {
  if (aborted()) throw new DOMException('aborted', 'AbortError');
  await tour.narrate(opts);
}

async function ensureDrawMode(cursor, tour) {
  const mobile = tourIsMobileLayout();
  if (mobile && !document.body.classList.contains('mobile-sidebar-open')) {
    await narrate(tour, {
      title: 'Начнём с параметров',
      text: 'На телефоне сначала открываем настройки — отсюда выбирается способ расчёта.',
      target: '#mobileParamsBtn',
      aboveFooter: true,
      radius: 14,
      stepLabel: 'Демо',
    });
    await cursor.click($('#mobileParamsBtn'));
    await pause(350);
  }

  await narrate(tour, {
    title: 'Выбираем «Нарисовать схему»',
    text: 'Когда форма комнаты сложная — удобнее набросать контур. Есть и готовые шаблоны.',
    textMobile: 'Когда форма комнаты сложная — набрасываем контур или берём шаблон.',
    target: '#entryDrawBtn',
    stepLabel: 'Демо',
  });

  const drawBtn = $('#entryDrawBtn');
  if (drawBtn && demoHooks?.getInputMode?.() !== 'draw') {
    await cursor.click(drawBtn);
    await pause(450);
  } else if (demoHooks?.getInputMode?.() !== 'draw') {
    demoHooks?.setInputMode?.('draw', { confirmSwitch: false });
    await pause(350);
  }

  if (mobile) {
    closeMobileSidebar();
    await pause(280);
  }
}

async function applyLShapeWithCursor(cursor, tour) {
  const tplBtn = $('#sketchTemplatesBtn');
  const menu = $('.sketch-dropdown-menu');
  const lBtn = $('[data-template="l-shape"]');

  await narrate(tour, {
    title: 'Берём готовую форму',
    text: 'Вместо пустой сетки покажем живой пример: курсор выберет Г-образную комнату — типичный случай для расчёта.',
    target: tplBtn || '#sketchCanvas',
    radius: 16,
    stepLabel: 'Демо',
  });

  if (tplBtn && lBtn) {
    await cursor.click(tplBtn);
    if (menu) menu.hidden = false;
    await pause(280);
    await narrate(tour, {
      title: 'Г-форма за секунду',
      text: 'Шаблон сразу даёт замкнутый контур с размерами. Можно было и кликать по сетке вручную — шаг 1 м.',
      target: lBtn,
      pad: 6,
      radius: 8,
      stepLabel: 'Демо',
    });
    await cursor.click(lBtn);
    if (menu) menu.hidden = true;
  } else {
    demoHooks?.applySketchTemplate?.('l-shape');
  }

  await pause(700);
  // Force calc if settle is slow
  demoHooks?.runCalculation?.({ silent: true });
  await pause(500);
}

async function runDemo(tour) {
  const cursor = new VirtualCursor(tour.root);
  demoAbort = new AbortController();
  demoHooks?.onDemoStart?.();

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

    tour.skipBtn.textContent = 'Пропустить демо';
    cursor.show();

    await narrate(tour, {
      title: 'Как считают MultiFRAME',
      text: 'Не теория — короткий рабочий проход: схема, раскладка, смета и покупка. Следите за курсором.',
      target: '.app-header',
      radius: 16,
      stepLabel: 'Демо',
    });
    await pause(900);

    await ensureDrawMode(cursor, tour);

    await narrate(tour, {
      title: 'Рабочая область схемы',
      text: 'Здесь живёт чертёж: сетка, зум, шаблоны и фото плана. Сейчас соберём пример комнаты.',
      target: '.scheme-card',
      stepLabel: 'Демо',
    });
    await pause(600);

    await applyLShapeWithCursor(cursor, tour);

    await narrate(tour, {
      title: 'Раскладка уже на схеме',
      text: 'Контур замкнут — калькулятор сам раскладывает панели MultiFRAME. Это не макет «на потом», а живой результат.',
      target: '.scheme-card',
      stepLabel: 'Демо',
    });
    await pause(1100);

    if (tourIsMobileLayout()) {
      openMobileSidebar();
      await pause(320);
    }

    const shared = $('#sharedCalcOptions');
    if (shared && $('#sharedReveal')) {
      $('#sharedReveal')?.classList.add('is-open');
      $('#sharedReveal')?.querySelector('.shared-reveal__collapse')?.removeAttribute('inert');
    }

    await narrate(tour, {
      title: 'Что входит в смету',
      text: 'Отмечаете потолок и стены, выбираете монтаж — список материалов и сумма перестраиваются под задачу.',
      target: '#sharedCalcOptions',
      scrollBlock: 'center',
      stepLabel: 'Демо',
    });
    await pause(1000);

    if (tourIsMobileLayout()) {
      closeMobileSidebar();
      await pause(300);
    }

    await narrate(tour, {
      title: 'Цифры под рукой',
      text: 'Площадь, число панелей и стоимость обновляются вместе со схемой — видно сразу, без отдельных «экранов отчёта».',
      target: '.workspace-stats',
      stepLabel: 'Демо',
    });
    await pause(900);

    await narrate(tour, {
      title: 'Детальный список',
      text: 'Справа (или ниже на телефоне) — полный состав: панели, комплектующие, запас. Удобно сверить перед заказом.',
      target: '#resultsAside',
      scrollBlock: 'nearest',
      stepLabel: 'Демо',
    });
    await pause(900);

    const pdfBtn = $('#downloadBtn');
    if (pdfBtn) {
      await narrate(tour, {
        title: 'Смета в PDF',
        text: 'Один клик — файл для клиента или прораба: схема и расчёт в одном документе.',
        target: pdfBtn,
        radius: 12,
        stepLabel: 'Демо',
      });
      await cursor.moveTo(pdfBtn);
      await pause(500);
      pdfBtn.classList.add('tour-demo-pulse');
      await pause(700);
      pdfBtn.classList.remove('tour-demo-pulse');
    }

    const buy = $('#buyMultiframeBtn') || $('.stat-card-button');
    if (buy) {
      await narrate(tour, {
        title: 'И к покупке панелей',
        text: 'Когда цифры устраивают — переход в каталог MultiFRAME. Расчёт уже готов, остаётся оформить заказ.',
        target: buy,
        radius: 14,
        stepLabel: 'Демо',
      });
      await cursor.moveTo(buy);
      buy.classList.add('tour-demo-pulse');
      await pause(900);
      buy.classList.remove('tour-demo-pulse');
    }

    await narrate(tour, {
      title: 'Готово — можно считать своё',
      text: 'Повторить демо — значок «?» в шапке. Для рисования с нуля подсказки появятся, когда откроете режим схемы.',
      target: '#appHelpBtn',
      radius: 22,
      stepLabel: 'Демо',
    });
    await cursor.moveTo($('#appHelpBtn'));
    await pause(1000);

    cursor.hide();
    tour.complete();
  } catch (err) {
    if (err?.name !== 'AbortError') console.warn('[onboarding demo]', err);
    demoHooks?.onDemoEnd?.();
  } finally {
    cursor.destroy();
    demoAbort = null;
    if (tour.skipBtn) tour.skipBtn.textContent = 'Пропустить';
  }
}

export function setupAppOnboarding(hooks = {}) {
  demoHooks = hooks;
  const tour = GuidedTour.getShared();

  const start = async ({ force = false } = {}) => {
    if (tour.isActive() && !force) return false;
    if (!force && !tour.shouldAutoStart(APP_TUTORIAL_KEY)) return false;

    // Abort previous demo if any
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

  // Skip should abort demo wait loops
  const origSkip = tour.skip.bind(tour);
  tour.skip = (opts) => {
    demoAbort?.abort?.();
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
    tour.skip({ silent: true });
    tour.markDone(APP_TUTORIAL_KEY);
  }
}

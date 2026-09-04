import {
  GuidedTour,
  openMobileSidebar,
  closeMobileSidebar,
  tourIsMobileLayout,
} from './guided-tour.js';

export const APP_TUTORIAL_KEY = 'mf-app-tutorial-v1';

function revealSharedOptions(open) {
  const sharedReveal = document.getElementById('sharedReveal');
  if (!sharedReveal) return;
  sharedReveal.classList.toggle('is-open', open);
  const collapse = sharedReveal.querySelector('.shared-reveal__collapse');
  if (collapse) {
    if (open) collapse.removeAttribute('inert');
    else collapse.setAttribute('inert', '');
  }
  const shared = document.getElementById('sharedCalcOptions');
  shared?.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function desktopSteps() {
  return [
    {
      id: 'entry',
      target: '#entryPicker',
      title: 'Способ ввода',
      text: 'Выберите, что знаете о помещении: размеры прямоугольника, свою схему или площадь.',
      beforeStep: async () => {
        revealSharedOptions(false);
      },
    },
    {
      id: 'options',
      target: '#sharedCalcOptions',
      title: 'Что считать',
      text: 'После выбора способа здесь появятся потолок/стены и тип монтажа — от этого зависит список материалов.',
      beforeStep: async () => {
        revealSharedOptions(true);
      },
      scrollBlock: 'center',
    },
    {
      id: 'scheme',
      target: '.scheme-card',
      title: 'Схема монтажа',
      text: 'Здесь появится раскладка панелей. Можно переключать вид потолка и стен.',
      beforeStep: async () => {
        revealSharedOptions(false);
      },
    },
    {
      id: 'results',
      target: '#resultsAside',
      title: 'Результаты',
      text: 'После расчёта справа — детальный список материалов, PDF и ссылка для отправки.',
    },
    {
      id: 'help',
      target: '#appHelpBtn',
      title: 'Помощь всегда рядом',
      text: 'Нажмите «?» в зелёной шапке, чтобы пройти обучение снова.',
      radius: 22,
    },
  ];
}

function mobileSteps() {
  return [
    {
      id: 'cta',
      target: '#mobileParamsBtn',
      title: 'Параметры расчёта',
      text: 'Нажмите кнопку внизу, чтобы открыть способы ввода и настройки.',
      aboveFooter: true,
      beforeStep: async () => {
        closeMobileSidebar();
        revealSharedOptions(false);
      },
      radius: 14,
    },
    {
      id: 'entry',
      target: '#entryPicker',
      title: 'Способ ввода',
      text: 'Три варианта: размеры, нарисовать схему или указать площадь.',
      beforeStep: async () => {
        openMobileSidebar();
        revealSharedOptions(false);
      },
    },
    {
      id: 'options',
      target: '#sharedCalcOptions',
      title: 'Что считать',
      text: 'После выбора способа — потолок/стены и тип монтажа.',
      beforeStep: async () => {
        openMobileSidebar();
        revealSharedOptions(true);
      },
      scrollBlock: 'center',
    },
    {
      id: 'scheme',
      target: '.scheme-card',
      title: 'Схема монтажа',
      text: 'После расчёта панель закроется — здесь будет раскладка панелей.',
      beforeStep: async () => {
        closeMobileSidebar();
        revealSharedOptions(false);
      },
    },
    {
      id: 'results',
      target: '#resultsAside',
      title: 'Результаты',
      text: 'Ниже схемы — детальный расчёт, PDF и кнопка «Поделиться».',
      beforeStep: async () => {
        closeMobileSidebar();
      },
      scrollBlock: 'start',
    },
    {
      id: 'help',
      target: '#appHelpBtn',
      title: 'Повторить обучение',
      text: 'Значок «?» в шапке снова запускает подсказки.',
      radius: 22,
    },
  ];
}

let appTourApi = null;

export function setupAppOnboarding({ getTour = () => GuidedTour.getShared() } = {}) {
  const tour = getTour();

  const start = async ({ force = false } = {}) => {
    if (tour.isActive() && !force) return false;
    const steps = tourIsMobileLayout() ? mobileSteps() : desktopSteps();
    return tour.start(steps, {
      force,
      storageKey: APP_TUTORIAL_KEY,
      onComplete: () => revealSharedOptions(false),
      onSkip: () => revealSharedOptions(false),
    });
  };

  const maybeAutoStart = () => {
    if (!tour.shouldAutoStart(APP_TUTORIAL_KEY)) return;
    setTimeout(() => {
      if (tour.isActive()) return;
      start({ force: false });
    }, 420);
  };

  const helpBtn = document.getElementById('appHelpBtn');
  helpBtn?.addEventListener('click', () => {
    start({ force: true });
  });

  appTourApi = { start, maybeAutoStart, tour };
  return appTourApi;
}

export function getAppOnboarding() {
  return appTourApi;
}

export function dismissAppTourIfActive() {
  const tour = GuidedTour.getShared();
  if (tour.isActive() && tour.storageKey === APP_TUTORIAL_KEY) {
    tour.skip({ silent: true });
    tour.markDone(APP_TUTORIAL_KEY);
    revealSharedOptions(false);
  }
}

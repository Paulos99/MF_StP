import {
  GuidedTour,
  openMobileSidebar,
  closeMobileSidebar,
  tourIsMobileLayout,
} from '../ui/guided-tour.js';

export const SKETCH_TUTORIAL_KEY = 'mf-sketch-tutorial-v2';

export const SKETCH_TUTORIAL_STEPS = [
  {
    id: 'contour',
    target: '#sketchCanvas',
    title: 'Создайте контур',
    text: 'Кликайте по сетке с шагом 1 м. Линии выравниваются по осям. Замкните контур красной точкой старта.',
    textMobile: 'Короткий тап по сетке — точка. Свайп по пустому месту — сдвиг схемы. Замкните контур красной точкой старта.',
    beforeStep: async () => {
      if (tourIsMobileLayout()) closeMobileSidebar();
    },
  },
  {
    id: 'dimensions',
    target: '#sketchCanvas',
    title: 'Размеры сторон',
    text: 'Кликните по стороне — появятся кнопки «Изменить размер» и «Проёмы».',
    textMobile: 'Тапните по стороне — появятся крупные кнопки размера и проёмов.',
    beforeStep: async () => {
      if (tourIsMobileLayout()) closeMobileSidebar();
    },
  },
  {
    id: 'edit',
    target: '#sketchCanvas',
    title: 'Форма и углы',
    text: 'Перетащите угол по сетке. Удерживайте угол ~0,5 с, чтобы удалить его.',
    textMobile: 'Перетащите угол. Удерживайте ~0,5 с — удаление угла.',
    beforeStep: async () => {
      if (tourIsMobileLayout()) closeMobileSidebar();
    },
  },
  {
    id: 'navigation',
    target: '.sketch-float-zoom',
    title: 'Масштаб и фото',
    text: 'Колёсико — зум. Пробел + перетаскивание или средняя кнопка — панорама. Камера загружает фото плана.',
    textMobile: 'Pinch — зум, один палец — сдвиг. Кнопки ± и камера тоже в углу схемы.',
    beforeStep: async () => {
      if (tourIsMobileLayout()) closeMobileSidebar();
    },
    radius: 16,
  },
  {
    id: 'height',
    target: '#drawHeight',
    title: 'Высота и проёмы',
    text: 'Укажите высоту стен. После контура проёмы — через сторону стены или «Настроить стены».',
    textMobile: 'Высота стен — в параметрах. Проёмы: тап по стороне или «Настроить стены».',
    beforeStep: async () => {
      if (tourIsMobileLayout()) openMobileSidebar();
    },
    scrollBlock: 'center',
  },
];

/**
 * Spotlight sketch tour — compatible API for SketchEditor.
 */
export class SketchOnboarding {
  constructor(_overlayEl, { onStepChange, onComplete, onSkip } = {}) {
    this.onStepChange = onStepChange;
    this.onComplete = onComplete;
    this.onSkip = onSkip;
    this.active = false;
    this.step = 0;
    this._tour = GuidedTour.getShared();
    if (_overlayEl) _overlayEl.hidden = true;
  }

  shouldAutoStart() {
    return this._tour.shouldAutoStart(SKETCH_TUTORIAL_KEY);
  }

  start(force = false) {
    if (!force && !this.shouldAutoStart()) return;
    this._run(0, force);
  }

  startOpenings(force = false) {
    if (!force && !this.shouldAutoStart()) return;
    const idx = SKETCH_TUTORIAL_STEPS.findIndex((s) => s.id === 'height');
    this._run(idx >= 0 ? idx : SKETCH_TUTORIAL_STEPS.length - 1, force);
  }

  async _run(startIndex, force) {
    this.active = true;
    const steps = SKETCH_TUTORIAL_STEPS.map((s) => ({
      ...s,
      beforeStep: async (step, ctx) => {
        await s.beforeStep?.(step, ctx);
        this.step = SKETCH_TUTORIAL_STEPS.indexOf(s);
        this.onStepChange?.(s);
      },
    }));

    await this._tour.start(steps, {
      force,
      storageKey: SKETCH_TUTORIAL_KEY,
      startIndex,
      allowSkip: false,
      onComplete: () => {
        this.active = false;
        this.onComplete?.();
      },
      onSkip: () => {
        this.active = false;
        this.onSkip?.();
      },
    });
  }

  dismiss() {
    if (this._tour.isActive() && this._tour.storageKey === SKETCH_TUTORIAL_KEY) {
      this._tour.skip();
    }
    this.active = false;
  }

  complete() {
    if (this._tour.isActive() && this._tour.storageKey === SKETCH_TUTORIAL_KEY) {
      this._tour.complete();
    }
    this.active = false;
  }

  prev() {
    this._tour.prev();
  }

  next() {
    this._tour.next();
  }

  getCurrentStep() {
    return SKETCH_TUTORIAL_STEPS[this.step] || this._tour.getCurrentStep();
  }
}

export const WALL_TUTORIAL_KEY = 'mf-wall-tutorial-v1';

export const WALL_TUTORIAL_STEPS = [
  {
    title: 'Выберите стену',
    text: 'Кликните по стене на плане или выберите чип — откроется развёртка.',
  },
  {
    title: 'Добавьте проём',
    text: 'Нажмите «+ Дверь» или «+ Окно», затем перетащите проём в нужное место.',
  },
  {
    title: 'Уточните размеры',
    text: 'Кликните по проёму и задайте точные размеры в панели свойств.',
  },
];

export class WallOnboarding {
  constructor() {
    this.step = 0;
  }

  shouldAutoStart() {
    try {
      return localStorage.getItem(WALL_TUTORIAL_KEY) !== 'done';
    } catch {
      return true;
    }
  }

  start() { /* unused */ }
  skip() {
    try {
      localStorage.setItem(WALL_TUTORIAL_KEY, 'done');
    } catch { /* ignore */ }
  }
  prev() {}
  next() {}
}

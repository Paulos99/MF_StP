import { TutorialDemoPlayer } from './tutorial-demo.js';

export const SKETCH_TUTORIAL_STEPS = [
  {
    id: 'contour',
    title: 'Создайте контур',
    subtitle: 'вид сверху',
    text: 'Кликайте по сетке с шагом 1 м. Линии выравниваются по горизонтали и вертикали. Для замыкания нажмите красную точку старта.',
    demo: 'draw',
  },
  {
    id: 'dimensions',
    title: 'Задайте размеры',
    text: 'Кликните по стороне — рядом с размером появятся кнопки «Изменить размер» и «Проёмы».',
    demo: 'dimension',
  },
  {
    id: 'edit',
    title: 'Измените форму',
    text: 'Перетащите угол по сетке, чтобы скорректировать форму.',
    demo: 'drag',
  },
  {
    id: 'delete',
    title: 'Удалите угол',
    text: 'Удерживайте угол ~1 сек — появится круг прогресса, затем подтвердите удаление.',
    demo: 'delete',
  },
  {
    id: 'navigation',
    title: 'Масштаб и перемещение',
    text: 'Колёсико мыши — приближение и отдаление. Зажмите колёсико и перетаскивайте схему. Или удерживайте пробел и перетаскивайте левой кнопкой.',
    demo: 'navigation',
  },
  {
    id: 'photo',
    title: 'Фото схемы',
    text: 'Нажмите значок камеры рядом с зумом (+/−), чтобы загрузить фото плана как подложку.',
    demo: 'photo',
  },
  {
    id: 'openings',
    title: 'Проёмы',
    text: 'Выберите стену и нажмите «Проёмы» — откроется настройка дверей и окон. Или «Настроить стены» в верхней панели.',
    demo: 'sketch-openings',
  },
  {
    id: 'done',
    title: 'Готово',
    text: 'Нажмите «Готово» — схема и проёмы сохранятся в калькуляторе.',
    demo: 'done',
  },
];

export class SketchOnboarding {
  constructor(overlayEl, { onStepChange, onComplete, onSkip } = {}) {
    this.overlay = overlayEl;
    this.onStepChange = onStepChange;
    this.onComplete = onComplete;
    this.onSkip = onSkip;
    this.step = 0;
    this.active = false;
    this._demoPlayer = null;
    this._bind();
  }

  _bind() {
    this.overlay.querySelector('.tutorial-prev')?.addEventListener('click', () => this.prev());
    this.overlay.querySelector('.tutorial-next')?.addEventListener('click', () => this.next());
    this.overlay.querySelector('.tutorial-skip')?.addEventListener('click', () => this.dismiss());
  }

  _ensureDemoPlayer() {
    const demoEl = this.overlay.querySelector('.tutorial-demo');
    if (!demoEl) return null;
    if (!this._demoPlayer) {
      this._demoPlayer = new TutorialDemoPlayer(demoEl);
    }
    return this._demoPlayer;
  }

  start(force = false) {
    if (!force) return;
    this.step = 0;
    this.active = true;
    this.overlay.hidden = false;
    this._render();
    this.onStepChange?.(this.getCurrentStep());
  }

  startOpenings(force = false) {
    if (!force) return;
    this.step = SKETCH_TUTORIAL_STEPS.findIndex((s) => s.id === 'openings');
    if (this.step < 0) this.step = 6;
    this.active = true;
    this.overlay.hidden = false;
    this._render();
    this.onStepChange?.(this.getCurrentStep());
  }

  dismiss() {
    this.active = false;
    this.overlay.hidden = true;
    this._demoPlayer?.stop();
    this.onSkip?.();
  }

  complete() {
    this.dismiss();
    this.onComplete?.();
  }

  prev() {
    if (this.step > 0) {
      this.step--;
      this._render();
      this.onStepChange?.(this.getCurrentStep());
    }
  }

  next() {
    if (this.step < SKETCH_TUTORIAL_STEPS.length - 1) {
      this.step++;
      this._render();
      this.onStepChange?.(this.getCurrentStep());
    } else {
      this.complete();
    }
  }

  getCurrentStep() {
    return SKETCH_TUTORIAL_STEPS[this.step];
  }

  _render() {
    const s = SKETCH_TUTORIAL_STEPS[this.step];
    this.overlay.querySelector('.tutorial-title').textContent = s.title;
    const sub = this.overlay.querySelector('.tutorial-subtitle');
    sub.textContent = s.subtitle ?? '';
    sub.hidden = !s.subtitle;
    this.overlay.querySelector('.tutorial-text').textContent = s.text;
    this.overlay.querySelector('.tutorial-step-indicator').textContent =
      `${this.step + 1} / ${SKETCH_TUTORIAL_STEPS.length}`;
    this.overlay.querySelector('.tutorial-prev').disabled = this.step === 0;
    const nextBtn = this.overlay.querySelector('.tutorial-next');
    nextBtn.textContent = this.step === SKETCH_TUTORIAL_STEPS.length - 1 ? 'Понятно' : 'Далее';
    nextBtn.setAttribute('aria-label', nextBtn.textContent);

    const player = this._ensureDemoPlayer();
    player?.start(s.demo);
  }
}

export const WALL_TUTORIAL_KEY = 'mf-wall-tutorial-v1';

export const WALL_TUTORIAL_STEPS = [
  {
    title: 'Выберите стену',
    text: 'Кликните по стене на плане или выберите чип — откроется развёртка.',
    demo: 'wall-select',
  },
  {
    title: 'Добавьте проём',
    text: 'Нажмите «+ Дверь» или «+ Окно», затем перетащите проём в нужное место.',
    demo: 'wall-opening',
  },
  {
    title: 'Уточните размеры',
    text: 'Кликните по проёму и задайте точные размеры в панели свойств.',
    demo: 'wall-form',
  },
];

export class WallOnboarding {
  constructor(overlayEl) {
    this.overlay = overlayEl;
    this.step = 0;
    this._demoPlayer = null;
    this._bind();
  }

  _bind() {
    this.overlay.querySelector('.tutorial-prev')?.addEventListener('click', () => this.prev());
    this.overlay.querySelector('.tutorial-next')?.addEventListener('click', () => this.next());
    this.overlay.querySelector('.tutorial-skip')?.addEventListener('click', () => this.skip());
  }

  shouldAutoStart() {
    try {
      return localStorage.getItem(WALL_TUTORIAL_KEY) !== 'done';
    } catch {
      return true;
    }
  }

  start(force = false) {
    if (!force && !this.shouldAutoStart()) return;
    this.step = 0;
    this.overlay.hidden = false;
    this._render();
  }

  skip() {
    this.overlay.hidden = true;
    this._demoPlayer?.stop();
    try {
      localStorage.setItem(WALL_TUTORIAL_KEY, 'done');
    } catch { /* ignore */ }
  }

  prev() {
    if (this.step > 0) {
      this.step--;
      this._render();
    }
  }

  next() {
    if (this.step < WALL_TUTORIAL_STEPS.length - 1) {
      this.step++;
      this._render();
    } else {
      this.skip();
    }
  }

  _render() {
    const s = WALL_TUTORIAL_STEPS[this.step];
    this.overlay.querySelector('.tutorial-title').textContent = s.title;
    const sub = this.overlay.querySelector('.tutorial-subtitle');
    if (sub) sub.hidden = true;
    this.overlay.querySelector('.tutorial-text').textContent = s.text;
    this.overlay.querySelector('.tutorial-step-indicator').textContent =
      `${this.step + 1} / ${WALL_TUTORIAL_STEPS.length}`;
    this.overlay.querySelector('.tutorial-prev').disabled = this.step === 0;
    const nextBtn = this.overlay.querySelector('.tutorial-next');
    nextBtn.textContent = this.step === WALL_TUTORIAL_STEPS.length - 1 ? 'Понятно' : 'Далее';

    let demoEl = this.overlay.querySelector('.tutorial-demo');
    if (!demoEl) {
      demoEl = document.createElement('div');
      demoEl.className = 'tutorial-demo';
      this.overlay.querySelector('.tutorial-text')?.after(demoEl);
    }

    if (!this._demoPlayer) {
      this._demoPlayer = new TutorialDemoPlayer(demoEl);
    }
    this._demoPlayer.start(s.demo);
  }
}

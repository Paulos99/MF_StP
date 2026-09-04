const MOBILE_MQ = '(max-width: 899px)';
const SPOTLIGHT_PAD = 10;
const LAYOUT_WAIT_MS = 80;

let activeTour = null;

function isMobileLayout() {
  return window.matchMedia(MOBILE_MQ).matches;
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function waitFrames(ms = LAYOUT_WAIT_MS) {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, ms);
    });
  });
}

function resolveTarget(selector) {
  if (!selector) return null;
  if (typeof selector === 'function') return selector();
  return document.querySelector(selector);
}

function readStorage(key) {
  if (!key) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  if (!key) return;
  try {
    localStorage.setItem(key, value);
  } catch { /* ignore */ }
}

/**
 * Spotlight guided tour engine (desktop floating card + mobile bottom sheet).
 */
export class GuidedTour {
  constructor() {
    this.root = null;
    this.spotlight = null;
    this.card = null;
    this.titleEl = null;
    this.textEl = null;
    this.stepEl = null;
    this.prevBtn = null;
    this.nextBtn = null;
    this.skipBtn = null;

    this.steps = [];
    this.stepIndex = 0;
    this.active = false;
    this.storageKey = null;
    this._wasSidebarOpen = false;
    this._onComplete = null;
    this._onSkip = null;
    this._boundKey = (e) => this._onKey(e);
    this._boundResize = () => this._onViewportChange();
    this._boundScroll = () => {
      if (this.active) this._position();
    };
    this._mq = window.matchMedia(MOBILE_MQ);
    this._boundMq = () => {
      if (this.active) this.skip({ silent: false });
    };

    this._ensureDom();
  }

  static getShared() {
    if (!GuidedTour._shared) GuidedTour._shared = new GuidedTour();
    return GuidedTour._shared;
  }

  isActive() {
    return this.active;
  }

  shouldAutoStart(storageKey) {
    return readStorage(storageKey) !== 'done';
  }

  markDone(storageKey = this.storageKey) {
    writeStorage(storageKey, 'done');
  }

  /**
   * @param {Array} steps
   * @param {{ force?: boolean, storageKey?: string, onComplete?: Function, onSkip?: Function, startIndex?: number }} opts
   */
  async start(steps, opts = {}) {
    const {
      force = false,
      storageKey = null,
      onComplete = null,
      onSkip = null,
      startIndex = 0,
    } = opts;

    if (!steps?.length) return false;
    if (!force && storageKey && !this.shouldAutoStart(storageKey)) return false;

    if (activeTour && activeTour !== this && activeTour.active) {
      activeTour.skip({ silent: true });
    }
    if (this.active) this.skip({ silent: true });

    this.steps = steps;
    this.storageKey = storageKey;
    this._onComplete = onComplete;
    this._onSkip = onSkip;
    this.stepIndex = Math.max(0, Math.min(startIndex, steps.length - 1));
    this._wasSidebarOpen = document.body.classList.contains('mobile-sidebar-open');
    this.active = true;
    activeTour = this;

    this.root.hidden = false;
    document.body.classList.add('tour-active');
    this._bindGlobal();
    await this._showStep(this.stepIndex);
    this.nextBtn?.focus?.({ preventScroll: true });
    return true;
  }

  async next() {
    if (!this.active) return;
    if (this.stepIndex >= this.steps.length - 1) {
      this.complete();
      return;
    }
    this.stepIndex += 1;
    await this._showStep(this.stepIndex);
  }

  async prev() {
    if (!this.active || this.stepIndex <= 0) return;
    this.stepIndex -= 1;
    await this._showStep(this.stepIndex);
  }

  skip({ silent = false } = {}) {
    if (!this.active && !silent) return;
    const wasActive = this.active;
    this._teardown();
    if (this.storageKey) this.markDone(this.storageKey);
    if (wasActive && !silent) this._onSkip?.();
  }

  complete() {
    if (!this.active) return;
    this._teardown();
    if (this.storageKey) this.markDone(this.storageKey);
    this._onComplete?.();
  }

  getCurrentStep() {
    return this.steps[this.stepIndex] || null;
  }

  _ensureDom() {
    let root = document.getElementById('guidedTourRoot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'guidedTourRoot';
      root.className = 'tour-root';
      root.hidden = true;
      root.innerHTML = `
        <div class="tour-spotlight" aria-hidden="true"></div>
        <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tourTitle">
          <div class="tour-card__body">
            <h3 class="tour-title" id="tourTitle" aria-live="polite"></h3>
            <p class="tour-text" id="tourText"></p>
          </div>
          <div class="tour-nav">
            <button type="button" class="tour-btn tour-btn--ghost tour-prev" aria-label="Назад">Назад</button>
            <span class="tour-step" id="tourStep"></span>
            <button type="button" class="tour-btn tour-btn--primary tour-next" aria-label="Далее">Далее</button>
          </div>
          <button type="button" class="tour-skip">Пропустить</button>
        </div>
      `;
      document.body.appendChild(root);
    }

    this.root = root;
    this.spotlight = root.querySelector('.tour-spotlight');
    this.card = root.querySelector('.tour-card');
    this.titleEl = root.querySelector('.tour-title');
    this.textEl = root.querySelector('.tour-text');
    this.stepEl = root.querySelector('.tour-step');
    this.prevBtn = root.querySelector('.tour-prev');
    this.nextBtn = root.querySelector('.tour-next');
    this.skipBtn = root.querySelector('.tour-skip');

    this.prevBtn.onclick = () => this.prev();
    this.nextBtn.onclick = () => this.next();
    this.skipBtn.onclick = () => this.skip();
  }

  _bindGlobal() {
    document.addEventListener('keydown', this._boundKey);
    window.addEventListener('resize', this._boundResize);
    window.addEventListener('scroll', this._boundScroll, true);
    this._mq.addEventListener?.('change', this._boundMq);
  }

  _unbindGlobal() {
    document.removeEventListener('keydown', this._boundKey);
    window.removeEventListener('resize', this._boundResize);
    window.removeEventListener('scroll', this._boundScroll, true);
    this._mq.removeEventListener?.('change', this._boundMq);
  }

  _onKey(e) {
    if (!this.active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.skip();
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      if (e.target === this.prevBtn) return;
      e.preventDefault();
      this.next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.prev();
    }
  }

  _onViewportChange() {
    if (!this.active) return;
    this._position();
  }

  async _showStep(index) {
    const step = this.steps[index];
    if (!step) return;

    if (typeof step.beforeStep === 'function') {
      await step.beforeStep(step, { isMobile: isMobileLayout() });
      await waitFrames();
    }

    const mobile = isMobileLayout();
    const title = step.title || '';
    const text = mobile && step.textMobile ? step.textMobile : (step.text || '');

    this.titleEl.textContent = title;
    this.textEl.textContent = text;
    this.stepEl.textContent = `${index + 1} / ${this.steps.length}`;
    this.prevBtn.disabled = index === 0;
    this.nextBtn.textContent = index >= this.steps.length - 1 ? 'Понятно' : 'Далее';
    this.nextBtn.setAttribute('aria-label', this.nextBtn.textContent);

    this.card.classList.toggle('tour-card--sheet', mobile);
    this.card.classList.toggle('tour-card--above-footer', Boolean(step.aboveFooter && mobile));

    const target = resolveTarget(step.target);
    if (target && typeof target.scrollIntoView === 'function') {
      try {
        target.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: step.scrollBlock || 'nearest',
          inline: 'nearest',
        });
        await waitFrames(prefersReducedMotion() ? 40 : 220);
      } catch { /* ignore */ }
    }

    this._position(target, step);
  }

  _position(target = null, step = null) {
    if (!this.active) return;
    step = step || this.getCurrentStep();
    if (!target) target = resolveTarget(step?.target);

    const mobile = isMobileLayout();
    this.card.classList.toggle('tour-card--sheet', mobile);
    this.card.classList.toggle('tour-card--above-footer', Boolean(step?.aboveFooter && mobile));

    if (!target || !target.getBoundingClientRect) {
      this.spotlight.classList.add('is-hidden');
      this.spotlight.style.cssText = '';
      if (!mobile) {
        this.card.style.left = '50%';
        this.card.style.top = '50%';
        this.card.style.right = 'auto';
        this.card.style.bottom = 'auto';
        this.card.style.transform = 'translate(-50%, -50%)';
      } else {
        this.card.style.left = '';
        this.card.style.top = '';
        this.card.style.right = '';
        this.card.style.bottom = '';
        this.card.style.transform = '';
      }
      return;
    }

    const rect = target.getBoundingClientRect();
    const pad = step?.pad ?? SPOTLIGHT_PAD;
    const top = Math.max(8, rect.top - pad);
    const left = Math.max(8, rect.left - pad);
    const width = Math.min(window.innerWidth - left - 8, rect.width + pad * 2);
    const height = Math.min(window.innerHeight - top - 8, rect.height + pad * 2);
    const radius = step?.radius ?? 12;

    this.spotlight.classList.remove('is-hidden');
    this.spotlight.style.top = `${top}px`;
    this.spotlight.style.left = `${left}px`;
    this.spotlight.style.width = `${Math.max(24, width)}px`;
    this.spotlight.style.height = `${Math.max(24, height)}px`;
    this.spotlight.style.borderRadius = `${radius}px`;

    if (mobile) {
      this.card.style.left = '';
      this.card.style.top = '';
      this.card.style.right = '';
      this.card.style.bottom = '';
      this.card.style.transform = '';
      return;
    }

    this._placeDesktopCard(rect, pad);
  }

  _placeDesktopCard(rect, pad) {
    const card = this.card;
    card.style.transform = 'none';
    const gap = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardW = Math.min(360, vw - 32);
    card.style.width = `${cardW}px`;

    // Measure after width set
    const ch = card.offsetHeight || 180;
    const spaceBelow = vh - (rect.bottom + pad);
    const spaceAbove = rect.top - pad;

    let top;
    let left = Math.min(Math.max(16, rect.left + rect.width / 2 - cardW / 2), vw - cardW - 16);

    if (spaceBelow >= ch + gap || spaceBelow >= spaceAbove) {
      top = Math.min(rect.bottom + pad + gap, vh - ch - 16);
    } else {
      top = Math.max(16, rect.top - pad - gap - ch);
    }

    // If still overlapping heavily, park to the right/left
    const overlaps =
      top < rect.bottom + pad &&
      top + ch > rect.top - pad &&
      left < rect.right + pad &&
      left + cardW > rect.left - pad;

    if (overlaps) {
      if (vw - rect.right - gap - 16 >= cardW) {
        left = rect.right + gap;
        top = Math.min(Math.max(16, rect.top), vh - ch - 16);
      } else if (rect.left - gap - 16 >= cardW) {
        left = rect.left - gap - cardW;
        top = Math.min(Math.max(16, rect.top), vh - ch - 16);
      }
    }

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.right = 'auto';
    card.style.bottom = 'auto';
  }

  _restoreSidebar() {
    if (!isMobileLayout()) return;
    if (this._wasSidebarOpen) {
      document.body.classList.add('mobile-sidebar-open');
    } else {
      document.body.classList.remove('mobile-sidebar-open');
    }
  }

  _teardown() {
    this.active = false;
    if (activeTour === this) activeTour = null;
    this.root.hidden = true;
    document.body.classList.remove('tour-active');
    this.spotlight.classList.add('is-hidden');
    this._unbindGlobal();
    this._restoreSidebar();
    this.steps = [];
    this.stepIndex = 0;
  }
}

export function openMobileSidebar() {
  document.body.classList.add('mobile-sidebar-open');
}

export function closeMobileSidebar() {
  document.body.classList.remove('mobile-sidebar-open');
}

export { isMobileLayout as tourIsMobileLayout };

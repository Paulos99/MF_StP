const MOBILE_MQ = '(max-width: 899px)';
const SPOTLIGHT_PAD = 10;
const LAYOUT_WAIT_MS = 80;
const CARD_MOVE_MS = 620;
const CARD_STICKY_SLACK = 12;

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

function rectsOverlap(a, b, slack = 0) {
  return !(
    a.left + a.width + slack <= b.left
    || b.left + b.width + slack <= a.left
    || a.top + a.height + slack <= b.top
    || b.top + b.height + slack <= a.top
  );
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function resolveTarget(selector) {
  if (!selector) return null;
  if (typeof selector === 'function') return selector();
  if (selector instanceof Element) return selector;
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
    this.blocker = null;
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
    this.demoMode = false;
    this._wasSidebarOpen = false;
    this._onComplete = null;
    this._onSkip = null;
    this._cardPos = null;
    this._cardLocked = false;
    this._boundKey = (e) => this._onKey(e);
    this._boundResize = () => this._onViewportChange();
    this._boundScroll = () => {
      if (!this.active) return;
      // Sticky re-place: only nudge card if it now covers the spotlight target
      this._position(this._spotlightTarget, {
        ...(this._spotlightOpts || {}),
        sticky: true,
      });
    };
    this._mq = window.matchMedia(MOBILE_MQ);
    this._boundMq = () => {
      if (this.active && !this.demoMode) this.skip({ silent: false });
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
   * @param {{ force?: boolean, storageKey?: string, onComplete?: Function, onSkip?: Function, startIndex?: number, demoMode?: boolean }} opts
   */
  async start(steps, opts = {}) {
    const {
      force = false,
      storageKey = null,
      onComplete = null,
      onSkip = null,
      startIndex = 0,
      demoMode = false,
    } = opts;

    if (!steps?.length && !demoMode) return false;
    if (!force && storageKey && !this.shouldAutoStart(storageKey)) return false;

    if (activeTour && activeTour !== this && activeTour.active) {
      activeTour.skip({ silent: true });
    }
    if (this.active) this.skip({ silent: true });

    this.steps = steps || [];
    this.storageKey = storageKey;
    this._onComplete = onComplete;
    this._onSkip = onSkip;
    this.demoMode = demoMode;
    this.stepIndex = Math.max(0, Math.min(startIndex, Math.max(0, this.steps.length - 1)));
    this._wasSidebarOpen = document.body.classList.contains('mobile-sidebar-open');
    this.active = true;
    activeTour = this;
    this._cardPos = null;
    this._cardLocked = false;
    this._spotlightTarget = null;
    this._spotlightOpts = null;

    this.root.hidden = false;
    document.body.classList.add('tour-active');
    document.body.classList.toggle('tour-demo-playing', demoMode);
    this.blocker.hidden = !demoMode;
    // Demo: user advances with Далее; hide Back
    this.prevBtn.hidden = demoMode;
    this.nextBtn.hidden = false;
    this.stepEl.hidden = false;
    this._bindGlobal();

    if (!demoMode && this.steps.length) {
      await this._showStep(this.stepIndex);
      this.nextBtn?.focus?.({ preventScroll: true });
    }
    return true;
  }

  /** Update narration while demo plays — card/spotlight move smoothly. */
  async narrate({
    title = '',
    text = '',
    textMobile = '',
    target = null,
    pad,
    radius,
    aboveFooter = false,
    scrollBlock = 'nearest',
    stepLabel = '',
    forceCard = false,
    skipScroll = false,
  } = {}) {
    if (!this.active) return;
    const mobile = isMobileLayout();
    const body = mobile && textMobile ? textMobile : text;

    this.card.classList.add('is-updating');
    await waitFrames(prefersReducedMotion() ? 0 : 90);
    this.titleEl.textContent = title;
    this.textEl.textContent = body;
    if (stepLabel) {
      this.stepEl.hidden = false;
      this.stepEl.textContent = stepLabel;
    }
    this.card.classList.remove('is-updating');

    this.card.classList.toggle('tour-card--sheet', mobile);
    this.card.classList.toggle('tour-card--above-footer', Boolean(aboveFooter && mobile));

    const el = resolveTarget(target);
    this._spotlightTarget = el;
    this._spotlightOpts = { pad, radius, aboveFooter };

    // Spotlight/card first — grey frame must appear immediately
    this._position(el, { pad, radius, aboveFooter, sticky: !forceCard, snap: forceCard });

    if (el?.scrollIntoView && !skipScroll) {
      try {
        el.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: scrollBlock,
          inline: 'nearest',
        });
        await waitFrames(prefersReducedMotion() ? 40 : 240);
        // Re-measure after scroll; keep card if still clear
        this._position(el, { pad, radius, aboveFooter, sticky: true });
      } catch { /* ignore */ }
    }

    await waitFrames(prefersReducedMotion() ? 40 : (forceCard ? CARD_MOVE_MS : 180));
  }

  /** @deprecated kept for callers; sticky placement replaces hard lock */
  lockCard() {}

  unlockCard() {
    this._cardLocked = false;
  }

  /** Change title/text only — no spotlight/card jump. */
  setCopy({ title, text, textMobile, stepLabel } = {}) {
    if (!this.active) return;
    const mobile = isMobileLayout();
    const body = mobile && textMobile ? textMobile : text;
    if (title != null) this.titleEl.textContent = title;
    if (body != null) this.textEl.textContent = body;
    if (stepLabel) {
      this.stepEl.hidden = false;
      this.stepEl.textContent = stepLabel;
    }
  }

  /** Re-measure spotlight; nudge card only if it covers the target. */
  refreshSpotlight(target, opts = {}) {
    if (!this.active) return;
    const el = resolveTarget(target);
    if (!el?.getBoundingClientRect) return;
    this._spotlightTarget = el;
    this._spotlightOpts = opts;
    this._position(el, {
      pad: opts.pad,
      radius: opts.radius,
      aboveFooter: opts.aboveFooter,
      sticky: opts.sticky !== false,
    });
  }

  async next() {
    if (!this.active || this.demoMode) return;
    if (this.stepIndex >= this.steps.length - 1) {
      this.complete();
      return;
    }
    this.stepIndex += 1;
    await this._showStep(this.stepIndex);
  }

  async prev() {
    if (!this.active || this.demoMode || this.stepIndex <= 0) return;
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
        <div class="tour-blocker" hidden aria-hidden="true"></div>
        <div class="tour-spotlight is-hidden" aria-hidden="true"></div>
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
    } else if (!root.querySelector('.tour-blocker')) {
      const blocker = document.createElement('div');
      blocker.className = 'tour-blocker';
      blocker.hidden = true;
      blocker.setAttribute('aria-hidden', 'true');
      root.insertBefore(blocker, root.firstChild);
    }

    this.root = root;
    this.blocker = root.querySelector('.tour-blocker');
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
      if (this.demoMode) this.nextBtn?.click();
      else this.next();
    } else if (!this.demoMode && e.key === 'ArrowLeft') {
      e.preventDefault();
      this.prev();
    }
  }

  _onViewportChange() {
    if (!this.active) return;
    this._position(this._spotlightTarget, {
      ...(this._spotlightOpts || {}),
      sticky: true,
    });
  }

  async _showStep(index) {
    const step = this.steps[index];
    if (!step) return;

    if (typeof step.beforeStep === 'function') {
      await step.beforeStep(step, { isMobile: isMobileLayout() });
      await waitFrames();
    }

    await this.narrate({
      title: step.title || '',
      text: step.text || '',
      textMobile: step.textMobile || '',
      target: step.target,
      pad: step.pad,
      radius: step.radius,
      aboveFooter: step.aboveFooter,
      scrollBlock: step.scrollBlock || 'nearest',
      stepLabel: `${index + 1} / ${this.steps.length}`,
      forceCard: true,
    });

    this.prevBtn.disabled = index === 0;
    this.nextBtn.textContent = index >= this.steps.length - 1 ? 'Понятно' : 'Далее';
    this.nextBtn.setAttribute('aria-label', this.nextBtn.textContent);
    this.prevBtn.hidden = false;
    this.nextBtn.hidden = false;
    this.stepEl.hidden = false;
  }

  _position(target = null, step = null) {
    if (!this.active) return;
    step = step || {};
    if (!target) target = resolveTarget(step?.target) || this._spotlightTarget;

    const mobile = isMobileLayout();
    this.card.classList.toggle('tour-card--sheet', mobile);
    this.card.classList.toggle('tour-card--above-footer', Boolean(step?.aboveFooter && mobile));

    if (!target || !target.getBoundingClientRect) {
      this.spotlight.classList.add('is-hidden');
      if (!mobile) {
        this._setCardPos(window.innerWidth / 2 - 180, window.innerHeight * 0.18);
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
    if (step?.snap) {
      this.spotlight.classList.add('tour-spotlight--snap');
    }
    this.spotlight.style.top = `${top}px`;
    this.spotlight.style.left = `${left}px`;
    this.spotlight.style.width = `${Math.max(24, width)}px`;
    this.spotlight.style.height = `${Math.max(24, height)}px`;
    this.spotlight.style.borderRadius = `${radius}px`;
    if (step?.snap) {
      void this.spotlight.offsetWidth;
      this.spotlight.classList.remove('tour-spotlight--snap');
    }

    if (mobile) {
      this.card.style.left = '';
      this.card.style.top = '';
      this.card.style.right = '';
      this.card.style.bottom = '';
      this.card.style.transform = '';
      return;
    }

    this._placeDesktopCard(rect, pad, { sticky: Boolean(step?.sticky) });
  }

  _placeDesktopCard(rect, pad, { sticky = false } = {}) {
    const card = this.card;
    const gap = 20;
    const margin = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardW = Math.min(360, vw - margin * 2);
    card.style.width = `${cardW}px`;
    const ch = card.offsetHeight || 168;

    const avoid = {
      left: rect.left - pad,
      top: rect.top - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    };

    const current = this._cardPos
      ? { left: this._cardPos.left, top: this._cardPos.top, width: cardW, height: ch }
      : null;

    // Stay put if sticky and current slot still clears the spotlight target
    if (sticky && current) {
      const inView =
        current.left >= margin - 2
        && current.top >= margin - 2
        && current.left + current.width <= vw - margin + 2
        && current.top + current.height <= vh - margin + 2;
      if (inView && !rectsOverlap(current, avoid, CARD_STICKY_SLACK)) {
        return;
      }
    }

    const largeTarget = rect.width > vw * 0.42 || rect.height > vh * 0.38;
    const candidates = [];

    const push = (left, top, bias = 0) => {
      candidates.push({
        left: clamp(left, margin, vw - cardW - margin),
        top: clamp(top, margin, vh - ch - margin),
        bias,
      });
    };

    // Prefer sides / corners for large canvases so the demo stays visible
    if (largeTarget) {
      push(rect.right + gap, rect.top, 40);
      push(rect.left - gap - cardW, rect.top, 40);
      push(vw - cardW - margin, 72, 55);
      push(margin, 72, 50);
      push(vw - cardW - margin, vh - ch - 88, 45);
      push(margin, vh - ch - 88, 40);
    } else {
      push(rect.left + rect.width / 2 - cardW / 2, rect.bottom + pad + gap, 30);
      push(rect.left + rect.width / 2 - cardW / 2, rect.top - pad - gap - ch, 25);
      push(rect.right + gap, rect.top, 35);
      push(rect.left - gap - cardW, rect.top, 35);
      push(vw - cardW - margin, 72, 20);
      push(margin, 72, 15);
    }

    let best = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      const box = { left: c.left, top: c.top, width: cardW, height: ch };
      let score = c.bias;
      if (rectsOverlap(box, avoid, 4)) score -= 8000;
      // Prefer staying near the current card — less “flying”
      if (current) {
        const dist = Math.hypot(c.left - current.left, c.top - current.top);
        score -= dist * 0.35;
      }
      // Mild preference to stay near the target (readable pairing)
      const tcx = rect.left + rect.width / 2;
      const tcy = rect.top + rect.height / 2;
      const ccx = c.left + cardW / 2;
      const ccy = c.top + ch / 2;
      score -= Math.hypot(ccx - tcx, ccy - tcy) * 0.08;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    if (!best) {
      best = { left: vw - cardW - margin, top: 72 };
    }

    // Ignore tiny nudges while sticky
    if (sticky && current) {
      const dist = Math.hypot(best.left - current.left, best.top - current.top);
      if (dist < 28 && !rectsOverlap(current, avoid, CARD_STICKY_SLACK)) {
        return;
      }
    }

    this._setCardPos(best.left, best.top);
  }

  _setCardPos(left, top) {
    const card = this.card;
    card.style.right = 'auto';
    card.style.bottom = 'auto';
    card.style.transform = 'none';

    // First placement: set without transition jump from 0,0
    if (!this._cardPos) {
      card.classList.add('tour-card--no-motion');
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      void card.offsetWidth;
      card.classList.remove('tour-card--no-motion');
    } else {
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
    }
    this._cardPos = { left, top };
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
    document.body.classList.remove('tour-active', 'tour-demo-playing');
    this.spotlight.classList.add('is-hidden');
    if (this.blocker) this.blocker.hidden = true;
    this._unbindGlobal();
    this._restoreSidebar();
    this.steps = [];
    this.stepIndex = 0;
    this.demoMode = false;
    this._cardPos = null;
    this._cardLocked = false;
    this._spotlightTarget = null;
    this._spotlightOpts = null;
  }
}

export function openMobileSidebar() {
  document.body.classList.add('mobile-sidebar-open');
}

export function closeMobileSidebar() {
  document.body.classList.remove('mobile-sidebar-open');
}

export { isMobileLayout as tourIsMobileLayout };

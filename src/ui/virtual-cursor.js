function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Animated virtual cursor for onboarding demos.
 */
export class VirtualCursor {
  constructor(parent = document.body) {
    this.parent = parent;
    this.el = null;
    this.ripple = null;
    this.x = window.innerWidth * 0.55;
    this.y = window.innerHeight * 0.4;
    this._moving = null;
    this._ensure();
  }

  _ensure() {
    if (this.el) return;
    const el = document.createElement('div');
    el.className = 'tour-cursor';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `
      <svg class="tour-cursor__svg" viewBox="0 0 24 24" width="28" height="28">
        <path fill="currentColor" d="M5.5 2.5v18.2l4.4-4.3 2.6 6.3 2.3-.9-2.6-6.2H18L5.5 2.5z"/>
      </svg>
      <span class="tour-cursor__ripple"></span>
    `;
    this.parent.appendChild(el);
    this.el = el;
    this.ripple = el.querySelector('.tour-cursor__ripple');
    this._applyPos(true);
  }

  show() {
    this._ensure();
    this.el.classList.add('is-visible');
  }

  hide() {
    this.el?.classList.remove('is-visible', 'is-pressing');
  }

  destroy() {
    if (this._moving) cancelAnimationFrame(this._moving);
    this._moving = null;
    this.el?.remove();
    this.el = null;
  }

  _applyPos(instant = false) {
    if (!this.el) return;
    if (instant) this.el.style.transition = 'none';
    this.el.style.transform = `translate(${this.x}px, ${this.y}px)`;
    if (instant) {
      void this.el.offsetWidth;
      this.el.style.transition = '';
    }
  }

  async moveTo(target, { duration = 1400 } = {}) {
    this.show();
    const point = target instanceof Element ? centerOf(target) : target;
    if (!point || Number.isNaN(point.x)) return;

    if (prefersReducedMotion()) {
      this.x = point.x;
      this.y = point.y;
      this._applyPos(true);
      return;
    }

    if (this._moving) cancelAnimationFrame(this._moving);

    const fromX = this.x;
    const fromY = this.y;
    const dist = Math.hypot(point.x - fromX, point.y - fromY);
    // Prefer requested duration so demos stay readable; scale up a bit for long paths.
    const ms = Math.max(duration, 720 + dist * 1.15);

    await new Promise((resolve) => {
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / ms);
        const e = easeInOutCubic(t);
        this.x = fromX + (point.x - fromX) * e;
        this.y = fromY + (point.y - fromY) * e;
        this._applyPos(true);
        if (t < 1) {
          this._moving = requestAnimationFrame(tick);
        } else {
          this._moving = null;
          resolve();
        }
      };
      this._moving = requestAnimationFrame(tick);
    });
  }

  async click(target, moveOpts) {
    if (target instanceof Element || (target && typeof target.x === 'number')) {
      await this.moveTo(target, moveOpts);
    }
    await sleep(160);
    this.el?.classList.add('is-pressing');
    this.ripple?.classList.remove('is-burst');
    void this.ripple?.offsetWidth;
    this.ripple?.classList.add('is-burst');
    await sleep(260);
    if (target instanceof Element) {
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      target.click();
    }
    await sleep(320);
    this.el?.classList.remove('is-pressing');
  }
}

export function sleep(ms) {
  if (prefersReducedMotion()) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitFor(ms, { signal } = {}) {
  if (prefersReducedMotion()) return;
  await new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });
}

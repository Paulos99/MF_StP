import { roundMeters } from '../core/geometry.js';
import { formatMetersDisplay } from '../core/polygon-geometry.js';

export class SketchKeypad {
  constructor(container, { onConfirm, onCancel } = {}) {
    this.container = container;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.value = '';
    this.label = '';
    this._build();
  }

  _build() {
    this.container.innerHTML = `
      <div class="sketch-keypad">
        <div class="sketch-keypad__label"></div>
        <div class="sketch-keypad__display">0</div>
        <div class="sketch-keypad__grid">
          ${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '.'].map((d) =>
            `<button type="button" class="sketch-keypad__key" data-key="${d}">${d}</button>`
          ).join('')}
          <button type="button" class="sketch-keypad__key sketch-keypad__key--ok" data-key="ok">✓</button>
        </div>
      </div>`;
    this.labelEl = this.container.querySelector('.sketch-keypad__label');
    this.displayEl = this.container.querySelector('.sketch-keypad__display');
    this.container.querySelectorAll('.sketch-keypad__key').forEach((btn) => {
      btn.addEventListener('click', () => this._handleKey(btn.dataset.key));
    });
    this.container.hidden = true;
  }

  show(label, initial = '') {
    this.label = label;
    this.value = initial ? String(initial) : '';
    this.labelEl.textContent = label;
    this._updateDisplay();
    this.container.hidden = false;
  }

  hide() {
    this.container.hidden = true;
    this.value = '';
  }

  _updateDisplay() {
    this.displayEl.textContent = this.value || '0';
  }

  _handleKey(key) {
    if (key === 'ok') {
      const num = parseFloat(this.value.replace(',', '.'));
      if (Number.isFinite(num) && num > 0) {
        this.onConfirm?.(roundMeters(num));
      }
      return;
    }
    if (key === 'C') {
      this.value = '';
      this._updateDisplay();
      return;
    }
    if (key === '.' && this.value.includes('.')) return;
    if (this.value.length >= 8) return;
    this.value += key;
    this._updateDisplay();
  }
}

export function buildEdgeDimensionsFromVertices(vertices) {
  const dims = {};
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    dims[i] = roundMeters(Math.hypot(b.x - a.x, b.y - a.y));
  }
  return dims;
}

export function formatEdgeLabel(index, labelA, labelB) {
  return `Сторона ${labelA}${labelB}`;
}

export function formatDiagonalLabel(labelA, labelB) {
  return `Диагональ ${labelA}–${labelB}`;
}

export { formatMetersDisplay };

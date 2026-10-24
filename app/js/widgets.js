// The app's small FF8 pieces, shared by the screens: category chips and gems, gauges, the keypad.

import { el } from './ui.js';
import { accentFor } from './palette.js';
import { onLongPress } from './presses.js';

// A category name with its color gem. Used by the main screen's strip and the category grid.
export function categoryChip(category, { selected = false } = {}) {
  const chip = el('button', { type: 'button', className: `chip${selected ? ' selected' : ''}` }, el('span', { textContent: category.name }));
  chip.dataset.id = category.id;
  chip.style.setProperty('--c', category.color);
  chip.style.setProperty('--c2', accentFor(category.color));
  return chip;
}

// A small FF8 item gem in a category's color, with its accent as the glint.
export function colorDot(color) {
  const dot = el('span', { className: 'dot' });
  dot.style.setProperty('--c', color);
  dot.style.setProperty('--c2', accentFor(color));
  return dot;
}

// An FF8-style gauge filled to `fraction` (0–1) in `color`, with the fraction out of 1000 under its
// right end, as on FF8's GF Compatibility bars.
export function gauge(fraction, color) {
  const share = Math.max(0, Math.min(1, fraction));
  const fill = el('span');
  fill.style.width = `${share * 100}%`;
  fill.style.setProperty('--c', color);
  return el('span', { className: 'gauge' },
    el('span', { className: 'bar' }, fill),
    el('span', { className: 'number', textContent: String(Math.round(share * 1000)) }));
}

// Digits-only keypad. Amounts are built from the digit string, so there is no "." key:
// for dollars the last two digits are cents. Hold ⌫ to clear.
export function keypad(getDigits, onChange, getMaxDigits) {
  const pad = el('div', { className: 'keypad' });
  for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫']) {
    const button = el('button', { type: 'button', className: 'key', textContent: key });
    if (key === '⌫') {
      button.setAttribute('aria-label', 'Delete');
      button.addEventListener('click', () => onChange(getDigits().slice(0, -1)));
      onLongPress(button, () => onChange(''));
    } else {
      button.addEventListener('click', () => {
        const next = (getDigits() + key).replace(/^0+/, '');
        if (next.length <= getMaxDigits()) onChange(next);
      });
    }
    pad.append(button);
  }
  return pad;
}

// Small DOM helpers shared by every screen.

const $ = (id) => document.getElementById(id);

// Build an element: el('li', { className: 'row', 'aria-label': 'x' }, child, 'text', ...)
// Keys containing "-" become attributes; everything else is set as a property.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.includes('-')) node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children.filter((child) => child != null && child !== false));
  return node;
}

export function svg(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

export function formatDate(iso, options = { month: 'short', day: 'numeric' }) {
  return new Date(`${iso}T00:00`).toLocaleDateString('en-US', options);
}

// Black or white text, whichever reads better on the given color.
export function textOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#111111' : '#ffffff';
}

// A pill in the category's color. Used by the main screen's strip and the long-press grid.
export function categoryChip(category, { selected = false } = {}) {
  const chip = el('button', { type: 'button', className: `chip${selected ? ' selected' : ''}`, textContent: category.name });
  chip.dataset.id = category.id;
  chip.style.setProperty('--c', category.color);
  chip.style.setProperty('--chip-text', textOn(category.color));
  return chip;
}

export function colorDot(color) {
  const dot = el('span', { className: 'dot' });
  dot.style.background = color;
  return dot;
}

// Briefly shake an element to say "can't do that".
export function nudge(node) {
  node.classList.remove('nudge');
  void node.offsetWidth; // restart the animation
  node.classList.add('nudge');
}

// ---------- gestures ----------

// Stop the click the browser sends right after a gesture we already handled.
function swallowNextClick(node) {
  const stop = (event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  node.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => node.removeEventListener('click', stop, { capture: true }), 400);
}

export function onSwipe(node, handler) {
  let start = null;
  node.addEventListener('pointerdown', (event) => { start = { x: event.clientX, y: event.clientY }; });
  node.addEventListener('pointercancel', () => { start = null; });
  node.addEventListener('pointerup', (event) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      swallowNextClick(node);
      handler(dx < 0 ? 'left' : 'right');
    }
  });
}

export function onLongPress(node, handler, ms = 450) {
  let timer = null;
  let start = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  node.addEventListener('pointerdown', (event) => {
    start = { x: event.clientX, y: event.clientY };
    timer = setTimeout(() => {
      timer = null;
      swallowNextClick(node);
      handler();
    }, ms);
  });
  node.addEventListener('pointermove', (event) => {
    if (timer && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancel();
  });
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('contextmenu', (event) => event.preventDefault());
}

// ---------- keypad ----------

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

// ---------- overlays ----------

let toastTimer;

// Pass an undo function (as returned by the store's changes) to show an Undo button.
export function toast(message, undo) {
  const node = $('toast');
  const hide = () => node.classList.remove('show');
  const children = [el('span', { textContent: message })];
  if (undo) {
    const button = el('button', { textContent: 'Undo' });
    button.addEventListener('click', () => {
      hide();
      undo();
    });
    children.push(button);
  }
  node.replaceChildren(...children);
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, 4000);
}

export function openSheet(content, { dismissable = true } = {}) {
  $('sheet').replaceChildren(content);
  $('sheet').scrollTop = 0;
  const backdrop = $('sheet-backdrop');
  backdrop.classList.add('open');
  backdrop.onclick = dismissable ? (event) => { if (event.target === backdrop) closeSheet(); } : null;
}

export function closeSheet() {
  $('sheet-backdrop').classList.remove('open');
  document.activeElement?.blur();
}

// ---------- files ----------

// On iPhone the share sheet is the reliable way to save a file ("Save to Files", AirDrop, Mail).
// Returns false if the person cancelled, true otherwise.
export async function saveFile(filename, text, type) {
  const file = new File([text], filename, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(file);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

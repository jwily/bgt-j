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

// A category name with its color gem. Used by the main screen's strip and the category grid.
export function categoryChip(category, { selected = false } = {}) {
  const chip = el('button', { type: 'button', className: `chip${selected ? ' selected' : ''}` }, el('span', { textContent: category.name }));
  chip.dataset.id = category.id;
  chip.style.setProperty('--c', category.color);
  return chip;
}

// A small diamond in a category's color.
export function colorDot(color) {
  const dot = el('span', { className: 'dot' });
  dot.style.setProperty('--c', color);
  return dot;
}

// A rounded FF8-style gauge filled to `fraction` (0–1) in `color`.
export function gauge(fraction, color) {
  const fill = el('span');
  fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  fill.style.setProperty('--c', color);
  return el('span', { className: 'gauge' }, fill);
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
  // Once a drag is clearly sideways, keep receiving it even if it ends outside this element.
  // (Not on pointerdown: capturing then would steal plain taps from the buttons inside.)
  node.addEventListener('pointermove', (event) => {
    if (start && !node.hasPointerCapture(event.pointerId) && Math.abs(event.clientX - start.x) > 10) {
      node.setPointerCapture(event.pointerId);
    }
  });
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

// Two taps close together in time and place. Taps that scroll (a swipe) aren't clicks, so they
// don't count.
export function onDoubleTap(node, handler, ms = 350) {
  let last = null;
  node.addEventListener('click', (event) => {
    const tap = { at: event.timeStamp, x: event.clientX, y: event.clientY };
    if (last && tap.at - last.at < ms && Math.hypot(tap.x - last.x, tap.y - last.y) < 40) {
      last = null;
      handler();
    } else {
      last = tap;
    }
  });
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

// ---------- help window ----------
// The HELP window at the top shows the current screen's help line. toast() borrows it for a few
// seconds to show a message, then the help line comes back.

let helpLine = { text: '', tone: '', onTap: null };
let toastTimer = null;

function showHelpLine() {
  const node = $('help');
  node.className = `window help${helpLine.tone ? ` ${helpLine.tone}` : ''}${helpLine.onTap ? ' tappable' : ''}`;
  node.onclick = helpLine.onTap;
  node.replaceChildren(el('span', { textContent: helpLine.text }));
}

// tone: '' or 'bad'. onTap: optional action when the help window is tapped.
export function setHelp(text, { tone = '', onTap = null } = {}) {
  helpLine = { text, tone, onTap };
  if (!toastTimer) showHelpLine();
}

// Pass an undo function (as returned by the store's changes) to show an Undo button. The message
// shows in the HELP window; Undo appears at the bottom, beside the Menu/Back button.
export function toast(message, undo) {
  const node = $('help');
  const undoButton = $('undo-btn');
  const end = () => {
    clearTimeout(toastTimer);
    toastTimer = null;
    undoButton.hidden = true;
    undoButton.onclick = null;
    showHelpLine();
  };
  undoButton.hidden = !undo;
  undoButton.onclick = undo ? () => {
    end();
    undo();
  } : null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(end, 4000);
  node.className = 'window help message';
  node.onclick = null;
  node.replaceChildren(el('span', { textContent: message }));
}

// ---------- sheets ----------

// label: the small tab on the sheet's top edge, like FF8's "HELP" / "STATUS" tabs.
// anchor: optional element. The sheet then opens with its top edge level with the anchor's top
// (moving up only as far as it must to stay on screen) instead of at the bottom of the screen.
export function openSheet(content, { dismissable = true, label = '', anchor = null } = {}) {
  const sheet = $('sheet');
  sheet.dataset.label = label;
  sheet.replaceChildren(content);
  sheet.scrollTop = 0;
  sheet.classList.toggle('anchored', Boolean(anchor));
  sheet.style.top = '';
  sheet.style.bottom = '';
  if (anchor) {
    const margin = 8;
    const lowestTop = window.innerHeight - sheet.offsetHeight - margin;
    sheet.style.top = `${Math.max(margin, Math.min(anchor.getBoundingClientRect().top, lowestTop))}px`;
    sheet.style.bottom = 'auto';
  }
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

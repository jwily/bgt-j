// Small DOM helpers shared by every screen.

import { accentFor } from './store.js';

export const $ = (id) => document.getElementById(id);

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
  chip.style.setProperty('--c2', accentFor(category.color));
  return chip;
}

// A small diamond in a category's color, with its accent at the core.
export function colorDot(color) {
  const dot = el('span', { className: 'dot' });
  dot.style.setProperty('--c', color);
  dot.style.setProperty('--c2', accentFor(color));
  return dot;
}

// An FF8-style gauge filled to `fraction` (0–1) in `color`, with the fraction out of 100 under its
// right end, as on FF8's GF Compatibility bars.
export function gauge(fraction, color) {
  const share = Math.max(0, Math.min(1, fraction));
  const fill = el('span');
  fill.style.width = `${share * 100}%`;
  fill.style.setProperty('--c', color);
  return el('span', { className: 'gauge' },
    el('span', { className: 'bar' }, fill),
    el('span', { className: 'number', textContent: String(Math.round(share * 100)) }));
}

// Briefly shake an element to say "can't do that".
export function nudge(node) {
  node.classList.remove('nudge');
  void node.offsetWidth; // restart the animation
  node.classList.add('nudge');
}

// ---------- gestures ----------

// Press and hold: ⌫ to clear, the category strip for its grid.
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
      dropClickOn(node); // the click that follows the hold isn't also a tap
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

// Presses, app-wide: a press that slides off its button before lifting doesn't count (iOS would
// otherwise still tap it). In the menu, a press can slide between commands: the hand follows the
// thumb, and lifting opens the command under it. Each finger is tracked on its own, so overlapping
// taps (the next finger landing before the last lifts, as in fast typing) don't cancel each other.
const PRESSABLE = 'button, [role=button], .date-btn, label.wide-btn';

// Watches the clicks that follow a press for `ms`, until `onClick(event)` returns true; then, if it
// never did, calls `onTimeout`.
function watchClicks(ms, onClick, onTimeout = () => {}) {
  let done = false;
  const finish = () => {
    done = true;
    document.removeEventListener('click', listener, { capture: true });
  };
  const listener = (event) => { if (onClick(event)) finish(); };
  document.addEventListener('click', listener, { capture: true });
  setTimeout(() => {
    if (done) return;
    finish();
    onTimeout();
  }, ms);
}
const stopClick = (event) => {
  event.stopPropagation();
  event.preventDefault();
};

// Ignores the click the browser may send to `button` right after a press we cancelled or a gesture
// we already handled; only that button's, so another finger's tap is never caught.
function dropClickOn(button) {
  watchClicks(400, (event) => {
    if (!button.contains(event.target)) return false;
    stopClick(event);
    return true;
  });
}

// Opens the menu command under the thumb when a press lifts (none if it lifted off the commands).
// The browser's own click goes to the command the press started on, or to nothing: iOS sends none
// once the thumb has strayed far enough, even if it came back. So wait for it briefly: let it
// through if it's on the right command, otherwise stop it and click the right one ourselves.
function openOnRelease(menu, command) {
  watchClicks(100, (event) => {
    if (!menu.contains(event.target)) return false;
    if (!command?.contains(event.target)) {
      stopClick(event);
      command?.click();
    }
    return true;
  }, () => command?.click());
}

export function trackPresses() {
  const presses = new Map(); // pointerId -> { target, menu }
  const commandAt = (event) => document.elementFromPoint(event.clientX, event.clientY)?.closest('.menu-list button') ?? null;
  const pointAt = (command) => {
    for (const button of document.querySelectorAll('.menu-list button')) button.classList.toggle('hover', button === command);
  };
  document.addEventListener('pointerdown', (event) => {
    const target = event.target.closest?.(PRESSABLE);
    if (!target || target.disabled) return;
    const menu = target.closest('.menu-list');
    presses.set(event.pointerId, { target, menu });
    if (menu) pointAt(target);
  }, { capture: true });
  document.addEventListener('pointermove', (event) => {
    if (presses.get(event.pointerId)?.menu) pointAt(commandAt(event));
  }, { capture: true });
  document.addEventListener('pointerup', (event) => {
    const press = presses.get(event.pointerId);
    if (!press) return;
    presses.delete(event.pointerId);
    const { target, menu } = press;
    if (menu) {
      pointAt(null);
      openOnRelease(menu, commandAt(event));
      return;
    }
    if (!target.contains(document.elementFromPoint(event.clientX, event.clientY))) dropClickOn(target);
  }, { capture: true });
  document.addEventListener('pointercancel', (event) => {
    presses.delete(event.pointerId);
    pointAt(null);
  }, { capture: true });
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

// ---------- on-screen keyboard ----------
// iOS lays the keyboard over the page without resizing it, so a field near the bottom of a screen
// can end up hidden behind it, with nothing below to scroll it up by. While the keyboard is open,
// --keyboard holds its height (screens make that much room at their bottom) and the focused field
// is scrolled to sit just above it. When the keyboard closes, that room isn't dropped at once: a
// screen scrolled into it would snap down by the keyboard's height as iOS slides the keyboard
// away, which flashes. The screen glides to where it will rest first, then the room goes.
export function keepFieldsAboveKeyboard() {
  const view = window.visualViewport;
  if (!view) return;
  let room = 0; // the keyboard height screens currently make room for
  let dropRoom = null;
  const setRoom = (height) => {
    clearTimeout(dropRoom);
    room = height;
    document.documentElement.style.setProperty('--keyboard', `${height}px`);
  };
  const update = () => {
    const keyboard = Math.max(0, Math.round(window.innerHeight - view.height));
    if (keyboard < room) {
      const screen = $('page');
      const dock = document.querySelector('.dock').offsetHeight; // screens keep at least the bottom bar's height of room
      const shrink = Math.max(room, dock) - Math.max(keyboard, dock);
      const rest = Math.max(0, screen.scrollHeight - screen.clientHeight - shrink);
      if (!screen.hidden && screen.scrollTop > rest) screen.scrollTo({ top: rest, behavior: 'smooth' });
      clearTimeout(dropRoom);
      dropRoom = setTimeout(() => setRoom(keyboard), 350);
      return;
    }
    if (keyboard !== room) setRoom(keyboard);
    const field = document.activeElement;
    const scroller = field?.matches('input, textarea') && field.closest('.page');
    if (!keyboard || !scroller) return;
    const box = field.getBoundingClientRect();
    const visibleBottom = view.offsetTop + view.height - 16;
    if (box.bottom > visibleBottom) scroller.scrollTop += box.bottom - visibleBottom;
  };
  view.addEventListener('resize', update);
  view.addEventListener('scroll', update);
  document.addEventListener('focusin', () => requestAnimationFrame(update)); // moving between fields with the keyboard already open
}

// ---------- help window ----------
// The HELP window at the top shows the current screen's help line. toast() borrows it for a few
// seconds to show a message, then the help line comes back. On the main screen the help line is a
// status row instead (see statusRow).

let helpLine = { text: '', tone: '', onTap: null, status: null };
let toastTimer = null;

function showHelpLine() {
  const node = $('help');
  const { text, tone, onTap, status } = helpLine;
  node.className = `window help${tone ? ` ${tone}` : ''}${onTap ? ' tappable' : ''}${status ? ' status' : ''}`;
  node.onclick = onTap;
  if (status) {
    node.setAttribute('aria-label', text);
    node.replaceChildren(statusRow(status));
  } else {
    node.removeAttribute('aria-label');
    showHelpText(text);
  }
}

// After FF8's party status rows ("Lv 45  HP 1801", a thin red bar under the HP filled to the share
// left), without a label: level, hp (text), share (0–1, of the bar), hpTone ('', 'low' or 'over').
function statusRow({ level, hp, share, hpTone }) {
  const fill = el('span');
  fill.style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
  return el('span', { className: 'status-row', 'aria-hidden': 'true' },
    el('span', { className: 'stat' }, el('small', { textContent: 'Lv' }), el('b', { className: 'level', textContent: String(level) })),
    el('span', { className: `stat hp${hpTone ? ` ${hpTone}` : ''}` }, el('small', { textContent: 'HP' }), el('b', { textContent: hp }),
      el('span', { className: 'hp-bar' }, fill)));
}

// The HELP window shows one line. Text too long for it rests at the start, glides left until its
// end is in view, rests, and starts over. Returns how long one pass takes (0 if it fits).
const HELP_REST = 1200;  // ms at each end
const HELP_SPEED = 40;   // px per second, an easy reading pace
function showHelpText(text) {
  const line = el('span', { className: 'text', textContent: text });
  $('help').replaceChildren(el('span', { className: 'clip' }, line));
  return scrollHelpText();
}

function scrollHelpText() {
  const line = $('help').querySelector('.text');
  if (!line) return 0;
  const clip = line.parentElement;
  line.getAnimations().forEach((animation) => animation.cancel());
  const style = getComputedStyle(clip);
  const room = clip.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const overflow = line.scrollWidth - room;
  clip.classList.toggle('scrolling', overflow > 1);
  if (overflow <= 1) return 0;
  const glide = (overflow / HELP_SPEED) * 1000;
  const pass = HELP_REST + glide + HELP_REST;
  const end = `translateX(${-overflow}px)`;
  line.animate([
    { transform: 'translateX(0)', offset: 0 },
    { transform: 'translateX(0)', offset: HELP_REST / pass },
    { transform: end, offset: (HELP_REST + glide) / pass },
    { transform: end, offset: 1 },
  ], { duration: pass, iterations: Infinity });
  return pass;
}
// Measure again whenever the space for the text changes: the title window appearing beside HELP
// (just after a screen sets its help line), the screen's width, or the font finishing loading.
let helpWidth = 0;
new ResizeObserver(([entry]) => {
  if (Math.round(entry.contentRect.width) === helpWidth) return;
  helpWidth = Math.round(entry.contentRect.width);
  scrollHelpText();
}).observe($('help'));
document.fonts?.ready.then(scrollHelpText);

// tone: '' or 'bad'. onTap: optional action when the help window is tapped. status: show this
// status row (see statusRow) instead, with text as what it says aloud.
export function setHelp(text, { tone = '', onTap = null, status = null } = {}) {
  // Screens set their help line on every redraw; only redraw HELP when it changed, so a scrolling
  // line doesn't restart.
  const unchanged = text === helpLine.text && tone === helpLine.tone && onTap === helpLine.onTap
    && JSON.stringify(status) === JSON.stringify(helpLine.status);
  helpLine = { text, tone, onTap, status };
  if (!toastTimer && !unchanged) showHelpLine();
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
  node.className = 'window help message';
  node.onclick = null;
  node.removeAttribute('aria-label');
  const pass = showHelpText(message);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(end, Math.max(4000, pass + 500)); // long enough to read a long message once
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

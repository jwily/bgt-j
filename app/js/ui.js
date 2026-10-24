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

// Press and hold: ⌫ to clear, the category strip for its grid. The press is then used up, so its
// lift doesn't also tap.
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
      usePresses(node);
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

// ---------- presses ----------
// Every tap on the app's own controls is handled here, the same way for touch, pen and mouse: a
// press activates what it started on (by calling its click()) when it lifts still over it; in the
// menu, whichever command is under the thumb when it lifts, so a press can slide between them.
// The browser's own click for a press never counts: iOS decides by itself whether and where to send
// one (none once the thumb has strayed far, a late one after a gesture, the first command after a
// slide), so it's cancelled at the source (touchend, which also stops double-tap zoom) and stopped
// if it comes anyway; clicks from the keyboard or from code carry no click count, and go through.
// Fields and labels (NATIVE) are left to the browser: iOS needs its own tap to focus them and open
// their pickers. Each finger is tracked on its own, so overlapping taps (fast typing) each count. A
// drag the page takes over as a scroll cancels its press.
const PRESSABLE = 'button, [role=button], .tappable';
const NATIVE = 'input, textarea, select, label';
// Gaps between controls: a press landing in one goes to the nearest control within REACH, as iOS
// does for its own taps.
const GAPS = '.keypad, .dock, .actions, .details, .grid, .menu-list';
const REACH = 12; // px

const presses = new Map(); // pointerId -> { target, menu, used }

// A press held for a gesture (a long press) is used up: its lift doesn't also tap.
function usePresses(node) {
  for (const press of presses.values()) if (node.contains(press.target)) press.used = true;
}

// What a press at (x, y) landing on `hit` is for: the control it's on, else in a gap the nearest
// control within REACH, else what it landed on (a sheet's backdrop, say).
function pressTarget(hit, x, y) {
  const own = hit.closest(PRESSABLE);
  if (own || !hit.matches(GAPS)) return own ?? hit;
  let nearest = null;
  let best = REACH;
  for (const control of hit.querySelectorAll(PRESSABLE)) {
    const box = control.getBoundingClientRect();
    const distance = Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));
    if (distance <= best) {
      nearest = control;
      best = distance;
    }
  }
  return nearest ?? hit;
}

// As a native tap would: a field being typed in loses focus (closing the keyboard) when a control
// is pressed.
function activate(target) {
  if (!target || target.disabled) return;
  const field = document.activeElement;
  if (target.matches(PRESSABLE) && field?.matches('input, textarea') && !target.contains(field)) field.blur();
  target.click();
}

export function trackPresses() {
  const native = (node) => node?.closest?.(NATIVE);
  const commandAt = (event) => document.elementFromPoint(event.clientX, event.clientY)?.closest('.menu-list button') ?? null;
  const pointAt = (command) => {
    for (const button of document.querySelectorAll('.menu-list button')) button.classList.toggle('hover', button === command);
  };
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || native(event.target)) return;
    const target = pressTarget(event.target, event.clientX, event.clientY);
    const menu = target.closest('.menu-list');
    presses.set(event.pointerId, { target, menu, used: false });
    if (menu) pointAt(target.closest('.menu-list button'));
  }, { capture: true });
  document.addEventListener('pointermove', (event) => {
    if (presses.get(event.pointerId)?.menu) pointAt(commandAt(event));
  }, { capture: true });
  document.addEventListener('pointerup', (event) => {
    const press = presses.get(event.pointerId);
    if (!press) return;
    presses.delete(event.pointerId);
    if (press.menu) pointAt(null);
    if (press.used) return;
    if (press.menu) {
      activate(commandAt(event));
      return;
    }
    const over = document.elementFromPoint(event.clientX, event.clientY);
    if (over && pressTarget(over, event.clientX, event.clientY) === press.target) activate(press.target);
  }, { capture: true });
  document.addEventListener('pointercancel', (event) => {
    if (presses.get(event.pointerId)?.menu) pointAt(null);
    presses.delete(event.pointerId);
  }, { capture: true });
  // The browser's own click for a press: cancelled at the source, and stopped if it comes anyway.
  // A touch's end goes to the element it started on even if a tap has since redrawn it away, when
  // it no longer reaches the document, so it's cancelled on that element itself.
  const cancelling = new WeakSet();
  const cancelTouch = (event) => { if (event.cancelable) event.preventDefault(); };
  document.addEventListener('touchstart', (event) => {
    if (native(event.target) || cancelling.has(event.target)) return;
    cancelling.add(event.target);
    event.target.addEventListener('touchend', cancelTouch, { passive: false });
  }, { capture: true, passive: true });
  document.addEventListener('click', (event) => {
    if (event.detail > 0 && !native(event.target)) {
      event.stopPropagation();
      event.preventDefault();
    }
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

let helpLine = { text: '', onTap: null, status: null };
let toastTimer = null;

function showHelpLine() {
  const node = $('help');
  const { text, onTap, status } = helpLine;
  node.className = `window help${onTap ? ' tappable' : ''}${status ? ' status' : ''}`;
  node.dataset.label = status ? 'Status' : 'Help';
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
// left), in a window labelled STATUS like theirs: level, hp (text), share (0–1, of the bar), hpTone
// ('', 'low' or 'over').
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

// onTap: optional action when the help window is tapped. status: show this status row (see
// statusRow) instead, with text as what it says aloud.
export function setHelp(text, { onTap = null, status = null } = {}) {
  // Screens set their help line on every redraw; only redraw HELP when it changed, so a scrolling
  // line doesn't restart.
  const unchanged = text === helpLine.text && onTap === helpLine.onTap && JSON.stringify(status) === JSON.stringify(helpLine.status);
  helpLine = { text, onTap, status };
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
  node.dataset.label = 'Help';
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

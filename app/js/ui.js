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

// Press and hold (used by ⌫ to clear).
function onLongPress(node, handler, ms = 450) {
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

// Presses, app-wide: a press that slides off its button before lifting doesn't count (iOS would
// otherwise still tap it). In the menu, a press can slide between commands: the hand follows the
// thumb, and lifting opens the command under it.
const PRESSABLE = 'button, [role=button], .date-btn, label.wide-btn';
let stopClick = null; // drops the click that follows a cancelled press

function dropNextClick() {
  const stop = (event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  document.addEventListener('click', stop, { capture: true, once: true });
  const remove = () => document.removeEventListener('click', stop, { capture: true });
  setTimeout(remove, 400);
  return remove;
}

export function trackPresses() {
  let press = null; // { target, menu }
  const commandAt = (event) => document.elementFromPoint(event.clientX, event.clientY)?.closest('.menu-list button') ?? null;
  const pointAt = (command) => {
    for (const button of document.querySelectorAll('.menu-list button')) button.classList.toggle('hover', button === command);
  };
  document.addEventListener('pointerdown', (event) => {
    stopClick?.(); // a new press: nothing left over from the last one
    stopClick = null;
    const target = event.target.closest?.(PRESSABLE);
    press = target && !target.disabled ? { target, menu: target.closest('.menu-list') } : null;
    if (press?.menu) pointAt(target);
  }, { capture: true });
  document.addEventListener('pointermove', (event) => {
    if (press?.menu) pointAt(commandAt(event));
  }, { capture: true });
  document.addEventListener('pointerup', (event) => {
    if (!press) return;
    const { target, menu } = press;
    press = null;
    if (menu) {
      const command = commandAt(event);
      pointAt(null);
      if (command === target) return; // an ordinary tap
      command?.click(); // first, so the drop below doesn't catch it
      stopClick = dropNextClick(); // the browser's own click, on the command the press started on
      return;
    }
    const under = document.elementFromPoint(event.clientX, event.clientY);
    if (!target.contains(under)) stopClick = dropNextClick();
  }, { capture: true });
  document.addEventListener('pointercancel', () => {
    press = null;
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
// is scrolled to sit just above it.
export function keepFieldsAboveKeyboard() {
  const view = window.visualViewport;
  if (!view) return;
  const update = () => {
    const keyboard = Math.max(0, Math.round(window.innerHeight - view.height));
    document.documentElement.style.setProperty('--keyboard', `${keyboard}px`);
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
// seconds to show a message, then the help line comes back.

let helpLine = { text: '', tone: '', onTap: null };
let toastTimer = null;

function showHelpLine() {
  const node = $('help');
  node.className = `window help${helpLine.tone ? ` ${helpLine.tone}` : ''}${helpLine.onTap ? ' tappable' : ''}`;
  node.onclick = helpLine.onTap;
  showHelpText(helpLine.text);
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

// tone: '' or 'bad'. onTap: optional action when the help window is tapped.
export function setHelp(text, { tone = '', onTap = null } = {}) {
  // Screens set their help line on every redraw; only redraw HELP when it changed, so a scrolling
  // line doesn't restart.
  const unchanged = text === helpLine.text && tone === helpLine.tone && onTap === helpLine.onTap;
  helpLine = { text, tone, onTap };
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

// The HELP window: each screen's help line, the main screen's status row, and messages.

import { $, el } from './ui.js';

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

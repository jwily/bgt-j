// The secondary screens' navigation and shared parts. Each screen (screens/*.js) exports render(params),
// which sets its title (shown in the top-right title window) and its HELP line, then fills the page
// with labelled windows, and optionally enter(params), which resets its state when it's opened.

import { currentPeriod, periodNumber } from './store.js';
import { $, el } from './ui.js';
import { setHelp, leftScreen } from './help.js';
import { formatDate } from './dates.js';
import * as summary from './screens/summary.js';
import * as periods from './screens/periods.js';
import * as categories from './screens/categories.js';
import * as backup from './screens/backup.js';
import * as budget from './screens/budget.js';

export { confirmLeave } from './screens/categories.js';

const page = $('page');
export const body = $('page-body');

const SCREENS = { summary, periods, categories, backup, budget };

let stack = [];               // [{ name, params }], so Back returns to the previous screen
let title = '';               // the showing screen's name, for the title window
let onNavigate = () => {};    // redraws the app after showing or leaving a screen

// A small grey footnote.
export const note = (text) => el('p', { className: 'empty-note', textContent: text });

// A window with an FF8-style label tab on its top edge.
export const panel = (label, ...children) => el('div', { className: 'window panel', 'data-label': label }, ...children);

// Set up a screen: its title and help line, then its windows. Skips empty slots like
// `condition && el(...)` that came out false.
export function fill(screenTitle, help, ...nodes) {
  title = screenTitle;
  setHelp(help);
  const windows = nodes.filter((node) => node != null && node !== false);
  if (arrivingNext) windows.forEach((node) => node.classList.add('arriving'));
  arrivingNext = false;
  body.replaceChildren(...windows);
}

export function initPages(options) {
  onNavigate = options.onNavigate;
}

export const isPageOpen = () => !page.hidden;
export const pageTitle = () => title;
// The first-budget screen can't be left: the app needs a period before anything else works.
export const canGoBack = () => !(stack.at(-1)?.name === 'budget' && !currentPeriod());

// push: keep the current screen underneath (Back returns to it).
export function showPage(name, params = {}, { push = false } = {}) {
  leftScreen();
  stack = push ? [...stack, { name, params }] : [{ name, params }];
  SCREENS[name].enter?.(params);
  page.hidden = false;
  page.scrollTop = 0;
  arrive();
  onNavigate();
}

export function goBack() {
  leftScreen();
  stack.pop();
  if (stack.length) arrive();
  else page.hidden = true;
  onNavigate();
}

// Leave every screen and return to the main screen.
export function closePages() {
  hidePages();
  onNavigate();
}

// The same during a redraw, which then carries on (a screen whose subject has gone, as after a
// restore).
export function hidePages() {
  leftScreen();
  stack = [];
  page.hidden = true;
}

// The screen showing, if any.
export const currentScreen = () => stack.at(-1)?.name ?? null;

// Windows fade in when you arrive at a screen, not on every redraw: only the windows the screen
// arrives with get the animation. (Marking the whole screen for a moment instead replayed it when
// something redrew the screen just after, like the exchange rate arriving on first launch.)
let arrivingNext = false;
function arrive() {
  arrivingNext = true;
}

export function renderPage() {
  const top = stack.at(-1);
  if (!top || page.hidden) return;
  SCREENS[top.name].render(top.params);
}

export const periodDates = (period) => `${formatDate(period.start)} – ${period.end ? formatDate(period.end) : 'ongoing'}`;
export const periodName = (period) => (period.end ? `Period ${periodNumber(period)}` : 'Current Period');
export const tone = (diffCents) => (diffCents >= 0 ? 'good' : 'bad'); // budget minus spent: under is good

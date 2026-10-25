// The period summary: the spending ring, the budget against what's spent, and each category's
// spending with its expenses (tap a category to open it).

import { state, getPeriod, periodExpenses, spentIn, totalUsd, getCategory, deletePeriod } from '../store.js';
import { HOME, formatMoney, formatUsd, formatDiff } from '../money.js';
import { el } from '../ui.js';
import { toast } from '../help.js';
import { colorDot, gauge } from '../widgets.js';
import { formatDate } from '../dates.js';
import { openExpenseSheet } from '../sheets.js';
import { takeSnapshot } from '../snapshots.js';
import { fill, panel, note, periodDates, periodName, tone, showPage, goBack, renderPage, hidePages } from '../pages.js';

const expanded = new Set(); // category ids opened on this screen

export function enter() {
  expanded.clear();
}

export function render({ periodId }) {
  const period = getPeriod(periodId);
  if (!period) {
    // e.g. after restoring a backup that doesn't contain it
    hidePages();
    return;
  }
  const isCurrent = !period.end;
  const spent = spentIn(period.id);
  const diff = period.budgetCents - spent;

  const groups = new Map();
  for (const expense of periodExpenses(period.id)) {
    if (!groups.has(expense.categoryId)) groups.set(expense.categoryId, []);
    groups.get(expense.categoryId).push(expense);
  }
  const rows = [...groups]
    .map(([id, items]) => ({
      category: getCategory(id) ?? { id, name: 'Unknown', color: '#888888' },
      items: items.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
      cents: totalUsd(items),
    }))
    .sort((a, b) => b.cents - a.cents);

  const stats = panel('Budget',
    el('div', { className: 'stat' }, el('span', { textContent: 'Budget' }), el('span', { className: 'value', textContent: formatUsd(period.budgetCents) })),
    el('div', { className: 'stat' }, el('span', { textContent: 'Spent' }), el('span', { className: 'value', textContent: formatUsd(spent) })),
    el('div', { className: `stat diff ${tone(diff)}` },
      el('span', { textContent: diff >= 0 ? 'Under budget' : 'Over budget' }),
      el('span', { className: 'value', textContent: formatDiff(diff) })),
  );

  const list = el('ul', { className: 'cat-list' });
  for (const row of rows) {
    const isOpen = expanded.has(row.category.id);
    const head = el('button', { className: 'cat-head', 'aria-expanded': String(isOpen) },
      colorDot(row.category.color),
      el('span', { className: 'name', textContent: row.category.name }),
      el('span', { className: 'value', textContent: formatUsd(row.cents) }),
      el('span', { className: 'chev', textContent: '›' }),
      gauge(row.cents / spent, row.category.color));
    head.addEventListener('click', () => {
      if (isOpen) expanded.delete(row.category.id);
      else expanded.add(row.category.id);
      renderPage();
    });
    list.append(el('li', { className: isOpen ? 'open' : '' }, head,
      isOpen && el('ul', { className: 'items' }, ...row.items.map(itemRow))));
  }

  // The screen's actions sit at the bottom, under the thumb; the safer one on the right, nearer it.
  const remove = el('button', { className: 'wide-btn delete-btn', textContent: 'Delete period' });
  remove.addEventListener('click', () => removePeriod(period));
  let edit = null;
  if (isCurrent) {
    edit = el('button', { className: 'wide-btn edit-budget', textContent: 'Edit budget' });
    edit.addEventListener('click', () => showPage('budget', { mode: 'edit' }, { push: true }));
  }

  fill(periodName(period), periodDates(period),
    panel('Spent', waveRing(rows.map((r) => ({ value: r.cents, color: r.category.color })), spent, period.budgetCents)),
    stats,
    panel('Categories', rows.length ? list : note('No expenses yet.')),
    el('div', { className: 'actions' }, remove, edit),
  );
}

// Asks first: this deletes every expense in the period. Undo is offered afterwards too.
function removePeriod(period) {
  const name = periodName(period);
  const count = periodExpenses(period.id).length;
  const what = `${name} and its ${count} expense${count === 1 ? '' : 's'}`;
  const reopens = !period.end && state.periods.length > 1;
  if (!confirm(`Delete ${what}?${reopens ? ' The previous period becomes current again.' : ''}`)) return;
  takeSnapshot(`before deleting ${name}`);
  goBack(); // leave this summary first; it can't be shown once its period is gone
  const undo = deletePeriod(period.id);
  toast(`${name} deleted`, undo);
}

function itemRow(expense) {
  const amount = el('span', { className: 'much', textContent: formatUsd(expense.usdCents) });
  const { original } = expense;
  if (original && original.currency !== HOME) {
    amount.append(el('span', { className: 'orig', textContent: `from ${formatMoney(original.amount, original.currency)}` }));
  }
  const row = el('button', { className: 'item' },
    el('span', { className: 'when', textContent: formatDate(expense.date) }),
    el('span', { className: `what${expense.note ? '' : ' muted'}`, textContent: expense.note || 'No note' }),
    amount);
  row.addEventListener('click', () => openExpenseSheet(expense));
  return el('li', {}, row);
}

// The spending ring, after the bar of Squall's Renzokuken: each category a wave going clockwise
// from 12 o'clock, largest first so the smallest comes last, rising from black to its color at a
// hard leading edge (its clockwise end, so the last edge marks where spending stops). Drawn against
// the budget, so what's unspent stays black; over budget, against the spending, all of it waves.
// Arriving, the waves fire one at a time, the furthest first, each travelling clockwise from 12
// o'clock to its place at FF8's constant speed (measured from renzo.mov) and landing gently; the
// next fires as the one before is 85% of the way there, so each travels only through space nothing
// has landed in yet. The tick at 12 o'clock flashes as each fires. The whole sequence then plays in
// PACE * (its natural length) ^ TEMPO seconds, rhythm kept: a smooth squeeze, so long sequences
// don't keep you waiting and short ones still read as one wave after another (about 0.35-1.3s).
const WAVE_SPEED = 400; // degrees a second
const NEXT_FIRES_AT = 0.85; // of the previous wave's travel
const TEMPO = 0.3; // 1 would keep FF8's speed; lower evens lengths out more
const PACE = 0.85;
function waveRing(slices, total, budget) {
  const whole = Math.max(budget, total);
  let at = 0;
  const placed = [...slices].sort((a, b) => b.value - a.value).map(({ value, color }) => {
    const from = (at / whole) * 360;
    at += value;
    return { color, from, to: (at / whole) * 360 };
  });
  // Timings at FF8's speed, furthest wave first, then squeezed.
  let fire = 0, end = 0;
  for (const wave of [...placed].reverse()) {
    wave.delay = fire;
    wave.dur = wave.to / WAVE_SPEED;
    fire += wave.dur * NEXT_FIRES_AT;
    end = Math.max(end, wave.delay + wave.dur);
  }
  const scale = end && (PACE * end ** TEMPO) / end;
  const seconds = (t) => `${(t * scale).toFixed(3)}s`;
  const waves = placed.map(({ color, from, to, delay, dur }) => {
    const wave = el('span', { className: 'wave' });
    wave.style.cssText = `--c: ${color}; --from: ${from}deg; --len: ${to - from}deg; --delay: ${seconds(delay)}; --dur: ${seconds(dur)}`;
    const place = el('span', { className: 'wave-place' }, wave);
    place.style.setProperty('--to', `${to}deg`);
    return place;
  });
  const flashes = placed.map(({ delay }) => {
    const flash = el('span', { className: 'tick flash' });
    flash.style.setProperty('--delay', seconds(delay));
    return flash;
  });
  return el('div', { className: `ring-chart${total > budget ? ' over' : ''}` },
    el('div', { className: 'waves' }, ...waves),
    el('span', { className: 'tick' }),
    ...flashes,
    el('div', { className: 'ring-center' },
      el('strong', { textContent: formatUsd(total) }),
      el('span', { textContent: 'spent' })));
}

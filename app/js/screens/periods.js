// The list of periods, newest first; tap one for its summary.

import { state, spentIn } from '../store.js';
import { formatUsd, formatDiff } from '../money.js';
import { el } from '../ui.js';
import { fill, note, periodDates, periodName, tone, showPage } from '../pages.js';

export function render() {
  const rows = [...state.periods].reverse().map((period) => {
    const spent = spentIn(period.id);
    const diff = period.budgetCents - spent;
    const row = el('button', { className: `period-row${period.end ? '' : ' current'}` },
      el('span', {}, el('strong', { textContent: periodName(period) }), el('small', { textContent: periodDates(period) })),
      el('span', { className: 'right' },
        el('span', { textContent: `${formatUsd(spent)} of ${formatUsd(period.budgetCents)}` }),
        el('small', { className: tone(diff), textContent: formatDiff(diff) })));
    row.addEventListener('click', () => showPage('summary', { periodId: period.id }, { push: true }));
    return row;
  });
  fill('Past Periods', 'Select a period to see its summary.', ...rows,
    state.periods.length < 2 && note('Past periods show up here after you start a new period.'));
}

// The Categories screen: a slot for each of the 16 colors, named ones first and then empty ones to
// fill in. Renames, additions, removals and restores edit a draft; Save applies it.

import { activeCategories, sortedCategories, saveCategories, categoryIsUsed } from '../store.js';
import { paletteColor, CATEGORY_SLOTS } from '../palette.js';
import { el } from '../ui.js';
import { toast } from '../help.js';
import { colorDot } from '../widgets.js';
import { fill, panel, note, currentScreen } from '../pages.js';

let categoryDraft = null;     // the unsaved edits: [{ id (null for a new one), name, archived }]
let drawnFrom = null;         // the saved categories the screen was last drawn from (as JSON)

export function enter() {
  categoryDraft = null;
  drawnFrom = null;
}

// The Categories screen edits a draft: renaming, adding, removing and restoring change only the
// draft, and Save applies it all at once, which sorts the categories alphabetically then and
// there. Colors always go by position down the list (GF order), in the draft as after saving.
const categoriesFromState = () => [...activeCategories(), ...sortedCategories().filter((c) => c.archived)]
  .map(({ id, name, archived }) => ({ id, name, archived }));
const sameCategories = (a, b) => a.length === b.length
  && a.every((c, i) => c.id === b[i].id && c.name.trim() === b[i].name.trim() && c.archived === b[i].archived);
// A category in the draft, or a slot typed into and cleared again (which is just an empty slot).
const holdsCategory = (c) => Boolean(c.id || c.name.trim());
const draftDiffers = (saved) => !sameCategories(categoryDraft.filter(holdsCategory), saved);
const categoryDraftChanged = () => Boolean(categoryDraft) && draftDiffers(categoriesFromState());

// Back from the Categories screen with unsaved changes asks first. Returns whether to leave.
export function confirmLeave() {
  if (currentScreen() !== 'categories' || !categoryDraftChanged()) return true;
  if (!confirm('Discard your unsaved category changes?')) return false;
  categoryDraft = null;
  return true;
}

// What's wrong with saving these, or null: at most one per color, and two can't share a name
// (ignoring capitalization).
function categoryDraftProblem(categories) {
  if (categories.filter((c) => !c.archived).length > CATEGORY_SLOTS) return `You can have up to ${CATEGORY_SLOTS} categories.`;
  const savedNames = new Map(categoriesFromState().map((c) => [c.id, c.name]));
  const unrenamed = (c) => c.id && savedNames.get(c.id) === c.name.trim();
  for (const [i, category] of categories.entries()) {
    const earlier = categories.slice(0, i).find((c) => c.name.trim().toLowerCase() === category.name.trim().toLowerCase());
    // Name the one that was already called that, not the one just renamed to it.
    const other = earlier && (unrenamed(earlier) || !unrenamed(category) ? earlier : category);
    if (other) return `There's already ${other.archived ? 'an archived' : 'a'} category called ${other.name.trim()}${other.archived ? '. Restore it instead' : ''}.`;
  }
  return null;
}

// Redraws for changes elsewhere (the day's rates arriving, say) leave the screen as it is, so a
// field isn't rebuilt under your finger mid-word; only a change to the saved categories redraws it.
// Edits on the screen redraw it themselves (draw).
export function render() {
  const saved = categoriesFromState();
  const from = JSON.stringify(saved);
  if (from === drawnFrom) return;
  drawnFrom = from;
  draw(saved);
}

function draw(saved = categoriesFromState()) {
  if (!categoryDraft || !draftDiffers(saved)) categoryDraft = saved.map((c) => ({ ...c }));
  const draft = categoryDraft;
  draft.splice(0, draft.length, ...draft.filter(holdsCategory));
  const active = draft.filter((c) => !c.archived);
  const archived = draft.filter((c) => c.archived);
  const editDraft = (change) => {
    const before = draft.map((c) => ({ ...c }));
    const message = change();
    draw();
    if (message) toast(message, () => { categoryDraft = before; draw(); });
  };

  const saveButton = el('button', { className: 'primary', textContent: 'Save', disabled: !draftDiffers(saved) });
  saveButton.addEventListener('click', () => {
    // A category left blank is dropped: a new one just goes, an existing one is removed like with ✕
    // (saveCategories archives it if it has expenses, so past summaries keep it). The draft itself
    // stays as it is until the save goes through, so a refused one leaves every row as it was.
    const kept = draft.filter((c) => c.name.trim());
    if (!kept.some((c) => !c.archived)) {
      toast('You need at least one category.');
      return;
    }
    const problem = categoryDraftProblem(kept);
    if (problem) {
      toast(problem);
      return;
    }
    categoryDraft = null; // first: saving redraws the screen, from the saved categories
    const undo = saveCategories(kept.map(({ id, name, archived: isArchived }) => ({ id, name, archived: isArchived })));
    toast('Categories saved', undo);
  });

  // Gems go by position down the screen, counting only rows that hold a category; an empty slot
  // has an empty socket until it's named. A keystroke repaints only when a row gains or loses its
  // category, and then only from that row down (the colors below it shift).
  const rows = []; // { row, holds, held, active }, top to bottom
  const paintFrom = (start) => {
    let i = rows.slice(0, start).filter((r) => r.held).length;
    for (const r of rows.slice(start)) r.row.querySelector('.dot').replaceWith(r.held ? colorDot(paletteColor(i++)) : el('span', { className: 'dot empty' }));
  };
  // Restoring needs a free slot; that changes as slots are filled in or cleared.
  let inUse = active.length;
  const restoreButtons = [];
  const fullHint = el('p', { className: 'hint', textContent: `All ${CATEGORY_SLOTS} slots are in use: remove one to restore a category.` });
  const showFull = () => {
    const full = inUse >= CATEGORY_SLOTS;
    for (const button of restoreButtons) button.disabled = full;
    fullHint.hidden = !full;
  };
  const edited = (entry) => {
    const held = entry.holds();
    if (held !== entry.held) {
      entry.held = held;
      if (entry.active) {
        inUse += held ? 1 : -1;
        showFull();
      }
      paintFrom(rows.indexOf(entry));
    }
    saveButton.disabled = !draftDiffers(saved);
  };
  const addRow = (row, holds, isActive) => {
    row.prepend(el('span', { className: 'dot' }));
    const entry = { row, holds, held: holds(), active: isActive };
    rows.push(entry);
    return entry;
  };
  const nameField = (value, label) => {
    const name = el('input', { type: 'text', value, placeholder: 'Empty', enterKeyHint: 'done', 'aria-label': label });
    name.addEventListener('keydown', (event) => { if (event.key === 'Enter') name.blur(); });
    return name;
  };
  // Spaces at either end go when you finish typing the name (and are never saved).
  const trimOnChange = (name, entry) => name.addEventListener('change', () => {
    name.value = name.value.trim();
    if (entry()) entry().name = name.value;
  });

  const named = active.map((category) => {
    const name = nameField(category.name, 'Category name');
    trimOnChange(name, () => category);

    const remove = el('button', { className: 'mini', textContent: '✕', 'aria-label': `Remove ${category.name}` });
    remove.addEventListener('click', () => {
      if (draft.filter((c) => !c.archived && holdsCategory(c)).length === 1) {
        toast('You need at least one category.');
        return;
      }
      editDraft(() => {
        draft.splice(draft.indexOf(category), 1);
        // One with expenses is archived, so past summaries keep it.
        if (category.id && categoryIsUsed(category.id)) {
          draft.push({ ...category, archived: true });
          return `${category.name.trim()} archived`;
        }
        return `${category.name.trim()} removed`;
      });
    });

    const entry = addRow(el('div', { className: 'cat-row' }, name, remove), () => holdsCategory(category), true);
    name.addEventListener('input', () => {
      category.name = name.value;
      edited(entry);
    });
    return entry.row;
  });

  // Typing in an empty slot adds a category to the draft (after the others, until Save sorts them).
  const empty = Array.from({ length: Math.max(0, CATEGORY_SLOTS - active.length) }, () => {
    let category = null;
    const name = nameField('', 'New category name');
    trimOnChange(name, () => category);
    const spacer = el('span', { className: 'mini', 'aria-hidden': 'true' }); // lines the field up with the named rows'
    const entry = addRow(el('div', { className: 'cat-row slot' }, name, spacer), () => Boolean(category?.name.trim()), true);
    name.addEventListener('input', () => {
      if (!category) {
        category = { id: null, name: '', archived: false };
        draft.splice(draft.filter((c) => !c.archived).length, 0, category);
      }
      category.name = name.value;
      edited(entry);
    });
    return entry.row;
  });

  const archivedPanel = archived.length > 0 && panel('Archived',
    ...archived.map((category) => {
      const restore = el('button', { className: 'link', textContent: 'Restore' });
      restore.addEventListener('click', () => editDraft(() => {
        draft.splice(draft.indexOf(category), 1);
        draft.splice(draft.filter((c) => !c.archived).length, 0, { ...category, archived: false });
      }));
      restoreButtons.push(restore);
      return addRow(el('div', { className: 'cat-row' }, el('span', { className: 'grow', textContent: category.name }), restore), () => true, false).row;
    }),
    fullHint);
  showFull();
  paintFrom(0);

  fill('Categories', 'Rename, add or remove, then save.', panel('Categories', ...named, ...empty), archivedPanel,
    note(`One category for each of the ${CATEGORY_SLOTS} colors. Saving sorts them alphabetically, and colors follow that order. Removing a category that has expenses archives it, so past summaries stay intact.`),
    el('div', { className: 'actions pinned' }, saveButton));
}

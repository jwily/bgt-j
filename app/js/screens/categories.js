// The Categories screen: a slot for each of the 16 colors, named ones first and then empty ones to
// fill in. Renames, additions, removals and restores edit a draft; Save applies it.

import { activeCategories, sortedCategories, saveCategories, categoryIsUsed } from '../store.js';
import { paletteColor, CATEGORY_SLOTS } from '../palette.js';
import { el } from '../ui.js';
import { toast } from '../help.js';
import { colorDot } from '../widgets.js';
import { fill, panel, note, renderPage, currentScreen } from '../pages.js';

let categoryDraft = null;     // the unsaved edits: [{ key, id, name, archived }]
let newCategoryKeys = 0;      // keys for categories named in empty slots (they have no id yet)

export function enter() {
  categoryDraft = null;
}

// The Categories screen edits a draft: renaming, adding, removing and restoring change only the
// draft, and Save applies it all at once, which sorts the categories alphabetically then and
// there. Colors always go by position down the list (GF order), in the draft as after saving.
const categoriesFromState = () => [...activeCategories(), ...sortedCategories().filter((c) => c.archived)]
  .map(({ id, name, archived }) => ({ key: id, id, name, archived }));
const sameCategories = (a, b) => JSON.stringify(a.map((c) => [c.id, c.name.trim(), c.archived]))
  === JSON.stringify(b.map((c) => [c.id, c.name.trim(), c.archived]));
// A category in the draft, or a slot typed into and cleared again (which is just an empty slot).
const holdsCategory = (c) => Boolean(c.id || c.name.trim());
const categoryDraftChanged = () => Boolean(categoryDraft) && !sameCategories(categoryDraft.filter(holdsCategory), categoriesFromState());

// Back from the Categories screen with unsaved changes asks first. Returns whether to leave.
export function confirmLeave() {
  if (currentScreen() !== 'categories' || !categoryDraftChanged()) return true;
  if (!confirm('Discard your unsaved category changes?')) return false;
  categoryDraft = null;
  return true;
}

// Two categories can't share a name (ignoring capitalization), and names can't be empty. Returns
// the problem to show, or null.
function categoryDraftProblem() {
  const savedNames = new Map(categoriesFromState().map((c) => [c.id, c.name]));
  const unrenamed = (c) => c.id && savedNames.get(c.id) === c.name.trim();
  for (const [i, category] of categoryDraft.entries()) {
    const earlier = categoryDraft.slice(0, i).find((c) => c.name.trim().toLowerCase() === category.name.trim().toLowerCase());
    // Name the one that was already called that, not the one just renamed to it.
    const other = earlier && (unrenamed(earlier) || !unrenamed(category) ? earlier : category);
    if (other) return `There's already ${other.archived ? 'an archived' : 'a'} category called ${other.name.trim()}${other.archived ? '. Restore it instead' : ''}.`;
  }
  return null;
}

export function render() {
  if (!categoryDraftChanged()) categoryDraft = categoriesFromState();
  const draft = categoryDraft;
  draft.splice(0, draft.length, ...draft.filter(holdsCategory));
  const active = draft.filter((c) => !c.archived);
  const archived = draft.filter((c) => c.archived);
  const full = active.length >= CATEGORY_SLOTS;
  const editDraft = (change) => {
    const before = draft.map((c) => ({ ...c }));
    const message = change();
    renderPage();
    if (message) toast(message, () => { categoryDraft = before; renderPage(); });
  };

  const saveButton = el('button', { className: 'primary', textContent: 'Save', disabled: !categoryDraftChanged() });
  saveButton.addEventListener('click', () => {
    // A category left blank is dropped: a new one just goes, an existing one is removed like with ✕
    // (saveCategories archives it if it has expenses, so past summaries keep it).
    const blank = draft.filter((c) => !c.name.trim());
    if (blank.length && draft.every((c) => c.archived || !c.name.trim())) {
      toast('You need at least one category.');
      return;
    }
    blank.forEach((category) => draft.splice(draft.indexOf(category), 1));
    const problem = categoryDraftProblem();
    if (problem) {
      toast(problem);
      return;
    }
    const undo = saveCategories(draft.map(({ id, name, archived: isArchived }) => ({ id, name, archived: isArchived })));
    categoryDraft = null;
    renderPage();
    toast('Categories saved', undo);
  });

  // Gems go by position down the screen, counting only rows that hold a category; an empty slot
  // has an empty socket until it's named. Repainted as names come and go.
  const rows = []; // { row, holds }, top to bottom
  const repaintDots = () => {
    let i = 0;
    for (const { row, holds } of rows) row.querySelector('.dot').replaceWith(holds() ? colorDot(paletteColor(i++)) : el('span', { className: 'dot empty' }));
  };
  const edited = () => {
    repaintDots();
    saveButton.disabled = !categoryDraftChanged();
  };
  const addRow = (row, holds) => {
    row.prepend(el('span', { className: 'dot' }));
    rows.push({ row, holds });
    return row;
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
    name.addEventListener('input', () => {
      category.name = name.value;
      edited();
    });
    trimOnChange(name, () => category);

    const remove = el('button', { className: 'mini', textContent: '✕', 'aria-label': `Remove ${category.name}` });
    remove.addEventListener('click', () => {
      if (draft.filter((c) => !c.archived && (c.id || c.name.trim())).length === 1) {
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

    return addRow(el('div', { className: 'cat-row' }, name, remove), () => holdsCategory(category));
  });

  // Typing in an empty slot adds a category to the draft (after the others, until Save sorts them).
  const empty = Array.from({ length: Math.max(0, CATEGORY_SLOTS - active.length) }, () => {
    let category = null;
    const name = nameField('', 'New category name');
    name.addEventListener('input', () => {
      if (!category) {
        category = { key: `new-${++newCategoryKeys}`, id: null, name: '', archived: false };
        draft.splice(draft.filter((c) => !c.archived).length, 0, category);
      }
      category.name = name.value;
      edited();
    });
    trimOnChange(name, () => category);
    const spacer = el('span', { className: 'mini', 'aria-hidden': 'true' }); // lines the field up with the named rows'
    return addRow(el('div', { className: 'cat-row slot' }, name, spacer), () => Boolean(category?.name.trim()));
  });

  const archivedPanel = archived.length > 0 && panel('Archived',
    ...archived.map((category) => {
      const restore = el('button', { className: 'link', textContent: 'Restore', disabled: full });
      restore.addEventListener('click', () => editDraft(() => {
        draft.splice(draft.indexOf(category), 1);
        draft.splice(draft.filter((c) => !c.archived).length, 0, { ...category, archived: false });
      }));
      return addRow(el('div', { className: 'cat-row' }, el('span', { className: 'grow', textContent: category.name }), restore), () => true);
    }),
    full && el('p', { className: 'hint', textContent: `All ${CATEGORY_SLOTS} slots are in use: remove one to restore a category.` }));
  repaintDots();

  fill('Categories', 'Rename, add or remove, then save.', panel('Categories', ...named, ...empty), archivedPanel,
    note(`One category for each of the ${CATEGORY_SLOTS} colors. Saving sorts them alphabetically, and colors follow that order. Removing a category that has expenses archives it, so past summaries stay intact.`),
    el('div', { className: 'actions pinned' }, saveButton));
}

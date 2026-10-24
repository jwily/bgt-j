// The Categories screen: renames, additions, removals and restores edit a draft; Save applies it.

import { activeCategories, sortedCategories, saveCategories, categoryIsUsed, paletteColor } from '../store.js';
import { $, el, toast, colorDot } from '../ui.js';
import { fill, panel, note, body, renderPage, currentScreen } from '../pages.js';

let categoryDraft = null;     // the unsaved edits: [{ key, id, name, archived }]
let newCategoryKeys = 0;      // row keys for categories added in the draft (they have no id yet)

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
const categoryDraftChanged = () => Boolean(categoryDraft) && !sameCategories(categoryDraft, categoriesFromState());

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
  const active = draft.filter((c) => !c.archived);
  const archived = draft.filter((c) => c.archived);
  const dot = (category) => colorDot(paletteColor([...active, ...archived].indexOf(category)));
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

  // Diamonds go by position down the screen; after a row is dropped in place, repaint them.
  const repaintDots = () => body.querySelectorAll('.cat-row .dot').forEach((old, i) => old.replaceWith(colorDot(paletteColor(i))));

  const list = panel('Categories', ...active.map((category) => {
    const name = el('input', { type: 'text', value: category.name, placeholder: 'New category', enterKeyHint: 'done', 'aria-label': 'Category name' });
    name.dataset.key = category.key;
    name.addEventListener('keydown', (event) => { if (event.key === 'Enter') name.blur(); });
    name.addEventListener('input', () => {
      category.name = name.value;
      saveButton.disabled = !categoryDraftChanged();
    });
    // Spaces at either end go when you finish typing the name (and are never saved).
    name.addEventListener('change', () => {
      name.value = name.value.trim();
      category.name = name.value;
    });
    // A new category still blank when the keyboard closes is dropped. Just its row goes, not the
    // whole screen redrawn, so a tap on Save that closed the keyboard still lands on Save.
    name.addEventListener('blur', () => {
      if (category.id || name.value.trim()) return;
      draft.splice(draft.indexOf(category), 1);
      name.closest('.cat-row').remove();
      repaintDots();
      saveButton.disabled = !categoryDraftChanged();
    });

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

    return el('div', { className: 'cat-row' }, dot(category), name, remove);
  }));

  const addButton = el('button', { className: 'wide-btn', textContent: 'Add category' });
  addButton.addEventListener('click', () => {
    const key = `new-${++newCategoryKeys}`;
    // New ones start blank and go after the other active categories, until Save sorts them.
    draft.splice(draft.filter((c) => !c.archived).length, 0, { key, id: null, name: '', archived: false });
    renderPage();
    // Bring the new row into view (a long list puts it below the buttons pinned at the bottom), then
    // type into it. Scrolling it ourselves rather than leaving it to focus(), which iOS doesn't do
    // reliably inside a scrolling screen.
    const field = body.querySelector(`.cat-row input[data-key="${key}"]`);
    field?.closest('.cat-row').scrollIntoView({ block: 'center' });
    field?.focus({ preventScroll: true });
  });

  const archivedPanel = archived.length > 0 && panel('Archived',
    ...archived.map((category) => {
      const restore = el('button', { className: 'link', textContent: 'Restore' });
      restore.addEventListener('click', () => editDraft(() => {
        draft.splice(draft.indexOf(category), 1);
        draft.splice(draft.filter((c) => !c.archived).length, 0, { ...category, archived: false });
      }));
      return el('div', { className: 'cat-row' }, dot(category), el('span', { className: 'grow', textContent: category.name }), restore);
    }));

  fill('Categories', 'Rename, add or remove, then save.', list, archivedPanel,
    note('Saving sorts categories alphabetically, and colors follow that order. Removing a category that has expenses archives it, so past summaries stay intact.'),
    el('div', { className: 'actions pinned' }, addButton, saveButton));
}

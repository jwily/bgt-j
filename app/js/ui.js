// Small DOM helpers shared by every screen.

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

// Spaces at either end of a text field go when you finish typing in it (category names, notes),
// so what you see is what's saved. then(value), if given, runs with the tidied value.
export function trimOnChange(field, then) {
  field.addEventListener('change', () => {
    field.value = field.value.trim();
    then?.(field.value);
  });
}

// Briefly shake an element to say "can't do that".
export function nudge(node) {
  node.classList.remove('nudge');
  void node.offsetWidth; // restart the animation
  node.classList.add('nudge');
}

// Runs fn once the page has fully loaded, style.css included (now, if it already has). Measuring
// anything styled before then can give 0; and a listener for "load" added after it fired (startup
// can await first, as when recovering data) would never run.
export function whenLoaded(fn) {
  if (document.readyState === 'complete') fn();
  else window.addEventListener('load', fn, { once: true });
}

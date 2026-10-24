// Presses: every tap on the app's own controls, and long presses.

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

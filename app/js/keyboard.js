// The on-screen keyboard: keeping the field being typed in above it.

import { $ } from './ui.js';

// iOS lays the keyboard over the page without resizing it, so a field near the bottom of a screen
// can end up hidden behind it, with nothing below to scroll it up by. While the keyboard is open,
// --keyboard holds its height (screens make that much room at their bottom) and the focused field
// is scrolled to sit just above it. When the keyboard closes, that room isn't dropped at once: a
// screen scrolled into it would snap down by the keyboard's height as iOS slides the keyboard
// away, which flashes. The screen glides to where it will rest first, then the room goes.
export function keepFieldsAboveKeyboard() {
  const view = window.visualViewport;
  if (!view) return;
  let room = 0; // the keyboard height screens currently make room for
  let dropRoom = null;
  const setRoom = (height) => {
    clearTimeout(dropRoom);
    room = height;
    document.documentElement.style.setProperty('--keyboard', `${height}px`);
  };
  const update = () => {
    const keyboard = Math.max(0, Math.round(window.innerHeight - view.height));
    if (keyboard < room) {
      const screen = $('page');
      const dock = document.querySelector('.dock').offsetHeight; // screens keep at least the bottom bar's height of room
      const shrink = Math.max(room, dock) - Math.max(keyboard, dock);
      const rest = Math.max(0, screen.scrollHeight - screen.clientHeight - shrink);
      if (!screen.hidden && screen.scrollTop > rest) screen.scrollTo({ top: rest, behavior: 'smooth' });
      clearTimeout(dropRoom);
      dropRoom = setTimeout(() => setRoom(keyboard), 350);
      return;
    }
    if (keyboard !== room) setRoom(keyboard);
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

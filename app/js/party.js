// A party member wandering the main screen: one of FF8's six (FF Record Keeper battle sprites, cut
// by tests/tools/cut-party.js into sprites/party.png), picked at random each launch, and a different
// one each time you come back to the main screen from another. It strolls back and forth along the
// top of the Note and Date windows, stopping now and then and sometimes turning back. Its walk is
// FFRK's own two frames (from walk.mov): a stride, then feet together. It stands on the
// feet-together one and sets off on the stride, a little quicker than the clip's march on the spot,
// with the ground speed matched to its feet so they stay planted. When an expense is added it
// stops and does FFRK's victory cheer (celebrate). It only draws while walking: a pause or a cheer
// is timers, and with another screen open or the app in the background it stops.

import { el } from './ui.js';

const PARTY = ['Squall', 'Zell', 'Irvine', 'Quistis', 'Rinoa', 'Selphie']; // party.png's rows
// party.png's columns: the walk's stride, feet together (standing), and the cheer's arm thrown up.
const STRIDE_FRAME = 0, STAND = 1, ARM_UP = 2;
// FFRK's victory cheer, timed from cheer.mov: standing and an arm thrown up, alternating about every
// 0.37s, three times (the user's choice; the clip has two), then holding the stance a moment:
// [frame, seconds].
const CHEER = [...Array(3).fill([[STAND, 0.37], [ARM_UP, 0.37]]).flat(), [STAND, 0.8]];
const STEP = 0.24; // seconds each walk frame is held
const PX = 4 / 3; // one sprite pixel: 4 screen pixels on a 3x iPhone (keep in sync with style.css)
// Ground speed to match the feet, so they don't slide: in the stride frame the feet are about 6
// sprite pixels apart, and a step (stride, then feet together) takes two frames.
const STRIDE = 6; // sprite pixels
const SPEED = (STRIDE * PX) / (2 * STEP); // px a second

let member, area;
let x = 0, face = 1, from = 0, target = 0, walkTime = 0, mode = 'idle', until = 0, step = 0;
let last = 0, away = false, running = false, frame = 0, wake = 0, cheer = 0, cheerNext = false;
const seconds = () => performance.now() / 1000;

export function initParty(container) {
  area = container;
  member = el('span', { className: 'party-member', 'aria-hidden': 'true' });
  area.append(member);
  // Runs only on the main screen with the app in view: another screen opening (body.page-open)
  // or the app going to the background stops it; coming back resumes it.
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', sync);
  new ResizeObserver(() => {
    x = Math.min(x, room());
    draw();
  }).observe(area);
  requestAnimationFrame(() => {
    enter(seconds());
    sync();
  });
}

function sync() {
  const screenOpen = document.body.classList.contains('page-open');
  const run = !document.hidden && !screenOpen;
  if (screenOpen) away = true;
  if (run === running) return;
  running = run;
  if (run && away) {
    away = false;
    enter(seconds()); // back on the main screen: someone new
  }
  last = performance.now();
  schedule();
}

// An expense was added: it cheers (again from the start if it already is), then rests a moment
// before wandering on. It cheers from standing: caught mid-stride, it finishes the step first (a
// fraction of a second), so it never snaps from a stride into the cheer.
export function celebrate() {
  if (!member) return;
  if (mode === 'walk' && walkCell() === STRIDE_FRAME) {
    cheerNext = true;
    return;
  }
  cheerNext = false;
  mode = 'cheer';
  cheer = 0;
  until = seconds() + CHEER[0][1];
  draw();
  schedule();
}

// What happens next: walking, the next frame; cheering, the next pose; standing, setting off when
// the pause ends.
function schedule() {
  cancelAnimationFrame(frame);
  clearTimeout(wake);
  if (!running) return;
  if (mode === 'walk') frame = requestAnimationFrame(walk);
  else wake = setTimeout(() => {
    const now = seconds();
    if (mode === 'cheer') {
      cheer += 1;
      if (cheer < CHEER.length) until = now + CHEER[cheer][1];
      else rest(now);
    } else {
      setOff(now);
      last = performance.now();
    }
    draw();
    schedule();
  }, Math.max(0, (until - seconds()) * 1000));
}

// A party member (any but the one there now) takes the stage: somewhere along the windows, facing
// either way, standing for a moment before it sets off.
function enter(now) {
  const others = PARTY.filter((name) => name !== member.dataset.member);
  const name = others[Math.floor(Math.random() * others.length)];
  member.dataset.member = name;
  member.style.setProperty('--row', PARTY.indexOf(name));
  face = Math.random() < 0.5 ? 1 : -1;
  x = Math.random() * room();
  rest(now);
  draw();
}

const room = () => Math.max(0, area.clientWidth - member.offsetWidth);

// Stand still for a while (longer, now and then), then set off.
function rest(now) {
  mode = 'idle';
  until = now + 0.8 + Math.random() * (Math.random() < 0.25 ? 3.5 : 1.6);
}

// Somewhere to walk to: usually a short stroll on in the same direction, sometimes back the other
// way; three to ten whole steps (stride, then feet together), so every walk ends having just
// settled onto the standing frame instead of stopping mid-stride. Near an edge, as many whole steps
// as fit, or it turns back.
function setOff(now) {
  const span = room();
  const pace = SPEED * 2 * STEP; // ground covered by one step
  const fits = (dir) => Math.floor((dir > 0 ? span - x : x) / pace + 1e-6);
  let dir = Math.random() < 0.35 ? face : -face; // face 1 = facing left, so walking on is toward smaller x
  if (fits(dir) < 1) dir = -dir;
  const steps = Math.min(3 + Math.floor(Math.random() * 8), fits(dir));
  if (steps < 1) {
    rest(now); // no room for a whole step either way
    return;
  }
  from = x;
  target = x + dir * steps * pace;
  walkTime = steps * 2 * STEP;
  face = dir > 0 ? -1 : 1;
  mode = 'walk';
  step = 0;
}

function walk(nowMs) {
  // A frame's time can be a touch earlier than when the walk began (it's when the frame started).
  step += Math.min(0.1, Math.max(0, (nowMs - last) / 1000));
  last = nowMs;
  if (step >= walkTime) {
    x = target;
    rest(nowMs / 1000);
  } else {
    x = from + Math.sign(target - from) * SPEED * step;
  }
  if (cheerNext && (mode !== 'walk' || walkCell() === STAND)) {
    celebrate(); // the step's done: standing, it cheers
    return;
  }
  draw();
  schedule();
}

const walkCell = () => [STRIDE_FRAME, STAND][Math.floor(step / STEP) % 2];

// The sprites face left; walking right mirrors them.
function draw() {
  const cell = mode === 'walk' ? walkCell() : mode === 'cheer' ? CHEER[cheer][0] : STAND;
  member.dataset.state = mode;
  member.style.setProperty('--frame', cell);
  member.style.transform = `translate(${x}px, 0) scaleX(${face})`;
}

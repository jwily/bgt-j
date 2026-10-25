// A party member wandering the main screen: one of FF8's six (FF Record Keeper battle sprites, cut
// by tests/tools/cut-party.js into sprites/party.png), picked at random each launch, and a different
// one each time you come back to the main screen from another. It strolls back and forth along the
// top of the Note and Date windows, stopping now and then and sometimes turning back. Its walk is
// FFRK's own two frames (from walk.mov): a stride, then feet together. It stands on the
// feet-together one and sets off on the stride, a little quicker than the clip's march on the spot,
// with the ground speed matched to its feet so they stay planted. When an expense is added it
// stops and does FFRK's victory cheer (celebrate). When a period starts, the whole party assembles
// for a cheer and then all but one walk off (assemble). It only draws while walking (or
// assembling): a pause or a cheer is timers, and with another screen open or the app in the
// background it stops.

import { el } from './ui.js';

const PARTY = ['Squall', 'Zell', 'Irvine', 'Quistis', 'Rinoa', 'Selphie']; // party.png's rows
// party.png's columns: the walk's stride, feet together (standing), and the cheer's arm thrown up.
const STRIDE_FRAME = 0, STAND = 1, ARM_UP = 2;
// FFRK's victory cheer, timed from cheer.mov: standing and an arm thrown up, alternating about every
// 0.37s, three times (the user's choice; the clip has two), then holding the stance a moment:
// [frame, seconds].
const CHEER = [...Array(3).fill([[STAND, 0.37], [ARM_UP, 0.37]]).flat(), [STAND, 0.8]];
const STEP = 0.24; // seconds each walk frame is held
// One sprite pixel on screen (style.css's --px: 4 screen pixels on a 3x iPhone), measured from the
// member as drawn, so it's set in one place: a cell is 20 sprite pixels wide.
const CELL = 20;
let PX = 0;
// Ground speed to match the feet, so they don't slide: in the stride frame the feet are about 6
// sprite pixels apart, and a step (stride, then feet together) takes two frames.
const STRIDE = 6; // sprite pixels
let SPEED = 0; // px a second (set once PX is known)

let member, area;
let x = 0, face = 1, from = 0, target = 0, walkTime = 0, mode = 'idle', until = 0, step = 0;
let last = 0, away = false, running = false, frame = 0, wake = 0, cheer = 0, cheerNext = false;
let scene = null; // while the party is assembled: { cast: [{ node, x, dir }], time, width, edge }
const seconds = () => performance.now() / 1000;

export function initParty(container) {
  area = container;
  member = el('span', { className: 'party-member', 'aria-hidden': 'true' });
  area.append(member);
  // Measured once style.css has surely applied (at startup it may not have yet, and an unstyled
  // member measures 0, which would leave it, and a new period's party, walking on the spot).
  window.addEventListener('load', () => {
    PX = member.getBoundingClientRect().width / CELL;
    SPEED = (STRIDE * PX) / (2 * STEP);
    EXIT_SPEED = (STRIDE * PX) / (2 * EXIT_STEP);
  }, { once: true });
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
  if (screenOpen) {
    away = true;
    endScene();
  }
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
  if (!member || scene) return; // the assembled party is cheering already
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
  if (scene) frame = requestAnimationFrame(perform);
  else if (mode === 'walk') frame = requestAnimationFrame(walk);
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
  if (!SPEED) {
    rest(now); // not measured yet (still starting up): stand a while longer
    return;
  }
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

// ---------- a new period: the party assembles ----------
// All six line up along the windows in a random order, facing left, and do the victory cheer
// together; then everyone but the third or fourth walks off, those left of it out past the left end
// of the windows and those right of it past the right end, vanishing into the edge as if stepping
// behind it, and the one left stays on to wander.
const CHEER_LENGTH = CHEER.reduce((sum, [, t]) => sum + t, 0);
// Leaving, they walk off a bit quicker than a stroll (the user's choice): quicker steps, the ground
// speed matched to them as ever so the feet don't slide.
const EXIT_STEP = 0.15;
let EXIT_SPEED = 0;

export function assemble() {
  if (!member || !EXIT_SPEED) return;
  endScene();
  const order = [...PARTY].sort(() => Math.random() - 0.5);
  const stays = 2 + Math.floor(Math.random() * 2); // the third or fourth
  const width = member.offsetWidth;
  const spacing = area.clientWidth / PARTY.length;
  const cast = order.map((name, i) => {
    const node = i === stays ? member : el('span', { className: 'party-member', 'aria-hidden': 'true' });
    if (node !== member) area.append(node);
    node.dataset.member = name;
    node.style.setProperty('--row', PARTY.indexOf(name));
    return { node, x: i * spacing + (spacing - width) / 2, dir: Math.sign(i - stays) };
  });
  scene = { cast, time: 0, width, edge: area.clientWidth }; // edge: the windows' right end (their left is 0)
  x = cast[stays].x;
  face = 1;
  mode = 'idle';
  cheerNext = false;
  away = false; // this is who's on stage now
  last = performance.now();
  perform(last);
}

function perform(nowMs) {
  if (!scene) return;
  scene.time += Math.min(0.1, Math.max(0, (nowMs - last) / 1000));
  last = nowMs;
  const { cast, time } = scene;
  if (time < CHEER_LENGTH) {
    let t = time, i = 0;
    while (t >= CHEER[i][1]) t -= CHEER[i++][1];
    for (const actor of cast) pose(actor.node, 'cheer', CHEER[i][0], actor.x, 1);
  } else {
    const t = time - CHEER_LENGTH;
    const cell = [STRIDE_FRAME, STAND][Math.floor(t / EXIT_STEP) % 2];
    let offstage = 0;
    for (const actor of cast) {
      if (!actor.dir) pose(actor.node, 'idle', STAND, actor.x, 1);
      else {
        const at = actor.x + actor.dir * EXIT_SPEED * t;
        // How much of it is past the windows' end, cut off there (its own left side either way: walking
        // right it's mirrored).
        const past = Math.min(scene.width, Math.max(0, -at, at + scene.width - scene.edge));
        if (past >= scene.width) offstage++;
        pose(actor.node, 'walk', cell, at, -actor.dir, past); // facing left is 1; walking right mirrors
      }
    }
    if (offstage === cast.length - 1) {
      endScene();
      rest(nowMs / 1000);
      draw();
    }
  }
  schedule();
}

function pose(node, state, cell, at, facing, hidden = 0) {
  node.dataset.state = state;
  node.style.setProperty('--frame', cell);
  node.style.transform = `translate(${at}px, 0) scaleX(${facing})`;
  node.style.clipPath = hidden ? `inset(0 0 0 ${hidden}px)` : '';
}

// The ones who walked off (or, cut short by leaving the screen, are still there) go.
function endScene() {
  if (!scene) return;
  for (const { node } of scene.cast) if (node !== member) node.remove();
  scene = null;
}


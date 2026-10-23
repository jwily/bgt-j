// A party member wandering the main screen: one of FF8's six (FF Record Keeper battle sprites, cut
// by tests/tools/cut-party.js into sprites/party.png), picked at random each launch, and a different
// one each time you come back to the main screen from another. It strolls back
// and forth along the top of the Note and Date windows, stopping now and then and sometimes turning
// back. Its walk is FFRK's own two frames (from walk.mov): a stride, then feet together. It stands on
// the feet-together one and sets off on the stride (the user's catch: standing on the stride froze it
// mid-step, which looked like sliding). The clip marches on the spot at half a second a frame;
// actually travelling, a quicker step looks livelier (the user's: a touch quicker than 0.3s), and
// the ground speed is matched to the feet so they stay planted.

import { el } from './ui.js';

const PARTY = ['Squall', 'Zell', 'Irvine', 'Quistis', 'Rinoa', 'Selphie']; // party.png's rows
const STEP = 0.24; // seconds each walk frame is held
const PX = 4 / 3; // one sprite pixel: 4 screen pixels on a 3x iPhone (keep in sync with style.css)
// Ground speed to match the feet, so they don't slide: in the stride frame the feet are about 6
// sprite pixels apart, and a step (stride, then feet together) takes two frames.
const STRIDE = 6; // sprite pixels
const SPEED = (STRIDE * PX) / (2 * STEP); // px a second

let member, area;
let x = 0, face = 1, from = 0, target = 0, walkTime = 0, mode = 'idle', until = 0, step = 0;
let last = 0, away = false;

export function initParty(container) {
  area = container;
  member = el('span', { className: 'party-member', 'aria-hidden': 'true' });
  area.append(member);
  requestAnimationFrame((now) => {
    enter(now / 1000);
    last = now;
    requestAnimationFrame(tick);
  });
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

const room = () => Math.max(0, area.clientWidth - 20 * PX);

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

function tick(nowMs) {
  const now = nowMs / 1000;
  const dt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  requestAnimationFrame(tick);
  if (document.hidden) return;
  // Away on another screen: still. Back on the main screen: someone new.
  if (document.body.classList.contains('page-open')) {
    away = true;
    return;
  }
  if (away) {
    away = false;
    enter(now);
  }
  x = Math.min(x, room());
  if (mode === 'idle' && now >= until) setOff(now);
  if (mode === 'walk') {
    step += dt;
    if (step >= walkTime) {
      x = target;
      rest(now);
    } else {
      x = from + Math.sign(target - from) * SPEED * step;
    }
  }
  draw();
}

// The sprites face left; walking right mirrors them.
function draw() {
  const frame = mode === 'walk' ? Math.floor(step / STEP) % 2 : 1;
  member.dataset.state = mode;
  member.style.setProperty('--frame', frame);
  member.style.transform = `translate(${x}px, 0) scaleX(${face})`;
}

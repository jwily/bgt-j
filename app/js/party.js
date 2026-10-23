// A party member wandering the main screen: one of FF8's six (FF Record Keeper battle sprites, cut
// by tests/tools/cut-party.js into sprites/party.png), picked at random each launch. It strolls back
// and forth along the top of the Note and Date windows, stopping now and then and sometimes turning
// back; when an expense is added it turns to you and does its victory pose, then wanders on.

import { el } from './ui.js';

const PARTY = ['Squall', 'Zell', 'Irvine', 'Quistis', 'Rinoa', 'Selphie']; // party.png's rows
// party.png's columns. The sprites face left; walking right mirrors them.
const FRAME = { stand: 0, stride: 1, start: 2, up: 3, cheer: 4, pose: 5 };
// The victory: [frame, seconds, hop in sprite pixels].
const VICTORY = [['start', 0.28, 0], ['up', 0.24, 3], ['cheer', 0.24, 0], ['up', 0.24, 3], ['cheer', 0.24, 0], ['pose', 0.9, 0]];
const SPEED = 24; // walking, in px a second
const STEP = 0.2; // seconds per stride or stand while walking
const PX = 4 / 3; // one sprite pixel: 4 screen pixels on a 3x iPhone (keep in sync with style.css)

let member, area;
let x = 0, face = 1, target = 0, mode = 'idle', until = 0, step = 0, victory = 0;
let last = 0;

export function initParty(container) {
  area = container;
  const row = Math.floor(Math.random() * PARTY.length);
  member = el('span', { className: 'party-member', 'aria-hidden': 'true' });
  member.dataset.member = PARTY[row];
  member.style.setProperty('--row', row);
  area.append(member);
  face = Math.random() < 0.5 ? 1 : -1;
  requestAnimationFrame((now) => {
    x = Math.random() * room();
    rest(now / 1000);
    last = now;
    requestAnimationFrame(tick);
  });
}

// The victory pose, from wherever it is (again from the start if it's already celebrating).
export function celebrate() {
  if (!member) return;
  mode = 'victory';
  victory = 0;
  until = performance.now() / 1000 + VICTORY[0][1];
  draw();
}

const room = () => Math.max(0, area.clientWidth - 20 * PX);

// Stand still for a while (longer, now and then), then set off.
function rest(now) {
  mode = 'idle';
  until = now + 0.8 + Math.random() * (Math.random() < 0.25 ? 3.5 : 1.6);
}

// Somewhere to walk to: usually a short stroll on in the same direction, sometimes back the other
// way, anywhere along the windows; always at least a few steps.
function setOff() {
  const span = room();
  const stroll = 24 + Math.random() * 70;
  const turn = Math.random() < 0.35;
  let dir = turn ? face : -face; // face 1 = facing left, so walking on is toward smaller x
  if (x - stroll < 0) dir = 1;
  if (x + stroll > span) dir = -1;
  target = Math.min(span, Math.max(0, x + dir * stroll));
  if (Math.abs(target - x) < 12) target = dir > 0 ? span : 0;
  face = target > x ? -1 : 1;
  mode = 'walk';
  step = 0;
}

function tick(nowMs) {
  const now = nowMs / 1000;
  const dt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  requestAnimationFrame(tick);
  if (document.hidden || document.body.classList.contains('page-open')) return;
  x = Math.min(x, room());
  if (mode === 'idle' && now >= until) setOff();
  if (mode === 'walk') {
    step += dt;
    const move = SPEED * dt;
    if (Math.abs(target - x) <= move) {
      x = target;
      rest(now);
    } else {
      x += Math.sign(target - x) * move;
    }
  }
  if (mode === 'victory' && now >= until) {
    victory += 1;
    if (victory < VICTORY.length) until = now + VICTORY[victory][1];
    else rest(now);
  }
  draw();
}

function draw() {
  let frame = FRAME.stand, hop = 0, mirror = face;
  if (mode === 'walk') {
    const striding = Math.floor(step / STEP) % 2 === 0;
    frame = striding ? FRAME.stride : FRAME.stand;
    hop = striding ? 0 : 1;
  } else if (mode === 'victory') {
    const [name, , lift] = VICTORY[victory];
    frame = FRAME[name];
    hop = lift;
    mirror = 1; // facing you
  }
  member.dataset.state = mode;
  member.style.setProperty('--frame', frame);
  member.style.transform = `translate(${x}px, ${-hop * PX}px) scaleX(${mirror})`;
}

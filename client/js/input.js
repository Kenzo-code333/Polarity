// =============================================================================
// Input: keyboard (WASD/arrows + Space/Shift/E/Q) and touch (virtual joystick
// + big state buttons). Produces one normalized input object per tick.
// =============================================================================
import { MODE } from '/shared/constants.js';

const keys = new Set();
const actionOrder = [];         // most recently pressed state button wins
let surgeQueued = false;
let enabled = true;
const listeners = { surgePress: [] };

const KEY_ACT = {
  Space: 'pull', ShiftLeft: 'push', ShiftRight: 'push', KeyE: 'anchor',
  KeyJ: 'pull', KeyK: 'push', KeyL: 'anchor',
};

function pressAct(act) {
  const i = actionOrder.indexOf(act);
  if (i >= 0) actionOrder.splice(i, 1);
  actionOrder.push(act);
}
function releaseAct(act) {
  const i = actionOrder.indexOf(act);
  if (i >= 0) actionOrder.splice(i, 1);
}

// ---------------------------------------------------------------------------
// keyboard
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  const act = KEY_ACT[e.code];
  if (act) pressAct(act);
  if (e.code === 'KeyQ' || e.code === 'KeyU') { surgeQueued = true; listeners.surgePress.forEach(f => f()); }
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  const act = KEY_ACT[e.code];
  if (act) {
    // both shift keys map to push: only release when neither is held
    if (act === 'push' && (keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyK'))) return;
    releaseAct(act);
  }
});
window.addEventListener('blur', () => { keys.clear(); actionOrder.length = 0; touchActs.clear(); stick.active = false; });

// ---------------------------------------------------------------------------
// touch
// ---------------------------------------------------------------------------
const stick = { active: false, id: -1, cx: 0, cy: 0, x: 0, y: 0 };
const touchActs = new Set();

export function initTouch() {
  const zone = document.getElementById('stickZone');
  const base = document.getElementById('stickBase');
  const knob = document.getElementById('stickKnob');
  const R = 55;
  const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
  zone.addEventListener('pointerdown', (e) => {
    if (stick.active) return;
    e.preventDefault();
    stick.active = true; stick.id = e.pointerId;
    stick.cx = e.clientX; stick.cy = e.clientY; stick.x = 0; stick.y = 0;
    // the joystick appears wherever the thumb lands
    base.style.left = (e.clientX - 65) + 'px';
    base.style.top = (e.clientY - 65) + 'px';
    base.style.bottom = 'auto';
    base.classList.add('active');
    try { zone.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  zone.addEventListener('pointermove', (e) => {
    if (!stick.active || e.pointerId !== stick.id) return;
    let dx = e.clientX - stick.cx, dy = e.clientY - stick.cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    stick.x = dx / R; stick.y = dy / R;
    setKnob(dx, dy);
  });
  const end = (e) => {
    if (e.pointerId !== stick.id) return;
    stick.active = false; stick.id = -1; stick.x = 0; stick.y = 0;
    setKnob(0, 0);
    base.classList.remove('active');
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);

  document.querySelectorAll('.tbtn').forEach(btn => {
    const act = btn.dataset.act;
    const down = (e) => {
      e.preventDefault();
      btn.classList.add('held');
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (act === 'surge') { surgeQueued = true; listeners.surgePress.forEach(f => f()); return; }
      touchActs.add(act); pressAct(act);
    };
    const up = (e) => {
      e.preventDefault();
      btn.classList.remove('held');
      if (act === 'surge') return;
      touchActs.delete(act); releaseAct(act);
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });
}

// ---------------------------------------------------------------------------
export function setInputEnabled(v) { enabled = v; if (!v) { actionOrder.length = 0; surgeQueued = false; } }
export function onSurgePress(fn) { listeners.surgePress.push(fn); }
export const isKeyDown = (code) => keys.has(code);

/** Sample the current input (called once per simulation tick). */
export function sampleInput() {
  if (!enabled) return { mx: 0, my: 0, mode: 0, surge: false };
  let mx = 0, my = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) my -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) my += 1;
  if (stick.active) {
    const d = Math.hypot(stick.x, stick.y);
    // small dead zone, then full range
    if (d > 0.12) { mx += stick.x; my += stick.y; }
  }
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  const act = actionOrder[actionOrder.length - 1];
  const mode = act === 'pull' ? MODE.PULL : act === 'push' ? MODE.PUSH : act === 'anchor' ? MODE.ANCHOR : MODE.NEUTRAL;
  const surge = surgeQueued;
  surgeQueued = false;
  return { mx, my, mode, surge };
}

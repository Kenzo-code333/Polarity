// =============================================================================
// Shared player physics.
//
// `stepSelf` contains everything about a player that depends ONLY on that
// player's own input and the static arena (state machine, energy, steering,
// drag, pylon grapple/dash). Because it is deterministic and self-contained the
// client runs the exact same code for client-side prediction, while the server
// layers on the interactions between players (fields, collisions, falls).
// =============================================================================
import { PHYS, PYLON, MODE, DT, FLAG } from './constants.js';

export function createPlayerState(id, x = 0, y = 0) {
  return {
    id, x, y, vx: 0, vy: 0,
    mode: MODE.NEUTRAL,     // active state
    pend: MODE.NEUTRAL,     // state being "told" (glowing) before it activates
    tell: 0,                // ticks of tell remaining
    cd: 0,                  // switch cooldown ticks remaining
    energy: PHYS.energyMax,
    rech: 0,                // ticks until recharge starts
    surge: 0,
    flags: FLAG.ALIVE,
    armor: 0,               // ticks of surge knockback armor
    ghostCd: 0,
    lastSurgeBtn: false,
    lastActionBtn: false,
  };
}

/** Sanitize a raw input (from the network or keyboard) into a safe object. */
export function sanitizeInput(raw) {
  let mx = Number(raw && raw.mx) || 0, my = Number(raw && raw.my) || 0;
  if (!Number.isFinite(mx)) mx = 0;
  if (!Number.isFinite(my)) my = 0;
  mx = Math.max(-1, Math.min(1, mx)); my = Math.max(-1, Math.min(1, my));
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  let mode = (raw && raw.mode) | 0;
  if (mode < 0 || mode > 3) mode = 0;
  return { mx, my, mode, surge: !!(raw && raw.surge) };
}

export const EMPTY_INPUT = Object.freeze({ mx: 0, my: 0, mode: 0, surge: false });

/** Is this player currently immune to magnetic fields? */
export const isAnchored = (p) => p.mode === MODE.ANCHOR;

/**
 * Advance one player's self-driven state by one tick.
 * env: { pylons, frozen } — frozen = countdown (no movement / states).
 * Returns an event string ('dash') when something notable happens, else null.
 */
export function stepSelf(p, input, env) {
  let event = null;
  const alive = (p.flags & FLAG.ALIVE) !== 0;
  if (!alive) return null;
  const drifting = (p.flags & FLAG.DRIFTING) !== 0;

  // ---- state machine: tell -> active, with cooldown ----------------------
  if (p.cd > 0) p.cd--;
  if (p.armor > 0) p.armor--;
  let want = env.frozen ? MODE.NEUTRAL : input.mode;
  if (want !== MODE.NEUTRAL && p.energy < PHYS.minEnergy && p.mode !== want) want = MODE.NEUTRAL;

  if (p.tell > 0) {
    // currently glowing in the color of `pend`
    if (want !== p.pend) {
      // released / changed during the tell: cancel it
      p.tell = 0; p.pend = MODE.NEUTRAL;
    } else if (--p.tell === 0) {
      p.mode = p.pend; p.pend = MODE.NEUTRAL; p.cd = PHYS.cooldownTicks;
      if (p.mode === MODE.PUSH) event = pylonDash(p, env.pylons) ? 'dash' : null;
    }
  } else if (want !== p.mode) {
    if (want === MODE.NEUTRAL) {
      // dropping a state is instant (but starts the cooldown)
      p.mode = MODE.NEUTRAL; p.cd = Math.max(p.cd, PHYS.cooldownTicks >> 1); p.rech = PHYS.rechargeDelay;
    } else if (p.cd === 0) {
      // start the 0.2 s tell; the previous state switches off immediately
      if (p.mode !== MODE.NEUTRAL) p.rech = PHYS.rechargeDelay;
      p.mode = MODE.NEUTRAL; p.pend = want; p.tell = PHYS.tellTicks;
    }
  }

  // ---- energy -------------------------------------------------------------
  if (p.mode !== MODE.NEUTRAL) {
    p.energy -= PHYS.drain[p.mode] * DT;
    if (p.energy <= 0) { p.energy = 0; p.mode = MODE.NEUTRAL; p.cd = PHYS.cooldownTicks; p.rech = PHYS.rechargeDelay * 2; }
  } else if (p.tell === 0) {
    if (p.rech > 0) p.rech--;
    else p.energy = Math.min(PHYS.energyMax, p.energy + PHYS.recharge * DT);
  }

  // ---- steering -----------------------------------------------------------
  let accel = PHYS.moveAccel;
  if (p.mode === MODE.ANCHOR) accel *= PHYS.anchorMoveFactor;
  if (drifting) accel *= PHYS.driftMoveFactor;
  if (env.frozen) accel = 0;
  p.vx += input.mx * accel * DT;
  p.vy += input.my * accel * DT;

  // ---- pylons: grapple (pull) and push-off ------------------------------
  if (p.mode === MODE.PULL || p.mode === MODE.PUSH) {
    for (const py of env.pylons) {
      const dx = py.x - p.x, dy = py.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > PYLON.range || d < 1) continue;
      const c = 1 - d / PYLON.range;
      if (p.mode === MODE.PULL) {
        // stop accelerating once hugging the pylon so you can orbit it
        const touch = PYLON.radius + PHYS.radius + 6;
        if (d > touch) {
          const a = PYLON.pull * (0.45 + 0.55 * c) * (drifting ? 1.35 : 1);
          p.vx += dx / d * a * DT; p.vy += dy / d * a * DT;
        }
      } else {
        const a = PYLON.push * c;
        p.vx -= dx / d * a * DT; p.vy -= dy / d * a * DT;
      }
    }
  }

  // ---- drag ---------------------------------------------------------------
  let drag = PHYS.drag;
  if (input.mx === 0 && input.my === 0) drag = PHYS.idleDrag;
  if (p.mode === MODE.ANCHOR) drag = PHYS.anchorDrag;
  if (drifting) drag = PHYS.driftDrag;
  const k = Math.exp(-drag * DT);
  p.vx *= k; p.vy *= k;

  const sp = Math.hypot(p.vx, p.vy);
  if (sp > PHYS.maxSpeed) { p.vx *= PHYS.maxSpeed / sp; p.vy *= PHYS.maxSpeed / sp; }
  return event;
}

/** Instant launch away from nearby pylons when Push activates. */
function pylonDash(p, pylons) {
  let fired = false;
  for (const py of pylons) {
    const dx = p.x - py.x, dy = p.y - py.y;
    const d = Math.hypot(dx, dy);
    if (d > PYLON.range * 0.6 || d < 1) continue;
    const c = 1 - d / (PYLON.range * 0.6);
    const imp = PYLON.dash * (0.4 + 0.6 * c);
    p.vx += dx / d * imp; p.vy += dy / d * imp;
    fired = true;
  }
  return fired;
}

/** Move by velocity and resolve against solid pylons. */
export function integrate(p, pylons) {
  p.x += p.vx * DT;
  p.y += p.vy * DT;
  collidePylons(p, pylons, PHYS.radius);
}

export function collidePylons(b, pylons, radius) {
  for (const py of pylons) {
    const dx = b.x - py.x, dy = b.y - py.y;
    const min = PYLON.radius * (py.pole ? POLE_SCALE : 1) + radius;
    const d2 = dx * dx + dy * dy;
    if (d2 < min * min && d2 > 0.0001) {
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
      b.x = py.x + nx * min; b.y = py.y + ny * min;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vy -= 1.6 * vn * ny; }
    }
  }
}
export const POLE_SCALE = 38 / 26;

/** Ghost movement: free floating, no collisions. */
export function stepGhost(p, input, bounds) {
  if (p.ghostCd > 0) p.ghostCd--;
  p.vx += input.mx * PHYS.ghostAccel * DT;
  p.vy += input.my * PHYS.ghostAccel * DT;
  const k = Math.exp(-PHYS.ghostDrag * DT);
  p.vx *= k; p.vy *= k;
  p.x += p.vx * DT; p.y += p.vy * DT;
  const d = Math.hypot(p.x, p.y);
  if (d > bounds) { p.x *= bounds / d; p.y *= bounds / d; }
}

/**
 * Magnetic field acceleration that `src` applies to a target at distance d.
 * Returns signed magnitude: positive = toward src (pull), negative = away.
 */
export function fieldMagnitude(srcMode, d) {
  const R = PHYS.fieldRange;
  if (d >= R) return 0;
  const c = 1 - d / R;
  if (srcMode === MODE.PULL) return PHYS.pullStrength * (0.28 + 1.75 * c * c * c);
  if (srcMode === MODE.PUSH) return -PHYS.pushStrength * (0.35 + 1.35 * c * c);
  return 0;
}

// =============================================================================
// Bot AI.
//
// Bots "see" the same information a player sees (positions, velocities,
// states and the 0.2 s glow tells) and produce the same inputs a human would.
// Difficulty changes reaction time, aim, how far ahead they look for edges,
// how well they read tells, and how often they make human-like mistakes.
// =============================================================================
import { MODE, FLAG, PHYS, PYLON, DEBRIS, rng } from './constants.js';

const LEVELS = {
  easy:   { react: 20, jitter: 10, aim: 0.55, look: 0.18, readTell: 0.25, mistake: 0.12, aggression: 0.55, surgeSmart: false, debris: 0.1 },
  normal: { react: 10, jitter: 6,  aim: 0.25, look: 0.32, readTell: 0.6,  mistake: 0.03, aggression: 0.8,  surgeSmart: true,  debris: 0.5 },
  hard:   { react: 4,  jitter: 3,  aim: 0.08, look: 0.45, readTell: 0.95, mistake: 0.0,  aggression: 1.0,  surgeSmart: true,  debris: 0.9 },
};

export class BotBrain {
  constructor(level = 'normal', seed = 1) {
    this.level = LEVELS[level] ? level : 'normal';
    this.cfg = LEVELS[this.level];
    this.rand = rng(seed * 7919 + 13);
    this.timer = 0;
    this.input = { mx: 0, my: 0, mode: 0, surge: false };
    this.wander = this.rand() * Math.PI * 2;
    this.target = -1;
    this.targetTimer = 0;
    this.mistakeTimer = 0;
    this.mistakeDir = 0;
    this.holdMode = 0;
    this.holdTimer = 0;
    this.centroidKey = -1;
    this.cx = 0; this.cy = 0;
  }

  /** Called every tick; re-plans every few ticks depending on difficulty. */
  think(game, me) {
    if (this.input.surge) this.input.surge = false;
    if (--this.timer > 0) return this.input;
    this.timer = this.cfg.react + Math.floor(this.rand() * this.cfg.jitter);
    this.updateCentroid(game);
    try {
      if (me.flags & FLAG.GHOST) this.planGhost(game, me);
      else if (me.flags & FLAG.ALIVE) this.plan(game, me);
      else this.set(0, 0, 0);
    } catch (e) {
      this.set(0, 0, 0);
    }
    return this.input;
  }

  set(mx, my, mode, surge = false) {
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.input = { mx, my, mode, surge };
  }

  updateCentroid(game) {
    const key = game.collapsed;
    if (key === this.centroidKey) return;
    this.centroidKey = key;
    let sx = 0, sy = 0, n = 0;
    for (const t of game.arena.tiles) if (t.layer <= game.maxAliveLayer) { sx += t.x; sy += t.y; n++; }
    this.cx = n ? sx / n : 0; this.cy = n ? sy / n : 0;
    this.safeTiles = game.arena.tiles.filter(t => t.layer <= game.maxAliveLayer - 1);
    if (this.safeTiles.length < 3) this.safeTiles = game.arena.tiles.filter(t => t.layer <= game.maxAliveLayer);
  }

  /** Distance (in px) from a point to the nearest void, sampled along 8 rays. */
  edgeDistance(game, x, y, max = 220) {
    let best = max;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const cx = Math.cos(a), cy = Math.sin(a);
      for (let d = 30; d < best; d += 30) {
        if (!game.isGround(x + cx * d, y + cy * d)) { best = d; break; }
      }
    }
    return best;
  }

  nearestSafe(game, x, y) {
    let best = null, bd = Infinity;
    for (const t of this.safeTiles) {
      const d = (t.x - x) ** 2 + (t.y - y) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    return best || { x: this.cx, y: this.cy };
  }

  enemies(game, me) {
    const out = [];
    for (const p of game.players.values()) if (p !== me && (p.flags & FLAG.ALIVE)) out.push(p);
    return out;
  }

  // --------------------------------------------------------------------------
  plan(game, me) {
    const cfg = this.cfg, R = this.rand;
    const frozen = game.phase === 'countdown';
    if (frozen) { this.set(0, 0, 0); return; }
    const foes = this.enemies(game, me);
    const speed = Math.hypot(me.vx, me.vy);

    // --- 0. human-like mistakes (easy bots) ------------------------------
    if (this.mistakeTimer > 0) {
      this.mistakeTimer--;
      this.set(Math.cos(this.mistakeDir), Math.sin(this.mistakeDir), R() < 0.5 ? MODE.PUSH : 0);
      return;
    }
    if (R() < cfg.mistake) { this.mistakeTimer = 2 + Math.floor(R() * 3); this.mistakeDir = R() * Math.PI * 2; }

    // --- 1. drifting over the void: try to save ourselves ---------------
    if (me.flags & FLAG.DRIFTING) {
      const safe = this.nearestSafe(game, me.x, me.y);
      let grab = null, gd = Infinity;
      for (const py of game.pylons) {
        const d = Math.hypot(py.x - me.x, py.y - me.y);
        if (d < PYLON.range * 0.95 && d < gd) { gd = d; grab = py; }
      }
      if (!grab) for (const f of foes) {
        const d = Math.hypot(f.x - me.x, f.y - me.y);
        if (d < PHYS.fieldRange * 0.9 && d < gd && !(f.flags & FLAG.DRIFTING)) { gd = d; grab = f; }
      }
      const canSave = R() < (this.level === 'easy' ? 0.45 : this.level === 'normal' ? 0.8 : 1);
      this.set(safe.x - me.x, safe.y - me.y, grab && canSave ? MODE.PULL : 0);
      return;
    }

    // --- 2. danger: about to slide off -----------------------------------
    const look = cfg.look;
    const ax = me.x + me.vx * look, ay = me.y + me.vy * look;
    const danger = !game.isGround(ax, ay) || !game.isGround(me.x + me.vx * look * 0.5, me.y + me.vy * look * 0.5);
    if (danger && speed > 80) {
      const safe = this.nearestSafe(game, me.x, me.y);
      // grapple to a pylon in a safe direction if we are going fast
      let mode = 0;
      if (speed > 420) {
        for (const py of game.pylons) {
          const d = Math.hypot(py.x - me.x, py.y - me.y);
          if (d < PYLON.range * 0.9 && game.isGround(py.x + (me.x - py.x) * 0.4, py.y + (me.y - py.y) * 0.4)) { mode = MODE.PULL; break; }
        }
        if (!mode && me.energy > 20 && this.level !== 'easy') mode = MODE.ANCHOR; // anchor = heavy drag, stops the slide
      }
      this.set((safe.x - me.x) / 60 - me.vx / 300, (safe.y - me.y) / 60 - me.vy / 300, mode);
      return;
    }

    // --- 3. threats: read glow tells and anchor ---------------------------
    let threat = null, threatScore = 0;
    for (const f of foes) {
      const dx = me.x - f.x, dy = me.y - f.y;
      const d = Math.hypot(dx, dy);
      if (d > PHYS.fieldRange) continue;
      const pushing = f.mode === MODE.PUSH;
      const telling = f.tell > 0 && f.pend === MODE.PUSH && R() < cfg.readTell;
      const closing = -((f.vx - me.vx) * dx + (f.vy - me.vy) * dy) / (d || 1);
      const charging = closing > 520 && d < 170 && R() < cfg.readTell;
      if (pushing || telling || charging || (f.flags & FLAG.ARMOR && closing > 300)) {
        const s = (1 - d / PHYS.fieldRange) + (charging ? 0.5 : 0);
        if (s > threatScore) { threatScore = s; threat = f; }
      }
    }
    const myEdge = this.edgeDistance(game, me.x, me.y);
    if (threat && (myEdge < 170 || threatScore > 0.75) && me.energy > 12) {
      // Push vs push repels both: if we have room behind, push back instead (hard bots)
      const pushBack = this.level === 'hard' && myEdge > 190 && threat.mode === MODE.PUSH && R() < 0.4;
      const safe = this.nearestSafe(game, me.x, me.y);
      this.set((safe.x - me.x) * 0.01, (safe.y - me.y) * 0.01, pushBack ? MODE.PUSH : MODE.ANCHOR);
      this.timer = Math.min(this.timer, 6);
      return;
    }

    // --- 4. surge -----------------------------------------------------------
    if (me.surge >= PHYS.surgeMax) {
      let good = 0, any = 0;
      for (const f of foes) {
        const d = Math.hypot(f.x - me.x, f.y - me.y);
        if (d < PHYS.surgeRange * 0.75) {
          any++;
          const fEdge = this.edgeDistance(game, f.x, f.y, 260);
          if (fEdge < 220 && f.mode !== MODE.ANCHOR) good++;
        }
      }
      if ((cfg.surgeSmart && (good >= 1 || any >= 3)) || (!cfg.surgeSmart && any >= 1 && R() < 0.3)) {
        this.set(0, 0, MODE.PUSH, true);
        this.input.mode = me.mode === MODE.PULL ? MODE.PULL : MODE.PUSH;
        // surge while pushing = everybody out
        if (me.mode !== MODE.PUSH && me.mode !== MODE.NEUTRAL) this.input.mode = me.mode;
        this.input.surge = true;
        return;
      }
    }

    // --- King of the Pole: get to the pole and stay there --------------------
    if (game.mode === 'kotp' && game.pole) {
      this.planPole(game, me, foes);
      return;
    }

    // --- 5. pick a target ---------------------------------------------------
    if (--this.targetTimer <= 0 || !game.players.get(this.target) || !(game.players.get(this.target).flags & FLAG.ALIVE)) {
      let best = null, bs = -Infinity;
      for (const f of foes) {
        const d = Math.hypot(f.x - me.x, f.y - me.y);
        const e = this.edgeDistance(game, f.x, f.y, 260);
        let s = -d * 0.004 - e * 0.006 + R() * 0.6;
        if (!(f.flags & FLAG.BOT)) s += 0.25; // humans are more fun to chase
        if (game.memory.lastKiller[me.id] === f.id) s += 0.5; // revenge
        if (s > bs) { bs = s; best = f; }
      }
      this.target = best ? best.id : -1;
      this.targetTimer = 40 + Math.floor(R() * 60);
    }
    const tgt = game.players.get(this.target);
    if (!tgt) { this.idle(game, me); return; }

    const dx = tgt.x - me.x, dy = tgt.y - me.y;
    const dist = Math.hypot(dx, dy) || 1;
    // the target's "outward" direction (away from the platform's heart)
    let ox = tgt.x - this.cx, oy = tgt.y - this.cy;
    const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
    // stand between the target and the center, then shove it outward
    const standX = tgt.x - ox * 120, standY = tgt.y - oy * 120;
    let mx = standX - me.x, my = standY - me.y;
    // aim noise
    const noise = (R() - 0.5) * cfg.aim * 2;
    const ca = Math.cos(noise), sa = Math.sin(noise);
    [mx, my] = [mx * ca - my * sa, mx * sa + my * ca];

    // alignment: are we "inside" the target relative to the void?
    const inward = (dx * ox + dy * oy) / dist; // 1 = perfectly lined up
    const tEdge = this.edgeDistance(game, tgt.x, tgt.y, 260);
    let mode = MODE.NEUTRAL;

    // --- debris as projectile: push when a block sits between us and the target
    if (R() < cfg.debris) {
      for (const b of game.debris) {
        if (!b.alive) continue;
        const bx = b.x - me.x, by = b.y - me.y;
        const bd = Math.hypot(bx, by);
        if (bd > 170 || bd > dist) continue;
        const along = (bx * dx + by * dy) / dist;
        const perp = Math.abs(bx * dy - by * dx) / dist;
        if (along > 0 && perp < 45) { mode = MODE.PUSH; break; }
      }
    }

    if (!mode && dist < PHYS.fieldRange * 0.75 && me.energy > PHYS.minEnergy + 5) {
      if (tgt.mode === MODE.ANCHOR) mode = MODE.NEUTRAL;           // pointless vs anchor
      else if (inward > 0.35 && R() < cfg.aggression) mode = MODE.PUSH;
      else if (tgt.mode === MODE.PULL && R() < 0.7) mode = MODE.PUSH; // push beats pull
      else if (tEdge > 200 && myEdge > 200 && inward < -0.2 && tgt.mode !== MODE.PUSH && dist > 120 && R() < 0.5) {
        // drag them toward us, then shove — set up a combo
        mode = MODE.PULL;
      }
    }

    // ramming: when lined up and close, charge straight through the target
    if (inward > 0.6 && dist < 200 && tEdge < 200) { mx = dx; my = dy; }

    // pylon dash toward a far target
    if (!mode && dist > 380 && me.energy > 40) {
      for (const py of game.pylons) {
        const px = me.x - py.x, pyy = me.y - py.y;
        const pd = Math.hypot(px, pyy);
        if (pd < 130 && (px * dx + pyy * dy) / (pd * dist) > 0.7) {
          const landX = me.x + dx / dist * 220, landY = me.y + dy / dist * 220;
          if (game.isGround(landX, landY)) { mode = MODE.PUSH; break; }
        }
      }
    }

    // keep a safety margin from our own edge
    if (myEdge < 90) {
      const safe = this.nearestSafe(game, me.x, me.y);
      mx = mx * 0.3 + (safe.x - me.x); my = my * 0.3 + (safe.y - me.y);
    }
    // conserve energy
    if (me.energy < 22 && mode !== MODE.ANCHOR) mode = MODE.NEUTRAL;
    this.set(mx / 80, my / 80, mode);
  }

  planPole(game, me, foes) {
    const pole = game.pole;
    const dx = pole.x - me.x, dy = pole.y - me.y;
    const d = Math.hypot(dx, dy);
    let mode = 0;
    let mx = dx, my = dy;
    const R = this.rand;
    if (d > 220 && d < PYLON.range && me.energy > 40) mode = MODE.PULL; // grapple to the pole
    // someone else is on the pole: knock them off
    for (const f of foes) {
      const fd = Math.hypot(f.x - me.x, f.y - me.y);
      if ((f.flags & FLAG.ON_POLE) && fd < 220 && me.energy > 25 && f.mode !== MODE.ANCHOR && R() < this.cfg.aggression) {
        mode = MODE.PUSH; mx = f.x - me.x; my = f.y - me.y;
      }
      if (f.mode === MODE.PUSH && fd < 200 && (me.flags & FLAG.ON_POLE) && R() < this.cfg.readTell) mode = MODE.ANCHOR;
    }
    if (d < 75 && mode === MODE.PULL) mode = 0;
    // orbit the pole a little so we don't get stuck behind it
    if (d < 80) { mx = -dy * 0.2 + dx; my = dx * 0.2 + dy; }
    if (me.energy < 18) mode = 0;
    this.set(mx / 60, my / 60, mode);
  }

  idle(game, me) {
    this.wander += (this.rand() - 0.5) * 0.8;
    let mx = Math.cos(this.wander), my = Math.sin(this.wander);
    const e = this.edgeDistance(game, me.x, me.y);
    if (e < 150) { mx = this.cx - me.x; my = this.cy - me.y; }
    this.set(mx * 0.5, my * 0.5, 0);
  }

  planGhost(game, me) {
    // haunt the living: float over whoever is closest to an edge and pulse
    let best = null, bs = Infinity;
    for (const p of game.players.values()) {
      if (!(p.flags & FLAG.ALIVE) || p === me) continue;
      let s = this.edgeDistance(game, p.x, p.y, 260);
      if (game.memory.lastKiller[me.id] === p.id) s -= 120; // revenge!
      if (s < bs) { bs = s; best = p; }
    }
    if (!best) { this.set(0, 0, 0); return; }
    // hover on the inside of the target so the pulse pushes it outward
    let ox = best.x - this.cx, oy = best.y - this.cy;
    const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
    const hx = best.x - ox * 70, hy = best.y - oy * 70;
    const d = Math.hypot(hx - me.x, hy - me.y);
    const ready = me.ghostCd <= 0 && d < 50 && bs < 200;
    this.set((hx - me.x) / 50, (hy - me.y) / 50, ready ? MODE.PUSH : 0);
    if (ready) this.timer = 2;
  }
}

export { LEVELS as BOT_LEVEL_CONFIG };
void DEBRIS;

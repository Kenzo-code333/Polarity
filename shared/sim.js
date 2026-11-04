// =============================================================================
// Polarity — authoritative round simulation.
//
// One `Game` instance simulates a single round (or the tutorial). It is pure
// JavaScript with no Node or browser dependencies, so the server runs it for
// real matches and the browser runs it locally for the offline tutorial.
// =============================================================================
import {
  PHYS, PYLON, POLE, DEBRIS, MODE, FLAG, DT, TICK_RATE,
  ROUND_TICKS, KOTP_TICKS, COUNTDOWN_TICKS, COLLAPSE_EVERY, COLLAPSE_WARN,
  KOTP_RESPAWN_TICKS, MODE_CSS,
} from './constants.js';
import { getArena, spawnPoints } from './arenas.js';
import { pixelToHex, hexKey } from './hex.js';
import {
  createPlayerState, stepSelf, stepGhost, integrate, collidePylons,
  fieldMagnitude, EMPTY_INPUT, POLE_SCALE,
} from './physics.js';

const R2 = PHYS.radius * 2;

export class Game {
  /**
   * @param {object} o
   * @param {'ffa'|'kotp'|'tutorial'} o.mode
   * @param {number} o.arena  arena index
   * @param {Array<{id:number,name:string,color:number}>} o.roster
   * @param {object} [o.memory] cross-round memory (revenge tracking)
   */
  constructor(o) {
    this.mode = o.mode || 'ffa';
    // tutorial & menu demo: endless, no collapse, instant respawns
    this.sandbox = this.mode === 'tutorial' || this.mode === 'demo';
    this.arena = getArena(o.arena);
    this.memory = o.memory || { lastKiller: {} };
    this.tick = 0;
    this.phase = this.sandbox ? 'play' : 'countdown';
    this.phaseTicks = COUNTDOWN_TICKS;
    this.playTick = 0;
    this.duration = this.mode === 'kotp' ? KOTP_TICKS : ROUND_TICKS;
    this.collapsed = 0;
    this.nextCollapse = COLLAPSE_EVERY;
    this.events = [];
    this.overTicks = 0;
    this.result = null;
    this.firstBlood = false;
    this.pylons = this.arena.pylons;
    this.pole = this.pylons.find(p => p.pole) || null;
    this.env = { pylons: this.pylons, frozen: false };

    // players
    this.players = new Map();
    this.names = new Map();
    const spawns = spawnPoints(this.arena, Math.max(2, o.roster.length));
    this.spawns = spawns;
    o.roster.forEach((m, i) => {
      const s = spawns[i % spawns.length];
      const p = createPlayerState(m.id, s.x, s.y);
      p.spawn = i;
      p.lastHitBy = -1; p.lastHitTick = -9999; p.lastHitCause = 'hit';
      p.drift = 0; p.driftPull = false; p.driftSpeed = 0;
      p.fallTicks = 0; p.respawn = 0; p.score = 0;
      p.nearCd = 0;
      p.koTicks = [];
      p.stats = { kos: 0, hits: 0, bigHit: 0, bestSave: 0, saves: 0, deathTick: -1, chaos: 0, surges: 0 };
      this.players.set(m.id, p);
      this.names.set(m.id, m.name || 'Player');
    });

    // debris
    this.debris = this.arena.debrisSpawns.map((s, i) => ({
      id: i, x: s.x, y: s.y, vx: 0, vy: 0, ang: i * 0.7, spin: 0,
      alive: true, owner: -1, ownerTick: -9999, respawn: 0, sx: s.x, sy: s.y,
    }));
  }

  // --------------------------------------------------------------------------
  // helpers
  // --------------------------------------------------------------------------
  get maxAliveLayer() { return this.arena.maxLayer - this.collapsed; }

  tileAt(x, y) {
    const h = pixelToHex(x, y);
    return this.arena.map.get(hexKey(h.q, h.r)) || null;
  }

  isGround(x, y) {
    const t = this.tileAt(x, y);
    return !!t && t.layer <= this.maxAliveLayer;
  }

  ev(k, data) { this.events.push({ k, t: this.tick, ...data }); }

  announce(text, color = '#ffffff', id = -1, big = true) {
    this.ev('ann', { text, color, id, big });
  }

  name(id) { return this.names.get(id) || '???'; }

  aliveCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.flags & FLAG.ALIVE) n++;
    return n;
  }

  // --------------------------------------------------------------------------
  // main step
  // --------------------------------------------------------------------------
  step(inputs) {
    this.tick++;
    const frozen = this.phase === 'countdown';
    this.env.frozen = frozen;

    if (this.phase === 'countdown') {
      if (this.phaseTicks % TICK_RATE === 0) this.ev('count', { n: this.phaseTicks / TICK_RATE });
      if (--this.phaseTicks <= 0) { this.phase = 'play'; this.ev('go', {}); }
    } else if (this.phase === 'play') {
      this.playTick++;
      if (!this.sandbox) this.updateCollapse();
    } else if (this.phase === 'over') {
      this.overTicks++;
    }

    // ---- per-player self step ---------------------------------------------
    const bounds = this.arena.extent + 120;
    for (const p of this.players.values()) {
      const inp = (inputs && inputs.get(p.id)) || EMPTY_INPUT;
      if (p.flags & FLAG.GHOST) {
        stepGhost(p, inp, bounds);
        const act = inp.mode !== MODE.NEUTRAL || inp.surge;
        if (act && !p.lastActionBtn && p.ghostCd <= 0 && this.phase === 'play') this.ghostPulse(p, inp.mode === MODE.PULL ? MODE.PULL : MODE.PUSH);
        p.lastActionBtn = act;
        continue;
      }
      if (p.flags & FLAG.FALLING) {
        p.fallTicks--;
        if (p.fallTicks <= 0) this.afterFall(p);
        continue;
      }
      if (!(p.flags & FLAG.ALIVE)) {
        // KotP: waiting to respawn
        if (p.respawn > 0 && --p.respawn === 0) this.respawnPlayer(p);
        continue;
      }
      const before = p.mode, pendBefore = p.pend;
      const e = stepSelf(p, inp, this.env);
      if (p.pend !== pendBefore && p.pend !== MODE.NEUTRAL) p.stats.chaos += 1;
      if (e === 'dash') { this.ev('dash', { id: p.id, x: p.x, y: p.y }); p.stats.chaos += 2; }
      if (before !== p.mode && p.mode !== MODE.NEUTRAL) this.ev('mode', { id: p.id, m: p.mode });
      if (inp.surge && !p.lastSurgeBtn && p.surge >= PHYS.surgeMax && !frozen && this.phase !== 'over') this.doSurge(p);
      p.lastSurgeBtn = inp.surge;
      if (p.armor > 0) p.flags |= FLAG.ARMOR; else p.flags &= ~FLAG.ARMOR;
    }

    if (!frozen) this.applyFields();

    // ---- integrate --------------------------------------------------------
    for (const p of this.players.values()) {
      if (!(p.flags & FLAG.ALIVE)) continue;
      integrate(p, this.pylons);
    }
    for (const d of this.debris) {
      if (!d.alive) { if (d.respawn > 0 && --d.respawn === 0) this.respawnDebris(d); continue; }
      const k = Math.exp(-DEBRIS.drag * DT);
      d.vx *= k; d.vy *= k;
      d.x += d.vx * DT; d.y += d.vy * DT;
      d.spin = d.spin * 0.985 + Math.hypot(d.vx, d.vy) * 0.00012 * Math.sign(d.vx * 0.7 + d.vy * 0.3 || 1);
      d.ang += d.spin;
      collidePylons(d, this.pylons, DEBRIS.radius);
    }

    this.collisions();
    this.groundChecks();
    if (this.mode === 'kotp' && this.phase === 'play') this.poleScoring();
    if (this.phase === 'play') this.endCheck();
  }

  // --------------------------------------------------------------------------
  // tiles collapsing
  // --------------------------------------------------------------------------
  updateCollapse() {
    if (this.collapsed >= this.arena.maxCollapses) return;
    const until = this.nextCollapse - this.playTick;
    if (until === COLLAPSE_WARN) this.ev('crack', { layer: this.maxAliveLayer });
    if (until <= 0) {
      const layer = this.maxAliveLayer;
      this.collapsed++;
      this.nextCollapse += COLLAPSE_EVERY;
      this.ev('collapse', { layer });
      if (this.collapsed >= this.arena.maxCollapses && this.mode === 'ffa') this.announce('SUDDEN DEATH!', '#ff9a3c');
    }
  }

  collapseInfo() {
    if (this.sandbox || this.collapsed >= this.arena.maxCollapses || this.phase !== 'play') return { next: -1, warn: 0 };
    const until = this.nextCollapse - this.playTick;
    return { next: until, warn: until <= COLLAPSE_WARN ? until : 0 };
  }

  // --------------------------------------------------------------------------
  // magnetic fields between players and debris
  // --------------------------------------------------------------------------
  applyFields() {
    const R = PHYS.fieldRange;
    const list = [...this.players.values()];
    for (const s of list) {
      if (!(s.flags & FLAG.ALIVE)) continue;
      if (s.mode !== MODE.PULL && s.mode !== MODE.PUSH) continue;
      const sDrift = (s.flags & FLAG.DRIFTING) !== 0;
      for (const t of list) {
        if (t === s || !(t.flags & FLAG.ALIVE)) continue;
        if (t.mode === MODE.ANCHOR) continue;               // anchors ignore fields
        if (s.mode === MODE.PULL && t.mode === MODE.PUSH) continue; // pushers stay steady
        const dx = s.x - t.x, dy = s.y - t.y;
        const d = Math.hypot(dx, dy);
        if (d >= R || d < 1) continue;
        let mag = fieldMagnitude(s.mode, d);
        if (s.mode === MODE.PULL && t.mode === MODE.PULL) mag *= PHYS.pullVsPull;
        if (s.mode === MODE.PUSH && t.mode === MODE.PUSH) mag *= PHYS.pushVsPush;
        if (s.mode === MODE.PUSH && t.mode === MODE.PULL) mag *= PHYS.pushVsPull;
        if (t.armor > 0) mag *= 0.3;
        if (mag > 0 && d < R2 + 3) mag *= 0.2;              // already touching: don't jitter
        const nx = dx / d, ny = dy / d;
        t.vx += nx * mag * DT; t.vy += ny * mag * DT;
        // a drifting puller hauls itself toward its victim (and drags it down)
        if (sDrift && s.mode === MODE.PULL && d > R2 + 3) {
          s.vx -= nx * mag * 0.9 * DT; s.vy -= ny * mag * 0.9 * DT;
        }
        if (Math.abs(mag) > 480) this.credit(t, s.id, sDrift ? 'drag' : 'field');
      }
      for (const b of this.debris) {
        if (!b.alive) continue;
        const dx = s.x - b.x, dy = s.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d >= R || d < 1) continue;
        let mag = fieldMagnitude(s.mode, d) * DEBRIS.fieldFactor;
        if (mag > 0 && d < PHYS.radius + DEBRIS.radius + 4) mag *= 0.1;
        b.vx += dx / d * mag * DT; b.vy += dy / d * mag * DT;
        if (s.mode === MODE.PUSH || d < 160) { b.owner = s.id; b.ownerTick = this.tick; }
      }
    }
  }

  credit(victim, by, cause) {
    if (by === victim.id) return;
    victim.lastHitBy = by; victim.lastHitTick = this.tick; victim.lastHitCause = cause;
  }

  // --------------------------------------------------------------------------
  // surge & ghost pulses
  // --------------------------------------------------------------------------
  doSurge(p) {
    const m = p.mode === MODE.NEUTRAL ? MODE.PUSH : p.mode;
    p.surge = 0;
    p.armor = m === MODE.ANCHOR ? 80 : PHYS.surgeArmorTicks;
    p.stats.surges++; p.stats.chaos += 6;
    this.ev('surge', { id: p.id, m, x: p.x, y: p.y });
    this.announce('SURGE!', MODE_CSS[m], p.id);
    const R = m === MODE.ANCHOR ? PHYS.surgeRange * 0.8 : PHYS.surgeRange;
    const hit = (t, isDebris) => {
      const dx = t.x - p.x, dy = t.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > R || d < 1) return;
      const c = 1 - d / R;
      let imp;
      if (m === MODE.PULL) imp = -PHYS.surgePull * (0.45 + 0.55 * c);
      else if (m === MODE.ANCHOR) imp = PHYS.surgeAnchor * (0.3 + 0.7 * c);
      else imp = PHYS.surgePush * (0.35 + 0.65 * c);
      if (!isDebris && t.mode === MODE.ANCHOR) imp *= 0.35;
      if (isDebris) imp *= 1.2;
      t.vx += dx / d * imp; t.vy += dy / d * imp;
      if (isDebris) { t.owner = p.id; t.ownerTick = this.tick; }
      else this.credit(t, p.id, 'surge');
    };
    for (const t of this.players.values()) if (t !== p && (t.flags & FLAG.ALIVE)) hit(t, false);
    for (const b of this.debris) if (b.alive) hit(b, true);
  }

  ghostPulse(g, m) {
    g.ghostCd = PHYS.ghostPulseTicks;
    g.stats.chaos += 2;
    this.ev('pulse', { id: g.id, m, x: g.x, y: g.y });
    const R = PHYS.ghostPulseRange;
    const hit = (t, isDebris) => {
      const dx = t.x - g.x, dy = t.y - g.y;
      const d = Math.hypot(dx, dy);
      if (d > R || d < 1) return;
      let imp = PHYS.ghostPulseForce * (0.5 + 0.5 * (1 - d / R)) * (m === MODE.PULL ? -0.8 : 1);
      if (!isDebris && t.mode === MODE.ANCHOR) imp *= 0.25;
      t.vx += dx / d * imp; t.vy += dy / d * imp;
      if (isDebris) { t.owner = g.id; t.ownerTick = this.tick; }
      else this.credit(t, g.id, 'ghost');
    };
    for (const t of this.players.values()) if (t !== g && (t.flags & FLAG.ALIVE)) hit(t, false);
    for (const b of this.debris) if (b.alive) hit(b, true);
  }

  // --------------------------------------------------------------------------
  // collisions (momentum based: the faster body wins the hit)
  // --------------------------------------------------------------------------
  massOf(p) { return (p.mode === MODE.ANCHOR || p.armor > 0) ? PHYS.anchorMass : PHYS.mass; }

  collisions() {
    const list = [];
    for (const p of this.players.values()) if (p.flags & FLAG.ALIVE) list.push(p);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.nearCd > 0) a.nearCd--;
      for (let j = i + 1; j < list.length; j++) this.collidePlayers(a, list[j]);
      for (const d of this.debris) if (d.alive) this.collidePlayerDebris(a, d);
    }
    for (let i = 0; i < this.debris.length; i++) {
      const a = this.debris[i]; if (!a.alive) continue;
      for (let j = i + 1; j < this.debris.length; j++) {
        const b = this.debris[j]; if (!b.alive) continue;
        resolveCircles(a, b, DEBRIS.radius * 2, DEBRIS.mass, DEBRIS.mass, 0.8);
      }
    }
  }

  collidePlayers(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= R2 * R2) {
      // near miss: fast pass within a whisker charges Surge
      if (d2 < (R2 + 30) * (R2 + 30) && a.nearCd === 0 && b.nearCd === 0) {
        const rv = Math.hypot(a.vx - b.vx, a.vy - b.vy);
        if (rv > 560) {
          a.surge = Math.min(PHYS.surgeMax, a.surge + PHYS.surgeNearMiss);
          b.surge = Math.min(PHYS.surgeMax, b.surge + PHYS.surgeNearMiss);
          a.nearCd = b.nearCd = 45;
          this.ev('near', { a: a.id, b: b.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        }
      }
      return;
    }
    if (d2 < 0.0001) { b.x += 0.5; return; }
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
    const ma = this.massOf(a), mb = this.massOf(b);
    // pre-impact speeds along the normal decide who is the attacker
    const sa = a.vx * nx + a.vy * ny;          // a moving toward b
    const sb = -(b.vx * nx + b.vy * ny);       // b moving toward a
    const closing = sa + sb;
    // separate
    const overlap = R2 - d;
    const tot = ma + mb;
    a.x -= nx * overlap * (mb / tot); a.y -= ny * overlap * (mb / tot);
    b.x += nx * overlap * (ma / tot); b.y += ny * overlap * (ma / tot);
    if (closing <= 0) return;
    const e = PHYS.restitution;
    const J = (1 + e) * closing / (1 / ma + 1 / mb);
    a.vx -= J / ma * nx; a.vy -= J / ma * ny;
    b.vx += J / mb * nx; b.vy += J / mb * ny;

    // who won the hit?
    let atk, vic, dir;
    if (ma !== mb) { atk = ma > mb ? a : b; vic = ma > mb ? b : a; }
    else if (sa >= sb) { atk = a; vic = b; } else { atk = b; vic = a; }
    dir = vic === b ? 1 : -1;
    const vm = this.massOf(vic);
    if (vm === PHYS.mass) {
      const bonus = closing * PHYS.knockBonus * Math.min(1.5, Math.max(0.35, closing / 800));
      vic.vx += nx * dir * bonus; vic.vy += ny * dir * bonus;
    }
    if (closing > PHYS.hitMinImpact) {
      const cx = a.x + nx * PHYS.radius, cy = a.y + ny * PHYS.radius;
      this.ev('hit', { a: atk.id, b: vic.id, x: cx, y: cy, i: Math.round(closing), nx: nx * dir, ny: ny * dir });
      this.credit(vic, atk.id, 'hit');
      atk.surge = Math.min(PHYS.surgeMax, atk.surge + Math.min(25, closing * PHYS.surgePerImpact));
      vic.surge = Math.min(PHYS.surgeMax, vic.surge + closing * PHYS.surgePerImpact * 0.3);
      atk.stats.hits++; atk.stats.chaos += 1;
      if (closing > atk.stats.bigHit) atk.stats.bigHit = Math.round(closing);
      if (closing > PHYS.hugeHit) this.announce(closing > PHYS.hugeHit * 1.4 ? 'HOME RUN!' : 'SMASH!', '#ffd23f', atk.id, false);
    }
  }

  collidePlayerDebris(p, b) {
    const dx = b.x - p.x, dy = b.y - p.y;
    const min = PHYS.radius + DEBRIS.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min || d2 < 0.0001) return;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
    const sp = p.vx * nx + p.vy * ny;
    const sb = -(b.vx * nx + b.vy * ny);
    const closing = sp + sb;
    const mp = this.massOf(p);
    const res = resolveCircles(p, b, min, mp, DEBRIS.mass, 0.85);
    if (res <= 0) return;
    // debris slamming into a player: a projectile hit
    if (sb > sp && sb > DEBRIS.hitSpeed && mp === PHYS.mass) {
      const bonus = closing * 0.3;
      p.vx -= nx * bonus; p.vy -= ny * bonus;
      const owner = (b.owner >= 0 && this.tick - b.ownerTick < 240 && b.owner !== p.id) ? b.owner : -1;
      this.ev('hit', { a: owner, b: p.id, x: p.x + nx * PHYS.radius, y: p.y + ny * PHYS.radius, i: Math.round(closing), nx: -nx, ny: -ny, deb: 1 });
      if (owner >= 0) {
        this.credit(p, owner, 'debris');
        const o = this.players.get(owner);
        if (o) { o.surge = Math.min(PHYS.surgeMax, o.surge + Math.min(20, closing * PHYS.surgePerImpact)); o.stats.hits++; o.stats.chaos += 2; if (closing > o.stats.bigHit) o.stats.bigHit = Math.round(closing); }
      }
    }
  }

  // --------------------------------------------------------------------------
  // edges, drifting, falling, KOs
  // --------------------------------------------------------------------------
  groundChecks() {
    for (const p of this.players.values()) {
      if (!(p.flags & FLAG.ALIVE)) continue;
      const ground = this.isGround(p.x, p.y);
      const drifting = (p.flags & FLAG.DRIFTING) !== 0;
      if (!drifting && !ground) {
        p.flags |= FLAG.DRIFTING;
        p.drift = PHYS.driftTicks; p.driftPull = false;
        p.driftSpeed = Math.hypot(p.vx, p.vy);
        this.ev('edge', { id: p.id, x: p.x, y: p.y });
      } else if (drifting) {
        if (p.mode === MODE.PULL || p.pend === MODE.PULL) p.driftPull = true;
        if (ground) {
          p.flags &= ~FLAG.DRIFTING;
          const used = PHYS.driftTicks - p.drift;
          if (p.driftPull && used >= 8) {
            p.stats.saves++;
            const quality = Math.round(p.driftSpeed + used * 10);
            if (quality > p.stats.bestSave) p.stats.bestSave = quality;
            p.surge = Math.min(PHYS.surgeMax, p.surge + 12);
            this.ev('save', { id: p.id, x: p.x, y: p.y });
            this.announce('CLUTCH SAVE!', '#7dff5a', p.id);
          }
        } else if (--p.drift <= 0) {
          this.fall(p);
        }
      }
    }
    for (const b of this.debris) {
      if (!b.alive) continue;
      if (!this.isGround(b.x, b.y)) {
        b.alive = false; b.respawn = DEBRIS.respawnTicks;
        this.ev('dfall', { id: b.id, x: b.x, y: b.y, vx: Math.round(b.vx), vy: Math.round(b.vy) });
      }
    }
  }

  fall(p) {
    p.flags &= ~(FLAG.ALIVE | FLAG.DRIFTING | FLAG.ON_POLE);
    p.flags |= FLAG.FALLING;
    p.fallTicks = PHYS.fallTicks;
    p.mode = MODE.NEUTRAL; p.pend = MODE.NEUTRAL; p.tell = 0;
    p.stats.deathTick = this.playTick;
    this.ev('fall', { id: p.id, x: p.x, y: p.y, vx: Math.round(p.vx), vy: Math.round(p.vy) });

    const credited = p.lastHitBy >= 0 && p.lastHitBy !== p.id && this.tick - p.lastHitTick <= PHYS.koCreditTicks;
    const killer = credited ? this.players.get(p.lastHitBy) : null;
    const cause = credited ? p.lastHitCause : 'self';
    const ko = { v: p.id, by: killer ? killer.id : -1, cause, final: false };
    if (killer) {
      killer.stats.kos++;
      killer.surge = Math.min(PHYS.surgeMax, killer.surge + PHYS.surgeOnKo);
      killer.koTicks = killer.koTicks.filter(t => this.tick - t < 3 * TICK_RATE);
      killer.koTicks.push(this.tick);
      const kname = this.name(killer.id);
      const n = killer.koTicks.length;
      const kGhost = (killer.flags & FLAG.GHOST) !== 0;
      const kFalling = (killer.flags & FLAG.FALLING) !== 0;
      if (this.memory.lastKiller[killer.id] === p.id) {
        this.announce('REVENGE!', '#ff4fd8', killer.id);
        delete this.memory.lastKiller[killer.id];
      } else if (n >= 3) this.announce(n === 3 ? 'TRIPLE KO!' : 'MEGA KO!', '#ffd23f', killer.id);
      else if (n === 2) this.announce('DOUBLE KO!', '#ffd23f', killer.id);
      else if (kGhost) this.announce('GHOST REVENGE!', '#b8a8ff', killer.id);
      else if (kFalling || cause === 'drag') this.announce('DRAGGED DOWN!', '#ff7a2f', killer.id);
      else if (cause === 'debris') this.announce('BULLSEYE!', '#ffb347', killer.id, false);
      else if (!this.firstBlood && this.mode === 'ffa') this.announce('FIRST BLOOD!', '#ff3352', killer.id, false);
      this.memory.lastKiller[p.id] = killer.id;
      this.firstBlood = true;
      void kname;
    } else {
      this.announce('SELF-DESTRUCT!', '#ff7a2f', p.id, false);
    }
    this.ev('ko', ko);
    this.lastKo = this.events[this.events.length - 1];
  }

  afterFall(p) {
    p.flags &= ~FLAG.FALLING;
    if (this.mode === 'kotp' || this.sandbox) {
      p.respawn = this.mode === 'tutorial' ? 30 : this.sandbox ? 90 : KOTP_RESPAWN_TICKS;
      return;
    }
    // become a ghost hovering above the arena
    p.flags |= FLAG.GHOST;
    const d = Math.hypot(p.x, p.y), lim = this.arena.extent * 0.85;
    if (d > lim) { p.x *= lim / d; p.y *= lim / d; }
    p.vx = 0; p.vy = 0;
    p.ghostCd = 2 * TICK_RATE;
    this.ev('ghost', { id: p.id });
  }

  respawnPlayer(p, x, y) {
    // choose the spawn point farthest from other living players
    if (x === undefined) {
      let best = this.spawns[0], bd = -1;
      for (const s of this.spawns) {
        if (!this.isGround(s.x, s.y)) continue;
        let md = Infinity;
        for (const o of this.players.values()) if (o !== p && (o.flags & FLAG.ALIVE)) md = Math.min(md, Math.hypot(o.x - s.x, o.y - s.y));
        if (md > bd) { bd = md; best = s; }
      }
      x = best.x; y = best.y;
    }
    p.x = x; p.y = y; p.vx = 0; p.vy = 0;
    p.flags = FLAG.ALIVE | (p.flags & FLAG.BOT);
    p.mode = MODE.NEUTRAL; p.pend = MODE.NEUTRAL; p.tell = 0; p.cd = 0;
    p.energy = PHYS.energyMax; p.armor = 60; p.drift = 0;
    p.lastHitBy = -1;
    this.ev('spawn', { id: p.id, x, y });
  }

  respawnDebris(b) {
    let x = b.sx, y = b.sy;
    if (!this.isGround(x, y)) {
      let best = null, bd = Infinity;
      for (const t of this.arena.tiles) {
        if (t.layer > this.maxAliveLayer) continue;
        const dd = (t.x - b.sx) ** 2 + (t.y - b.sy) ** 2;
        if (dd < bd && this.pylons.every(p => Math.hypot(p.x - t.x, p.y - t.y) > 70)) { bd = dd; best = t; }
      }
      if (!best) return;
      x = best.x; y = best.y;
    }
    Object.assign(b, { x, y, vx: 0, vy: 0, alive: true, owner: -1, spin: 0 });
    this.ev('dspawn', { id: b.id, x, y });
  }

  // --------------------------------------------------------------------------
  // King of the Pole
  // --------------------------------------------------------------------------
  poleScoring() {
    if (!this.pole) return;
    const reach = POLE.radius + PHYS.radius + 10;
    let toucher = null, count = 0;
    for (const p of this.players.values()) {
      p.flags &= ~FLAG.ON_POLE;
      if (!(p.flags & FLAG.ALIVE)) continue;
      if (Math.hypot(p.x - this.pole.x, p.y - this.pole.y) <= reach) {
        p.flags |= FLAG.ON_POLE; toucher = p; count++;
      }
    }
    if (count === 1 && this.playTick % POLE.scoreEvery === 0) toucher.score++;
  }

  // --------------------------------------------------------------------------
  // round end
  // --------------------------------------------------------------------------
  endCheck() {
    if (this.sandbox) return;
    const timeUp = this.playTick >= this.duration;
    if (this.mode === 'kotp') {
      if (timeUp) {
        let best = null;
        for (const p of this.players.values()) if (!best || p.score > best.score) best = p;
        this.end(best ? best.id : -1, 'time');
      }
      return;
    }
    const alive = [];
    for (const p of this.players.values()) if (p.flags & FLAG.ALIVE) alive.push(p);
    if (this.players.size >= 2 && alive.length <= 1) {
      if (alive.length === 1) {
        this.announce('LAST ONE STANDING!', '#ffffff', alive[0].id);
        this.end(alive[0].id, 'last');
      } else {
        this.announce('NO SURVIVORS!', '#ff7a2f');
        this.end(-1, 'none');
      }
      if (this.lastKo && this.tick - this.lastKo.t < 2) this.lastKo.final = true;
    } else if (timeUp) {
      this.announce('TIME!', '#ffffff');
      this.end(-1, 'time');
    }
  }

  end(winner, reason) {
    this.phase = 'over';
    this.overTicks = 0;
    for (const p of this.players.values()) if ((p.flags & FLAG.ALIVE) && p.stats.deathTick < 0) p.stats.deathTick = this.playTick;
    this.result = { winner, reason };
    this.ev('over', { winner, reason });
  }

  // --------------------------------------------------------------------------
  // compact snapshot for the network
  // --------------------------------------------------------------------------
  snapshot() {
    const ci = this.collapseInfo();
    const p = [];
    for (const s of this.players.values()) {
      p.push([
        s.id, Math.round(s.x * 10), Math.round(s.y * 10), Math.round(s.vx), Math.round(s.vy),
        s.mode, s.pend, s.tell, s.cd, Math.round(s.energy * 10), Math.round(s.surge), s.flags,
        s.ghostCd, s.score, s.armor, s.rech, s.drift,
      ]);
    }
    const d = [];
    for (const b of this.debris) {
      d.push([b.id, Math.round(b.x * 10), Math.round(b.y * 10), Math.round(b.vx), Math.round(b.vy), Math.round(b.ang * 100), b.alive ? 1 : 0]);
    }
    const PH = { countdown: 0, play: 1, over: 2 };
    return {
      ph: PH[this.phase], tk: this.tick, tl: Math.max(0, this.duration - this.playTick), cl: this.collapsed,
      nc: ci.next, cw: ci.warn, cd: this.phase === 'countdown' ? this.phaseTicks : 0,
      p, d,
    };
  }
}

/** Generic circle-circle resolution; returns closing speed (<=0 if separating). */
function resolveCircles(a, b, min, ma, mb, e) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min || d2 < 0.0001) return 0;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
  const overlap = min - d, tot = ma + mb;
  a.x -= nx * overlap * (mb / tot); a.y -= ny * overlap * (mb / tot);
  b.x += nx * overlap * (ma / tot); b.y += ny * overlap * (ma / tot);
  const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (closing <= 0) return 0;
  const J = (1 + e) * closing / (1 / ma + 1 / mb);
  a.vx -= J / ma * nx; a.vy -= J / ma * ny;
  b.vx += J / mb * nx; b.vy += J / mb * ny;
  return closing;
}

export { POLE_SCALE, PYLON };

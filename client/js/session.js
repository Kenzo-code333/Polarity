// =============================================================================
// Sessions turn simulation state into a smooth per-frame "view" for rendering.
//
//  NetSession   — online play. Buffers server snapshots and renders other
//                 entities ~100 ms in the past with interpolation, while the
//                 local player is predicted ahead using the shared physics
//                 and reconciled smoothly when the server disagrees.
//  LocalSession — runs the shared Game locally (tutorial / menu demo).
// =============================================================================
import { TICK_MS, DT, FLAG, MODE } from '/shared/constants.js';
import { getArena } from '/shared/arenas.js';
import { stepSelf, stepGhost, integrate, EMPTY_INPUT } from '/shared/physics.js';

const PH_NAMES = ['countdown', 'play', 'over'];
const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function decodePlayer(a) {
  return {
    id: a[0], x: a[1] / 10, y: a[2] / 10, vx: a[3], vy: a[4], mode: a[5], pend: a[6], tell: a[7], cd: a[8],
    energy: a[9] / 10, surge: a[10], flags: a[11], ghostCd: a[12], score: a[13], armor: a[14], rech: a[15], drift: a[16],
  };
}
function decodeDebris(a) {
  return { id: a[0], x: a[1] / 10, y: a[2] / 10, vx: a[3], vy: a[4], ang: a[5] / 100, alive: a[6] === 1 };
}

let globalSeq = 1;  // input sequence numbers never repeat for the life of the page

// -----------------------------------------------------------------------------
class BaseSession {
  constructor({ arena, mode, selfId }) {
    this.arena = getArena(arena);
    this.mode = mode;
    this.selfId = selfId;
    this.onEvent = () => {};
    this.freezeLeft = 0;
    this.lag = 0;
    this.slowLeft = 0;
    this.slowScale = 1;
    this.view = null;
  }
  /** brief hit-stop: hold the current frame */
  freeze(ms) { this.freezeLeft = Math.max(this.freezeLeft, ms); }
  /** slow motion: world time runs at `scale` for `ms` */
  slowmo(ms, scale = 0.3) { this.slowLeft = ms; this.slowScale = scale; }
  timeWarp(dt) {
    if (this.slowLeft > 0) { this.slowLeft -= dt; this.lag += dt * (1 - this.slowScale); }
    else if (this.lag > 0) this.lag = Math.max(0, this.lag - dt * 0.6);
    this.lag = Math.min(this.lag, 1400);
  }
  destroy() {}
}

// -----------------------------------------------------------------------------
export class NetSession extends BaseSession {
  constructor(net, opts) {
    super(opts);
    this.net = net;
    this.isLocal = false;
    this.buffer = [];
    this.queue = [];             // pending events {time, ev}
    this.acc = 0;
    this.pred = null;            // predicted local player state
    this.prev = { x: 0, y: 0 };  // predicted position one tick earlier (for render smoothing)
    this.pending = [];           // unacknowledged inputs
    this.history = new Map();    // seq -> predicted velocity (for external-force estimation)
    this.ext = { x: 0, y: 0 };   // estimated external acceleration (fields we can't predict)
    this.offset = { x: 0, y: 0 };// visual error offset, decays to zero
    this.lastAck = -1;
    this.late = [];              // snapshot lateness samples
    this.delay = 110;            // render delay behind the snapshot stream
    this.lateBase = 60;
    this.lastSnapAt = 0;
    this.snapCount = 0;
    this.snapIntervals = [];
    this.lastTk = 0;
    this.tickRateMeasured = 60;
    this.predError = 0;
    this.selfSource = 'pred';
    this.usePrediction = true;
    this.lastSelfRender = null;
  }

  onSnapshot(s) {
    this.net.observeSnapshot(s.ts);
    const now = this.net.serverNow();
    // measure how late snapshots arrive (one-way latency + jitter)
    const lateness = now - s.ts;
    this.late.push(lateness);
    if (this.late.length > 30) this.late.shift();
    const avg = this.late.reduce((a, b) => a + b, 0) / this.late.length;
    const dev = Math.sqrt(this.late.reduce((a, b) => a + (b - avg) ** 2, 0) / this.late.length);
    const base = this.net.offline ? 40 : 100; // no network jitter offline
    const target = Math.max(0, avg) + base + Math.min(80, dev * 1.5);
    this.delay = this.snapCount < 3 ? target : lerp(this.delay, target, 0.05);
    const pnow = performance.now();
    if (this.lastSnapAt) { this.snapIntervals.push(pnow - this.lastSnapAt); if (this.snapIntervals.length > 40) this.snapIntervals.shift(); }
    if (this.lastTk && s.rt > this.lastTk) {
      const dts = s.ts - this.lastTs;
      if (dts > 0) this.tickRateMeasured = lerp(this.tickRateMeasured, (s.rt - this.lastTk) / dts * 1000, 0.2);
    }
    this.lastTk = s.rt; this.lastTs = s.ts;
    this.lastSnapAt = pnow;
    this.snapCount++;

    const snap = {
      ts: s.ts, tk: s.tk, phase: PH_NAMES[s.ph] || 'play', tl: s.tl, cl: s.cl, nc: s.nc, cw: s.cw, cd: s.cd,
      players: new Map(), debris: new Map(),
    };
    for (const a of s.p) { const p = decodePlayer(a); snap.players.set(p.id, p); }
    for (const a of s.d) { const d = decodeDebris(a); snap.debris.set(d.id, d); }
    // keep the buffer ordered and ~3 s long
    if (this.buffer.length && snap.ts <= this.buffer[this.buffer.length - 1].ts) return;
    this.buffer.push(snap);
    while (this.buffer.length > 2 && this.buffer[1].ts < s.ts - 3000) this.buffer.shift();
    this.latest = snap;

    for (const ev of s.e || []) {
      const time = s.ts - (s.tk - ev.t) * TICK_MS;
      this.queue.push({ time, ev });
    }
    this.queue.sort((a, b) => a.time - b.time);

    this.reconcile(snap, s.a);
  }

  /** Re-base the predicted local player on authoritative state, replay inputs. */
  reconcile(snap, ack) {
    const S = snap.players.get(this.selfId);
    if (!S || !this.usePrediction) { this.pred = null; return; }
    const predictable = (S.flags & FLAG.ALIVE) || (S.flags & FLAG.GHOST);
    if (!predictable) { this.pred = null; return; }

    const old = this.pred ? { x: this.pred.x, y: this.pred.y } : null;
    // estimate external acceleration (fields from others) from the velocity error
    if (this.pred && ack > this.lastAck && this.history.has(ack) && (S.flags & FLAG.ALIVE)) {
      const h = this.history.get(ack);
      const n = Math.max(1, ack - this.lastAck);
      const dvx = S.vx - h.vx, dvy = S.vy - h.vy;
      const per = Math.hypot(dvx, dvy) / n;
      if (per < 45 && S.mode !== MODE.ANCHOR) {
        this.ext.x = lerp(this.ext.x, this.ext.x + dvx / (n * DT) * 0.8, 0.5);
        this.ext.y = lerp(this.ext.y, this.ext.y + dvy / (n * DT) * 0.8, 0.5);
      } else { this.ext.x *= 0.3; this.ext.y *= 0.3; }
      const el = Math.hypot(this.ext.x, this.ext.y);
      if (el > 2600) { this.ext.x *= 2600 / el; this.ext.y *= 2600 / el; }
    }
    if (S.mode === MODE.ANCHOR || !(S.flags & FLAG.ALIVE)) { this.ext.x = 0; this.ext.y = 0; }
    if (ack >= 0) this.lastAck = ack;
    for (const k of this.history.keys()) if (k <= ack) this.history.delete(k);

    // authoritative state
    const p = { ...S, lastSurgeBtn: false, lastActionBtn: false };
    // replay inputs the server hasn't processed yet
    this.pending = this.pending.filter(i => i.seq > ack);
    if (this.pending.length > 90) this.pending.splice(0, this.pending.length - 90);
    const frozen = snap.phase === 'countdown';
    for (const i of this.pending) this.stepPredicted(p, i.inp, frozen);
    this.pred = p;
    if (old) {
      const dx = old.x - p.x, dy = old.y - p.y;
      this.predError = Math.hypot(dx, dy);
      this.offset.x += dx; this.offset.y += dy;
      this.prev.x -= dx; this.prev.y -= dy;
      if (Math.hypot(this.offset.x, this.offset.y) > 260) { this.offset.x = 0; this.offset.y = 0; this.prev.x = p.x; this.prev.y = p.y; }
    } else { this.prev.x = p.x; this.prev.y = p.y; }
  }

  stepPredicted(p, inp, frozen) {
    if (p.flags & FLAG.GHOST) {
      stepGhost(p, inp, this.arena.extent + 120);
      return;
    }
    if (!(p.flags & FLAG.ALIVE)) return;
    stepSelf(p, inp, { pylons: this.arena.pylons, frozen });
    if (!frozen) { p.vx += this.ext.x * DT; p.vy += this.ext.y * DT; }
    integrate(p, this.arena.pylons);
  }

  /** Per animation frame. sampleInput() returns the current local input. */
  update(dt, sampleInput) {
    // fixed-rate local ticks: sample + send input, advance prediction
    this.acc += dt;
    if (this.acc > 250) this.acc = 250;
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      const inp = sampleInput ? sampleInput() : EMPTY_INPUT;
      const seq = globalSeq++;
      this.net.sendInput(seq, inp);
      this.pending.push({ seq, inp });
      if (this.pred) {
        this.prev.x = this.pred.x; this.prev.y = this.pred.y;
        const frozen = this.latest && this.latest.phase === 'countdown';
        this.stepPredicted(this.pred, inp, frozen);
        this.history.set(seq, { vx: this.pred.vx, vy: this.pred.vy });
        if (this.history.size > 200) this.history.delete(this.history.keys().next().value);
      }
    }
    const dk = Math.exp(-dt / 1000 * 9);
    this.offset.x *= dk; this.offset.y *= dk;

    if (this.freezeLeft > 0) { this.freezeLeft -= dt; if (this.view) return this.view; }
    this.timeWarp(dt);

    const renderTime = this.net.serverNow() - this.delay - this.lag;
    this.renderTime = renderTime;
    const view = this.interpolate(renderTime);
    if (!view) return this.view;

    // local player: predicted (instant) unless we're in slow-mo / not predictable
    const selfInterp = view.players.get(this.selfId);
    if (selfInterp) {
      const usePred = this.pred && this.lag < 1 && !(selfInterp.flags & FLAG.FALLING);
      const a = this.acc / TICK_MS;
      let sx, sy, src;
      if (usePred) {
        const p = this.pred;
        sx = lerp(this.prev.x, p.x, a) + this.offset.x;
        sy = lerp(this.prev.y, p.y, a) + this.offset.y;
        src = 'pred';
        Object.assign(selfInterp, {
          vx: p.vx, vy: p.vy, mode: p.mode, pend: p.pend, tell: p.tell, cd: p.cd, energy: p.energy,
          ghostCd: p.ghostCd,
        });
      } else { sx = selfInterp.x; sy = selfInterp.y; src = 'interp'; }
      // switching between sources: absorb the jump into the smoothing offset
      if (this.lastSelfRender && src !== this.selfSource) {
        const jx = this.lastSelfRender.x - sx, jy = this.lastSelfRender.y - sy;
        if (Math.hypot(jx, jy) < 200) { this.offset.x += jx; this.offset.y += jy; sx += jx; sy += jy; }
      }
      this.selfSource = src;
      selfInterp.x = sx; selfInterp.y = sy;
      this.lastSelfRender = { x: sx, y: sy };
    }

    // fire events that have "happened" at the render time
    while (this.queue.length && this.queue[0].time <= renderTime) {
      const { ev } = this.queue.shift();
      this.onEvent(ev);
    }
    this.view = view;
    return view;
  }

  interpolate(rt) {
    const buf = this.buffer;
    if (!buf.length) return null;
    let s0 = buf[0], s1 = buf[0];
    if (rt >= buf[buf.length - 1].ts) { s0 = s1 = buf[buf.length - 1]; }
    else {
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].ts <= rt) { s0 = buf[i]; s1 = buf[i + 1] || buf[i]; break; }
      }
    }
    const span = s1.ts - s0.ts;
    const t = span > 0 ? Math.max(0, Math.min(1, (rt - s0.ts) / span)) : 0;
    // extrapolate a little when we run out of snapshots (late packet)
    const extra = s0 === s1 ? Math.min(0.1, Math.max(0, (rt - s0.ts) / 1000)) : 0;
    const near = t < 0.5 ? s0 : s1;
    const players = new Map();
    for (const [id, b] of s1.players) {
      const a = s0.players.get(id) || b;
      const n = near.players.get(id) || b;
      const jump = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 400;
      const p = { ...n };
      p.x = jump ? b.x : lerp(a.x, b.x, t) + b.vx * extra;
      p.y = jump ? b.y : lerp(a.y, b.y, t) + b.vy * extra;
      p.vx = lerp(a.vx, b.vx, t); p.vy = lerp(a.vy, b.vy, t);
      p.energy = lerp(a.energy, b.energy, t);
      p.surge = lerp(a.surge, b.surge, t);
      players.set(id, p);
    }
    const debris = new Map();
    for (const [id, b] of s1.debris) {
      const a = s0.debris.get(id) || b;
      const d = { ...(t < 0.5 ? a : b) };
      const jump = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 400 || a.alive !== b.alive;
      d.x = jump ? b.x : lerp(a.x, b.x, t) + b.vx * extra;
      d.y = jump ? b.y : lerp(a.y, b.y, t) + b.vy * extra;
      d.ang = jump ? b.ang : lerpAngle(a.ang, b.ang, t);
      debris.set(id, d);
    }
    const ticksIn = (rt - s0.ts) / TICK_MS;
    return {
      players, debris,
      meta: {
        phase: near.phase, timeLeft: Math.max(0, near.tl - (near === s0 && near.phase === 'play' ? Math.max(0, ticksIn) : 0)),
        collapsed: near.cl, next: near.nc, warn: near.cw, countdown: near.cd,
      },
    };
  }

  stats() {
    const iv = this.snapIntervals;
    const avg = iv.length ? iv.reduce((a, b) => a + b, 0) / iv.length : 0;
    return {
      snapRate: avg ? 1000 / avg : 0, delay: this.delay, lag: this.lag, pending: this.pending.length,
      predError: this.predError, tickRate: this.tickRateMeasured, buffer: this.buffer.length,
    };
  }
}

// -----------------------------------------------------------------------------
export class LocalSession extends BaseSession {
  /**
   * @param {Game} game
   * @param {object} o  { selfId, brains: Map<id, BotBrain>, script?: (game, inputs) => void }
   */
  constructor(game, o = {}) {
    super({ arena: game.arena.index, mode: game.mode, selfId: o.selfId ?? -1 });
    this.isLocal = true;
    this.game = game;
    this.brains = o.brains || new Map();
    this.script = o.script || null;
    this.acc = 0;
    this.prevPos = new Map();
    this.timeScale = 1;
  }

  update(dt, sampleInput) {
    if (this.freezeLeft > 0) { this.freezeLeft -= dt; if (this.view) return this.view; }
    let scale = this.timeScale;
    if (this.slowLeft > 0) { this.slowLeft -= dt; scale *= this.slowScale; }
    this.acc += dt * scale;
    if (this.acc > 200) this.acc = 200;
    const g = this.game;
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      const inputs = new Map();
      for (const [id, brain] of this.brains) {
        const p = g.players.get(id);
        if (p) inputs.set(id, brain.think(g, p));
      }
      if (this.selfId >= 0 && sampleInput) inputs.set(this.selfId, sampleInput());
      if (this.script) this.script(g, inputs);
      for (const p of g.players.values()) this.prevPos.set(p.id, { x: p.x, y: p.y });
      for (const d of g.debris) this.prevPos.set('d' + d.id, { x: d.x, y: d.y, ang: d.ang });
      g.step(inputs);
      for (const ev of g.events) this.onEvent(ev);
      g.events.length = 0;
    }
    const a = this.acc / TICK_MS;
    const players = new Map();
    for (const p of g.players.values()) {
      const pv = this.prevPos.get(p.id) || p;
      const jump = Math.abs(pv.x - p.x) + Math.abs(pv.y - p.y) > 200;
      players.set(p.id, {
        id: p.id, x: jump ? p.x : lerp(pv.x, p.x, a), y: jump ? p.y : lerp(pv.y, p.y, a), vx: p.vx, vy: p.vy,
        mode: p.mode, pend: p.pend, tell: p.tell, cd: p.cd, energy: p.energy, surge: p.surge, flags: p.flags,
        ghostCd: p.ghostCd, score: p.score, armor: p.armor, drift: p.drift,
      });
    }
    const debris = new Map();
    for (const d of g.debris) {
      const pv = this.prevPos.get('d' + d.id) || d;
      const jump = Math.abs(pv.x - d.x) + Math.abs(pv.y - d.y) > 200;
      debris.set(d.id, { id: d.id, x: jump ? d.x : lerp(pv.x, d.x, a), y: jump ? d.y : lerp(pv.y, d.y, a), vx: d.vx, vy: d.vy, ang: jump ? d.ang : lerpAngle(pv.ang, d.ang, a), alive: d.alive });
    }
    const ci = g.collapseInfo();
    this.view = {
      players, debris,
      meta: { phase: g.phase, timeLeft: Math.max(0, g.duration - g.playTick), collapsed: g.collapsed, next: ci.next, warn: ci.warn, countdown: g.phase === 'countdown' ? g.phaseTicks : 0 },
    };
    return this.view;
  }

  stats() { return { snapRate: 60, delay: 0, lag: 0, pending: 0, predError: 0, tickRate: 60, buffer: 0 }; }
}

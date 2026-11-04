// =============================================================================
// Room: lobby, match flow (rounds, results, podium), inputs and snapshots.
// A server hosts many rooms; each room owns at most one running `Game`.
// =============================================================================
import {
  SNAPSHOT_EVERY, ROUNDS_PER_MATCH, ROUND_END_TICKS, RESULTS_MS, TICK_MS,
  MAX_PLAYERS, PLAYER_COLORS, SKINS, BOT_NAMES, BOT_LEVELS, FLAG, TICK_RATE,
} from '../shared/constants.js';
import { Game } from '../shared/sim.js';
import { BotBrain } from '../shared/bot.js';
import { ARENA_COUNT, KOTP_ARENA } from '../shared/arenas.js';
import { sanitizeInput } from '../shared/physics.js';

const INPUT_QUEUE_MAX = 8;
const LOBBY_GRACE_MS = 30000;
const EMPTY_ROOM_MS = 60000;

export class Room {
  /**
   * @param {string} code
   * @param {object} opts { practice, io, clock: () => ms, onDispose }
   */
  constructor(code, opts = {}) {
    this.code = code;
    this.io = opts.io || null;
    this.clock = opts.clock || (() => Date.now());
    this.onDispose = opts.onDispose || (() => {});
    this.practice = !!opts.practice;
    this.members = new Map();
    this.nextId = 1;
    this.host = -1;
    this.mode = 'ffa';
    this.phase = 'lobby';
    this.round = 0;
    this.totalRounds = ROUNDS_PER_MATCH;
    this.game = null;
    this.ticks = 0;
    this.phaseUntil = 0;
    this.arenaOffset = Math.floor(Math.random() * ARENA_COUNT);
    this.matchNo = 0;
    this.memory = { lastKiller: {} };
    this.emptySince = 0;
    this.lastRoundResults = null;
    this.disposed = false;
  }

  // --------------------------------------------------------------------------
  // membership
  // --------------------------------------------------------------------------
  allocId() {
    for (let i = 0; i < 256; i++) {
      const id = ((this.nextId + i - 1) % 250) + 1;
      if (!this.members.has(id)) { this.nextId = id + 1; return id; }
    }
    return -1;
  }

  humans() { return [...this.members.values()].filter(m => !m.bot); }
  connectedHumans() { return this.humans().filter(m => m.connected); }

  /** Add a human. Returns { member } or { error }. */
  addHuman(profile, socket) {
    // rejoin with the same token takes back control of the old slot
    if (profile.token) {
      for (const m of this.members.values()) {
        if (!m.bot && m.token === profile.token) {
          if (m.socket && m.socket !== socket && m.connected) {
            try { m.socket.emit('kicked', 'You joined from another tab.'); m.socket.leave(this.code); } catch (e) { /* ignore */ }
          }
          m.socket = socket; m.connected = true; m.leftAt = 0;
          m.name = profile.name || m.name;
          m.queue = []; m.ack = -1; m.lastSeq = -1;
          if (this.host < 0 || !this.members.get(this.host)?.connected) this.host = m.id;
          this.broadcastRoom();
          return { member: m, rejoined: true };
        }
      }
    }
    if (this.members.size >= MAX_PLAYERS) {
      // make room by dropping a bot while in the lobby
      const bot = [...this.members.values()].find(m => m.bot);
      if (bot && this.phase === 'lobby') this.members.delete(bot.id);
      else return { error: 'This room is full (12 players).' };
    }
    const id = this.allocId();
    if (id < 0) return { error: 'Room is full.' };
    const m = {
      id, name: profile.name, color: profile.color, skin: profile.skin,
      bot: null, token: profile.token || '', socket, connected: true,
      spectator: this.phase !== 'lobby', kos: 0, score: 0,
      queue: [], ack: -1, lastSeq: -1, input: sanitizeInput(null), brain: null,
      inputCount: 0, inputWindow: 0, leftAt: 0,
    };
    this.members.set(id, m);
    if (this.host < 0 || !this.members.get(this.host) || !this.members.get(this.host).connected) this.host = id;
    this.broadcastRoom();
    return { member: m };
  }

  addBot(level) {
    if (this.members.size >= MAX_PLAYERS) return false;
    if (!BOT_LEVELS.includes(level)) level = 'normal';
    const id = this.allocId();
    if (id < 0) return false;
    const used = new Set([...this.members.values()].map(m => m.name));
    let name = BOT_NAMES.find((n, i) => !used.has(n) && (i + id) % 2 === 0) || BOT_NAMES.find(n => !used.has(n)) || `Bot ${id}`;
    const usedColors = new Set([...this.members.values()].map(m => m.color));
    let color = PLAYER_COLORS.findIndex((c, i) => !usedColors.has(i));
    if (color < 0) color = id % PLAYER_COLORS.length;
    this.members.set(id, {
      id, name, color, skin: (id * 3) % SKINS.length, bot: level, token: '', socket: null,
      connected: true, spectator: this.phase !== 'lobby', kos: 0, score: 0, queue: [], ack: -1, lastSeq: -1,
      input: sanitizeInput(null), brain: null,
    });
    this.broadcastRoom();
    return true;
  }

  removeMember(id) {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    if (m.socket) { try { m.socket.leave(this.code); } catch (e) { /* ignore */ } }
    if (this.host === id) this.pickHost();
    this.broadcastRoom();
  }

  pickHost() {
    const h = this.connectedHumans()[0] || this.humans()[0];
    this.host = h ? h.id : -1;
  }

  /** A socket dropped (or left). Mid-match a bot takes over the slot. */
  disconnect(member, leaving = false) {
    if (!member || !this.members.has(member.id)) return;
    member.connected = false;
    member.socket = null;
    member.leftAt = this.clock();
    if (leaving && (this.phase === 'lobby' || this.phase === 'podium' || member.spectator)) {
      this.removeMember(member.id);
      return;
    }
    if (this.host === member.id) this.pickHost();
    this.broadcastRoom();
  }

  updateProfile(member, p) {
    if (p.name) member.name = p.name;
    if (Number.isInteger(p.color)) member.color = p.color;
    if (Number.isInteger(p.skin)) member.skin = p.skin;
    this.broadcastRoom();
  }

  // --------------------------------------------------------------------------
  // inputs
  // --------------------------------------------------------------------------
  pushInput(member, raw) {
    if (!Array.isArray(raw) || raw.length < 5) return;
    const seq = raw[0];
    if (!Number.isInteger(seq) || seq <= member.lastSeq || seq > member.lastSeq + 600 && member.lastSeq >= 0) return;
    // rate limiting: no more than ~1.5x the tick rate
    const now = this.clock();
    if (now - (member.inputWindow || 0) > 1000) { member.inputWindow = now; member.inputCount = 0; }
    if (++member.inputCount > TICK_RATE * 1.6) return;
    member.lastSeq = seq;
    const inp = sanitizeInput({ mx: Number(raw[1]) / 100, my: Number(raw[2]) / 100, mode: raw[3], surge: raw[4] === 1 });
    inp.seq = seq;
    member.queue.push(inp);
    member.lastInputAt = now;
    // never let a client bank inputs to run faster than the server (speed hack)
    if (member.queue.length > INPUT_QUEUE_MAX) member.queue.splice(0, member.queue.length - 3);
  }

  // --------------------------------------------------------------------------
  // match flow
  // --------------------------------------------------------------------------
  participants() { return [...this.members.values()].filter(m => !m.spectator); }

  canStart() { return this.phase === 'lobby' && this.members.size >= 2; }

  startMatch() {
    if (!this.canStart()) return false;
    for (const m of this.members.values()) { m.kos = 0; m.score = 0; m.spectator = false; }
    this.memory = { lastKiller: {} };
    this.round = 0;
    this.matchNo++;
    this.totalRounds = this.mode === 'kotp' ? 1 : ROUNDS_PER_MATCH;
    this.startRound();
    return true;
  }

  startRound() {
    this.round++;
    // mid-match joiners get to play from this round on
    for (const m of this.members.values()) m.spectator = false;
    const roster = this.participants();
    const arena = this.mode === 'kotp' ? KOTP_ARENA : (this.arenaOffset + this.round - 1 + this.matchNo * 2) % ARENA_COUNT;
    this.game = new Game({
      mode: this.mode, arena,
      roster: roster.map(m => ({ id: m.id, name: m.name })),
      memory: this.memory,
    });
    for (const m of roster) {
      m.brain = new BotBrain(m.bot || 'normal', m.id * 31 + this.round);
      m.queue = []; m.ack = -1;
      const p = this.game.players.get(m.id);
      if (m.bot) p.flags |= FLAG.BOT;
    }
    this.phase = 'round';
    this.broadcastRoom();
    this.emitAll('round', {
      round: this.round, total: this.totalRounds, mode: this.mode, arena,
      roster: roster.map(m => m.id),
    });
    this.sendSnapshot();
  }

  finishRound() {
    const g = this.game;
    for (const p of g.players.values()) {
      const m = this.members.get(p.id);
      if (!m) continue;
      m.kos += p.stats.kos;
      m.score += p.score;
    }
    const results = {
      round: this.round, total: this.totalRounds, mode: this.mode,
      winner: g.result ? g.result.winner : -1, reason: g.result ? g.result.reason : 'time',
      awards: computeAwards(g, this.mode),
      standings: this.standings(),
      last: this.round >= this.totalRounds,
      roundKos: [...g.players.values()].map(p => [p.id, p.stats.kos, p.score]),
    };
    this.lastRoundResults = results;
    this.phase = 'results';
    this.phaseUntil = this.clock() + RESULTS_MS;
    this.game = null;
    // remove humans that never came back
    for (const m of [...this.members.values()]) if (!m.bot && !m.connected && this.clock() - m.leftAt > 5000) this.members.delete(m.id);
    this.emitAll('results', results);
    this.broadcastRoom();
  }

  standings() {
    const list = [...this.members.values()].map(m => ({ id: m.id, name: m.name, color: m.color, skin: m.skin, kos: m.kos, score: m.score, bot: m.bot }));
    const key = this.mode === 'kotp' ? 'score' : 'kos';
    list.sort((a, b) => b[key] - a[key] || b.kos - a.kos || a.id - b.id);
    return list;
  }

  toPodium() {
    this.phase = 'podium';
    this.emitAll('podium', { mode: this.mode, standings: this.standings() });
    this.broadcastRoom();
  }

  backToLobby() {
    if (this.phase !== 'podium' && this.phase !== 'results') return;
    this.phase = 'lobby';
    this.round = 0;
    this.game = null;
    for (const m of this.members.values()) { m.spectator = false; m.kos = 0; m.score = 0; }
    for (const m of [...this.members.values()]) if (!m.bot && !m.connected) this.members.delete(m.id);
    this.pickHostIfNeeded();
    this.broadcastRoom();
  }

  pickHostIfNeeded() {
    const h = this.members.get(this.host);
    if (!h || h.bot || !h.connected) this.pickHost();
  }

  // --------------------------------------------------------------------------
  // per-tick update (called 60x/s by the server loop)
  // --------------------------------------------------------------------------
  tick(idealTime) {
    this.ticks++;
    // ideal (jitter-free) server time of this tick, used to timestamp snapshots
    this.tickTime = idealTime !== undefined ? idealTime : this.ticks * TICK_MS;
    const now = this.clock();

    // housekeeping once a second
    if (this.ticks % TICK_RATE === 0) this.housekeeping(now);
    if (this.disposed) return;

    if (this.phase === 'results' && now >= this.phaseUntil) {
      if (this.round >= this.totalRounds) this.toPodium();
      else this.startRound();
      return;
    }
    if (this.phase !== 'round' || !this.game) return;

    const g = this.game;
    const inputs = new Map();
    for (const p of g.players.values()) {
      const m = this.members.get(p.id);
      if (!m) { inputs.set(p.id, { mx: 0, my: 0, mode: 0, surge: false }); continue; }
      const aiControlled = !!m.bot || !m.connected;
      if (aiControlled) {
        if (!m.brain) m.brain = new BotBrain(m.bot || 'normal', m.id);
        inputs.set(p.id, m.brain.think(g, p));
        p.flags |= FLAG.BOT;
      } else {
        p.flags &= ~FLAG.BOT;
        if (m.queue.length) { m.input = m.queue.shift(); m.ack = m.input.seq; }
        else if (now - (m.lastInputAt || 0) > 400) m.input = sanitizeInput(null); // client went quiet: let go of everything
        else if (m.input.surge) m.input = { ...m.input, surge: false };
        inputs.set(p.id, m.input);
      }
    }
    g.step(inputs);
    if (this.ticks % SNAPSHOT_EVERY === 0) this.sendSnapshot();
    if (g.phase === 'over' && g.overTicks >= ROUND_END_TICKS) {
      this.sendSnapshot();
      this.finishRound();
    }
  }

  housekeeping(now) {
    // drop humans that left the lobby a while ago
    if (this.phase === 'lobby' || this.phase === 'podium') {
      for (const m of [...this.members.values()]) {
        if (!m.bot && !m.connected && now - m.leftAt > LOBBY_GRACE_MS) this.removeMember(m.id);
      }
    }
    const anyone = this.connectedHumans().length > 0;
    if (!anyone) {
      if (!this.emptySince) this.emptySince = now;
      if (now - this.emptySince > (this.practice ? 5000 : EMPTY_ROOM_MS)) this.dispose();
    } else this.emptySince = 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.onDispose(this);
  }

  // --------------------------------------------------------------------------
  // networking
  // --------------------------------------------------------------------------
  emitAll(ev, data) {
    if (this.io) this.io.to(this.code).emit(ev, data);
  }

  sendSnapshot() {
    const g = this.game;
    if (!g) return;
    const snap = g.snapshot();
    snap.ts = Math.round(this.tickTime * 10) / 10;
    snap.rt = this.ticks;
    snap.e = g.events;
    g.events = [];
    if (!this.io) return;
    for (const m of this.members.values()) {
      if (!m.socket || !m.connected) continue;
      snap.a = m.ack;
      m.socket.emit('s', snap);
    }
  }

  roomState() {
    return {
      code: this.code, host: this.host, mode: this.mode, phase: this.phase, practice: this.practice,
      round: this.round, total: this.totalRounds,
      members: [...this.members.values()].map(m => ({
        id: m.id, name: m.name, color: m.color, skin: m.skin, bot: m.bot,
        connected: m.connected, spectator: m.spectator, kos: m.kos, score: m.score,
      })),
    };
  }

  broadcastRoom() { this.emitAll('room', this.roomState()); }
}

// =============================================================================
// End-of-round awards
// =============================================================================
export function computeAwards(g, mode) {
  const ps = [...g.players.values()];
  const awards = [];
  const best = (fn, min = 1) => {
    let b = null, bv = -Infinity;
    for (const p of ps) { const v = fn(p); if (v > bv) { bv = v; b = p; } }
    return b && bv >= min ? { p: b, v: bv } : null;
  };
  const k = best(p => p.stats.kos);
  if (k) awards.push({ key: 'kos', title: 'Most KOs', id: k.p.id, value: `${k.v} KO${k.v > 1 ? 's' : ''}` });
  if (mode === 'kotp') {
    const s = best(p => p.score);
    if (s) awards.push({ key: 'pole', title: 'King of the Pole', id: s.p.id, value: `${s.v} pts` });
  }
  const sv = best(p => p.stats.bestSave);
  if (sv) awards.push({ key: 'save', title: 'Best Save', id: sv.p.id, value: `${sv.p.stats.saves} clutch save${sv.p.stats.saves > 1 ? 's' : ''}` });
  if (mode !== 'kotp') {
    const winner = g.result && g.result.winner >= 0 ? g.players.get(g.result.winner) : null;
    const sur = winner ? { p: winner, v: winner.stats.deathTick } : best(p => p.stats.deathTick, 0);
    if (sur) awards.push({ key: 'survivor', title: 'Longest Survivor', id: sur.p.id, value: `${Math.round(sur.v / TICK_RATE)}s` });
  }
  const h = best(p => p.stats.bigHit, 200);
  if (h) awards.push({ key: 'hit', title: 'Biggest Hit', id: h.p.id, value: `${h.v} force` });
  const c = best(p => p.stats.chaos, 3);
  if (c) awards.push({ key: 'chaos', title: 'Most Chaotic', id: c.p.id, value: `${c.v} chaos` });
  return awards;
}

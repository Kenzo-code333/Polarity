// =============================================================================
// LocalNet: an in-browser stand-in for the server, used by the offline build
// (e.g. the Claude artifact). It runs the real server Room — lobby, rounds,
// bots, results, podium — inside the page and talks to the client through the
// exact same interface as Net, so nothing else in the client changes.
// =============================================================================
import { Room } from '../../server/room.js';
import { TICK_MS, PLAYER_COLORS, SKINS, BOT_LEVELS, MAX_PLAYERS } from '/shared/constants.js';

const clone = (d) => (d === undefined ? d : JSON.parse(JSON.stringify(d)));

export class LocalNet {
  constructor() {
    this.handlers = {};
    this.rtt = 0;
    this.connected = true;
    this.offline = true;
    this.t0 = performance.now();
    this.room = null;
    this.member = null;
    this.ticks = 0;
    // fake socket handed to the Room for our single human player
    this.sock = { id: 'local', emit: (ev, d) => this.deliver(ev, d), leave() {}, join() {} };
    this.io = { to: () => ({ emit: (ev, d) => this.deliver(ev, d) }) };
    this.loop = setInterval(() => this.tick(), 4);
    setTimeout(() => this.emitLocal('connect'), 0);
  }

  now() { return performance.now() - this.t0; }
  serverNow() { return this.now(); }
  observeSnapshot() {}

  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
  emitLocal(ev, d) { for (const fn of this.handlers[ev] || []) fn(d); }
  deliver(ev, d) { const c = clone(d); this.emitLocal(ev, c); }

  /** Fixed-rate simulation, same scheme as the server loop. */
  tick() {
    const target = Math.floor(this.now() / TICK_MS);
    let n = 0;
    while (this.ticks < target && n < 6) {
      this.ticks++; n++;
      if (this.room) {
        try { this.room.tick(this.ticks * TICK_MS); } catch (e) { console.error(e); }
      }
    }
    if (this.ticks < target) this.ticks = target;
  }

  newRoom(practice) {
    this.room = new Room('SOLO', { io: this.io, clock: () => this.now(), practice });
    this.room.housekeeping = () => {};
    this.room.dispose = () => {};
  }

  profile(p) {
    p = p || {};
    let color = Number(p.color) | 0; if (color < 0 || color >= PLAYER_COLORS.length) color = 0;
    let skin = Number(p.skin) | 0; if (skin < 0 || skin >= SKINS.length) skin = 0;
    const name = String(p.name || '').trim().slice(0, 16) || 'You';
    return { name, color, skin, token: 'local' };
  }

  join(profile, practice) {
    this.newRoom(practice);
    const res = this.room.addHuman(this.profile(profile), this.sock);
    this.member = res.member;
    this.emitLocal('joined', { code: 'SOLO', you: this.member.id, practice: true });
    this.deliver('room', this.room.roomState());
  }

  sendInput(seq, inp) {
    if (this.room && this.member && this.room.phase === 'round') {
      this.room.pushInput(this.member, [seq, Math.round(inp.mx * 100), Math.round(inp.my * 100), inp.mode, inp.surge ? 1 : 0]);
    }
  }

  send(ev, d) {
    const r = this.room, m = this.member;
    switch (ev) {
      case 'create': this.join(d, false); break;
      case 'join': this.emitLocal('err', 'Joining friends needs the online version of Polarity.'); break;
      case 'practice': {
        this.join(d && d.profile, true);
        let level = d && d.level; if (!BOT_LEVELS.includes(level)) level = 'normal';
        this.room.mode = d && d.mode === 'kotp' ? 'kotp' : 'ffa';
        const n = Math.max(1, Math.min(MAX_PLAYERS - 1, Number(d && d.bots) || 5));
        for (let i = 0; i < n; i++) this.room.addBot(level);
        this.room.startMatch();
        break;
      }
      case 'leave': this.room = null; this.member = null; break;
      case 'profile': if (r && m) r.updateProfile(m, this.profile({ ...m, ...d })); break;
      case 'host:mode': if (r && r.phase === 'lobby') { r.mode = d === 'kotp' ? 'kotp' : 'ffa'; r.broadcastRoom(); } break;
      case 'host:addBot': if (r && r.phase === 'lobby') r.addBot(String(d)); break;
      case 'host:removeBot': if (r && r.phase === 'lobby') { const b = r.members.get(Number(d)); if (b && b.bot) r.removeMember(b.id); } break;
      case 'host:start': if (r && !r.startMatch()) this.emitLocal('err', 'Add at least one bot to start.'); break;
      case 'playAgain': if (r) r.backToLobby(); break;
      default: break;
    }
  }
}

// =============================================================================
// Polarity server: serves the client, hosts rooms, runs the 60 Hz loop.
// =============================================================================
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Room } from './room.js';
import { TICK_MS, PLAYER_COLORS, SKINS, BOT_LEVELS, MAX_PLAYERS } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 20000,
  perMessageDeflate: false,          // cheaper CPU; snapshots are already compact
  cors: { origin: true },
});

// ---- static files (no build step: libraries straight from node_modules) ----
const nm = path.join(ROOT, 'node_modules');
const staticOpts = { maxAge: '1h' };
app.get('/lib/pixi.min.js', (req, res) => res.sendFile(path.join(nm, 'pixi.js/dist/pixi.min.js'), staticOpts));
app.get('/lib/pixi-filters.js', (req, res) => res.sendFile(path.join(nm, 'pixi-filters/dist/browser/pixi-filters.js'), staticOpts));
app.use('/shared', express.static(path.join(ROOT, 'shared'), { maxAge: 0 }));
app.use('/', express.static(path.join(ROOT, 'client'), { maxAge: 0 }));
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size, players: io.engine.clientsCount }));

// ---- clock shared by all rooms ---------------------------------------------
const t0 = performance.now();
const now = () => performance.now() - t0;

// ---- rooms --------------------------------------------------------------------
/** @type {Map<string, Room>} */
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  for (let len = 4; len < 8; len++) {
    for (let tries = 0; tries < 50; tries++) {
      let c = '';
      for (let i = 0; i < len; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!rooms.has(c)) return c;
    }
  }
  return 'X' + Date.now().toString(36).toUpperCase();
}

function createRoom(opts = {}) {
  const code = newCode();
  const room = new Room(code, {
    ...opts, io, clock: now,
    onDispose: (r) => { rooms.delete(r.code); },
  });
  rooms.set(code, room);
  return room;
}

// ---- validation -------------------------------------------------------------
function cleanProfile(p) {
  p = p && typeof p === 'object' ? p : {};
  let name = String(p.name || '').replace(/[^\p{L}\p{N} _\-.!?'*]/gu, '').trim().slice(0, 16);
  if (!name) name = 'Magnet' + Math.floor(Math.random() * 900 + 100);
  let color = Number(p.color) | 0;
  if (color < 0 || color >= PLAYER_COLORS.length) color = 0;
  let skin = Number(p.skin) | 0;
  if (skin < 0 || skin >= SKINS.length) skin = 0;
  const token = String(p.token || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  return { name, color, skin, token };
}

const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

// ---- sockets ------------------------------------------------------------------
io.on('connection', (socket) => {
  let room = null;
  let member = null;

  const join = (r, profile) => {
    const res = r.addHuman(profile, socket);
    if (res.error) { socket.emit('err', res.error); return false; }
    if (room && room !== r && member) room.disconnect(member, true);
    room = r; member = res.member;
    socket.join(r.code);
    socket.emit('joined', { code: r.code, you: member.id, practice: r.practice });
    socket.emit('room', r.roomState());
    // catch up on a match already in progress
    if (r.phase === 'round' && r.game) {
      socket.emit('round', {
        round: r.round, total: r.totalRounds, mode: r.mode, arena: r.game.arena.index,
        roster: [...r.game.players.keys()], late: true, collapsed: r.game.collapsed,
      });
    } else if (r.phase === 'results' && r.lastRoundResults) socket.emit('results', r.lastRoundResults);
    else if (r.phase === 'podium') socket.emit('podium', { mode: r.mode, standings: r.standings() });
    return true;
  };

  const isHost = () => room && member && room.host === member.id;

  // time sync: reply with the server clock
  socket.on('png', (ct, cb) => { if (typeof cb === 'function') cb(now()); });

  socket.on('create', (profile) => {
    const r = createRoom();
    join(r, cleanProfile(profile));
  });

  socket.on('join', (data) => {
    const code = cleanCode(data && data.code);
    const r = rooms.get(code);
    if (!r || r.disposed) { socket.emit('err', `Room ${code || '?'} doesn't exist (maybe it ended).`); return; }
    join(r, cleanProfile(data && data.profile));
  });

  socket.on('practice', (data) => {
    const r = createRoom({ practice: true });
    if (!join(r, cleanProfile(data && data.profile))) return;
    let level = data && data.level;
    if (!BOT_LEVELS.includes(level)) level = 'normal';
    let n = Number(data && data.bots) | 0;
    if (n < 1 || n > MAX_PLAYERS - 1) n = 5;
    r.mode = data && data.mode === 'kotp' ? 'kotp' : 'ffa';
    for (let i = 0; i < n; i++) r.addBot(level);
    r.startMatch();
  });

  socket.on('leave', () => {
    if (room && member) room.disconnect(member, true);
    if (room) socket.leave(room.code);
    room = null; member = null;
  });

  socket.on('profile', (p) => {
    if (!room || !member) return;
    const c = cleanProfile({ ...p, token: member.token });
    room.updateProfile(member, c);
  });

  socket.on('i', (raw) => { if (room && member && room.phase === 'round') room.pushInput(member, raw); });

  socket.on('host:mode', (mode) => {
    if (!isHost() || room.phase !== 'lobby') return;
    room.mode = mode === 'kotp' ? 'kotp' : 'ffa';
    room.broadcastRoom();
  });
  socket.on('host:addBot', (level) => { if (isHost() && room.phase === 'lobby') room.addBot(String(level)); });
  socket.on('host:removeBot', (id) => {
    if (!isHost() || room.phase !== 'lobby') return;
    const m = room.members.get(Number(id));
    if (m && m.bot) room.removeMember(m.id);
  });
  socket.on('host:kick', (id) => {
    if (!isHost() || room.phase !== 'lobby') return;
    const m = room.members.get(Number(id));
    if (m && !m.bot && m.id !== member.id) {
      if (m.socket) m.socket.emit('kicked', 'The host removed you from the lobby.');
      room.removeMember(m.id);
    }
  });
  socket.on('host:start', () => {
    if (!isHost()) return;
    if (!room.startMatch()) socket.emit('err', 'Need at least 2 players (add a bot!).');
  });
  socket.on('playAgain', () => { if (room) room.backToLobby(); });

  socket.on('disconnect', () => { if (room && member) room.disconnect(member, false); });
});

// ---- the fixed-rate game loop ----------------------------------------------
// Ticks are scheduled against an ideal timeline so the simulation never drifts;
// if the process stalls we catch up a few ticks, then skip ahead.
let ticks = 0;
function loop() {
  const target = Math.floor(now() / TICK_MS);
  let n = 0;
  while (ticks < target && n < 6) {
    ticks++; n++;
    for (const r of rooms.values()) {
      try { r.tick(ticks * TICK_MS); } catch (e) { console.error(`room ${r.code} crashed:`, e); r.phase = 'lobby'; r.game = null; r.broadcastRoom(); }
    }
  }
  if (ticks < target) ticks = target;
  const next = (ticks + 1) * TICK_MS - now();
  setTimeout(loop, Math.max(1, next));
}
loop();

server.listen(PORT, () => {
  console.log(`Polarity server running on http://localhost:${PORT}`);
});

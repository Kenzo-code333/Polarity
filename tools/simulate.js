// =============================================================================
// Headless match simulator: runs full bot-only matches as fast as possible to
// catch crashes, NaNs, stuck rounds and to measure server tick cost.
//   node tools/simulate.js [matches=6]
// =============================================================================
import { Room } from '../server/room.js';
import { TICK_MS, FLAG } from '../shared/constants.js';

const MATCHES = Number(process.argv[2] || 6);
let fakeNow = 0;
const clock = () => fakeNow;

function checkFinite(room) {
  const g = room.game;
  if (!g) return;
  for (const p of g.players.values()) {
    for (const k of ['x', 'y', 'vx', 'vy', 'energy', 'surge']) {
      if (!Number.isFinite(p[k])) throw new Error(`NaN in player ${p.id}.${k} (tick ${g.tick})`);
    }
  }
  for (const d of g.debris) for (const k of ['x', 'y', 'vx', 'vy', 'ang']) {
    if (!Number.isFinite(d[k])) throw new Error(`NaN in debris ${d.id}.${k}`);
  }
}

const summary = [];
let totalTicks = 0, totalMs = 0, worstTick = 0;
const configs = [
  { mode: 'ffa', bots: ['hard', 'hard', 'normal', 'normal', 'easy', 'easy'] },
  { mode: 'ffa', bots: ['easy', 'normal', 'hard', 'hard', 'normal', 'easy', 'hard', 'normal', 'easy', 'hard', 'normal', 'easy'] },
  { mode: 'kotp', bots: ['hard', 'normal', 'easy', 'hard', 'normal'] },
  { mode: 'ffa', bots: ['hard', 'hard'] },
];

for (let mi = 0; mi < MATCHES; mi++) {
  const cfg = configs[mi % configs.length];
  const room = new Room('SIM' + mi, { clock });
  room.housekeeping = () => {};
  room.mode = cfg.mode;
  for (const l of cfg.bots) room.addBot(l);
  if (!room.startMatch()) throw new Error('could not start');
  const roundLog = [];
  let guard = 0;
  let lastRound = 0;
  while (room.phase !== 'podium') {
    const t0 = performance.now();
    room.tick();
    const dt = performance.now() - t0;
    totalMs += dt; totalTicks++; worstTick = Math.max(worstTick, dt);
    fakeNow += TICK_MS;
    checkFinite(room);
    if (room.phase === 'results' && room.lastRoundResults && room.lastRoundResults.round !== lastRound) {
      const r = room.lastRoundResults;
      lastRound = r.round;
      roundLog.push(`  R${r.round}: winner=${r.winner} reason=${r.reason} kos=${r.roundKos.map(x => x[1]).join(',')}${cfg.mode === 'kotp' ? ' pts=' + r.roundKos.map(x => x[2]).join(',') : ''} awards=${r.awards.map(a => a.key).join('/')}`);
    }
    if (++guard > 60 * 60 * 20) throw new Error('match did not finish');
  }
  const st = room.standings();
  summary.push(`Match ${mi + 1} (${cfg.mode}, ${cfg.bots.length} bots) -> winner ${st[0].name} [${st[0].bot}] ${cfg.mode === 'kotp' ? st[0].score + ' pts' : st[0].kos + ' KOs'}`);
  summary.push(...roundLog);
  // play again flow
  room.backToLobby();
  if (room.phase !== 'lobby') throw new Error('play again failed');
}

console.log(summary.join('\n'));
console.log(`\nticks simulated: ${totalTicks}, avg ${(totalMs / totalTicks * 1000).toFixed(1)} µs/tick, worst ${worstTick.toFixed(2)} ms`);
void FLAG;

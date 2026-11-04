// =============================================================================
// Polarity client entry point: boots the renderer, wires networking, sessions,
// UI, audio and input together, and turns game events into juice.
// =============================================================================
import { Net } from './net.js';
import { NetSession, LocalSession } from './session.js';
import { Scene } from './render/scene.js';
import { audio } from './audio.js';
import { sampleInput, initTouch, setInputEnabled } from './input.js';
import { settings, save, QUALITY, resolveQuality, isTouchDevice } from './settings.js';
import * as ui from './ui.js';
import { Tutorial } from './tutorial.js';
import { Game } from '/shared/sim.js';
import { BotBrain } from '/shared/bot.js';
import { ARENA_COUNT } from '/shared/arenas.js';
import { MODE, FLAG, PHYS, PLAYER_COLORS, MODE_CSS, BOT_NAMES, SKINS, TICK_RATE } from '/shared/constants.js';

const $ = ui.$;

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const app = {
  screen: 'loading',
  net: null,
  scene: null,
  session: null,        // NetSession during a match
  demo: null,           // LocalSession for the menu / lobby attract mode
  tutorial: null,
  room: null,           // last room state from the server
  selfId: -1,
  roster: new Map(),    // id -> {id, name, color, skin, bot}
  matchKos: new Map(),
  roundKos: new Map(),
  roundInfo: null,
  pendingJoin: null,
  lastTime: performance.now(),
  fps: 60, fpsFrames: 0, fpsTime: 0,
  frameTimes: [],
  autoCheckAt: 0,
  qualityName: 'medium',
  debug: false,
  lastPend: 0,
  lastSelfFlags: 0,
  touchOn: false,
};
window.polarity = app; // handy for debugging in the console

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
async function boot() {
  try { await Promise.race([document.fonts.load('900 20px Orbitron'), new Promise(r => setTimeout(r, 1500))]); } catch (e) { /* ignore */ }
  try { await Promise.race([document.fonts.load('700 20px Rajdhani'), new Promise(r => setTimeout(r, 800))]); } catch (e) { /* ignore */ }

  app.qualityName = resolveQuality();
  app.scene = new Scene($('stage'), QUALITY[app.qualityName]);
  ui.refreshSettings(app.qualityName);

  initTouch();
  applyTouch();
  applyVolumes();

  ui.initHome({
    onCreate: () => connectThen(() => app.net.send('create', ui.profile())),
    onJoin: (code) => {
      code = String(code || '').trim().toUpperCase();
      if (!code) { ui.toast('Enter a room code first', true); return; }
      connectThen(() => app.net.send('join', { code, profile: ui.profile() }));
    },
    onPractice: (level, mode) => connectThen(() => app.net.send('practice', { profile: ui.profile(), level, bots: 5, mode })),
    onTutorial: startTutorial,
    onProfile: () => { if (app.screen === 'home') startDemo(); },
  });
  ui.initLobby({
    onMode: (m) => app.net.send('host:mode', m),
    onAddBot: (l) => app.net.send('host:addBot', l),
    onStart: () => app.net.send('host:start'),
    onLeave: () => leaveRoom(),
    onRemove: (id, bot) => app.net.send(bot ? 'host:removeBot' : 'host:kick', id),
  });
  ui.initSettings({
    onQuality: () => applyQuality(resolveQuality()),
    onVolume: applyVolumes,
    onTouch: applyTouch,
    onQuit: () => { if (app.tutorial) endTutorial(); else leaveRoom(); },
  });
  $('btnAgain').onclick = () => { audio.click(); app.net.send('playAgain'); };
  $('btnPodiumLeave').onclick = () => { audio.click(); leaveRoom(); };
  $('btnTutSkip').onclick = () => { audio.click(); endTutorial(); };

  // audio must start from a user gesture
  const unlock = () => {
    audio.init(); applyVolumes(); audio.startMusic();
    window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') { e.preventDefault(); app.debug = !app.debug; $('debug').classList.toggle('show', app.debug); }
    if (e.code === 'Escape' && (app.screen === 'hud' || app.screen === 'tutorial')) ui.openSettings(true);
    if (e.code === 'KeyM' && !(e.target && e.target.tagName === 'INPUT')) { settings.muted = !settings.muted; save(); applyVolumes(); ui.refreshSettings(); }
  });

  const params = new URLSearchParams(location.search);
  const code = params.get('room');
  if (code) {
    // opening an invite link joins directly
    if (!settings.name) { settings.name = 'Magnet' + Math.floor(100 + Math.random() * 900); save(); $('nameInput').value = settings.name; }
    connectThen(() => app.net.send('join', { code: code.toUpperCase(), profile: ui.profile() }));
    goHome(true);
  } else goHome();

  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// networking
// ---------------------------------------------------------------------------
function ensureNet() {
  if (app.net) return app.net;
  const net = app.net = new Net();
  net.on('connect', () => {
    if (app.pendingJoin) { const f = app.pendingJoin; app.pendingJoin = null; f(); }
    else if (app.room && app.room.code) {
      // reconnect: take our slot back
      net.send('join', { code: app.room.code, profile: ui.profile() });
      ui.toast('Reconnected!');
    }
  });
  net.on('disconnect', () => { if (app.room) ui.toast('Connection lost — reconnecting…', true, 5000); });
  net.on('joined', (d) => {
    app.selfId = d.you;
    history.replaceState(null, '', d.practice ? '/' : `/?room=${d.code}`);
    if (!d.practice) ui.toast(`Joined room ${d.code}`);
  });
  net.on('room', onRoom);
  net.on('round', onRound);
  net.on('s', (s) => { if (app.session) app.session.onSnapshot(s); });
  net.on('results', onResults);
  net.on('podium', onPodium);
  net.on('err', (m) => { ui.toast(m, true, 4000); if (!app.room) goHome(); });
  net.on('kicked', (m) => { ui.toast(m, true, 4000); app.room = null; goHome(); });
  return net;
}

function connectThen(fn) {
  audio.init();
  const net = ensureNet();
  if (net.connected) fn();
  else { app.pendingJoin = fn; ui.toast('Connecting…'); }
}

function leaveRoom() {
  if (app.net) app.net.send('leave');
  app.room = null;
  endSession();
  history.replaceState(null, '', '/');
  goHome();
}

function onRoom(room) {
  const wasNull = !app.room;
  app.room = room;
  for (const m of room.members) app.roster.set(m.id, m);
  if (room.phase === 'lobby') {
    if (app.screen !== 'lobby') enterLobby();
    ui.renderLobby(room, app.selfId);
    // rebuild the live preview if the member list changed
    const sig = room.members.map(m => `${m.id}:${m.color}:${m.skin}:${m.name}`).join('|');
    if (sig !== app.lobbySig) { app.lobbySig = sig; startDemo(room.members); }
  } else if (wasNull && room.phase === 'round') {
    // joined mid-match: spectate until the next round (round message follows)
  }
}

function enterLobby() {
  endSession();
  app.screen = 'lobby';
  ui.show('lobby');
  audio.setIntensity(0);
  app.lobbySig = '';
}

function onRound(r) {
  endDemo();
  if (app.tutorial) endTutorial(true);
  app.roundInfo = r;
  app.roundKos = new Map();
  // KOs from earlier rounds come from the room standings
  app.matchKos = new Map();
  if (app.room) for (const m of app.room.members) app.matchKos.set(m.id, m.kos);
  if (r.round === 1) app.matchKos = new Map();
  if (app.session) app.session.destroy();
  app.session = new NetSession(app.net, { arena: r.arena, mode: r.mode, selfId: app.selfId });
  app.session.onEvent = onGameEvent;
  app.scene.loadArena(r.arena, r.collapsed || 0);
  ui.clearKillfeed(); ui.clearAnnouncer();
  app.screen = 'hud';
  ui.show('hud');
  setInputEnabled(true);
  audio.setIntensity(1);
  if (!r.late) ui.announce(r.mode === 'kotp' ? 'KING OF THE POLE' : `ROUND ${r.round}`, '#ffffff', app.scene.arena.name, true);
  else ui.toast('Match in progress — you\'ll join next round');
}

function onResults(r) {
  if (!app.room) return;
  app.screen = 'results';
  ui.show('results');
  setInputEnabled(false);
  ui.showResults(r, app.roster);
  for (const s of r.standings) app.matchKos.set(s.id, s.kos);
  audio.setHum(0);
  audio.fanfare();
}

function onPodium(d) {
  endSession();
  app.screen = 'podium';
  ui.show('podium');
  const won = ui.showPodium(d, app.selfId);
  audio.setIntensity(0);
  audio.fanfare();
  if (won) setTimeout(() => ui.announce('CHAMPION!', '#ffd23f', '', true), 600);
  startDemo(d.standings.slice(0, 6).map(s => ({ ...s })));
}

function endSession() {
  if (app.session) { app.session.destroy(); app.session = null; }
  setInputEnabled(false);
  audio.setHum(0);
}

// ---------------------------------------------------------------------------
// menu / lobby attract mode: real bots fighting in the background
// ---------------------------------------------------------------------------
function startDemo(members) {
  endDemo();
  if (!members || !members.length) {
    // home screen: show the player's own character with a few bots
    members = [{ id: 1, name: settings.name || 'You', color: settings.color, skin: settings.skin }];
    for (let i = 0; i < 5; i++) members.push({ id: i + 2, name: BOT_NAMES[(i * 3) % BOT_NAMES.length], color: (settings.color + 2 + i * 2) % 12, skin: (settings.skin + 1 + i) % SKINS.length });
  }
  const arena = Math.floor(Math.random() * ARENA_COUNT);
  const roster = members.map(m => ({ id: m.id, name: m.name }));
  const game = new Game({ mode: 'demo', arena, roster });
  const brains = new Map(members.map((m, i) => [m.id, new BotBrain(i % 3 === 0 ? 'hard' : 'normal', m.id * 13 + 1)]));
  app.demo = new LocalSession(game, { brains });
  app.demo.roster = new Map(members.map(m => [m.id, m]));
  app.demo.onEvent = (ev) => demoEvent(ev);
  app.scene.loadArena(arena);
}

function endDemo() { app.demo = null; }

function demoEvent(ev) {
  const fx = app.scene.fx;
  // lighter juice for the background demo
  if (ev.k === 'hit') { fx.impact(ev.x, ev.y, ev.nx, ev.ny, ev.i, 0xffffff); if (ev.i > 600) app.scene.shake(0.08); }
  else if (ev.k === 'fall') { const v = app.scene.players.get(ev.id); if (v) v.startFall(ev); }
  else if (ev.k === 'surge') { fx.surge(ev.x, ev.y, ev.m); app.scene.filings.pulse(ev.x, ev.y, ev.m, 2.5, 500); app.scene.shockwave(ev.x, ev.y, 1.2); }
  else if (ev.k === 'dfall') app.scene.arenaView.debrisFall(ev);
  else if (ev.k === 'dspawn') app.scene.arenaView.debrisSpawn(ev);
  else if (ev.k === 'spawn') fx.ring(ev.x, ev.y, 0xffffff, 60, 0.5);
}

function goHome(silent = false) {
  endSession();
  if (app.tutorial) endTutorial(true);
  app.screen = 'home';
  app.room = null;
  ui.show('home');
  ui.refreshPickers();
  setInputEnabled(false);
  audio.setIntensity(0);
  startDemo();
  void silent;
}

// ---------------------------------------------------------------------------
// tutorial
// ---------------------------------------------------------------------------
function startTutorial() {
  endDemo();
  audio.init();
  const tut = app.tutorial = new Tutorial(ui.profile(), app.touchOn);
  tut.session.onEvent = (ev) => { tut.onEvent(ev); onGameEvent(ev); };
  app.roster = new Map([...app.roster, ...tut.roster]);
  app.selfId = 1;
  app.roundKos = new Map(); app.matchKos = new Map();
  app.scene.loadArena(tut.game.arena.index);
  app.screen = 'tutorial';
  ui.show('tutorial');
  setInputEnabled(true);
  audio.setIntensity(1);
}

function endTutorial(silent = false) {
  if (!app.tutorial) return;
  app.tutorial = null;
  setInputEnabled(false);
  audio.setHum(0);
  if (!silent) goHome();
}

// ---------------------------------------------------------------------------
// game events -> juice (effects, shake, hit-stop, sound, announcer)
// ---------------------------------------------------------------------------
function rosterColor(id) {
  const m = app.roster.get(id);
  return m ? PLAYER_COLORS[m.color] : 0xffffff;
}
function pan(x) {
  const c = app.scene.cam;
  return Math.max(-1, Math.min(1, (x - c.x) * c.zoom / (window.innerWidth / 2)));
}

function onGameEvent(ev) {
  const sc = app.scene, fx = sc.fx;
  const sess = app.session || (app.tutorial && app.tutorial.session);
  const me = app.selfId;
  switch (ev.k) {
    case 'hit': {
      const col = ev.a >= 0 ? rosterColor(ev.a) : 0xffa040;
      const involved = ev.a === me || ev.b === me;
      fx.impact(ev.x, ev.y, ev.nx, ev.ny, ev.i, col);
      const k = Math.min(1, ev.i / 1500);
      sc.shake(k * (involved ? 0.55 : 0.3));
      if (ev.i > 650) sc.shockwave(ev.x, ev.y, 0.5 + k * 0.6);
      if (ev.i > PHYS.bigHit && sess) sess.freeze(involved ? 90 : 55);
      const va = sc.players.get(ev.a), vb = sc.players.get(ev.b);
      if (va) va.impact(k * 0.6);
      if (vb) vb.impact(k);
      audio.hit(ev.i, pan(ev.x));
      if (ev.a === me && ev.i > 700) fx.text(ev.x, ev.y - 30, ev.i > PHYS.hugeHit ? 'SMASH!' : 'HIT!', 0xffd23f, ev.i > PHYS.hugeHit ? 26 : 18);
      break;
    }
    case 'fall': {
      const v = sc.players.get(ev.id);
      if (v) v.startFall(ev);
      audio.fall(pan(ev.x));
      sc.shake(ev.id === me ? 0.5 : 0.15);
      if (ev.id === me) ui.screenFlash('#ff3352', 0.25);
      break;
    }
    case 'ko': {
      ui.killfeed(ev, app.roster);
      if (ev.by >= 0) app.roundKos.set(ev.by, (app.roundKos.get(ev.by) || 0) + 1);
      audio.ko();
      if (ev.by === me) { const p = sess && sess.view && sess.view.players.get(me); if (p) fx.text(p.x, p.y - 40, '+1 KO', 0x7dff5a, 24); }
      if (ev.final && sess) {
        // slow-motion zoom on the final KO of the round
        const v = sc.players.get(ev.v);
        const fa = v && v.fallAnim;
        if (fa) sc.focus(fa.x, fa.y, 1700);
        sess.slowmo(1500, 0.28);
      }
      break;
    }
    case 'ann': {
      const m = app.roster.get(ev.id);
      const sub = m ? m.name : '';
      ui.announce(ev.text, ev.color, sub, ev.big !== false);
      audio.stinger();
      break;
    }
    case 'surge': {
      fx.surge(ev.x, ev.y, ev.m);
      sc.shockwave(ev.x, ev.y, 2);
      sc.shake(ev.id === me ? 0.8 : 0.55);
      sc.filings && sc.filings.pulse(ev.x, ev.y, ev.m, 3, 520);
      ui.screenFlash(MODE_CSS[ev.m], 0.35);
      audio.surge(ev.m);
      if (sess) sess.freeze(70);
      break;
    }
    case 'pulse': {
      fx.ring(ev.x, ev.y, 0xc8b8ff, PHYS.ghostPulseRange, 0.5);
      fx.flash(ev.x, ev.y, 0xb8a8ff, 1.5, 0.3);
      sc.filings && sc.filings.pulse(ev.x, ev.y, ev.m, 1.2, 220);
      audio.pulse();
      break;
    }
    case 'crack': audio.crack(); break;
    case 'collapse': {
      sc.shake(0.45);
      audio.collapse();
      const lvl = app.scene.arena ? app.scene.arena.maxLayer - ev.layer + 1 : 1;
      sc.setCollapsed(lvl);
      audio.setIntensity(Math.min(3, 1 + lvl));
      break;
    }
    case 'save': {
      fx.ring(ev.x, ev.y, 0x7dff5a, 90, 0.6);
      fx.text(ev.x, ev.y - 40, 'SAVED!', 0x7dff5a, 22);
      audio.save();
      break;
    }
    case 'dash': {
      fx.ring(ev.x, ev.y, 0xff3352, 70, 0.35);
      fx.flash(ev.x, ev.y, 0xff6a80, 1, 0.2);
      audio.dash();
      break;
    }
    case 'near': {
      if (ev.a === me || ev.b === me) { fx.text(ev.x, ev.y - 20, 'NEAR MISS +SURGE', 0x31e7ff, 14); audio.near(); }
      break;
    }
    case 'dfall': sc.arenaView && sc.arenaView.debrisFall(ev); break;
    case 'dspawn': sc.arenaView && sc.arenaView.debrisSpawn(ev); break;
    case 'spawn': fx.ring(ev.x, ev.y, rosterColor(ev.id), 70, 0.6); fx.flash(ev.x, ev.y, rosterColor(ev.id), 1.2, 0.4); break;
    case 'count': ui.announce(String(ev.n), '#ffffff', '', true); audio.count(ev.n); break;
    case 'go': ui.announce('GO!', '#7dff5a', '', true); audio.count(0); break;
    case 'edge': if (ev.id === me) audio.near(); break;
    default: break;
  }
}

// ---------------------------------------------------------------------------
// settings helpers
// ---------------------------------------------------------------------------
function applyVolumes() {
  audio.setVolumes({ master: settings.volMaster / 100, music: settings.volMusic / 100, sfx: settings.volSfx / 100, muted: settings.muted });
}
function applyTouch() {
  app.touchOn = settings.touch === 'on' || (settings.touch === 'auto' && isTouchDevice());
  document.body.classList.toggle('touch-on', app.touchOn);
  updateTouchVisibility();
}
function updateTouchVisibility() {
  $('touch').classList.toggle('show', app.touchOn && (app.screen === 'hud' || app.screen === 'tutorial'));
}
function applyQuality(name) {
  app.qualityName = name;
  app.scene.setQuality(QUALITY[name]);
  ui.refreshSettings(name);
}

/** Auto quality: watch frame times and step down if we can't hold ~60 fps. */
function autoQuality(dtMs) {
  if (settings.quality !== 'auto') return;
  if (app.screen !== 'hud' && app.screen !== 'tutorial' && app.screen !== 'home') return;
  const ft = app.frameTimes;
  ft.push(dtMs);
  if (ft.length < 150) return;
  const sorted = [...ft].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  ft.length = 0;
  if (performance.now() < app.autoCheckAt) return;
  const order = ['low', 'medium', 'high'];
  const i = order.indexOf(app.qualityName);
  if (median > 19 && i > 0) {
    settings._autoLevel = order[i - 1]; save();
    applyQuality(order[i - 1]);
    app.autoCheckAt = performance.now() + 4000;
  }
}

// ---------------------------------------------------------------------------
// main loop: rendering at the display's refresh rate, decoupled from network
// ---------------------------------------------------------------------------
function loop(now) {
  requestAnimationFrame(loop);
  let dtMs = now - app.lastTime;
  app.lastTime = now;
  if (dtMs > 100) dtMs = 100;
  if (dtMs <= 0) dtMs = 0.001;
  const dt = dtMs / 1000;

  // fps meter
  app.fpsFrames++; app.fpsTime += dtMs;
  if (app.fpsTime >= 500) { app.fps = app.fpsFrames * 1000 / app.fpsTime; app.fpsFrames = 0; app.fpsTime = 0; }
  autoQuality(dtMs);
  updateTouchVisibility();

  let view = null, camMode = 'overview', roster = app.roster, selfId = app.selfId;
  try {
    if (app.tutorial) {
      const tut = app.tutorial;
      view = tut.session.update(dtMs, sampleInput);
      const r = tut.update(dt);
      if (r === 'step') audio.save();
      if (r === 'complete') { audio.fanfare(); ui.announce('TRAINING COMPLETE', '#7dff5a', '', false); }
      if (tut.finished) { endTutorial(); }
      camMode = 'follow'; roster = tut.roster; selfId = 1;
    } else if (app.session) {
      view = app.session.update(dtMs, sampleInput);
      camMode = 'follow';
      if (view) {
        app.scene.setCollapsed(view.meta.collapsed);
        if (view.meta.warn > 0 && app.scene.arenaView && app.scene.arenaView.crackLayer !== app.scene.arena.maxLayer - view.meta.collapsed) {
          app.scene.arenaView.crack(app.scene.arena.maxLayer - view.meta.collapsed);
        }
        if (view.meta.phase === 'play' && view.meta.timeLeft < 20 * TICK_RATE && app.roundInfo && app.roundInfo.mode === 'ffa') audio.setIntensity(3);
      }
    } else if (app.demo) {
      view = app.demo.update(dtMs);
      roster = app.demo.roster; selfId = -1;
      camMode = 'overview';
    }
  } catch (e) { console.error(e); }

  app.scene.frame(dt, view, { selfId, roster, camMode });

  // HUD + hum for the local player
  if (view && (app.screen === 'hud' || app.screen === 'tutorial')) {
    const ctx = {
      roster, mode: app.tutorial ? 'tutorial' : (app.roundInfo ? app.roundInfo.mode : 'ffa'),
      round: app.roundInfo ? app.roundInfo.round : 1, total: app.roundInfo ? app.roundInfo.total : 1,
      matchKos: app.matchKos, roundKos: app.roundKos,
    };
    if (app.screen === 'hud') ui.updateHud(view, selfId, ctx);
    const me = view.players.get(selfId);
    if (me && (me.flags & FLAG.ALIVE)) {
      audio.setHum(me.mode, me.energy / PHYS.energyMax);
      if (me.tell > 0 && me.pend && me.pend !== app.lastPend) audio.tell(me.pend);
      app.lastPend = me.tell > 0 ? me.pend : 0;
    } else audio.setHum(0);
  }

  if (app.debug) updateDebug();
}

function updateDebug() {
  const s = app.session ? app.session.stats() : null;
  const net = app.net;
  const lines = [
    `POLARITY debug (F3)`,
    `fps        ${app.fps.toFixed(0)}`,
    `quality    ${app.qualityName}${settings.quality === 'auto' ? ' (auto)' : ''}  res ${app.scene.app.renderer.resolution}`,
    `ping       ${net ? net.rtt.toFixed(0) : '-'} ms`,
  ];
  if (s) {
    lines.push(
      `tick rate  ${s.tickRate.toFixed(1)} Hz (server)`,
      `snapshots  ${s.snapRate.toFixed(1)} /s`,
      `interp     ${s.delay.toFixed(0)} ms behind`,
      `pending    ${s.pending} inputs`,
      `pred err   ${s.predError.toFixed(1)} px`,
      `buffer     ${s.buffer} snaps`,
    );
  } else lines.push(`tick rate  60 Hz (local sim)`);
  lines.push(`filings    ${app.scene.filings ? app.scene.filings.n : 0}`, `particles  ${app.scene.fx.parts.length}`);
  $('debug').textContent = lines.join('\n');
}

window.addEventListener('error', (e) => console.error('Polarity error:', e.message));
boot();

void MODE; void PLAYER_COLORS;

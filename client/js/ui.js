// =============================================================================
// DOM UI: screens, home pickers, lobby, HUD, announcer, kill feed, results,
// podium, settings modal, toasts.
// =============================================================================
import { PLAYER_COLORS, SKINS, MODE, MODE_NAMES, MODE_CSS, FLAG, PHYS, TICK_RATE, GAME_MODES, RESULTS_MS } from '/shared/constants.js';
import { discPreview, hexColor } from './render/textures.js';
import { settings, save } from './settings.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export { $, esc };

const SCREENS = ['loading', 'home', 'lobby', 'hud', 'results', 'podium', 'tutorial'];

export function show(...names) {
  for (const s of SCREENS) $(s).classList.toggle('show', names.includes(s));
  document.body.classList.toggle('in-game', names.includes('hud'));
}

// ---------------------------------------------------------------------------
// toasts
// ---------------------------------------------------------------------------
let toastTimer = 0;
export function toast(msg, error = false, ms = 2800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------------------------------------------------------------------
// home screen
// ---------------------------------------------------------------------------
export function initHome(h) {
  const name = $('nameInput');
  name.value = settings.name;
  name.addEventListener('input', () => { settings.name = name.value.slice(0, 16); save(); h.onProfile(); });

  const cp = $('colorPicker');
  PLAYER_COLORS.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'color-swatch';
    d.style.background = hexColor(c); d.style.color = hexColor(c);
    d.addEventListener('click', () => { settings.color = i; save(); refreshPickers(); audio.click(); h.onProfile(); });
    cp.appendChild(d);
  });
  const sp = $('skinPicker');
  SKINS.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'skin-opt'; d.title = s.name;
    d.innerHTML = '<img alt="">';
    d.addEventListener('click', () => { settings.skin = i; save(); refreshPickers(); audio.click(); h.onProfile(); });
    sp.appendChild(d);
  });
  refreshPickers();

  const code = $('codeInput');
  const params = new URLSearchParams(location.search);
  if (params.get('room')) code.value = params.get('room').toUpperCase();
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') h.onJoin(code.value); });
  $('btnCreate').onclick = () => { audio.click(); h.onCreate(); };
  $('btnJoin').onclick = () => { audio.click(); h.onJoin(code.value); };
  $('btnPractice').onclick = () => { audio.click(); h.onPractice($('practiceLevel').value, $('practiceMode').value); };
  $('btnTutorial').onclick = () => { audio.click(); h.onTutorial(); };
  $('btnSettings').onclick = () => { audio.click(); openSettings(false); };
  document.querySelectorAll('.btn').forEach(b => b.addEventListener('pointerenter', () => audio.hover()));
}

export function refreshPickers() {
  [...$('colorPicker').children].forEach((d, i) => d.classList.toggle('sel', i === settings.color));
  [...$('skinPicker').children].forEach((d, i) => {
    d.classList.toggle('sel', i === settings.skin);
    d.querySelector('img').src = discPreview(i, settings.color, 64);
  });
  $('skinName').textContent = SKINS[settings.skin].name;
}

export function profile() {
  return { name: settings.name || '', color: settings.color, skin: settings.skin, token: settings.token };
}

// ---------------------------------------------------------------------------
// lobby
// ---------------------------------------------------------------------------
export function initLobby(h) {
  $('btnCopy').onclick = async () => {
    const link = $('shareLink').textContent;
    try { await navigator.clipboard.writeText(link); toast('Invite link copied! Send it to your friends.'); }
    catch (e) {
      // fallback for browsers without clipboard permission
      const ta = document.createElement('textarea'); ta.value = link; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Invite link copied!'); } catch (e2) { toast(link); }
      ta.remove();
    }
    audio.click();
  };
  document.querySelectorAll('.mode-btn').forEach(b => { b.onclick = () => { audio.click(); h.onMode(b.dataset.mode); }; });
  $('btnAddBot').onclick = () => { audio.click(); h.onAddBot($('botLevel').value); };
  $('btnStart').onclick = () => { audio.click(); h.onStart(); };
  $('btnLeave').onclick = () => { audio.click(); h.onLeave(); };
  $('btnLobbySettings').onclick = () => { audio.click(); openSettings(false); };
  $('playerList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) { audio.click(); h.onRemove(Number(b.dataset.rm), b.dataset.bot === '1'); }
  });
}

let lastLobbySig = '';
export function renderLobby(room, selfId) {
  const link = `${location.origin}/?room=${room.code}`;
  $('roomCode').textContent = room.code;
  $('shareLink').textContent = link;
  const isHost = room.host === selfId;
  $('hostControls').style.display = isHost ? 'flex' : 'none';
  $('hostControls').style.flexDirection = 'column';
  $('hostControls').style.gap = '8px';
  $('guestInfo').style.display = isHost ? 'none' : 'block';
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('sel', b.dataset.mode === room.mode));
  $('modeDesc').textContent = GAME_MODES[room.mode].desc;
  $('guestInfo').textContent = `Waiting for the host to start… (${GAME_MODES[room.mode].name})`;
  $('playerCount').textContent = room.members.length;
  $('btnStart').disabled = room.members.length < 2;
  $('btnStart').textContent = room.members.length < 2 ? 'Add a bot or invite friends' : 'Start match';
  const sig = JSON.stringify([room.members, room.host, selfId]);
  if (sig === lastLobbySig) return;
  lastLobbySig = sig;
  $('playerList').innerHTML = room.members.map((m, i) => `
    <div class="player-row" style="animation-delay:${i * 0.04}s">
      <img src="${discPreview(m.skin, m.color, 64)}" alt="">
      <div class="pname" style="color:${hexColor(PLAYER_COLORS[m.color])}">${esc(m.name)}</div>
      ${m.id === room.host ? '<span class="tag host">HOST</span>' : ''}
      ${m.id === selfId ? '<span class="tag you">YOU</span>' : ''}
      ${m.bot ? `<span class="tag">BOT · ${m.bot.toUpperCase()}</span>` : ''}
      ${!m.bot && !m.connected ? '<span class="tag off">OFFLINE</span>' : ''}
      ${isHost && m.id !== selfId ? `<button class="rm" data-rm="${m.id}" data-bot="${m.bot ? 1 : 0}" title="Remove">✕</button>` : ''}
    </div>`).join('');
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
let lastSb = '';
let lastState = -1;
export function updateHud(view, selfId, ctx) {
  if (!view) return;
  const meta = view.meta;
  // timer
  const secs = Math.ceil(meta.timeLeft / TICK_RATE);
  const timer = $('timer');
  timer.textContent = meta.phase === 'countdown' ? '0:00'.replace('0:00', fmt(secs)) : fmt(secs);
  timer.classList.toggle('low', meta.phase === 'play' && secs <= 10);
  $('roundLabel').textContent = ctx.mode === 'kotp' ? 'KING OF THE POLE' : `ROUND ${ctx.round}/${ctx.total}`;
  // collapse countdown
  const ct = $('collapseTimer');
  if (meta.warn > 0) { ct.textContent = `⚠ COLLAPSE ${(meta.warn / TICK_RATE).toFixed(1)}`; ct.classList.add('warn'); }
  else if (meta.next > 0) { ct.textContent = `COLLAPSE IN ${Math.ceil(meta.next / TICK_RATE)}s`; ct.classList.remove('warn'); }
  else if (meta.phase === 'play' && ctx.mode === 'ffa' && meta.collapsed > 0) { ct.textContent = 'SUDDEN DEATH'; ct.classList.remove('warn'); }
  else { ct.textContent = ''; ct.classList.remove('warn'); }

  // scoreboard
  const rows = [];
  for (const p of view.players.values()) {
    const info = ctx.roster.get(p.id); if (!info) continue;
    const kos = (ctx.matchKos.get(p.id) || 0) + (ctx.roundKos.get(p.id) || 0);
    rows.push({ id: p.id, name: info.name, color: info.color, kos, score: p.score, alive: !!(p.flags & FLAG.ALIVE), ghost: !!(p.flags & FLAG.GHOST), bot: !!(p.flags & FLAG.BOT) && !info.bot });
  }
  const key = ctx.mode === 'kotp' ? 'score' : 'kos';
  rows.sort((a, b) => b[key] - a[key] || (b.alive - a.alive) || a.id - b.id);
  const sig = JSON.stringify(rows);
  if (sig !== lastSb) {
    lastSb = sig;
    $('scoreboard').innerHTML = rows.map(r => `
      <div class="sb-row ${r.alive || ctx.mode === 'kotp' ? '' : 'dead'} ${r.id === selfId ? 'me' : ''}">
        <span class="dot" style="color:${hexColor(PLAYER_COLORS[r.color])}"></span>
        <span class="n">${r.ghost ? '👻 ' : ''}${esc(r.name)}${r.bot ? ' 🤖' : ''}</span>
        <span class="k">${ctx.mode === 'kotp' ? r.score : r.kos}</span>
      </div>`).join('');
  }

  // meters
  const me = view.players.get(selfId);
  const ghost = me && (me.flags & FLAG.GHOST);
  const spectating = !me;
  $('spectateBanner').classList.toggle('show', spectating && ctx.mode !== 'demo');
  $('ghostBanner').classList.toggle('show', !!ghost);
  if (ghost) $('ghostCd').textContent = me.ghostCd > 0 ? `(${Math.ceil(me.ghostCd / TICK_RATE)}s)` : '— READY!';
  document.querySelector('.meters').style.visibility = me && (me.flags & FLAG.ALIVE) ? 'visible' : 'hidden';
  if (me) {
    const e = me.energy / PHYS.energyMax;
    $('energyFill').style.width = (e * 100).toFixed(1) + '%';
    document.querySelector('.meter.energy').classList.toggle('low', me.energy < PHYS.minEnergy);
    const s = Math.min(1, me.surge / PHYS.surgeMax);
    $('surgeFill').style.width = (s * 100).toFixed(1) + '%';
    const ready = s >= 1;
    document.querySelector('.meter.surge').classList.toggle('ready', ready);
    $('surgeLabel').textContent = ready ? 'SURGE READY [Q]' : 'SURGE';
    document.querySelector('.tbtn.surge').classList.toggle('ready', ready);
    const st = me.tell > 0 && me.pend ? me.pend + 10 : me.mode;
    if (st !== lastState) {
      lastState = st;
      const pill = $('statePill');
      const m = st >= 10 ? st - 10 : st;
      pill.textContent = st >= 10 ? MODE_NAMES[m] + '…' : MODE_NAMES[m];
      pill.style.color = m === MODE.NEUTRAL ? '#cfd8ff' : m === MODE.ANCHOR ? '#1a2040' : '#fff';
      pill.style.background = m === MODE.NEUTRAL ? 'rgba(255,255,255,0.08)' : MODE_CSS[m];
      pill.style.boxShadow = m === MODE.NEUTRAL ? 'none' : `0 0 16px ${MODE_CSS[m]}`;
      pill.style.opacity = st >= 10 ? 0.7 : 1;
    }
  }
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// announcer & kill feed
// ---------------------------------------------------------------------------
const annQueue = [];
let annBusyUntil = 0;
export function announce(text, color = '#fff', sub = '', big = true) {
  const now = performance.now();
  if (now < annBusyUntil && annQueue.length < 3) { annQueue.push([text, color, sub, big]); return; }
  playAnnounce(text, color, sub, big);
}
function playAnnounce(text, color, sub, big) {
  const a = $('announcer');
  a.textContent = text;
  a.style.color = color;
  a.style.textShadow = `0 0 24px ${color}, 0 0 60px ${color}, 0 4px 0 rgba(0,0,0,0.6)`;
  a.classList.toggle('small', !big);
  a.classList.remove('pop'); void a.offsetWidth; a.classList.add('pop');
  const s = $('subAnnouncer');
  s.textContent = sub || '';
  s.classList.remove('pop'); void s.offsetWidth; if (sub) s.classList.add('pop');
  annBusyUntil = performance.now() + 700;
  setTimeout(() => {
    if (annQueue.length && performance.now() >= annBusyUntil - 5) playAnnounce(...annQueue.shift());
  }, 720);
}
export function clearAnnouncer() { annQueue.length = 0; $('announcer').classList.remove('pop'); $('subAnnouncer').classList.remove('pop'); }

const CAUSE_ICON = { hit: '💥', field: '🧲', debris: '🪨', surge: '⚡', ghost: '👻', drag: '🌀', self: '☠️' };
export function killfeed(ko, roster) {
  const kf = $('killfeed');
  const v = roster.get(ko.v), k = roster.get(ko.by);
  const nm = (m) => m ? `<span style="color:${hexColor(PLAYER_COLORS[m.color])}">${esc(m.name)}</span>` : '';
  const el = document.createElement('div');
  el.className = 'kf';
  el.innerHTML = k ? `${nm(k)}<span class="via">${CAUSE_ICON[ko.cause] || '💥'}</span>${nm(v)}` : `${nm(v)}<span class="via">fell into the void ☠️</span>`;
  kf.prepend(el);
  while (kf.children.length > 5) kf.lastChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 5500);
}
export function clearKillfeed() { $('killfeed').innerHTML = ''; }

export function screenFlash(color = '#ffffff', strength = 0.5) {
  const f = $('flash');
  f.style.background = color;
  f.animate([{ opacity: strength }, { opacity: 0 }], { duration: 380, easing: 'ease-out' });
}

// ---------------------------------------------------------------------------
// results & podium
// ---------------------------------------------------------------------------
const AWARD_ICON = { kos: '🏆', save: '🛟', survivor: '⏳', hit: '💥', chaos: '🌪️', pole: '👑' };
export function showResults(r, roster) {
  $('resultsTitle').textContent = r.mode === 'kotp' ? 'TIME!' : `ROUND ${r.round} OF ${r.total}`;
  const w = roster.get(r.winner);
  $('resultsWinner').innerHTML = w
    ? `${r.mode === 'kotp' ? 'Pole champion' : r.reason === 'last' ? 'Last one standing' : 'Winner'}: <b style="color:${hexColor(PLAYER_COLORS[w.color])}">${esc(w.name)}</b>`
    : (r.reason === 'none' ? 'Nobody survived! 💀' : 'Time ran out — nobody survived alone!');
  $('awards').innerHTML = r.awards.map((a, i) => {
    const m = roster.get(a.id) || { name: '?', color: 0, skin: 0 };
    return `<div class="award" style="animation-delay:${0.25 + i * 0.15}s">
      <div class="ic">${AWARD_ICON[a.key] || '⭐'}</div>
      <div class="t">${esc(a.title)}</div>
      <img src="${discPreview(m.skin, m.color, 64)}" alt="">
      <div class="n" style="color:${hexColor(PLAYER_COLORS[m.color])}">${esc(m.name)}</div>
      <div class="v">${esc(a.value)}</div></div>`;
  }).join('');
  const key = r.mode === 'kotp' ? 'score' : 'kos';
  $('standings').innerHTML = r.standings.map((s, i) => `
    <div class="st" style="animation-delay:${0.8 + i * 0.05}s"><img src="${discPreview(s.skin, s.color, 48)}" alt="">${esc(s.name)} <span class="k">${s[key]}${r.mode === 'kotp' ? ' pts' : ' KO'}</span></div>`).join('');
  const bar = $('resultsProgress');
  bar.style.transition = 'none'; bar.style.width = '0';
  void bar.offsetWidth;
  bar.style.transition = `width ${RESULTS_MS - 300}ms linear`; bar.style.width = '100%';
}

export function showPodium(data, selfId) {
  const key = data.mode === 'kotp' ? 'score' : 'kos';
  const top = data.standings.slice(0, 3);
  const order = [1, 0, 2];
  $('podiumStage').innerHTML = order.map((idx, i) => {
    const s = top[idx];
    if (!s) return '<div class="pod"></div>';
    return `<div class="pod p${idx + 1}">
      <div class="who" style="animation-delay:${0.9 - idx * 0.35}s">
        <img src="${discPreview(s.skin, s.color, 96)}" alt="">
        <div class="n" style="color:${hexColor(PLAYER_COLORS[s.color])}">${idx === 0 ? '👑 ' : ''}${esc(s.name)}</div>
        <div class="s">${s[key]} ${data.mode === 'kotp' ? 'pts' : 'KOs'}</div>
      </div>
      <div class="block" style="animation-delay:${0.6 - idx * 0.2 + i * 0}s">${idx + 1}</div></div>`;
  }).join('');
  $('podiumRest').innerHTML = data.standings.slice(3).map((s, i) => `
    <div class="st" style="animation-delay:${1.4 + i * 0.05}s">#${i + 4} <img src="${discPreview(s.skin, s.color, 48)}" alt="">${esc(s.name)} <span class="k">${s[key]}</span></div>`).join('');
  // confetti
  const colors = ['#2f9bff', '#ff3352', '#ffd23f', '#31e7ff', '#ff4fd8', '#7dff5a'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 2.2 + Math.random() * 2.5 + 's';
    c.style.animationDelay = 0.8 + Math.random() * 1.2 + 's';
    c.style.borderRadius = Math.random() < 0.5 ? '50%' : '2px';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 6000);
  }
  const won = top[0] && top[0].id === selfId;
  return won;
}

// ---------------------------------------------------------------------------
// settings modal
// ---------------------------------------------------------------------------
let settingsHandlers = null;
export function initSettings(h) {
  settingsHandlers = h;
  const seg = $('qualitySeg');
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    settings.quality = b.dataset.q; save(); refreshSettings(); audio.click(); h.onQuality();
  });
  const vol = (id, key) => {
    const el = $(id);
    el.value = settings[key];
    el.addEventListener('input', () => { settings[key] = Number(el.value); save(); refreshSettings(); h.onVolume(); });
  };
  vol('volMaster', 'volMaster'); vol('volMusic', 'volMusic'); vol('volSfx', 'volSfx');
  $('btnMute').onclick = () => { settings.muted = !settings.muted; save(); refreshSettings(); h.onVolume(); };
  $('btnMuteQuick').onclick = () => { settings.muted = !settings.muted; save(); refreshSettings(); h.onVolume(); };
  $('btnShowTouch').onclick = () => {
    settings.touch = settings.touch === 'auto' ? 'on' : settings.touch === 'on' ? 'off' : 'auto'; save(); refreshSettings(); h.onTouch();
  };
  $('btnCloseSettings').onclick = () => { audio.click(); $('settings').classList.remove('show'); };
  $('btnQuit').onclick = () => { $('settings').classList.remove('show'); h.onQuit(); };
  $('settings').addEventListener('click', (e) => { if (e.target.id === 'settings') $('settings').classList.remove('show'); });
  $('btnMenu').onclick = () => { audio.click(); openSettings(true); };
  refreshSettings();
}

export function openSettings(inGame) {
  $('btnQuit').style.display = inGame ? 'block' : 'none';
  refreshSettings();
  $('settings').classList.add('show');
}

export function refreshSettings(activeQuality) {
  [...$('qualitySeg').children].forEach(b => b.classList.toggle('sel', b.dataset.q === settings.quality));
  if (activeQuality) refreshSettings.active = activeQuality;
  $('qualityInfo').textContent = `Currently rendering at ${(refreshSettings.active || '').toUpperCase()} quality${settings.quality === 'auto' ? ' (auto-adjusts to keep 60 fps)' : ''}.`;
  $('volMasterVal').textContent = settings.volMaster + '%';
  $('volMusicVal').textContent = settings.volMusic + '%';
  $('volSfxVal').textContent = settings.volSfx + '%';
  $('btnMute').textContent = settings.muted ? 'Unmute' : 'Mute';
  $('btnMuteQuick').textContent = settings.muted ? '🔇' : '🔊';
  $('btnShowTouch').textContent = `Touch controls: ${settings.touch}`;
  void settingsHandlers;
}

// =============================================================================
// Scene: the PixiJS application, render layers, dynamic camera, post effects
// (bloom + shockwave distortion), screen shake and quality management.
// =============================================================================
import { buildTextures } from './textures.js';
import { Background } from './background.js';
import { ArenaView } from './arena.js';
import { Filings } from './filings.js';
import { FieldLines } from './fieldlines.js';
import { Players } from './players.js';
import { Effects } from './effects.js';
import { BloomFilter } from './bloom.js';
import { getArena } from '/shared/arenas.js';
import { MODE, FLAG, PHYS } from '/shared/constants.js';

const PIXI = window.PIXI;

export class Scene {
  constructor(parent, quality) {
    this.q = quality;
    PIXI.settings.ROUND_PIXELS = false;
    const res = Math.min(window.devicePixelRatio || 1, quality.maxRes);
    this.app = new PIXI.Application({
      resizeTo: window, antialias: quality.antialias, backgroundColor: 0x05030f, resolution: res, autoDensity: true,
      powerPreference: 'high-performance', autoStart: false,
    });
    parent.appendChild(this.app.view);
    this.app.ticker.stop();
    buildTextures();

    const stage = this.app.stage;
    this.bg = new Background(quality);
    stage.addChild(this.bg.container);

    // world, transformed by the camera
    this.world = new PIXI.Container();
    stage.addChild(this.world);
    const L = this.layers = {};
    for (const name of ['void', 'fallingTiles', 'sides', 'tops', 'lights', 'rims', 'cracks', 'filings', 'shadows', 'fieldLines', 'trails', 'debris', 'pylons', 'players', 'fxNormal', 'fx', 'names']) {
      L[name] = new PIXI.Container();
      this.world.addChild(L[name]);
    }
    L.fx.blendMode = PIXI.BLEND_MODES.ADD;

    this.fx = new Effects(L, quality);
    this.players = new Players(L, quality);
    this.fieldLines = new FieldLines(L.fieldLines, quality);

    this.cam = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tz: 1, override: null };
    this.trauma = 0;
    this.shakeT = 0;
    this.time = 0;
    this.shockwaves = [];
    this.setupFilters();
    this.arenaView = null;
    this.filings = null;
    this.arena = null;
  }

  setupFilters() {
    const q = this.q;
    this.bloom = null;
    const F = PIXI.filters;
    if (q.bloom) {
      this.bloom = new BloomFilter({ threshold: 0.62, scale: 0.75, downsample: q.bloomRes, passes: q.name === 'high' ? [0, 1, 2, 3, 4] : [0, 1, 2, 3] });
    }
    void F;
    this.world.filterArea = this.app.screen;
    this.updateFilters();
  }

  updateFilters() {
    const list = [];
    if (this.bloom) list.push(this.bloom);
    for (const s of this.shockwaves) list.push(s.f);
    this.world.filters = list.length ? list : null;
  }

  /** Change quality preset at runtime. */
  setQuality(q) {
    if (q.name === this.q.name) return;
    this.q = q;
    const res = Math.min(window.devicePixelRatio || 1, q.maxRes);
    this.app.renderer.resolution = res;
    this.app.renderer.plugins.interaction && (this.app.renderer.plugins.interaction.resolution = res);
    this.app.renderer.resize(window.innerWidth, window.innerHeight);
    this.bg.build(q);
    this.fx.max = q.particles;
    this.fieldLines.glow = q.fieldGlow;
    this.players.quality = q;
    for (const s of this.shockwaves) s.f.destroy?.();
    this.shockwaves = [];
    this.setupFilters();
    if (this.arena) {
      const collapsed = this.arenaView ? this.arenaView.collapsed : 0;
      if (this.filings) this.filings.destroy();
      this.filings = new Filings(this.layers.filings, this.arena, q);
      this.filings.setCollapsed(collapsed);
    }
  }

  /** Build the arena (tiles, pylons, filings). */
  loadArena(index, collapsed = 0) {
    if (this.arenaView) this.arenaView.destroy();
    if (this.filings) this.filings.destroy();
    this.players.clear();
    this.fx.clear();
    this.arena = getArena(index);
    this.arenaView = new ArenaView(this.layers, this.arena, this.fx);
    this.filings = new Filings(this.layers.filings, this.arena, this.q);
    if (collapsed) { this.arenaView.setCollapsed(collapsed, true); this.filings.setCollapsed(collapsed); }
    this.cam.override = null;
    this.trauma = 0;
    this.fitCamera(true);
  }

  setCollapsed(level, instant = false) {
    if (!this.arenaView) return;
    if (level !== this.arenaView.collapsed) {
      this.arenaView.setCollapsed(level, instant);
      this.filings.setCollapsed(level);
    }
  }

  // ---------------------------------------------------------------- juice
  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  shockwave(x, y, power = 1) {
    if (!this.q.shockwave || !PIXI.filters.ShockwaveFilter) return;
    if (this.shockwaves.length >= 3) { const old = this.shockwaves.shift(); old.f.destroy?.(); }
    const f = new PIXI.filters.ShockwaveFilter([0, 0], {
      amplitude: 18 * power, wavelength: 120 + 60 * power, speed: 520 + 200 * power, brightness: 1.15, radius: 260 + 420 * power,
    }, 0);
    this.shockwaves.push({ f, x, y, life: 0, max: 0.9 + 0.4 * power });
    this.updateFilters();
  }

  toScreen(x, y) {
    const c = this.cam, w = this.app.screen.width, h = this.app.screen.height;
    return [(x - c.x) * c.zoom + w / 2 + this.shakeX, (y - c.y) * c.zoom + h / 2 + this.shakeY];
  }

  /** Slow-motion zoom on a point (final KO). */
  focus(x, y, ms = 1600) {
    this.cam.override = { x, y, zoomMul: 1.7, until: this.time + ms / 1000 };
  }

  fitZoom() {
    const w = this.app.screen.width, h = this.app.screen.height;
    const ext = this.arena ? this.arena.extent : 500;
    // small screens (phones) crop the platform slightly so discs stay readable
    const small = Math.min(w, h) < 520 ? 1.18 : 1;
    return Math.min(w, h) / (ext * 2.15) * small;
  }

  fitCamera(snap = false) {
    this.cam.tx = 0; this.cam.ty = 0; this.cam.tz = this.fitZoom();
    if (snap) { this.cam.x = 0; this.cam.y = 0; this.cam.zoom = this.cam.tz; }
  }

  /** Frame all living players, weighted toward the local player. */
  updateCamera(dt, view, selfId, mode) {
    const c = this.cam;
    const w = this.app.screen.width, h = this.app.screen.height;
    const fit = this.fitZoom();
    if (mode === 'overview' || !view) {
      c.tx = 0; c.ty = 0; c.tz = fit * 1.05;
    } else {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0, sx = 0, sy = 0;
      for (const p of view.players.values()) {
        if (!(p.flags & FLAG.ALIVE)) continue;
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        sx += p.x; sy += p.y; n++;
      }
      const me = view.players.get(selfId);
      if (me && (me.flags & (FLAG.ALIVE | FLAG.GHOST))) {
        sx += me.x * 2; sy += me.y * 2; n += 2;
        minX = Math.min(minX, me.x); maxX = Math.max(maxX, me.x); minY = Math.min(minY, me.y); maxY = Math.max(maxY, me.y);
      }
      if (n === 0) { c.tx = 0; c.ty = 0; c.tz = fit; }
      else {
        const cx = (minX + maxX) / 2 * 0.5 + (sx / n) * 0.5, cy = (minY + maxY) / 2 * 0.5 + (sy / n) * 0.5;
        const margin = 260;
        const bw = maxX - minX + margin * 2, bh = maxY - minY + margin * 2;
        let z = Math.min(w / bw, h / bh);
        z = Math.max(fit * 0.98, Math.min(fit * 1.55, z));
        // keep the platform loosely centered so the edges stay readable
        c.tx = cx * 0.55; c.ty = cy * 0.55; c.tz = z;
      }
    }
    if (c.override) {
      if (this.time > c.override.until) c.override = null;
      else { c.tx = c.override.x; c.ty = c.override.y; c.tz = fit * c.override.zoomMul; }
    }
    const k = 1 - Math.exp(-dt * (c.override ? 5 : 2.6));
    c.x += (c.tx - c.x) * k; c.y += (c.ty - c.y) * k;
    c.zoom += (c.tz - c.zoom) * (1 - Math.exp(-dt * (c.override ? 4 : 1.8)));
  }

  /**
   * Render one frame.
   * @param {number} dt seconds
   * @param {object} view session view (players, debris, meta) or null
   * @param {object} o { selfId, camMode, roster }
   */
  frame(dt, view, o = {}) {
    this.time += dt;
    const w = this.app.screen.width, h = this.app.screen.height;
    if (view && o.roster) this.players.sync(view, o.roster, o.selfId);
    this.updateCamera(dt, view, o.selfId, o.camMode || 'follow');

    // screen shake (trauma^2 model)
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const sh = this.trauma * this.trauma;
    this.shakeT += dt * 60;
    this.shakeX = sh * 26 * (Math.sin(this.shakeT * 1.7) + Math.sin(this.shakeT * 3.3) * 0.5);
    this.shakeY = sh * 26 * (Math.cos(this.shakeT * 1.9) + Math.sin(this.shakeT * 2.7) * 0.5);
    const c = this.cam;
    this.world.scale.set(c.zoom);
    this.world.position.set(w / 2 - c.x * c.zoom + this.shakeX, h / 2 - c.y * c.zoom + this.shakeY);
    this.world.rotation = sh * 0.02 * Math.sin(this.shakeT * 2.1);

    this.bg.update(dt, { x: c.x * c.zoom, y: c.y * c.zoom }, w, h);

    // magnetic sources for filings & pylons
    const sources = [], bodies = [];
    if (view) {
      for (const p of view.players.values()) {
        if (!(p.flags & FLAG.ALIVE)) continue;
        bodies.push(p);
        if (p.mode === MODE.PULL || p.mode === MODE.PUSH) sources.push({ x: p.x, y: p.y, mode: p.mode, k: 0.5 + 0.5 * Math.min(1, p.energy / 40) });
        else if (p.tell > 0 && (p.pend === MODE.PULL || p.pend === MODE.PUSH)) sources.push({ x: p.x, y: p.y, mode: p.pend, k: 0.25 });
      }
    }
    if (this.arenaView) this.arenaView.update(dt, view, sources);
    if (this.filings) this.filings.update(dt, this.time, sources, bodies);
    if (this.arena) this.fieldLines.update(dt, view, this.arena.pylons);
    // keep names readable when the camera is zoomed out (phones)
    const ns = Math.max(1, 0.85 / c.zoom);
    for (const v of this.players.views.values()) v.nameC.scale.set(ns);
    this.players.update(dt, view, this.fx, this.time);
    this.fx.update(dt);

    // shockwaves follow the camera
    if (this.shockwaves.length) {
      let changed = false;
      for (let i = this.shockwaves.length - 1; i >= 0; i--) {
        const s = this.shockwaves[i];
        s.life += dt;
        s.f.time = s.life;
        const [sx, sy] = this.toScreen(s.x, s.y);
        s.f.center = [sx, sy];
        s.f.amplitude = Math.max(0, s.f.amplitude * (1 - dt * 1.2));
        if (s.life > s.max) { this.shockwaves.splice(i, 1); s.f.destroy?.(); changed = true; }
      }
      if (changed) this.updateFilters();
    }
    this.app.renderer.render(this.app.stage);
  }
}

void PHYS;

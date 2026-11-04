// =============================================================================
// Arena rendering: metallic hex tiles with depth, glowing edges, ambient light
// pulses, cracking/collapsing tiles, magnetic pylons and metal debris.
// =============================================================================
import { T } from './textures.js';
import { HEX_DIRS, hexKey } from '/shared/hex.js';
import { MODE, FLAG, PHYS, PYLON, DEBRIS, rng } from '/shared/constants.js';
import { POLE_SCALE } from '/shared/physics.js';

const PIXI = window.PIXI;
const ADD = () => PIXI.BLEND_MODES.ADD;

export class ArenaView {
  constructor(layers, arena, fx) {
    this.layers = layers;
    this.arena = arena;
    this.fx = fx;
    this.time = 0;
    this.collapsed = 0;
    this.crackLayer = -1;
    this.crackStart = 0;
    this.tiles = [];
    this.falling = [];
    const R = rng(arena.index * 101 + 5);

    // glow of the void beneath the platform
    const vg = new PIXI.Sprite(T.glow);
    vg.anchor.set(0.5); vg.blendMode = ADD();
    vg.tint = arena.theme; vg.alpha = 0.22;
    vg.scale.set(arena.extent * 2.6 / 128);
    layers.void.addChild(vg);
    const vg2 = new PIXI.Sprite(T.glow);
    vg2.anchor.set(0.5); vg2.blendMode = ADD();
    vg2.tint = 0x2a1a6a; vg2.alpha = 0.35; vg2.scale.set(arena.extent * 4 / 128);
    layers.void.addChildAt(vg2, 0);
    this.voidGlow = vg;

    for (const t of arena.tiles) {
      const v = Math.floor(R() * 3);
      const side = new PIXI.Sprite(T.hexSide);
      side.anchor.set(0.5, T.hexH / 2 / (T.hexH + T.hexDepth));
      side.position.set(t.x, t.y);
      const top = new PIXI.Sprite(T.hexTop[v]);
      top.anchor.set(0.5); top.position.set(t.x, t.y);
      top.tint = 0xffffff;
      const light = new PIXI.Sprite(T.hexLight);
      light.anchor.set(0.5); light.position.set(t.x, t.y); light.blendMode = ADD(); light.alpha = 0;
      light.tint = arena.theme;
      const rim = new PIXI.Sprite(T.hexRim);
      rim.anchor.set(0.5); rim.position.set(t.x, t.y); rim.blendMode = ADD(); rim.tint = arena.theme; rim.alpha = 0.06;
      const crack = new PIXI.Sprite(T.cracks[Math.floor(R() * 3)]);
      crack.anchor.set(0.5); crack.position.set(t.x, t.y); crack.blendMode = ADD(); crack.alpha = 0; crack.visible = false;
      crack.tint = 0xff8a2a;
      crack.rotation = Math.floor(R() * 6) * Math.PI / 3;
      layers.sides.addChild(side); layers.tops.addChild(top); layers.lights.addChild(light);
      layers.rims.addChild(rim); layers.cracks.addChild(crack);
      this.tiles.push({
        t, side, top, light, rim, crack, edge: false, gone: false,
        dist: Math.hypot(t.x, t.y), phase: R() * Math.PI * 2,
      });
    }
    this.computeEdges();

    // pylons
    this.pylons = arena.pylons.map(p => this.makePylon(p));
    // debris
    this.debris = new Map();
  }

  computeEdges() {
    const alive = new Set();
    const maxL = this.arena.maxLayer - this.collapsed;
    for (const tv of this.tiles) if (tv.t.layer <= maxL) alive.add(hexKey(tv.t.q, tv.t.r));
    for (const tv of this.tiles) {
      tv.edge = alive.has(hexKey(tv.t.q, tv.t.r)) && HEX_DIRS.some(([dq, dr]) => !alive.has(hexKey(tv.t.q + dq, tv.t.r + dr)));
    }
  }

  makePylon(p) {
    const c = new PIXI.Container();
    c.position.set(p.x, p.y);
    const k = p.pole ? POLE_SCALE : 1;
    const shadow = new PIXI.Sprite(T.shadow); shadow.anchor.set(0.5); shadow.scale.set(1.6 * k); shadow.position.set(6, 10); shadow.alpha = 0.8;
    const halo = new PIXI.Sprite(T.glow); halo.anchor.set(0.5); halo.blendMode = ADD(); halo.tint = p.pole ? 0xffc93f : 0x4aa8ff; halo.alpha = 0.35; halo.scale.set(1.3 * k);
    const base = new PIXI.Sprite(T.pylonBase); base.anchor.set(0.5); base.scale.set(0.95 * k);
    const ring = new PIXI.Sprite(T.dashedRing); ring.anchor.set(0.5); ring.blendMode = ADD(); ring.tint = p.pole ? 0xffd23f : 0x7fc8ff; ring.alpha = 0.55;
    ring.scale.set((PYLON.radius + 12) * 2 / 256 * k);
    const range = new PIXI.Sprite(T.thinRing); range.anchor.set(0.5); range.blendMode = ADD(); range.tint = 0x7fc8ff; range.alpha = 0.0;
    range.scale.set(PYLON.range * 2 / 256);
    const core = new PIXI.Sprite(T.pylonCore); core.anchor.set(0.5); core.blendMode = ADD(); core.scale.set(0.8 * k);
    core.tint = p.pole ? 0xffe08a : 0xffffff;
    c.addChild(shadow, range, halo, base, ring, core);
    this.layers.pylons.addChild(c);
    return { p, c, halo, ring, core, range, active: 0, pole: p.pole };
  }

  /** Warning: the given layer starts cracking. */
  crack(layer) {
    this.crackLayer = layer;
    this.crackStart = this.time;
    for (const tv of this.tiles) if (tv.t.layer === layer && !tv.gone) tv.crack.visible = true;
  }

  /** Set the collapse level; animate newly collapsed tiles unless `instant`. */
  setCollapsed(level, instant = false) {
    if (level === this.collapsed) return;
    const maxL = this.arena.maxLayer - level;
    for (const tv of this.tiles) {
      if (tv.gone || tv.t.layer <= maxL) continue;
      tv.gone = true;
      tv.light.visible = false; tv.rim.visible = false; tv.crack.visible = false;
      if (instant) { tv.top.visible = false; tv.side.visible = false; continue; }
      // move into the falling layer, under the platform
      this.layers.fallingTiles.addChild(tv.side); this.layers.fallingTiles.addChild(tv.top);
      tv.fall = { vy: 20 + Math.random() * 60, vr: (Math.random() - 0.5) * 2.5, t: 0, delay: Math.random() * 0.25 };
      this.falling.push(tv);
      this.fx.crumble(tv.t.x, tv.t.y, this.arena.theme);
    }
    this.collapsed = level;
    this.crackLayer = -1;
    this.computeEdges();
  }

  /** Per-frame update. view = session view; dt seconds. */
  update(dt, view, fieldSources) {
    this.time += dt;
    const time = this.time;
    // ambient light pulses running across the floor
    const crackAge = this.time - this.crackStart;
    for (let i = 0; i < this.tiles.length; i++) {
      const tv = this.tiles[i];
      if (tv.gone) continue;
      const w1 = Math.sin(tv.dist * 0.011 - time * 1.4);
      const w2 = Math.sin(tv.t.x * 0.008 + tv.t.y * 0.005 + time * 0.7 + tv.phase * 0.2);
      let L = 0.015 + 0.16 * Math.pow(Math.max(0, w1), 12) + 0.05 * Math.pow(Math.max(0, w2), 6);
      tv.rim.alpha = tv.edge ? 0.5 + 0.25 * Math.sin(time * 2 + tv.phase) : 0.05 + L * 0.6;
      if (tv.crack.visible) {
        // cracks grow brighter and the tile shakes harder as the drop nears
        const k = Math.min(1, crackAge / 3);
        const flick = 0.75 + 0.25 * Math.sin(time * 40 + tv.phase * 9);
        tv.crack.alpha = (0.25 + 0.75 * k) * flick;
        const sh = 0.6 + k * 2.6;
        const ox = Math.sin(time * 53 + tv.phase * 7) * sh, oy = Math.cos(time * 47 + tv.phase * 5) * sh;
        tv.top.position.set(tv.t.x + ox, tv.t.y + oy);
        tv.crack.position.copyFrom(tv.top.position);
        tv.light.position.copyFrom(tv.top.position);
        L = Math.max(L, 0.1 + 0.35 * k * flick);
        tv.light.tint = 0xff6a1f;
        tv.top.tint = 0xffd0b0;
      }
      tv.light.alpha = L;
    }

    // tiles falling into the void
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const tv = this.falling[i];
      const f = tv.fall;
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.t += dt; f.vy += 600 * dt;
      tv.top.y += f.vy * dt; tv.side.y = tv.top.y;
      tv.top.rotation += f.vr * dt; tv.side.rotation = tv.top.rotation;
      const s = Math.max(0.05, 1 - f.t * 0.55);
      tv.top.scale.set(s); tv.side.scale.set(s);
      tv.top.alpha = tv.side.alpha = Math.max(0, 1 - f.t * 0.6);
      tv.top.tint = 0x8890b0;
      if (f.t > 1.8) { tv.top.visible = false; tv.side.visible = false; this.falling.splice(i, 1); }
    }

    // pylons: glow up when someone grapples or pushes off them
    for (const py of this.pylons) {
      let act = 0, col = py.pole ? 0xffd23f : 0x7fc8ff;
      for (const s of fieldSources) {
        if (s.mode !== MODE.PULL && s.mode !== MODE.PUSH) continue;
        const d = Math.hypot(s.x - py.p.x, s.y - py.p.y);
        if (d < PYLON.range) { const a = 1 - d / PYLON.range; if (a > act) { act = a; col = s.mode === MODE.PULL ? 0x2f9bff : 0xff3352; } }
      }
      py.active += (act - py.active) * Math.min(1, dt * 8);
      py.ring.rotation += dt * (0.4 + py.active * 6);
      py.ring.tint = act > 0.05 ? col : (py.pole ? 0xffd23f : 0x7fc8ff);
      py.core.alpha = (py.pole ? 0.5 : 0.65) + 0.25 * Math.sin(time * 3 + py.p.x) + py.active * 0.35;
      py.core.scale.set((py.pole ? POLE_SCALE : 1) * (0.75 + 0.1 * Math.sin(time * 5) + py.active * 0.5));
      py.halo.alpha = 0.3 + py.active * 0.7;
      py.halo.tint = act > 0.05 ? col : (py.pole ? 0xffc93f : 0x4aa8ff);
      py.range.alpha = py.active * 0.25;
      py.range.tint = col;
    }

    this.updateDebris(dt, view);
  }

  updateDebris(dt, view) {
    if (!view) return;
    for (const [id, d] of view.debris) {
      let dv = this.debris.get(id);
      if (!dv) {
        const c = new PIXI.Container();
        const shadow = new PIXI.Sprite(T.shadow); shadow.anchor.set(0.5); shadow.scale.set(0.7); shadow.position.set(4, 7);
        const glow = new PIXI.Sprite(T.debrisGlow); glow.anchor.set(0.5); glow.blendMode = ADD(); glow.alpha = 0; glow.scale.set(1.3);
        const body = new PIXI.Sprite(T.debris); body.anchor.set(0.5);
        body.scale.set(DEBRIS.radius * 2 / 28);
        c.addChild(shadow, glow, body);
        this.layers.debris.addChild(c);
        dv = { c, glow, body, shadow, fall: null, wasAlive: d.alive };
        this.debris.set(id, dv);
      }
      if (dv.fall) {
        const f = dv.fall;
        f.t += dt;
        dv.c.x += f.vx * dt; dv.c.y += f.vy * dt + f.t * 200 * dt;
        f.vx *= 0.97; f.vy *= 0.97;
        dv.c.scale.set(Math.max(0.05, 1 - f.t * 0.8));
        dv.body.rotation += dt * 6;
        dv.c.alpha = Math.max(0, 1 - f.t * 0.7);
        if (f.t > 1.4) { dv.fall = null; dv.c.visible = false; }
        continue;
      }
      dv.c.visible = d.alive;
      if (!d.alive) continue;
      dv.c.alpha = 1; dv.c.scale.set(1);
      dv.c.position.set(d.x, d.y);
      dv.body.rotation = d.ang;
      const sp = Math.hypot(d.vx, d.vy);
      dv.glow.alpha += (Math.min(1, sp / 500) - dv.glow.alpha) * Math.min(1, dt * 10);
      if (sp > 350 && Math.random() < 0.5) this.fx.trailSpark(d.x, d.y, d.vx, d.vy, 0xffa040);
    }
  }

  debrisFall(ev) {
    const dv = this.debris.get(ev.id);
    if (!dv) return;
    dv.fall = { t: 0, vx: ev.vx * 0.5, vy: ev.vy * 0.5 };
    dv.c.position.set(ev.x, ev.y);
    this.layers.fallingTiles.addChild(dv.c);
  }

  debrisSpawn(ev) {
    const dv = this.debris.get(ev.id);
    if (dv) { dv.fall = null; this.layers.debris.addChild(dv.c); dv.c.visible = true; }
    this.fx.ring(ev.x, ev.y, 0xffa040, 60, 0.5);
  }

  destroy() {
    for (const k of ['void', 'sides', 'tops', 'lights', 'rims', 'cracks', 'pylons', 'debris', 'fallingTiles']) {
      this.layers[k].removeChildren().forEach(c => c.destroy({ children: true }));
    }
  }
}

void FLAG; void PHYS;

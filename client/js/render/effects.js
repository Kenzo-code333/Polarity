// =============================================================================
// Effects: pooled particles (sparks, dust, chunks, speed lines), expanding
// rings, flashes and floating text. Screen-level juice (shake, shockwave
// distortion, hit-stop) lives in scene.js.
// =============================================================================
import { T } from './textures.js';
import { MODE_COLORS } from '/shared/constants.js';

const PIXI = window.PIXI;

export class Effects {
  constructor(layers, quality) {
    this.add = layers.fx;          // additive layer
    this.norm = layers.fxNormal;   // normal-blend layer (chunks, text)
    this.add.blendMode = PIXI.BLEND_MODES.NORMAL;
    this.max = quality.particles;
    this.parts = [];
    this.pool = [];
    this.texts = [];
  }

  sprite(tex, additive = true) {
    let s = this.pool.pop();
    if (!s) { s = new PIXI.Sprite(tex); s.anchor.set(0.5); }
    s.texture = tex;
    s.blendMode = additive ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL;
    s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1); s.tint = 0xffffff;
    (additive ? this.add : this.norm).addChild(s);
    return s;
  }

  spawn(o) {
    if (this.parts.length >= this.max) {
      // recycle the oldest particle
      const old = this.parts.shift();
      this.release(old.s);
    }
    const s = this.sprite(o.tex, o.add !== false);
    s.position.set(o.x, o.y);
    s.tint = o.tint ?? 0xffffff;
    const p = {
      s, vx: o.vx || 0, vy: o.vy || 0, life: 0, max: o.life || 0.6, drag: o.drag ?? 3, grav: o.grav || 0,
      spin: o.spin || 0, s0: o.s0 ?? 1, s1: o.s1 ?? 0, sx: o.sx || 1, a0: o.a0 ?? 1, orient: !!o.orient,
    };
    s.scale.set(p.s0 * p.sx, p.s0);
    if (o.rot !== undefined) s.rotation = o.rot;
    this.parts.push(p);
    return p;
  }

  release(s) {
    s.visible = false;
    if (s.parent) s.parent.removeChild(s);
    this.pool.push(s);
  }

  // ------------------------------------------------------------------ presets
  sparks(x, y, nx, ny, color, n = 14, speed = 600) {
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(ny, nx) + (Math.random() - 0.5) * 2.2;
      const v = speed * (0.3 + Math.random() * 0.9);
      this.spawn({
        tex: T.spark, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25 + Math.random() * 0.35,
        tint: Math.random() < 0.4 ? 0xffffff : color, s0: 0.5 + Math.random() * 0.5, s1: 0.1, sx: 1.4, drag: 4, orient: true,
      });
    }
    for (let i = 0; i < n / 2; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * 0.3 * Math.random();
      this.spawn({ tex: T.dot, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.4, tint: color, s0: 1.2, s1: 0, drag: 2 });
    }
  }

  ring(x, y, color, radius = 80, life = 0.45, width = 1) {
    const p = this.spawn({ tex: T.ring, x, y, life, tint: color, s0: 0.15, s1: radius * 2 / 112, drag: 0 });
    p.ring = true; p.width = width;
    return p;
  }

  flash(x, y, color, size = 2, life = 0.25) {
    this.spawn({ tex: T.glow, x, y, life, tint: color, s0: size, s1: size * 1.4, drag: 0 });
  }

  /** big impact: sparks + ring + flash */
  impact(x, y, nx, ny, force, color) {
    const k = Math.min(1.6, force / 900);
    this.sparks(x, y, nx, ny, color, Math.round(8 + 18 * k), 400 + 600 * k);
    this.ring(x, y, 0xffffff, 40 + 70 * k, 0.35);
    this.flash(x, y, color, 0.8 + 1.2 * k, 0.2);
    if (k > 0.8) this.spawn({ tex: T.flare, x, y, life: 0.3, tint: 0xffffff, s0: 3 * k, s1: 0.5, drag: 0 });
  }

  crumble(x, y, theme) {
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * 30;
      this.spawn({
        tex: T.chunk[i % 3], add: false, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d,
        vx: Math.cos(a) * 40 * Math.random(), vy: -30 + Math.random() * 40, grav: 500, life: 1 + Math.random() * 0.6,
        s0: 1 + Math.random() * 0.8, s1: 0.2, drag: 0.5, spin: (Math.random() - 0.5) * 10, tint: 0xbac4e8,
      });
    }
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn({ tex: T.dot, x: x + Math.cos(a) * 20, y: y + Math.sin(a) * 20, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 + 30, life: 0.8, tint: 0xff8a2a, s0: 1.5, s1: 0, drag: 1 });
    }
    this.spawn({ tex: T.softGlow, x, y, life: 0.6, tint: theme, s0: 0.8, s1: 1.4, drag: 0, a0: 0.6 });
  }

  trailSpark(x, y, vx, vy, color) {
    this.spawn({
      tex: T.dot, x: x + (Math.random() - 0.5) * 16, y: y + (Math.random() - 0.5) * 16,
      vx: vx * 0.2 + (Math.random() - 0.5) * 40, vy: vy * 0.2 + (Math.random() - 0.5) * 40, life: 0.35 + Math.random() * 0.3,
      tint: color, s0: 0.9, s1: 0, drag: 3,
    });
  }

  speedLine(x, y, vx, vy, color) {
    const a = Math.atan2(vy, vx);
    const off = (Math.random() - 0.5) * 50;
    this.spawn({
      tex: T.streak, x: x - Math.cos(a) * 30 - Math.sin(a) * off, y: y - Math.sin(a) * 30 + Math.cos(a) * off,
      vx: -vx * 0.15, vy: -vy * 0.15, life: 0.22, tint: Math.random() < 0.5 ? 0xffffff : color, s0: 0.5, s1: 0.2, sx: 1.6, rot: a, drag: 2,
    });
  }

  voidFlash(x, y, color) {
    this.spawn({ tex: T.glow, x, y, life: 0.6, tint: color, s0: 0.2, s1: 1.6, drag: 0 });
    this.spawn({ tex: T.flare, x, y, life: 0.5, tint: 0xffffff, s0: 1.2, s1: 0.1, drag: 0 });
  }

  surge(x, y, mode) {
    const col = MODE_COLORS[mode];
    for (let i = 0; i < 4; i++) {
      const p = this.ring(x, y, i % 2 ? 0xffffff : col, 430 * (0.5 + i * 0.2), 0.5 + i * 0.15);
      if (mode === 1) { p.s0 = 430 * 2 / 112; p.s1 = 0.1; p.s.scale.set(p.s0); } // pull: rings collapse inward
    }
    this.flash(x, y, col, 4, 0.5);
    this.spawn({ tex: T.flare, x, y, life: 0.6, tint: 0xffffff, s0: 6, s1: 0.5, drag: 0 });
    for (let i = 0; i < 40; i++) {
      const a = i / 40 * Math.PI * 2;
      const v = 700 + Math.random() * 500;
      const inward = mode === 1;
      this.spawn({
        tex: T.spark, x: x + (inward ? Math.cos(a) * 380 : 0), y: y + (inward ? Math.sin(a) * 380 : 0),
        vx: Math.cos(a) * v * (inward ? -0.9 : 1), vy: Math.sin(a) * v * (inward ? -0.9 : 1),
        life: 0.5, tint: i % 3 ? col : 0xffffff, s0: 1, s1: 0.2, sx: 2, drag: inward ? 0.5 : 2.5, orient: true,
      });
    }
  }

  text(x, y, str, color = 0xffffff, size = 22) {
    const t = new PIXI.Text(str, {
      fontFamily: 'Orbitron, sans-serif', fontWeight: '900', fontSize: size, fill: color, stroke: 0x000000, strokeThickness: 4,
    });
    t.resolution = 2;
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.norm.addChild(t);
    this.texts.push({ t, life: 0, max: 1.1 });
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) { this.release(p.s); this.parts.splice(i, 1); continue; }
      const s = p.s;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vy *= dr; p.vy += p.grav * dt;
      s.x += p.vx * dt; s.y += p.vy * dt;
      if (p.spin) s.rotation += p.spin * dt;
      if (p.orient) s.rotation = Math.atan2(p.vy, p.vx);
      const sc = p.s0 + (p.s1 - p.s0) * (p.ring ? 1 - (1 - k) * (1 - k) : k);
      s.scale.set(sc * p.sx, sc);
      s.alpha = p.a0 * (p.ring ? (1 - k) * (1 - k) : 1 - k * k);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const o = this.texts[i];
      o.life += dt;
      const k = o.life / o.max;
      o.t.y -= 40 * dt;
      o.t.scale.set(k < 0.15 ? 0.5 + k / 0.15 * 0.7 : 1.2 - Math.min(0.2, (k - 0.15)));
      o.t.alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      if (k >= 1) { o.t.destroy(); this.texts.splice(i, 1); }
    }
  }

  clear() {
    for (const p of this.parts) this.release(p.s);
    this.parts.length = 0;
    for (const o of this.texts) o.t.destroy();
    this.texts.length = 0;
  }
}

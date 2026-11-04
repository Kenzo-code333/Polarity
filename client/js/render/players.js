// =============================================================================
// Player discs: animated skin cores, rim light, state-colored aura, glow tells,
// field range ripples, squash & stretch, motion trails, ghosts and falls.
// =============================================================================
import { T, discTextures } from './textures.js';
import { MODE, MODE_COLORS, FLAG, PHYS, SKINS, PLAYER_COLORS } from '/shared/constants.js';

const PIXI = window.PIXI;
const ADD = () => PIXI.BLEND_MODES.ADD;
const TRAIL_PTS = 14;
const DISC_SCALE = (PHYS.radius * 2) / 64;

class PlayerView {
  constructor(layers, info, isSelf, quality) {
    this.id = info.id;
    this.info = info;
    this.isSelf = isSelf;
    this.layers = layers;
    this.time = Math.random() * 10;
    this.spin = Math.random() * 6;
    this.stretch = 0; this.stretchV = 0;
    this.fallAnim = null;
    this.lastX = 0; this.lastY = 0;
    this.prevFlags = 0;
    this.pts = [];
    const col = PLAYER_COLORS[info.color] ?? 0xffffff;
    this.color = col;
    this.trailColor = SKINS[info.skin]?.trail ?? col;
    const tx = discTextures(info.skin, info.color);

    // trail (under everything)
    if (quality.trails) {
      for (let i = 0; i < TRAIL_PTS; i++) this.pts.push(new PIXI.Point(0, 0));
      this.trail = new PIXI.SimpleRope(T.trail, this.pts, 0);
      this.trail.blendMode = ADD();
      this.trail.tint = this.trailColor;
      this.trail.alpha = 0;
      layers.trails.addChild(this.trail);
    }

    const c = this.c = new PIXI.Container();
    this.shadow = new PIXI.Sprite(T.shadow); this.shadow.anchor.set(0.5); this.shadow.scale.set(1.05); this.shadow.position.set(5, 9);
    layers.shadows.addChild(this.shadow);

    this.fieldRing = new PIXI.Sprite(T.thinRing); this.fieldRing.anchor.set(0.5); this.fieldRing.blendMode = ADD(); this.fieldRing.alpha = 0;
    this.fieldRing.scale.set(PHYS.fieldRange * 2 / 256);
    this.ripples = [0, 1, 2].map(() => { const r = new PIXI.Sprite(T.ring); r.anchor.set(0.5); r.blendMode = ADD(); r.alpha = 0; return r; });
    this.aura = new PIXI.Sprite(T.glow); this.aura.anchor.set(0.5); this.aura.blendMode = ADD(); this.aura.tint = col; this.aura.alpha = 0.4;
    this.aura2 = new PIXI.Sprite(T.softGlow); this.aura2.anchor.set(0.5); this.aura2.blendMode = ADD(); this.aura2.alpha = 0;
    this.tellRing = new PIXI.Sprite(T.ring); this.tellRing.anchor.set(0.5); this.tellRing.blendMode = ADD(); this.tellRing.alpha = 0;
    this.selfRing = null;
    if (isSelf) {
      this.selfRing = new PIXI.Sprite(T.dashedRing); this.selfRing.anchor.set(0.5); this.selfRing.blendMode = ADD();
      this.selfRing.alpha = 0.45; this.selfRing.scale.set((PHYS.radius + 11) * 2 / 256);
    }

    // squash container (rotated to velocity) -> spin container (skin animation)
    this.squash = new PIXI.Container();
    this.spinC = new PIXI.Container();
    this.body = new PIXI.Sprite(tx.body); this.body.anchor.set(0.5); this.body.scale.set(DISC_SCALE);
    this.core1 = new PIXI.Sprite(tx.core); this.core1.anchor.set(0.5); this.core1.blendMode = ADD(); this.core1.scale.set(DISC_SCALE * 0.95);
    this.core2 = new PIXI.Sprite(tx.core); this.core2.anchor.set(0.5); this.core2.blendMode = ADD(); this.core2.scale.set(DISC_SCALE * 0.6); this.core2.alpha = 0.7;
    this.coreGlow = new PIXI.Sprite(T.glow); this.coreGlow.anchor.set(0.5); this.coreGlow.blendMode = ADD(); this.coreGlow.scale.set(0.32); this.coreGlow.alpha = 0.55;
    this.coreGlow.tint = this.trailColor;
    this.spinC.addChild(this.body, this.core1, this.core2, this.coreGlow);
    this.plate = new PIXI.Sprite(T.dashedRing); this.plate.anchor.set(0.5); this.plate.blendMode = ADD(); this.plate.alpha = 0;
    this.plate.scale.set((PHYS.radius + 4) * 2 / 256); this.plate.tint = 0xf2f6ff;
    this.squash.addChild(this.spinC, this.plate);
    this.highlight = new PIXI.Sprite(T.highlight); this.highlight.anchor.set(0.5); this.highlight.scale.set(DISC_SCALE); this.highlight.alpha = 0.6;
    this.armorRing = new PIXI.Sprite(T.ring); this.armorRing.anchor.set(0.5); this.armorRing.blendMode = ADD(); this.armorRing.tint = 0xffd23f; this.armorRing.alpha = 0;
    this.armorRing.scale.set((PHYS.radius + 8) * 2 / 128);
    this.warn = new PIXI.Sprite(T.ring); this.warn.anchor.set(0.5); this.warn.blendMode = ADD(); this.warn.tint = 0xff3030; this.warn.alpha = 0;
    // surge-ready sparkles
    this.sparkles = [0, 1, 2].map(() => { const s = new PIXI.Sprite(T.flare); s.anchor.set(0.5); s.blendMode = ADD(); s.tint = 0xffd23f; s.scale.set(0.45); s.alpha = 0; return s; });

    const label = (info.name || '?') + (info.bot ? '' : '');
    this.name = new PIXI.Text(label, {
      fontFamily: 'Rajdhani, sans-serif', fontWeight: '700', fontSize: 15, fill: isSelf ? 0xffffff : 0xdfe6ff,
      stroke: 0x000000, strokeThickness: 3, letterSpacing: 0.5,
    });
    this.name.resolution = 2;
    this.name.anchor.set(0.5, 1);
    this.name.position.set(0, -PHYS.radius - 10);
    this.nameDot = new PIXI.Sprite(T.dot); this.nameDot.anchor.set(0.5); this.nameDot.tint = col; this.nameDot.scale.set(0.6);

    c.addChild(this.fieldRing, ...this.ripples, this.aura2, this.aura);
    if (this.selfRing) c.addChild(this.selfRing);
    c.addChild(this.warn, this.tellRing, this.squash, this.highlight, this.armorRing, ...this.sparkles);
    layers.players.addChild(c);
    // names render above all players
    this.nameC = new PIXI.Container();
    this.nameC.addChild(this.name);
    layers.names.addChild(this.nameC);
  }

  /** squash on impact (k ~ 0..1) */
  impact(k) { this.stretchV = Math.max(-9, this.stretchV - 7 * k); }

  startFall(ev) {
    this.fallAnim = { t: 0, x: ev.x, y: ev.y, vx: ev.vx, vy: ev.vy, spin: (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 6) };
  }

  update(dt, p, fx, time) {
    this.time += dt;
    const t = this.time;
    const flags = p.flags;
    const alive = (flags & FLAG.ALIVE) !== 0;
    const ghost = (flags & FLAG.GHOST) !== 0;
    const falling = (flags & FLAG.FALLING) !== 0 || (this.fallAnim && this.fallAnim.t < 1.3 && !ghost);
    const c = this.c;

    // ---------------------------------------------------------------- fall
    if (falling && this.fallAnim) {
      const f = this.fallAnim;
      f.t += dt;
      const k = Math.min(1, f.t / 1.25);
      f.x += f.vx * dt * (1 - k); f.y += f.vy * dt * (1 - k) + 140 * k * dt;
      c.visible = true; c.position.set(f.x, f.y);
      c.scale.set(Math.max(0.02, 1 - k * 0.95));
      this.squash.rotation += f.spin * dt;
      c.alpha = 1 - k * 0.7;
      this.aura.tint = this.color; this.aura.alpha = 0.6 * (1 - k);
      this.fieldRing.alpha = 0; this.tellRing.alpha = 0; this.warn.alpha = 0;
      this.ripples.forEach(r => (r.alpha = 0));
      this.shadow.visible = false;
      this.nameC.visible = false;
      if (Math.random() < 0.8) fx.trailSpark(f.x, f.y, -f.vx * 0.2, -f.vy * 0.2 - 40, this.trailColor);
      if (f.t >= 1.25 && !f.flashed) { f.flashed = true; fx.voidFlash(f.x, f.y + 30, this.color); }
      if (this.trail) this.trail.alpha = 0;
      this.trailInit = false;
      return;
    }
    if (!falling && this.fallAnim && (alive || ghost)) this.fallAnim = null;
    if (!alive && !ghost) { c.visible = false; this.shadow.visible = false; this.nameC.visible = false; if (this.trail) this.trail.alpha = 0; this.trailInit = false; return; }

    c.visible = true; c.alpha = 1; c.scale.set(1);
    this.nameC.visible = true;
    let x = p.x, y = p.y;
    if (ghost) y += Math.sin(t * 2.4 + this.id) * 5;
    c.position.set(x, y);
    this.nameC.position.set(x, y);
    this.shadow.visible = !ghost;
    this.shadow.position.set(x + 5, y + 9);

    // ---------------------------------------------------------------- motion
    const vx = p.vx, vy = p.vy;
    const sp = Math.hypot(vx, vy);
    // spring for impact squash
    this.stretchV += (-180 * this.stretch - 14 * this.stretchV) * dt;
    this.stretch += this.stretchV * dt;
    const st = Math.max(-0.22, Math.min(0.3, Math.min(0.2, sp / 4000) + this.stretch * 0.18));
    const sx = Math.max(0.6, 1 + st), sy = 1 / sx;
    if (sp > 20) this.squash.rotation = Math.atan2(vy, vx);
    this.squash.scale.set(sx, sy);
    const anchored = p.mode === MODE.ANCHOR;
    this.spin += dt * (1.2 + sp * 0.004) * (this.id % 2 ? 1 : -1);
    this.spinC.rotation = this.spin - this.squash.rotation;
    this.core1.rotation = t * 1.7;
    this.core2.rotation = -t * 2.6;
    this.core2.scale.set(DISC_SCALE * (0.55 + 0.08 * Math.sin(t * 4)));
    this.coreGlow.alpha = 0.45 + 0.2 * Math.sin(t * 5 + this.id);

    // ---------------------------------------------------------------- state
    const modeCol = MODE_COLORS[p.mode];
    const energyK = p.energy / PHYS.energyMax;
    const active = p.mode === MODE.PULL || p.mode === MODE.PUSH;
    if (ghost) {
      this.aura.tint = 0xb8a8ff; this.aura.alpha = 0.35 + 0.15 * Math.sin(t * 3);
      this.aura.scale.set(1.3);
      this.squash.alpha = 0.45; this.highlight.alpha = 0.25;
      this.body.tint = 0xc8b8ff;
      this.fieldRing.alpha = 0;
      this.aura2.alpha = p.ghostCd <= 0 ? 0.3 + 0.2 * Math.sin(t * 6) : 0;
      this.aura2.tint = 0xd0c0ff; this.aura2.scale.set(2.2);
    } else {
      this.squash.alpha = 1; this.highlight.alpha = 0.6; this.body.tint = 0xffffff;
      if (p.mode === MODE.NEUTRAL) {
        this.aura.tint = this.color;
        this.aura.alpha = 0.32 + 0.06 * Math.sin(t * 2.2);
        this.aura.scale.set(0.95);
      } else {
        this.aura.tint = modeCol;
        const pulse = 0.5 + 0.5 * Math.sin(t * (anchored ? 3 : 9));
        this.aura.alpha = 0.6 + 0.3 * pulse * (0.4 + energyK * 0.6);
        this.aura.scale.set((anchored ? 1.35 : 1.15) + 0.12 * pulse * energyK);
      }
      // second, wider aura for active fields
      this.aura2.tint = modeCol;
      this.aura2.alpha += ((active ? 0.35 + 0.25 * energyK : anchored ? 0.25 : 0) - this.aura2.alpha) * Math.min(1, dt * 10);
      this.aura2.scale.set(active ? 3.2 : 2);
      this.fieldRing.tint = modeCol;
      this.fieldRing.alpha += ((active ? 0.18 : 0) - this.fieldRing.alpha) * Math.min(1, dt * 10);
    }
    // ripples: inward for pull, outward for push
    for (let i = 0; i < 3; i++) {
      const r = this.ripples[i];
      if (!active || ghost) { r.alpha = Math.max(0, r.alpha - dt * 4); continue; }
      let ph = (t * 1.3 + i / 3) % 1;
      if (p.mode === MODE.PULL) ph = 1 - ph;
      const rad = 30 + ph * (PHYS.fieldRange - 30);
      r.scale.set(rad * 2 / 112);
      r.tint = modeCol;
      r.alpha = Math.sin(ph * Math.PI) * 0.22 * (0.4 + energyK * 0.6);
    }
    // anchor plating
    this.plate.alpha += ((anchored ? 0.9 : 0) - this.plate.alpha) * Math.min(1, dt * 14);
    this.plate.rotation += dt * 0.6;
    this.plate.scale.set((PHYS.radius + 4 + (anchored ? 0 : 6)) * 2 / 256);
    this.shadow.scale.set(anchored ? 1.35 : 1.05);
    this.shadow.alpha = anchored ? 1 : 0.85;
    // glow tell: a ring collapsing onto the disc in the color of the upcoming state
    if (p.tell > 0 && p.pend) {
      const k = 1 - p.tell / PHYS.tellTicks;
      this.tellRing.tint = MODE_COLORS[p.pend];
      this.tellRing.alpha = 0.6 + 0.4 * Math.sin(t * 50);
      this.tellRing.scale.set((PHYS.radius * (2.6 - 1.4 * k)) * 2 / 112);
      this.aura.tint = MODE_COLORS[p.pend];
      this.aura.alpha = 0.7 + 0.3 * Math.sin(t * 40);
    } else this.tellRing.alpha = Math.max(0, this.tellRing.alpha - dt * 6);
    // armor after a surge
    this.armorRing.alpha = p.armor > 0 && !anchored ? 0.5 + 0.4 * Math.sin(t * 20) : 0;
    this.armorRing.rotation += dt * 4;
    // drifting over the void
    if (flags & FLAG.DRIFTING) {
      this.warn.alpha = 0.5 + 0.5 * Math.sin(t * 25);
      this.warn.scale.set((PHYS.radius + 10 + Math.sin(t * 25) * 3) * 2 / 112);
      this.squash.rotation += Math.sin(t * 30) * 0.05;
    } else this.warn.alpha = 0;
    // surge ready
    const surgeReady = p.surge >= PHYS.surgeMax && !ghost;
    for (let i = 0; i < 3; i++) {
      const s = this.sparkles[i];
      s.alpha = surgeReady ? 0.6 + 0.4 * Math.sin(t * 8 + i) : 0;
      if (surgeReady) {
        const a = t * 3 + i * Math.PI * 2 / 3;
        s.position.set(Math.cos(a) * (PHYS.radius + 9), Math.sin(a) * (PHYS.radius + 9));
        s.rotation = t * 4;
      }
    }
    if (this.selfRing) {
      this.selfRing.rotation -= dt * 0.8;
      this.selfRing.alpha = ghost ? 0.15 : 0.35 + 0.1 * Math.sin(t * 3);
    }
    // KotP: crown glow when on the pole
    if (flags & FLAG.ON_POLE) { this.aura2.tint = 0xffd23f; this.aura2.alpha = 0.5 + 0.2 * Math.sin(t * 10); this.aura2.scale.set(2.6); }

    // ---------------------------------------------------------------- trail
    if (this.trail) {
      const pts = this.pts;
      const moved = Math.hypot(x - this.lastX, y - this.lastY);
      if (!this.trailInit || moved > 120) { for (const q of pts) q.set(x, y); this.trailInit = true; }
      else {
        // shift points toward the head; the head follows the disc
        for (let i = 0; i < pts.length - 1; i++) {
          pts[i].x += (pts[i + 1].x - pts[i].x) * Math.min(1, dt * 22);
          pts[i].y += (pts[i + 1].y - pts[i].y) * Math.min(1, dt * 22);
        }
        pts[pts.length - 1].set(x, y);
      }
      const ta = ghost ? 0.12 : Math.min(0.9, Math.max(0, (sp - 180) / 700));
      this.trail.alpha += (ta - this.trail.alpha) * Math.min(1, dt * 8);
      this.trail.tint = ghost ? 0xb8a8ff : this.trailColor;
    }
    // speed lines when launched
    if (sp > 950 && !ghost && Math.random() < 0.6) fx.speedLine(x, y, vx, vy, this.trailColor);
    this.lastX = x; this.lastY = y;
    this.prevFlags = flags;
  }

  destroy() {
    this.c.destroy({ children: true });
    this.shadow.destroy();
    this.nameC.destroy({ children: true });
    if (this.trail) this.trail.destroy();
  }
}

export class Players {
  constructor(layers, quality) {
    this.layers = layers;
    this.quality = quality;
    this.views = new Map();
  }

  /** roster: Map id -> {id, name, color, skin, bot} */
  sync(view, roster, selfId) {
    if (!view) return;
    for (const id of view.players.keys()) {
      if (!this.views.has(id)) {
        const info = roster.get(id) || { id, name: 'Player', color: id % 12, skin: id % 8 };
        this.views.set(id, new PlayerView(this.layers, { ...info, id }, id === selfId, this.quality));
      }
    }
    for (const [id, v] of this.views) {
      if (!view.players.has(id)) { v.destroy(); this.views.delete(id); }
    }
  }

  update(dt, view, fx, time) {
    if (!view) return;
    for (const [id, p] of view.players) {
      const v = this.views.get(id);
      if (v) v.update(dt, p, fx, time);
    }
  }

  get(id) { return this.views.get(id); }

  clear() { for (const v of this.views.values()) v.destroy(); this.views.clear(); }
}

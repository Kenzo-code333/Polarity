// =============================================================================
// Iron filings — the signature visual. Thousands of tiny metal slivers lie on
// the floor; every frame each one turns to align with the combined magnetic
// field, swirls, slides a little toward/away from the source and lights up in
// the field's color, so players can literally see the forces.
// Rendered through a single ParticleContainer (one draw call).
// =============================================================================
import { T, mixColor } from './textures.js';
import { HEX_SIZE, PHYS, MODE, rng } from '/shared/constants.js';

const PIXI = window.PIXI;
const TAU = Math.PI * 2;

// precomputed color ramps (dim steel -> bright field color)
function ramp(from, to, n = 32) { return Array.from({ length: n }, (_, i) => mixColor(from, to, i / (n - 1))); }
const BASE = 0x7884b4;
const PULL_RAMP = ramp(BASE, 0x6cc4ff);
const PUSH_RAMP = ramp(BASE, 0xff5a70);
const WHITE_RAMP = ramp(BASE, 0xffffff);

export class Filings {
  constructor(layer, arena, quality) {
    this.layer = layer;
    this.arena = arena;
    this.stride = quality.filingStride || 1;
    this.frame = 0;
    this.pulses = [];   // transient radial bursts (surges, ghost pulses, hits)
    const tiles = arena.tiles;
    const N = Math.min(quality.filings, Math.round(tiles.length * 40));
    const per = Math.max(1, Math.floor(N / tiles.length));
    const total = per * tiles.length;
    this.n = total;
    this.pc = new PIXI.ParticleContainer(total, { position: true, rotation: true, tint: true, vertices: true });
    this.pc.blendMode = PIXI.BLEND_MODES.ADD;
    layer.addChild(this.pc);

    this.bx = new Float32Array(total); this.by = new Float32Array(total);
    this.ox = new Float32Array(total); this.oy = new Float32Array(total);
    this.ang = new Float32Array(total); this.base = new Float32Array(total);
    this.str = new Float32Array(total);
    this.tile = new Int16Array(total);
    this.sprites = new Array(total);
    const R = rng(777 + arena.index);
    let k = 0;
    for (let ti = 0; ti < tiles.length; ti++) {
      const t = tiles[ti];
      for (let j = 0; j < per; j++) {
        const a = R() * TAU, d = Math.sqrt(R()) * HEX_SIZE * 0.8;
        this.bx[k] = t.x + Math.cos(a) * d; this.by[k] = t.y + Math.sin(a) * d;
        // filings at rest loosely follow a gentle swirl pattern so the floor
        // looks like it has a faint "grain" even with no fields active
        const swirl = Math.atan2(this.by[k], this.bx[k]) + Math.PI / 2 + (R() - 0.5) * 1.6;
        this.base[k] = swirl; this.ang[k] = swirl;
        this.tile[k] = ti;
        const s = new PIXI.Sprite(T.filing);
        s.anchor.set(0.5);
        s.x = this.bx[k]; s.y = this.by[k]; s.rotation = swirl;
        s.tint = BASE; s.alpha = 0.22;
        s.scale.set(0.8 + R() * 0.5, 1);
        s.baseScale = s.scale.x;
        this.pc.addChild(s);
        this.sprites[k] = s;
        k++;
      }
    }
    this.hidden = new Uint8Array(tiles.length);
  }

  /** Hide filings on tiles that collapsed. */
  setCollapsed(level) {
    const maxL = this.arena.maxLayer - level;
    for (let ti = 0; ti < this.arena.tiles.length; ti++) {
      if (this.arena.tiles[ti].layer > maxL) this.hidden[ti] = 1;
    }
  }

  /** A transient radial burst (mode: PUSH = outward, PULL = inward). */
  pulse(x, y, mode, power = 1, range = 420) {
    this.pulses.push({ x, y, mode, power, range, t: 0 });
  }

  /**
   * sources: [{x, y, mode, k}] — players currently pulling/pushing (k = 0..1 intensity)
   * bodies:  [{x, y}] — discs that plow through filings
   */
  update(dt, time, sources, bodies) {
    this.frame++;
    const R = PHYS.fieldRange, R2 = R * R;
    const n = this.n;
    const stride = this.stride;
    const startK = stride > 1 ? this.frame % stride : 0;
    const dtS = dt * stride;
    // advance pulses
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += dt;
      if (p.t > 1.2) this.pulses.splice(i, 1);
    }
    const pulses = this.pulses;
    const ns = sources.length, nb = bodies.length, np = pulses.length;
    const hidden = this.hidden, tile = this.tile;
    const bx = this.bx, by = this.by, ox = this.ox, oy = this.oy, ang = this.ang, base = this.base, str = this.str;

    for (let k = startK; k < n; k += stride) {
      const s = this.sprites[k];
      if (hidden[tile[k]]) { if (s.alpha !== 0) s.alpha = 0; continue; }
      const x = bx[k], y = by[k];
      let fx = 0, fy = 0, pullS = 0, pushS = 0;
      for (let i = 0; i < ns; i++) {
        const src = sources[i];
        const dx = src.x - x, dy = src.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 > R2 || d2 < 1) continue;
        const d = Math.sqrt(d2), c = 1 - d / R;
        const m = src.k * (0.12 + c * c * 1.4);
        const ux = dx / d, uy = dy / d;
        if (src.mode === MODE.PULL) {
          // inward spiral
          fx += (ux + uy * 0.55) * m; fy += (uy - ux * 0.55) * m; pullS += m;
        } else {
          // outward burst with a counter-swirl
          fx -= (ux - uy * 0.35) * m; fy -= (uy + ux * 0.35) * m; pushS += m;
        }
      }
      for (let i = 0; i < np; i++) {
        const p = pulses[i];
        const dx = x - p.x, dy = y - p.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
        // expanding ring front
        const front = p.t * 900;
        const w = Math.abs(d - front);
        if (w > 90 || d > p.range) continue;
        const m = p.power * (1 - w / 90) * (1 - p.t / 1.2) * 2;
        const sgn = p.mode === MODE.PULL ? -1 : 1;
        fx += dx / d * m * sgn; fy += dy / d * m * sgn;
        if (p.mode === MODE.PULL) pullS += m; else pushS += m;
      }
      // discs plow the filings aside
      let px = 0, py = 0;
      for (let i = 0; i < nb; i++) {
        const b = bodies[i];
        const dx = x - b.x, dy = y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1600 && d2 > 0.01) { const d = Math.sqrt(d2); const m = (40 - d) / 40; px += dx / d * m * 10; py += dy / d * m * 10; }
      }

      const f = Math.sqrt(fx * fx + fy * fy);
      const st = f > 1 ? 1 : f;
      str[k] += (st - str[k]) * Math.min(1, dtS * 10);
      const S = str[k];
      // align (filings are symmetric: angle modulo PI)
      const target = S > 0.02 ? Math.atan2(fy, fx) : base[k];
      let diff = target - ang[k];
      diff -= Math.round(diff / Math.PI) * Math.PI;
      ang[k] += diff * Math.min(1, dtS * (1.5 + S * 16));
      // displacement toward the field direction + plow
      const tx = (f > 0.001 ? fx / f : 0) * S * 9 + px, ty = (f > 0.001 ? fy / f : 0) * S * 9 + py;
      ox[k] += (tx - ox[k]) * Math.min(1, dtS * 7);
      oy[k] += (ty - oy[k]) * Math.min(1, dtS * 7);
      s.x = x + ox[k]; s.y = y + oy[k];
      s.rotation = ang[k] + (S > 0.3 ? Math.sin(time * 20 + k) * 0.05 * S : 0);
      // color & brightness
      const idx = Math.min(31, (S * 31) | 0);
      s.tint = pullS > pushS * 1.2 ? PULL_RAMP[idx] : pushS > pullS * 1.2 ? PUSH_RAMP[idx] : WHITE_RAMP[idx];
      s.alpha = 0.2 + S * 0.8;
      s.scale.x = s.baseScale * (1 + S * 0.8);
    }
  }

  destroy() {
    this.pc.destroy({ children: true });
  }
}

// =============================================================================
// Field lines: glowing animated arcs between players that are currently
// affecting each other (blue = pull, red = push), flowing in the direction of
// the force. Also draws grapple lines to pylons.
// =============================================================================
import { MODE, PHYS, PYLON, FLAG, DEBRIS } from '/shared/constants.js';

const PIXI = window.PIXI;
const COL = { [MODE.PULL]: 0x4ab4ff, [MODE.PUSH]: 0xff4a64 };
const MAX_LINKS = 36;

export class FieldLines {
  constructor(layer, quality) {
    this.g = new PIXI.Graphics();
    this.g.blendMode = PIXI.BLEND_MODES.ADD;
    this.glow = quality.fieldGlow;
    layer.addChild(this.g);
    this.time = 0;
  }

  /** Same rules as the server: who is affecting whom right now. */
  links(view, pylons) {
    const out = [];
    const ps = [...view.players.values()].filter(p => p.flags & FLAG.ALIVE);
    const R = PHYS.fieldRange;
    for (const s of ps) {
      if (s.mode !== MODE.PULL && s.mode !== MODE.PUSH) continue;
      for (const t of ps) {
        if (t === s || t.mode === MODE.ANCHOR) continue;
        if (s.mode === MODE.PULL && t.mode === MODE.PUSH) continue;
        const d = Math.hypot(t.x - s.x, t.y - s.y);
        if (d < R && d > PHYS.radius * 2 - 2) out.push({ s, t, d, k: 1 - d / R, mode: s.mode, w: 1 });
      }
      for (const b of view.debris.values()) {
        if (!b.alive) continue;
        const d = Math.hypot(b.x - s.x, b.y - s.y);
        if (d < R * 0.8 && d > PHYS.radius + DEBRIS.radius) out.push({ s, t: b, d, k: (1 - d / R) * 0.7, mode: s.mode, w: 0.6 });
      }
      for (const py of pylons) {
        const d = Math.hypot(py.x - s.x, py.y - s.y);
        if (d < PYLON.range && d > PYLON.radius + PHYS.radius + 4) out.push({ s, t: py, d, k: (1 - d / PYLON.range) * 1.1, mode: s.mode, w: 1.2, pylon: true });
      }
    }
    out.sort((a, b) => b.k - a.k);
    return out.length > MAX_LINKS ? out.slice(0, MAX_LINKS) : out;
  }

  update(dt, view, pylons) {
    this.time += dt;
    const g = this.g;
    g.clear();
    if (!view) return;
    const links = this.links(view, pylons);
    const time = this.time;
    for (const L of links) {
      const { s, t, d, k, mode } = L;
      const col = COL[mode];
      const nArcs = k > 0.5 ? 3 : 2;
      const dx = t.x - s.x, dy = t.y - s.y;
      const nx = -dy / d, ny = dx / d;
      // flow: pull lines run from the target into the source, push lines outward
      const dir = mode === MODE.PULL ? -1 : 1;
      for (let a = 0; a < nArcs; a++) {
        const curv = (a === 0 ? 0.18 : a === 1 ? -0.18 : 0.05) * (1 + 0.15 * Math.sin(time * 3 + a));
        const cx = (s.x + t.x) / 2 + nx * curv * d, cy = (s.y + t.y) / 2 + ny * curv * d;
        const P = (u) => {
          const iu = 1 - u;
          return [iu * iu * s.x + 2 * iu * u * cx + u * u * t.x, iu * iu * s.y + 2 * iu * u * cy + u * u * t.y];
        };
        // faint continuous glow arc
        if (this.glow) {
          g.lineStyle({ width: 5 * L.w, color: col, alpha: 0.07 + 0.12 * k, cap: PIXI.LINE_CAP.ROUND });
          let [x0, y0] = P(0.08);
          g.moveTo(x0, y0);
          for (let i = 1; i <= 8; i++) { const [x, y] = P(0.08 + i / 8 * 0.84); g.lineTo(x, y); }
        }
        // flowing dashes
        const dashes = 7;
        const speed = 0.9 + k * 1.4;
        for (let i = 0; i < dashes; i++) {
          let u = ((i / dashes + time * speed * dir * 0.6 + a * 0.13) % 1 + 1) % 1;
          const len = 0.07;
          const u0 = Math.max(0.06, u), u1 = Math.min(0.94, u + len);
          if (u1 <= u0) continue;
          const fade = Math.sin(u * Math.PI);
          g.lineStyle({ width: (1.6 + 1.6 * k) * L.w, color: i % 3 === 0 ? 0xffffff : col, alpha: (0.35 + 0.6 * k) * fade, cap: PIXI.LINE_CAP.ROUND });
          const [x0, y0] = P(u0); const [xm, ym] = P((u0 + u1) / 2); const [x1, y1] = P(u1);
          g.moveTo(x0, y0); g.lineTo(xm, ym); g.lineTo(x1, y1);
        }
      }
    }
  }

  destroy() { this.g.destroy(); }
}

// =============================================================================
// Deep-space backdrop: multi-layer parallax starfield, slowly drifting nebula
// clouds and the occasional shooting star. Drawn in screen space.
// =============================================================================
import { T } from './textures.js';
import { rng } from '/shared/constants.js';

const PIXI = window.PIXI;

export class Background {
  constructor(quality) {
    this.container = new PIXI.Container();
    this.R = rng(4242);
    this.time = 0;
    this.build(quality);
  }

  build(q) {
    this.container.removeChildren();
    const R = this.R;
    // base gradient wash
    this.wash = new PIXI.Sprite(T.softGlow);
    this.wash.anchor.set(0.5);
    this.wash.tint = 0x140f3c; this.wash.alpha = 0.7;
    this.container.addChild(this.wash);

    // nebula clouds (additive, huge, slow)
    this.nebulae = [];
    for (let i = 0; i < q.nebula; i++) {
      const s = new PIXI.Sprite(T.nebula[i % T.nebula.length]);
      s.anchor.set(0.5);
      s.blendMode = PIXI.BLEND_MODES.ADD;
      s.alpha = 0.22 + R() * 0.16;
      s.baseScale = 2.6 + R() * 2;
      s.px = (R() - 0.5) * 1.4; s.py = (R() - 0.5) * 1.2;
      s.drift = (R() - 0.5) * 0.004; s.rot = (R() - 0.5) * 0.01;
      s.parallax = 0.03 + i * 0.015;
      this.nebulae.push(s);
      this.container.addChild(s);
    }

    // three parallax star layers
    this.layers = [];
    const counts = [0.5, 0.32, 0.18].map(f => Math.round(q.stars * f));
    const parallax = [0.04, 0.1, 0.2];
    const colors = [0xffffff, 0xbfd4ff, 0xffe6c8, 0xd6c8ff];
    counts.forEach((n, li) => {
      const pc = new PIXI.ParticleContainer(n, { position: true, tint: true });
      pc.blendMode = PIXI.BLEND_MODES.ADD;
      const stars = [];
      for (let i = 0; i < n; i++) {
        const s = new PIXI.Sprite(T.star);
        s.anchor.set(0.5);
        s.u = R(); s.v = R();
        const big = R() < 0.06;
        s.scale.set((0.35 + R() * 0.6 + li * 0.25) * (big ? 2 : 1));
        s.tint = colors[Math.floor(R() * colors.length)];
        s.baseAlpha = 0.35 + R() * 0.6;
        s.tw = R() * Math.PI * 2; s.tws = 0.5 + R() * 2.5;
        s.alpha = s.baseAlpha;
        pc.addChild(s); stars.push(s);
      }
      this.layers.push({ pc, stars, parallax: parallax[li] });
      this.container.addChild(pc);
    });

    // shooting stars
    this.shooters = new PIXI.Container();
    this.container.addChild(this.shooters);
    this.nextShooter = 3 + R() * 4;
  }

  /** cam: {x, y, zoom}; w/h: screen size; dt in seconds */
  update(dt, cam, w, h) {
    this.time += dt;
    const R = this.R;
    this.wash.position.set(w / 2, h * 0.6);
    this.wash.scale.set(Math.max(w, h) / 70);

    const span = Math.max(w, h);
    for (const n of this.nebulae) {
      n.px += n.drift * dt; n.rotation += n.rot * dt;
      n.position.set(w / 2 + n.px * span - cam.x * n.parallax, h / 2 + n.py * span - cam.y * n.parallax);
      n.scale.set(n.baseScale * span / 900);
    }

    const pad = 40;
    for (const L of this.layers) {
      const ox = -cam.x * L.parallax, oy = -cam.y * L.parallax;
      const W = w + pad * 2, H = h + pad * 2;
      for (let i = 0; i < L.stars.length; i++) {
        const s = L.stars[i];
        let x = (s.u * W + ox) % W; if (x < 0) x += W;
        let y = (s.v * H + oy) % H; if (y < 0) y += H;
        s.x = x - pad; s.y = y - pad;
        if ((i & 3) === (Math.floor(this.time * 30) & 3)) {
          s.alpha = s.baseAlpha * (0.6 + 0.4 * Math.sin(this.time * s.tws + s.tw));
        }
      }
    }

    // shooting stars
    this.nextShooter -= dt;
    if (this.nextShooter <= 0) {
      this.nextShooter = 4 + R() * 7;
      const s = new PIXI.Sprite(T.streak);
      s.anchor.set(1, 0.5);
      s.blendMode = PIXI.BLEND_MODES.ADD;
      const fromLeft = R() < 0.5;
      s.x = fromLeft ? R() * w * 0.5 : w * 0.5 + R() * w * 0.5; s.y = R() * h * 0.4;
      const ang = (fromLeft ? 0.35 : Math.PI - 0.35) + (R() - 0.5) * 0.3;
      s.rotation = ang; s.vx = Math.cos(ang) * (700 + R() * 500); s.vy = Math.sin(ang) * (700 + R() * 500);
      s.life = 0; s.max = 0.9 + R() * 0.6;
      s.scale.set(1.2 + R(), 1);
      s.tint = R() < 0.5 ? 0xffffff : 0xbfe0ff;
      this.shooters.addChild(s);
    }
    for (let i = this.shooters.children.length - 1; i >= 0; i--) {
      const s = this.shooters.children[i];
      s.life += dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      const k = s.life / s.max;
      s.alpha = Math.sin(Math.min(1, k) * Math.PI);
      if (k >= 1) { s.destroy(); }
    }
  }
}

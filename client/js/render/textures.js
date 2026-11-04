// =============================================================================
// Procedural textures. Every piece of art in Polarity is painted at startup
// with Canvas 2D and uploaded to the GPU once — no image files needed.
// =============================================================================
import { HEX_SIZE, PLAYER_COLORS, SKINS, rng } from '/shared/constants.js';

const PIXI = window.PIXI;
const SQ3 = Math.sqrt(3);
export const T = {};          // texture registry
const discCache = new Map();
const previewCache = new Map();

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
function rgba(n, a) { return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
function mix(a, b, t) {
  const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
  const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
  const bl = (a & 255) * (1 - t) + (b & 255) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
export { hex as hexColor, mix as mixColor };

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w); c.height = Math.ceil(h);
  return c;
}

/** Paint a texture at `res`x resolution; logical size is w×h. */
function tex(w, h, draw, res = 2) {
  const c = makeCanvas(w * res, h * res);
  const g = c.getContext('2d');
  g.scale(res, res);
  draw(g, w, h);
  return PIXI.Texture.from(c, { resolution: res });
}

function hexPath(g, cx, cy, size) {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    const x = cx + size * Math.cos(a), y = cy + size * Math.sin(a);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

function radial(g, cx, cy, r, stops) {
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

// =============================================================================
export function buildTextures() {
  const R = rng(1337);

  // ---- generic glows --------------------------------------------------------
  T.glow = tex(128, 128, (g) => {
    g.fillStyle = radial(g, 64, 64, 64, [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.75)'], [0.42, 'rgba(255,255,255,0.25)'], [0.7, 'rgba(255,255,255,0.07)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(0, 0, 128, 128);
  }, 1);
  T.softGlow = tex(128, 128, (g) => {
    g.fillStyle = radial(g, 64, 64, 64, [[0, 'rgba(255,255,255,0.6)'], [0.5, 'rgba(255,255,255,0.2)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(0, 0, 128, 128);
  }, 1);
  T.ring = tex(128, 128, (g) => {
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 3;
    g.shadowColor = '#fff'; g.shadowBlur = 8;
    g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.5; g.stroke();
  });
  T.thinRing = tex(256, 256, (g) => {
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.5;
    g.shadowColor = '#fff'; g.shadowBlur = 4;
    g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.stroke();
  }, 1);
  T.dashedRing = tex(256, 256, (g) => {
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 3; g.lineCap = 'round';
    g.shadowColor = '#fff'; g.shadowBlur = 5;
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      g.beginPath(); g.arc(128, 128, 120, a, a + 0.13); g.stroke();
    }
  }, 1);
  T.dot = tex(16, 16, (g) => {
    g.fillStyle = radial(g, 8, 8, 8, [[0, '#fff'], [0.4, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(0, 0, 16, 16);
  }, 1);
  T.spark = tex(64, 10, (g) => {
    const gr = g.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(32, 5, 32, 3.2, 0, 0, Math.PI * 2); g.fill();
  }, 1);
  T.streak = tex(128, 6, (g) => {
    const gr = g.createLinearGradient(0, 0, 128, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.85, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0.2)');
    g.fillStyle = gr; g.fillRect(0, 1.5, 128, 3);
  }, 1);
  T.filing = tex(14, 4, (g) => {
    const gr = g.createLinearGradient(0, 0, 14, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.3)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0.3)');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(7, 2, 7, 1.3, 0, 0, Math.PI * 2); g.fill();
  }, 2);
  T.shadow = tex(64, 64, (g) => {
    g.fillStyle = radial(g, 32, 32, 32, [[0, 'rgba(0,0,0,0.7)'], [0.6, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0)']]);
    g.fillRect(0, 0, 64, 64);
  }, 1);
  T.trail = tex(64, 40, (g) => {
    const v = g.createLinearGradient(0, 0, 0, 40);
    v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.3, 'rgba(255,255,255,0.35)');
    v.addColorStop(0.5, 'rgba(255,255,255,1)'); v.addColorStop(0.7, 'rgba(255,255,255,0.35)'); v.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = v; g.fillRect(0, 0, 64, 40);
    const hz = g.createLinearGradient(0, 0, 64, 0);
    hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-in'; g.fillStyle = hz; g.fillRect(0, 0, 64, 40);
  }, 1);
  T.chunk = [0, 1, 2].map(k => tex(12, 12, (g) => {
    g.fillStyle = ['#56607e', '#3c4560', '#6d7aa0'][k];
    g.beginPath();
    const n = 5 + k;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, r = 3.5 + R() * 2.5;
      const x = 6 + Math.cos(a) * r, y = 6 + Math.sin(a) * r;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(200,215,255,0.5)'; g.lineWidth = 0.8; g.stroke();
  }));
  T.star = tex(8, 8, (g) => {
    g.fillStyle = radial(g, 4, 4, 4, [[0, '#fff'], [0.35, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(0, 0, 8, 8);
  }, 1);
  T.flare = tex(64, 64, (g) => {
    g.fillStyle = radial(g, 32, 32, 32, [[0, 'rgba(255,255,255,1)'], [0.1, 'rgba(255,255,255,0.6)'], [0.3, 'rgba(255,255,255,0.1)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(0, 0, 64, 64);
    const gr = g.createLinearGradient(0, 32, 64, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 31, 64, 2); g.save(); g.translate(32, 32); g.rotate(Math.PI / 2); g.translate(-32, -32); g.fillRect(0, 31, 64, 2); g.restore();
  }, 1);

  buildHexTextures(R);
  buildPropTextures();
  buildNebulae();
}

// ---- hex tiles ------------------------------------------------------------
function buildHexTextures(R) {
  const s = HEX_SIZE;
  const w = SQ3 * s, h = 2 * s, depth = 16;
  T.hexW = w; T.hexH = h; T.hexDepth = depth;

  T.hexTop = [0, 1, 2].map(variant => tex(w, h, (g) => {
    const cx = w / 2, cy = h / 2, inner = s - 1.2;
    hexPath(g, cx, cy, inner);
    g.save(); g.clip();
    const base = g.createLinearGradient(0, 0, w, h);
    const tint = [['#46527a', '#232a46', '#141a2f'], ['#4a5274', '#262b45', '#151a2c'], ['#424f78', '#202842', '#12182b']][variant];
    base.addColorStop(0, tint[0]); base.addColorStop(0.5, tint[1]); base.addColorStop(1, tint[2]);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    // brushed metal streaks
    g.globalAlpha = 0.08;
    for (let i = 0; i < 70; i++) {
      const y = R() * h, l = 10 + R() * 50, x = R() * w;
      g.strokeStyle = R() < 0.5 ? '#ffffff' : '#000000';
      g.lineWidth = 0.6 + R() * 0.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y + l * 0.12); g.stroke();
    }
    g.globalAlpha = 1;
    // soft reflection
    g.fillStyle = radial(g, cx - s * 0.35, cy - s * 0.45, s * 1.1, [[0, 'rgba(190,210,255,0.22)'], [0.5, 'rgba(160,190,255,0.06)'], [1, 'rgba(0,0,0,0)']]);
    g.fillRect(0, 0, w, h);
    // panel inset
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.5;
    hexPath(g, cx, cy, s * 0.62); g.stroke();
    g.strokeStyle = 'rgba(170,190,255,0.12)'; g.lineWidth = 1;
    hexPath(g, cx + 0.8, cy + 0.8, s * 0.62); g.stroke();
    // circuit / groove detail
    g.strokeStyle = 'rgba(120,150,230,0.10)'; g.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const a = (variant * 2 + i * 2) * Math.PI / 3 + Math.PI / 6;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * s * 0.62, cy + Math.sin(a) * s * 0.62);
      g.lineTo(cx + Math.cos(a) * s * 0.9, cy + Math.sin(a) * s * 0.9); g.stroke();
    }
    // rivets
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 30);
      const x = cx + Math.cos(a) * s * 0.78, y = cy + Math.sin(a) * s * 0.78;
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(x + 0.6, y + 0.6, 1.8, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(190,205,255,0.45)'; g.beginPath(); g.arc(x, y, 1.5, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // bevel: light top-left, dark bottom-right
    g.lineWidth = 2.5;
    for (let i = 0; i < 6; i++) {
      const a0 = Math.PI / 180 * (60 * i - 30), a1 = Math.PI / 180 * (60 * (i + 1) - 30);
      const mid = (a0 + a1) / 2;
      const lit = -Math.cos(mid) * 0.5 - Math.sin(mid) * 0.8;
      g.strokeStyle = lit > 0 ? `rgba(190,210,255,${0.25 + lit * 0.35})` : `rgba(0,0,0,${0.3 - lit * 0.3})`;
      g.beginPath();
      g.moveTo(cx + Math.cos(a0) * (inner - 1.5), cy + Math.sin(a0) * (inner - 1.5));
      g.lineTo(cx + Math.cos(a1) * (inner - 1.5), cy + Math.sin(a1) * (inner - 1.5));
      g.stroke();
    }
  }));

  // the platform's thickness, drawn underneath the tops for a 2.5D look
  T.hexSide = tex(w, h + depth, (g) => {
    const cx = w / 2, cy = h / 2;
    const gr = g.createLinearGradient(0, cy, 0, h + depth);
    gr.addColorStop(0, '#1b2140'); gr.addColorStop(0.6, '#0d1024'); gr.addColorStop(1, '#05060f');
    g.fillStyle = gr;
    for (let d = 0; d <= depth; d += 1) { hexPath(g, cx, cy + d, s - 1.2); g.fill(); }
    // bright lip under the top edge
    g.strokeStyle = 'rgba(110,140,255,0.25)'; g.lineWidth = 1;
    hexPath(g, cx, cy + depth, s - 1.2); g.stroke();
  });

  T.hexRim = tex(w, h, (g) => {
    const cx = w / 2, cy = h / 2;
    g.shadowColor = '#fff'; g.shadowBlur = 6;
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.6;
    hexPath(g, cx, cy, s - 2.5); g.stroke();
  });

  T.hexLight = tex(w, h, (g) => {
    const cx = w / 2, cy = h / 2;
    hexPath(g, cx, cy, s - 1.5); g.save(); g.clip();
    g.fillStyle = radial(g, cx, cy, s, [[0, 'rgba(255,255,255,0.25)'], [0.7, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0.9)']]);
    g.fillRect(0, 0, w, h);
    g.restore();
  }, 1);

  // glowing cracks for tiles about to fall
  T.cracks = [0, 1, 2].map(k => tex(w, h, (g) => {
    const cx = w / 2, cy = h / 2;
    hexPath(g, cx, cy, s - 1.5); g.save(); g.clip();
    g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
    g.shadowColor = '#fff'; g.shadowBlur = 5;
    const branches = 5 + k;
    for (let b = 0; b < branches; b++) {
      let x = cx + (R() - 0.5) * 10, y = cy + (R() - 0.5) * 10;
      let a = b / branches * Math.PI * 2 + R() * 0.6;
      g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(x, y);
      for (let i = 0; i < 7; i++) {
        a += (R() - 0.5) * 1.1;
        const l = 5 + R() * 8;
        x += Math.cos(a) * l; y += Math.sin(a) * l;
        g.lineTo(x, y);
        if (R() < 0.3) {
          g.stroke(); g.lineWidth = Math.max(0.8, g.lineWidth - 0.4); g.beginPath(); g.moveTo(x, y);
          const ba = a + (R() < 0.5 ? 1 : -1) * (0.6 + R() * 0.6);
          g.lineTo(x + Math.cos(ba) * 9, y + Math.sin(ba) * 9); g.moveTo(x, y);
        }
      }
      g.stroke();
    }
    g.restore();
  }));
}

// ---- pylons, debris -----------------------------------------------------------
function buildPropTextures() {
  T.pylonBase = tex(96, 96, (g) => {
    const c = 48;
    g.fillStyle = radial(g, c, c + 4, 46, [[0, 'rgba(0,0,0,0.6)'], [1, 'rgba(0,0,0,0)']]);
    g.fillRect(0, 0, 96, 96);
    // body: metallic cylinder seen from above
    const body = g.createLinearGradient(10, 10, 86, 86);
    body.addColorStop(0, '#c8d4f0'); body.addColorStop(0.35, '#6b7699'); body.addColorStop(0.7, '#2b3150'); body.addColorStop(1, '#151a2e');
    g.fillStyle = body; g.beginPath(); g.arc(c, c, 30, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#0c0f1e'; g.lineWidth = 2; g.stroke();
    // coil bands
    for (let r = 24; r > 12; r -= 4) {
      g.strokeStyle = r % 8 === 0 ? 'rgba(255,180,90,0.75)' : 'rgba(30,35,60,0.9)';
      g.lineWidth = 2; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
    }
    // bolts
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      g.fillStyle = '#dfe6ff'; g.beginPath(); g.arc(c + Math.cos(a) * 27, c + Math.sin(a) * 27, 1.6, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = radial(g, c - 8, c - 10, 20, [[0, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
    g.beginPath(); g.arc(c, c, 30, 0, Math.PI * 2); g.fill();
  });
  T.pylonCore = tex(48, 48, (g) => {
    g.fillStyle = radial(g, 24, 24, 24, [[0, '#ffffff'], [0.3, 'rgba(160,220,255,0.95)'], [0.6, 'rgba(60,140,255,0.4)'], [1, 'rgba(0,60,255,0)']]);
    g.fillRect(0, 0, 48, 48);
  });

  T.debris = tex(40, 40, (g) => {
    const c = 20;
    g.save(); g.translate(c, c);
    const b = g.createLinearGradient(-14, -14, 14, 14);
    b.addColorStop(0, '#a9b3cf'); b.addColorStop(0.45, '#5d6684'); b.addColorStop(1, '#262b40');
    g.fillStyle = b;
    roundRect(g, -14, -14, 28, 28, 4); g.fill();
    g.strokeStyle = '#11141f'; g.lineWidth = 1.5; g.stroke();
    // hazard stripe
    g.save(); roundRect(g, -14, -14, 28, 28, 4); g.clip();
    g.fillStyle = 'rgba(255,170,40,0.85)';
    for (let i = -3; i < 4; i++) { g.beginPath(); g.moveTo(i * 9 - 4, 10); g.lineTo(i * 9 + 1, 10); g.lineTo(i * 9 + 7, 14); g.lineTo(i * 9 + 2, 14); g.fill(); }
    g.restore();
    // plate seams
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-14, -2); g.lineTo(14, -2); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(-12, -12); g.lineTo(12, -12); g.stroke();
    for (const [x, y] of [[-10, -9], [10, -9], [-10, 5], [10, 5]]) {
      g.fillStyle = '#dbe2f7'; g.beginPath(); g.arc(x, y, 1.4, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  });
  T.debrisGlow = tex(64, 64, (g) => {
    g.fillStyle = radial(g, 32, 32, 32, [[0, 'rgba(255,190,90,0.8)'], [0.5, 'rgba(255,140,40,0.25)'], [1, 'rgba(255,100,0,0)']]);
    g.fillRect(0, 0, 64, 64);
  }, 1);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// ---- nebula clouds --------------------------------------------------------------
function buildNebulae() {
  const palettes = [
    [0x5b2bff, 0xff2fa8, 0x2fb8ff],
    [0x1e6bff, 0x2fffc4, 0x8a2bff],
    [0xff3f6e, 0xff9a3c, 0x7a2bff],
    [0x2b4bff, 0xb02bff, 0x18e0ff],
  ];
  T.nebula = palettes.map((pal, k) => {
    const R = rng(99 + k * 17);
    return tex(384, 384, (g) => {
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 26; i++) {
        const x = 192 + (R() - 0.5) * 240, y = 192 + (R() - 0.5) * 240;
        const r = 40 + R() * 120;
        const col = pal[i % pal.length];
        g.fillStyle = radial(g, x, y, r, [[0, rgba(col, 0.16 + R() * 0.1)], [0.5, rgba(col, 0.06)], [1, rgba(col, 0)]]);
        g.fillRect(0, 0, 384, 384);
      }
      // dark dust lanes
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 8; i++) {
        const x = 192 + (R() - 0.5) * 260, y = 192 + (R() - 0.5) * 260, r = 20 + R() * 60;
        g.fillStyle = radial(g, x, y, r, [[0, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0)']]);
        g.fillRect(0, 0, 384, 384);
      }
      // fade edges
      g.fillStyle = radial(g, 192, 192, 192, [[0.55, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,1)']]);
      g.fillRect(0, 0, 384, 384);
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 120; i++) {
        const a = R() * Math.PI * 2, d = R() * 150;
        g.fillStyle = `rgba(255,255,255,${0.2 + R() * 0.5})`;
        g.fillRect(192 + Math.cos(a) * d, 192 + Math.sin(a) * d, 1, 1);
      }
    }, 1);
  });
}

// =============================================================================
// Player discs: body (skin + player color rim) and an animated core layer.
// =============================================================================
const DISC = 64; // logical diameter of the disc textures

function paintBody(g, skin, color, size = DISC) {
  const c = size / 2, r = size / 2 - 2;
  const col = PLAYER_COLORS[color] ?? 0xffffff;
  const S = rng(skin * 31 + 7);
  g.save();
  g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.clip();
  const fill = (stops) => { g.fillStyle = radial(g, c - r * 0.25, c - r * 0.3, r * 1.35, stops); g.fillRect(0, 0, size, size); };
  switch (SKINS[skin].id) {
    case 'plasma':
      fill([[0, '#ffd6ff'], [0.25, '#ff4fd8'], [0.6, '#7a1fd6'], [1, '#1a0640']]);
      break;
    case 'chrome': {
      fill([[0, '#ffffff'], [0.3, '#c9d3e8'], [0.65, '#5b6683'], [1, '#1b2033']]);
      g.globalAlpha = 0.35;
      for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#20263a'; g.fillRect(0, i * size / 6 + (i * 3) % 5, size, size / 14); }
      g.globalAlpha = 1;
      break;
    }
    case 'galaxy':
      fill([[0, '#c7b3ff'], [0.2, '#5a35c9'], [0.6, '#1a1258'], [1, '#05031a']]);
      for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${0.4 + S() * 0.6})`; g.fillRect(S() * size, S() * size, 1, 1); }
      break;
    case 'lava':
      fill([[0, '#ffd27a'], [0.2, '#ff6a1f'], [0.55, '#7a1a08'], [1, '#1a0502']]);
      g.strokeStyle = 'rgba(30,6,2,0.85)'; g.lineWidth = 2.2;
      for (let i = 0; i < 7; i++) { g.beginPath(); g.moveTo(S() * size, S() * size); g.lineTo(S() * size, S() * size); g.lineTo(S() * size, S() * size); g.stroke(); }
      break;
    case 'ice':
      fill([[0, '#ffffff'], [0.3, '#bff6ff'], [0.7, '#3fa8e0'], [1, '#0b3a66']]);
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
      for (let i = 0; i < 9; i++) { const a = S() * Math.PI * 2; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); g.stroke(); }
      break;
    case 'neon':
      fill([[0, '#203030'], [0.6, '#081414'], [1, '#000']]);
      g.strokeStyle = hex(col); g.lineWidth = 2; g.shadowColor = hex(col); g.shadowBlur = 6;
      for (let rr = r * 0.35; rr < r; rr += r * 0.22) { g.beginPath(); g.arc(c, c, rr, 0, Math.PI * 2); g.stroke(); }
      g.shadowBlur = 0;
      break;
    case 'gold':
      fill([[0, '#fff6c8'], [0.25, '#ffd23f'], [0.6, '#b07a10'], [1, '#3a2402']]);
      g.globalAlpha = 0.3; g.strokeStyle = '#fff3b0'; g.lineWidth = 1;
      for (let rr = 4; rr < r; rr += 5) { g.beginPath(); g.arc(c, c, rr, 0, Math.PI * 2); g.stroke(); }
      g.globalAlpha = 1;
      break;
    case 'void':
    default:
      fill([[0, '#000000'], [0.55, '#05010f'], [0.85, '#2a0f6b'], [1, '#8a5bff']]);
      break;
  }
  // tint toward the player's color so every player is identifiable
  g.globalCompositeOperation = 'overlay';
  g.fillStyle = rgba(col, SKINS[skin].id === 'void' || SKINS[skin].id === 'neon' ? 0.15 : 0.35);
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'source-over';
  // inner shadow for volume
  g.fillStyle = radial(g, c, c, r, [[0.7, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.55)']]);
  g.fillRect(0, 0, size, size);
  g.restore();
  // player-colored rim
  g.lineWidth = 3.2; g.strokeStyle = hex(col);
  g.shadowColor = hex(col); g.shadowBlur = 6;
  g.beginPath(); g.arc(c, c, r - 1.4, 0, Math.PI * 2); g.stroke();
  g.shadowBlur = 0;
  g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.65)';
  g.beginPath(); g.arc(c, c, r - 3.2, Math.PI * 1.05, Math.PI * 1.6); g.stroke();
}

function paintCore(g, skin, size = DISC) {
  const c = size / 2, r = size / 2 - 6;
  const S = rng(skin * 97 + 3);
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  switch (SKINS[skin].id) {
    case 'plasma':
      for (let arm = 0; arm < 3; arm++) {
        g.strokeStyle = arm === 0 ? 'rgba(255,220,255,0.9)' : 'rgba(255,90,230,0.7)'; g.lineWidth = 2.4 - arm * 0.5;
        g.beginPath();
        for (let i = 0; i < 30; i++) { const t = i / 29, a = arm * 2.09 + t * 4.2, d = t * r; const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d; i ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.stroke();
      }
      break;
    case 'chrome':
      g.fillStyle = radial(g, c - r * 0.2, c - r * 0.4, r * 0.7, [[0, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]);
      g.beginPath(); g.ellipse(c - r * 0.1, c - r * 0.35, r * 0.7, r * 0.25, -0.4, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(c, c, r * 0.8, 0.2, 1.2); g.stroke();
      break;
    case 'galaxy':
      for (let i = 0; i < 90; i++) {
        const t = S(), arm = i % 2, a = arm * Math.PI + t * 5 + (S() - 0.5) * 0.5, d = t * r;
        g.fillStyle = i % 3 ? 'rgba(200,170,255,0.9)' : 'rgba(255,255,255,1)';
        g.fillRect(c + Math.cos(a) * d - 0.8, c + Math.sin(a) * d - 0.8, 1.6, 1.6);
      }
      g.fillStyle = radial(g, c, c, r * 0.35, [[0, 'rgba(255,240,255,1)'], [1, 'rgba(160,100,255,0)']]);
      g.fillRect(0, 0, size, size);
      break;
    case 'lava':
      for (let i = 0; i < 6; i++) {
        const a = S() * Math.PI * 2, d = S() * r * 0.7, rr = 4 + S() * 7;
        g.fillStyle = radial(g, c + Math.cos(a) * d, c + Math.sin(a) * d, rr, [[0, 'rgba(255,240,150,1)'], [0.5, 'rgba(255,120,20,0.7)'], [1, 'rgba(255,60,0,0)']]);
        g.fillRect(0, 0, size, size);
      }
      break;
    case 'ice':
      g.strokeStyle = 'rgba(220,250,255,0.95)'; g.lineWidth = 1.6;
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); g.stroke();
        for (const t of [0.45, 0.7]) {
          const x = c + Math.cos(a) * r * t, y = c + Math.sin(a) * r * t;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a + 0.7) * 6, y + Math.sin(a + 0.7) * 6);
          g.moveTo(x, y); g.lineTo(x + Math.cos(a - 0.7) * 6, y + Math.sin(a - 0.7) * 6); g.stroke();
        }
      }
      break;
    case 'neon':
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2.5;
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.beginPath(); g.arc(c, c, r * 0.75, a, a + 0.9); g.stroke(); }
      g.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 + 0.5; g.beginPath(); g.arc(c, c, r * 0.45, a, a + 1.2); g.stroke(); }
      break;
    case 'gold':
      g.fillStyle = radial(g, c, c, r * 0.9, [[0, 'rgba(255,255,230,0.9)'], [0.25, 'rgba(255,230,120,0.25)'], [1, 'rgba(255,200,0,0)']]);
      g.fillRect(0, 0, size, size);
      g.strokeStyle = 'rgba(255,255,220,0.95)'; g.lineWidth = 1.6;
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(c - Math.cos(a) * r, c - Math.sin(a) * r); g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); g.stroke(); }
      break;
    case 'void':
    default:
      for (let i = 0; i < 4; i++) {
        g.strokeStyle = `rgba(${150 + i * 25},90,255,${0.8 - i * 0.15})`; g.lineWidth = 2;
        g.beginPath(); g.arc(c, c, r * (0.55 + i * 0.12), i, i + 2.4); g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = radial(g, c, c, r * 0.5, [[0, 'rgba(0,0,0,1)'], [0.8, 'rgba(0,0,0,0.9)'], [1, 'rgba(0,0,0,0)']]);
      g.fillRect(0, 0, size, size);
      break;
  }
}

export function discTextures(skin, color) {
  const key = skin * 100 + color;
  if (discCache.has(key)) return discCache.get(key);
  const body = tex(DISC, DISC, (g) => paintBody(g, skin, color));
  let core = discCache.get('core' + skin);
  if (!core) { core = tex(DISC, DISC, (g) => paintCore(g, skin)); discCache.set('core' + skin, core); }
  if (!T.highlight) {
    T.highlight = tex(DISC, DISC, (g) => {
      const c = DISC / 2;
      g.fillStyle = radial(g, c - 9, c - 12, 18, [[0, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
      g.beginPath(); g.ellipse(c - 7, c - 11, 15, 8, -0.5, 0, Math.PI * 2); g.fill();
    });
  }
  const out = { body, core, size: DISC };
  discCache.set(key, out);
  return out;
}

/** Data URL preview of a disc for DOM UI (lobby, podium, awards). */
export function discPreview(skin, color, size = 96) {
  const key = `${skin}:${color}:${size}`;
  if (previewCache.has(key)) return previewCache.get(key);
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const k = size / DISC;
  g.save(); g.scale(k, k);
  const col = PLAYER_COLORS[color] ?? 0xffffff;
  g.fillStyle = radial(g, DISC / 2, DISC / 2, DISC / 2, [[0.6, rgba(col, 0.35)], [1, rgba(col, 0)]]);
  g.fillRect(0, 0, DISC, DISC);
  g.translate(DISC * 0.08, DISC * 0.08); g.scale(0.84, 0.84);
  paintBody(g, skin, color);
  paintCore(g, skin);
  g.restore();
  const url = c.toDataURL();
  previewCache.set(key, url);
  return url;
}

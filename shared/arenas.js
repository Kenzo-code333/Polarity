// =============================================================================
// Arena layouts. Each layout is built deterministically from hex coordinates,
// so server and client construct the exact same platform from an index.
//
// Tiles carry a "layer" (distance from the center); every collapse removes the
// outermost remaining layer, down to `minLayer`.
// =============================================================================
import { hexToPixel, hexDistance, hexKey } from './hex.js';
import { HEX_SIZE } from './constants.js';

function hexRange(radius, filter = () => true) {
  const out = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      if (filter(q, r)) out.push({ q, r });
    }
  }
  return out;
}

const atHex = (q, r) => hexToPixel(q, r);

const LAYOUTS = [
  {
    name: 'The Hive',
    theme: 0x4a7dff,
    tiles: () => hexRange(6),
    pylons: () => [atHex(3, -3), atHex(-3, 0), atHex(0, 3)].map(p => ({ ...p })),
    debris: () => [atHex(4, 0), atHex(-4, 4), atHex(0, -4), atHex(2, 2), atHex(-2, -1), atHex(1, -3)],
    minLayer: 2,
  },
  {
    name: 'Twin Isles',
    theme: 0x2fffc4,
    tiles: () => {
      const set = new Map();
      const add = (q, r) => set.set(hexKey(q, r), { q, r });
      hexRange(9, (q, r) => hexDistance(q, r, -4, 0) <= 3 || hexDistance(q, r, 4, 0) <= 3).forEach(t => add(t.q, t.r));
      // the bridge
      for (let q = -1; q <= 1; q++) { add(q, 0); }
      add(0, -1); add(0, 1); add(1, -1); add(-1, 1);
      return [...set.values()];
    },
    pylons: () => [atHex(-4, 0), atHex(4, 0)],
    debris: () => [atHex(-5, 2), atHex(5, -2), atHex(-3, -2), atHex(3, 2), atHex(0, 0)],
    minLayer: 3,
  },
  {
    name: 'The Halo',
    theme: 0xff4fd8,
    tiles: () => hexRange(6, (q, r) => hexDistance(q, r) >= 2),
    // a single pylon floating over the hole: grapple across the void!
    pylons: () => [{ x: 0, y: 0 }],
    debris: () => [atHex(4, -2), atHex(-4, 2), atHex(2, 2), atHex(-2, -2), atHex(-2, 4), atHex(2, -4)],
    minLayer: 3,
  },
  {
    name: 'Starfall',
    theme: 0xffd23f,
    tiles: () => hexRange(8, (q, r) => {
      const d = hexDistance(q, r);
      if (d <= 3) return true;
      // six narrow arms along the axes, plus a little platform near the tips
      const s = -q - r;
      return d <= 7 && (q === 0 || r === 0 || s === 0);
    }),
    pylons: () => [atHex(0, -6), atHex(6, 0), atHex(-6, 6)],
    debris: () => [atHex(2, 0), atHex(-2, 0), atHex(0, 2), atHex(0, -2), atHex(2, -2), atHex(-2, 2)],
    minLayer: 2,
  },
  {
    name: 'The Gauntlet',
    theme: 0xff7a2f,
    tiles: () => {
      const out = [];
      for (let row = -4; row <= 4; row++) {
        for (let col = -8; col <= 8; col++) {
          const q = col - Math.floor(row / 2);
          out.push({ q, r: row });
        }
      }
      return out;
    },
    // the long ends crumble first
    layerOf: (t, p) => Math.round(Math.abs(p.x) / (HEX_SIZE * 1.732 * 1.6)),
    pylons: () => [atHex(-5, 0), atHex(5, 0), atHex(-1, -3), atHex(1, 3)],
    debris: () => [atHex(-2, 0), atHex(2, 0), atHex(0, -2), atHex(0, 2), atHex(-6, 2), atHex(6, -2), atHex(-3, -2), atHex(3, 2)],
    minLayer: 2,
  },
];

// King of the Pole arena: one big central pole
const KOTP_LAYOUT = {
  name: 'The Summit',
  theme: 0xffd23f,
  tiles: () => hexRange(6, (q, r) => hexDistance(q, r) !== 0),
  pylons: () => [{ x: 0, y: 0, pole: true }, atHex(4, -4), atHex(-4, 0), atHex(0, 4)],
  debris: () => [atHex(3, 0), atHex(-3, 3), atHex(0, -3), atHex(-2, -1), atHex(2, 1)],
  minLayer: 5,
};

// Tutorial arena: small and friendly
const TUTORIAL_LAYOUT = {
  name: 'Training Deck',
  theme: 0x31e7ff,
  tiles: () => hexRange(4),
  pylons: () => [atHex(-3, 3)],
  debris: () => [],
  minLayer: 4,
};

export const ARENA_COUNT = LAYOUTS.length;
export const KOTP_ARENA = 100;
export const TUTORIAL_ARENA = 101;

const cache = new Map();

/** Build (and cache) an arena by index. */
export function getArena(index) {
  if (cache.has(index)) return cache.get(index);
  const layout = index === KOTP_ARENA ? KOTP_LAYOUT : index === TUTORIAL_ARENA ? TUTORIAL_LAYOUT : LAYOUTS[index % LAYOUTS.length];
  const tiles = layout.tiles().map((t, i) => {
    const p = hexToPixel(t.q, t.r);
    const layer = layout.layerOf ? layout.layerOf(t, p) : hexDistance(t.q, t.r);
    return { i, q: t.q, r: t.r, x: p.x, y: p.y, layer };
  });
  const map = new Map();
  tiles.forEach(t => map.set(hexKey(t.q, t.r), t));
  let maxLayer = 0, extent = 0;
  for (const t of tiles) {
    maxLayer = Math.max(maxLayer, t.layer);
    extent = Math.max(extent, Math.hypot(t.x, t.y) + HEX_SIZE);
  }
  const pylons = layout.pylons().map((p, i) => ({ id: i, x: p.x, y: p.y, pole: !!p.pole }));
  const arena = {
    index,
    name: layout.name,
    theme: layout.theme,
    tiles,
    map,
    pylons,
    debrisSpawns: layout.debris(),
    minLayer: Math.min(layout.minLayer, maxLayer),
    maxLayer,
    extent,
    // number of collapses possible
    maxCollapses: Math.max(0, maxLayer - Math.min(layout.minLayer, maxLayer)),
  };
  cache.set(index, arena);
  return arena;
}

/** Deterministic spawn points spread around the platform. */
export function spawnPoints(arena, n) {
  // only spawn on "solid" tiles (all six neighbours present), away from pylons
  const solid = (t) => [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]].every(([dq, dr]) => arena.map.has(hexKey(t.q + dq, t.r + dr)));
  const cands = arena.tiles.filter(t => solid(t) &&
    t.layer >= Math.max(1, arena.minLayer - 1) && t.layer <= Math.max(arena.minLayer + 1, arena.maxLayer - 2) &&
    arena.pylons.every(p => Math.hypot(p.x - t.x, p.y - t.y) > 80));
  const pool = cands.length >= n ? cands : arena.tiles.slice();
  const used = new Set();
  const out = [];
  const rad = arena.extent * 0.52;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const tx = Math.cos(a) * rad, ty = Math.sin(a) * rad;
    let best = null, bd = Infinity;
    for (const t of pool) {
      if (used.has(t.i) && used.size < pool.length) continue;
      const d = (t.x - tx) ** 2 + (t.y - ty) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    used.add(best.i);
    out.push({ x: best.x, y: best.y });
  }
  return out;
}

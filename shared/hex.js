// =============================================================================
// Hex grid helpers (pointy-top, axial coordinates q/r)
// =============================================================================
import { HEX_SIZE } from './constants.js';

const SQRT3 = Math.sqrt(3);

export function hexToPixel(q, r, size = HEX_SIZE) {
  return { x: size * SQRT3 * (q + r / 2), y: size * 1.5 * r };
}

export function pixelToHex(x, y, size = HEX_SIZE) {
  const q = (SQRT3 / 3 * x - y / 3) / size;
  const r = (2 / 3 * y) / size;
  return hexRound(q, r);
}

export function hexRound(q, r) {
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

export function hexDistance(q1, r1, q2 = 0, r2 = 0) {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

export const hexKey = (q, r) => q * 1000 + r;

// Corner points of a hex centered at 0,0 (pointy-top)
export function hexCorners(size = HEX_SIZE) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    pts.push({ x: size * Math.cos(a), y: size * Math.sin(a) });
  }
  return pts;
}

export const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

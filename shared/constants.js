// =============================================================================
// Polarity — shared constants
// Used by both the server (Node) and the browser client (ES modules), so the
// simulation and the client-side prediction always agree on every number.
// =============================================================================

export const TICK_RATE = 60;                 // fixed physics ticks per second
export const DT = 1 / TICK_RATE;             // seconds per tick
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_RATE = 20;             // snapshots per second sent to clients
export const SNAPSHOT_EVERY = TICK_RATE / SNAPSHOT_RATE;

// Player magnetic states
export const MODE = { NEUTRAL: 0, PULL: 1, PUSH: 2, ANCHOR: 3 };
export const MODE_NAMES = ['NEUTRAL', 'PULL', 'PUSH', 'ANCHOR'];
export const MODE_COLORS = [0x8fb0ff, 0x2f9bff, 0xff3352, 0xf2f6ff];
export const MODE_CSS = ['#8fb0ff', '#2f9bff', '#ff3352', '#f2f6ff'];

// Player flags packed into snapshots
export const FLAG = {
  ALIVE: 1,
  DRIFTING: 2,     // knocked off the edge, ~1 s to save yourself
  GHOST: 4,
  FALLING: 8,      // playing the fall-into-the-void animation
  ARMOR: 16,       // post-surge knockback armor
  ON_POLE: 32,     // King of the Pole: touching the pole
  BOT: 64,         // controlled by AI (bot or disconnected human)
};

// ---------------------------------------------------------------------------
// Physics tuning (units: world pixels, seconds)
// ---------------------------------------------------------------------------
export const PHYS = {
  radius: 22,
  mass: 1,
  anchorMass: 7,
  moveAccel: 1550,          // input acceleration
  drag: 3.3,                // exponential drag per second (gives slight drift)
  idleDrag: 4.2,            // a touch more grip when not steering
  driftDrag: 0.9,           // floating over the void: very slippery
  driftMoveFactor: 0.28,    // very little control while drifting
  anchorMoveFactor: 0.3,
  anchorDrag: 7,
  maxSpeed: 2400,

  tellTicks: 12,            // 0.2 s colored glow before a state activates
  cooldownTicks: 18,        // 0.3 s between state switches

  energyMax: 100,
  drain: [0, 19, 23, 28],   // energy/second per mode
  recharge: 30,             // energy/second while neutral
  rechargeDelay: 15,        // ticks after leaving a state before recharge
  minEnergy: 15,            // needed to activate a state

  fieldRange: 340,
  pullStrength: 900,
  pushStrength: 1000,
  pullVsPull: 1.3,
  pushVsPush: 1.35,
  pushVsPull: 1.6,          // a puller caught by a push gets thrown

  // collisions
  restitution: 0.92,
  knockBonus: 0.32,         // extra launch for the loser of a hit
  hitMinImpact: 140,        // smallest impact that counts as a "hit"
  bigHit: 900,
  hugeHit: 1350,

  // edge / void
  driftTicks: 60,           // ~1 s to save yourself
  fallTicks: 75,            // fall animation before becoming a ghost
  koCreditTicks: 180,       // 3 s KO credit window

  // surge
  surgeMax: 100,
  surgeRange: 430,
  surgePush: 1300,
  surgePull: 900,
  surgeAnchor: 1200,
  surgeArmorTicks: 40,
  surgePerImpact: 1 / 38,
  surgeOnKo: 22,
  surgeNearMiss: 7,

  // ghosts
  ghostAccel: 1100,
  ghostDrag: 3,
  ghostPulseTicks: 480,     // 8 s
  ghostPulseRange: 175,
  ghostPulseForce: 330,
};

export const PYLON = {
  radius: 26,
  range: 380,
  pull: 1650,               // grapple acceleration toward a pylon
  push: 900,                // continuous push-off acceleration
  dash: 760,                // instant dash impulse when Push activates nearby
};

export const POLE = { radius: 38, scoreEvery: 6 };  // KotP: 10 points/s

export const DEBRIS = {
  radius: 17,
  mass: 1.25,
  drag: 1.7,
  fieldFactor: 1.4,
  hitSpeed: 260,
  respawnTicks: 360,
};

export const HEX_SIZE = 46;  // hex tile radius (center to corner)

// ---------------------------------------------------------------------------
// Match flow
// ---------------------------------------------------------------------------
export const ROUND_TICKS = 90 * TICK_RATE;
export const KOTP_TICKS = 120 * TICK_RATE;
export const ROUNDS_PER_MATCH = 5;
export const COUNTDOWN_TICKS = 3 * TICK_RATE;
export const COLLAPSE_EVERY = 20 * TICK_RATE;
export const COLLAPSE_WARN = 3 * TICK_RATE;
export const ROUND_END_TICKS = 150;        // slow-mo / celebration time after the round ends
export const RESULTS_MS = 7000;
export const KOTP_RESPAWN_TICKS = 150;
export const MAX_PLAYERS = 12;

export const GAME_MODES = {
  ffa: { name: 'Free-for-all', desc: 'Knock everyone into the void. Most KOs after 5 rounds wins.' },
  kotp: { name: 'King of the Pole', desc: 'Touch the central pole to score. Highest score after 2 minutes wins.' },
};

// ---------------------------------------------------------------------------
// Cosmetics
// ---------------------------------------------------------------------------
export const PLAYER_COLORS = [
  0x31e7ff, 0xff4fd8, 0xffd23f, 0x7dff5a, 0xff7a2f, 0xa77bff,
  0x3f7bff, 0xff3f5e, 0x2fffc4, 0xf2f2ff, 0xc6ff3f, 0xff9fd0,
];

export const SKINS = [
  { id: 'plasma', name: 'Plasma', trail: 0xff66ff },
  { id: 'chrome', name: 'Chrome', trail: 0xdfe8ff },
  { id: 'galaxy', name: 'Galaxy', trail: 0x9a6bff },
  { id: 'lava',   name: 'Lava',   trail: 0xff6a1f },
  { id: 'ice',    name: 'Ice',    trail: 0x9ff0ff },
  { id: 'neon',   name: 'Neon',   trail: 0x39ff9c },
  { id: 'gold',   name: 'Gold',   trail: 0xffcf4a },
  { id: 'void',   name: 'Void',   trail: 0x6a3cff },
];

export const BOT_LEVELS = ['easy', 'normal', 'hard'];
export const BOT_NAMES = [
  'Magneto Jr', 'Coil', 'Ferris', 'Volta', 'Tesla Tom', 'Gauss', 'Lodestone',
  'Dynamo', 'Sparky', 'Ohm My', 'Flux', 'Joule', 'Ampy', 'Nikola', 'Polaris', 'Quark',
];

// Small deterministic PRNG (mulberry32). Used for arena decoration and bot
// personality so nothing in gameplay depends on Math.random.
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =============================================================================
// Persistent settings (localStorage) + quality presets + slow-device detection
// =============================================================================

const KEY = 'polarity_settings_v1';

const defaults = {
  name: '',
  color: Math.floor(Math.random() * 12),
  skin: Math.floor(Math.random() * 8),
  quality: 'auto',
  volMaster: 80,
  volMusic: 55,
  volSfx: 85,
  muted: false,
  touch: 'auto',   // auto | on | off
  token: '',
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...defaults, ...raw };
  } catch (e) { return { ...defaults }; }
}

export const settings = load();
if (!settings.token) {
  settings.token = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => (b % 36).toString(36)).join('');
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* private mode */ }
}
save();

// ---------------------------------------------------------------------------
// Quality presets. "Low" still looks good: glow comes from additive sprites,
// only the expensive full-screen filters are turned off.
// ---------------------------------------------------------------------------
export const QUALITY = {
  low: {
    name: 'low', resolution: 1, maxRes: 1, filings: 1100, bloom: false, bloomRes: 0, shockwave: false,
    stars: 160, trails: true, fieldGlow: false, particles: 260, filingStride: 2, nebula: 2, antialias: false,
  },
  medium: {
    name: 'medium', resolution: 1, maxRes: 1.5, filings: 2400, bloom: true, bloomRes: 0.25, shockwave: true,
    stars: 320, trails: true, fieldGlow: true, particles: 600, filingStride: 1, nebula: 3, antialias: false,
  },
  high: {
    name: 'high', resolution: 2, maxRes: 2, filings: 4200, bloom: true, bloomRes: 0.35, shockwave: true,
    stars: 520, trails: true, fieldGlow: true, particles: 1100, filingStride: 1, nebula: 4, antialias: true,
  },
};

export const isTouchDevice = () =>
  (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;

/** First guess at a quality level before we can measure frame times. */
export function guessQuality() {
  const ua = navigator.userAgent;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const cros = /CrOS/.test(ua);
  const mobile = /Android|iPhone|iPad|iPod|Mobile/.test(ua);
  if (cores <= 2 || mem <= 2) return 'low';
  if (cros && cores <= 4) return 'low';
  if (mobile || cros || cores <= 4) return 'medium';
  return 'high';
}

export function resolveQuality() {
  return settings.quality === 'auto' ? (settings._autoLevel || guessQuality()) : settings.quality;
}

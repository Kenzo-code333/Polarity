// =============================================================================
// Procedural audio (Web Audio API). No audio files at all: every sound effect
// and the music loop are synthesized on the fly.
// =============================================================================

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.vol = { master: 0.8, music: 0.55, sfx: 0.85, muted: false };
    this.intensity = 0;
    this.musicOn = false;
    this.lastPlay = {};
  }

  /** Must be called from a user gesture (browser autoplay rules). */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.003; this.comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.connect(this.comp); this.comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.connect(this.master);
    // shared white-noise buffer
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // distortion curve for crunchy big hits
    this.curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; this.curve[i] = Math.tanh(x * 4); }
    // echo bus for music arps and ghosts
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = 0.375;
    this.fb = ctx.createGain(); this.fb.gain.value = 0.35;
    this.delayOut = ctx.createGain(); this.delayOut.gain.value = 0.45;
    this.delay.connect(this.fb); this.fb.connect(this.delay); this.delay.connect(this.delayOut); this.delayOut.connect(this.music);
    this.initHum();
    this.applyVolumes();
    this.ready = true;
  }

  setVolumes(v) { Object.assign(this.vol, v); this.applyVolumes(); }
  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.muted ? 0 : this.vol.master, t, 0.05);
    this.music.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
  }

  // ---------------------------------------------------------------- helpers
  now() { return this.ctx.currentTime; }
  limit(key, ms) {
    const t = performance.now();
    if (this.lastPlay[key] && t - this.lastPlay[key] < ms) return false;
    this.lastPlay[key] = t; return true;
  }
  out(pan = 0, dest = this.sfx) {
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(dest); return p;
    }
    return dest;
  }
  env(gainNode, t, a, peak, dec) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  osc(type, f0, f1, t, dur, peak, dest, attack = 0.005) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    this.env(g, t, attack, peak, dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + attack + dur + 0.05);
    return o;
  }
  noise(t, dur, peak, dest, filterType = 'lowpass', f0 = 1000, f1 = null, q = 1, attack = 0.003) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter(); f.type = filterType; f.frequency.setValueAtTime(f0, t); f.Q.value = q;
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, attack, peak, dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + attack + 0.05);
  }

  // ---------------------------------------------------------------- SFX
  click() { if (!this.ready) return; const t = this.now(); this.osc('sine', 1100, 700, t, 0.05, 0.18, this.sfx); }
  hover() { if (!this.ready || !this.limit('hover', 40)) return; this.osc('sine', 1600, 1400, this.now(), 0.03, 0.05, this.sfx); }

  /** Punchy impact thud scaled by force (0..~2000). */
  hit(force, pan = 0) {
    if (!this.ready || !this.limit('hit', 25)) return;
    const t = this.now(), k = Math.min(1, force / 1400);
    const dest = this.out(pan);
    this.osc('sine', 120 + 80 * k, 38, t, 0.14 + 0.25 * k, 0.35 + 0.65 * k, dest, 0.002);
    this.noise(t, 0.05 + 0.12 * k, 0.25 + 0.5 * k, dest, 'lowpass', 2500 + 3000 * k, 300);
    if (k > 0.55) {
      // crunch layer
      const o = this.ctx.createOscillator(), ws = this.ctx.createWaveShaper(), g = this.ctx.createGain();
      ws.curve = this.curve; o.type = 'square'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.2);
      this.env(g, t, 0.002, 0.25 * k, 0.22);
      o.connect(ws); ws.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.3);
    }
  }

  crack() {
    if (!this.ready) return;
    const t = this.now();
    for (let i = 0; i < 14; i++) {
      const tt = t + Math.random() * 0.9;
      this.noise(tt, 0.02 + Math.random() * 0.04, 0.12 + Math.random() * 0.2, this.sfx, 'highpass', 1800 + Math.random() * 3000, null, 2);
    }
    this.osc('sawtooth', 70, 50, t, 0.8, 0.06, this.sfx, 0.3);
  }

  collapse() {
    if (!this.ready) return;
    const t = this.now();
    this.noise(t, 1.6, 0.7, this.sfx, 'lowpass', 400, 60, 1, 0.02);
    this.osc('sine', 70, 25, t, 1.4, 0.6, this.sfx, 0.02);
    for (let i = 0; i < 10; i++) this.noise(t + Math.random() * 1.2, 0.05, 0.15, this.sfx, 'bandpass', 600 + Math.random() * 1500, null, 3);
  }

  fall(pan = 0) {
    if (!this.ready) return;
    const t = this.now(), dest = this.out(pan);
    this.noise(t, 1.2, 0.45, dest, 'bandpass', 2400, 160, 2.5, 0.05);
    this.osc('sine', 420, 50, t, 1.2, 0.3, dest, 0.02);
    // the faint flash far below
    this.osc('triangle', 90, 40, t + 1.1, 0.6, 0.25, dest, 0.01);
  }

  surge(mode = 2) {
    if (!this.ready) return;
    const t = this.now();
    const base = mode === 1 ? 55 : mode === 3 ? 40 : 70;
    // riser
    this.osc('sawtooth', base * 4, base * 16, t, 0.18, 0.15, this.sfx, 0.12);
    // the boom
    const tb = t + 0.12;
    this.osc('sine', base * 2, 22, tb, 1.8, 1.0, this.sfx, 0.004);
    this.noise(tb, 1.2, 0.8, this.sfx, 'lowpass', 3000, 80, 1, 0.003);
    const o = this.ctx.createOscillator(), ws = this.ctx.createWaveShaper(), g = this.ctx.createGain();
    ws.curve = this.curve; o.type = 'sawtooth'; o.frequency.setValueAtTime(base, tb); o.frequency.exponentialRampToValueAtTime(20, tb + 1);
    this.env(g, tb, 0.005, 0.4, 1);
    o.connect(ws); ws.connect(g); g.connect(this.sfx); o.start(tb); o.stop(tb + 1.2);
  }

  tell(mode) {
    if (!this.ready || !this.limit('tell', 60)) return;
    const t = this.now();
    if (mode === 1) this.osc('triangle', 300, 520, t, 0.12, 0.08, this.sfx);
    else if (mode === 2) this.osc('triangle', 600, 320, t, 0.12, 0.08, this.sfx);
    else this.osc('square', 160, 150, t, 0.12, 0.05, this.sfx);
  }

  dash() { if (!this.ready) return; const t = this.now(); this.noise(t, 0.35, 0.4, this.sfx, 'bandpass', 600, 3500, 1.5, 0.01); }

  pulse() {
    if (!this.ready) return;
    const t = this.now();
    const o = this.osc('sine', 500, 200, t, 0.6, 0.25, this.sfx, 0.02);
    void o;
    this.osc('sine', 750, 300, t, 0.6, 0.12, this.delay, 0.02);
  }

  save() {
    if (!this.ready) return;
    const t = this.now();
    [523, 659, 784, 1046].forEach((f, i) => this.osc('triangle', f, f, t + i * 0.06, 0.18, 0.18, this.sfx));
  }

  ko() {
    if (!this.ready) return;
    const t = this.now();
    this.osc('square', 880, 880, t, 0.1, 0.07, this.sfx);
    this.osc('square', 1320, 1320, t + 0.08, 0.2, 0.07, this.sfx);
  }

  near() { if (!this.ready || !this.limit('near', 200)) return; this.noise(this.now(), 0.18, 0.15, this.sfx, 'bandpass', 3000, 800, 4); }

  count(n) {
    if (!this.ready) return;
    const t = this.now();
    if (n > 0) this.osc('square', 520, 520, t, 0.15, 0.12, this.sfx);
    else { this.osc('square', 1040, 1040, t, 0.4, 0.14, this.sfx); this.osc('sine', 130, 60, t, 0.5, 0.4, this.sfx); }
  }

  stinger() {
    if (!this.ready || !this.limit('stinger', 300)) return;
    const t = this.now();
    this.noise(t, 0.4, 0.25, this.sfx, 'highpass', 800, 6000, 1, 0.15);
  }

  fanfare() {
    if (!this.ready) return;
    const t = this.now();
    [392, 523, 659, 784, 1046].forEach((f, i) => {
      this.osc('sawtooth', f, f, t + i * 0.12, 0.35, 0.08, this.music);
      this.osc('triangle', f * 2, f * 2, t + i * 0.12, 0.35, 0.06, this.delay);
    });
  }

  // ---------------------------------------------------------------- hum
  initHum() {
    const c = this.ctx;
    this.humGain = c.createGain(); this.humGain.gain.value = 0;
    this.humFilter = c.createBiquadFilter(); this.humFilter.type = 'lowpass'; this.humFilter.frequency.value = 600; this.humFilter.Q.value = 6;
    this.hum1 = c.createOscillator(); this.hum1.type = 'sawtooth'; this.hum1.frequency.value = 100;
    this.hum2 = c.createOscillator(); this.hum2.type = 'sine'; this.hum2.frequency.value = 100.7;
    this.lfo = c.createOscillator(); this.lfo.frequency.value = 6;
    this.lfoGain = c.createGain(); this.lfoGain.gain.value = 80;
    this.lfo.connect(this.lfoGain); this.lfoGain.connect(this.humFilter.frequency);
    this.hum1.connect(this.humFilter); this.hum2.connect(this.humFilter);
    this.humFilter.connect(this.humGain); this.humGain.connect(this.sfx);
    this.hum1.start(); this.hum2.start(); this.lfo.start();
    this.humMode = 0;
  }

  /** Continuous magnetic hum for the local player's state. */
  setHum(mode, energy = 1) {
    if (!this.ready) return;
    const t = this.now();
    const F = [0, 98, 147, 62];
    if (mode !== this.humMode) {
      this.humMode = mode;
      if (mode) {
        this.hum1.frequency.setTargetAtTime(F[mode], t, 0.03);
        this.hum2.frequency.setTargetAtTime(F[mode] * (mode === 2 ? 1.5 : 2.01), t, 0.03);
        this.lfo.frequency.setTargetAtTime(mode === 1 ? 5 : mode === 2 ? 9 : 2, t, 0.05);
        this.humFilter.frequency.setTargetAtTime(mode === 3 ? 300 : 700, t, 0.05);
      }
    }
    const g = mode ? 0.07 + 0.05 * energy : 0;
    this.humGain.gain.setTargetAtTime(g, t, mode ? 0.04 : 0.08);
  }

  // ---------------------------------------------------------------- music
  startMusic() {
    if (!this.ready || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextNote = this.now() + 0.1;
    this.musicTimer = setInterval(() => this.schedule(), 25);
  }
  stopMusic() { this.musicOn = false; clearInterval(this.musicTimer); }
  /** 0 = menu chill, 1..3 = in match, ramps as the arena shrinks */
  setIntensity(n) { this.intensity = Math.max(0, Math.min(3, n)); }

  schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const bpm = 112 + this.intensity * 6;
    const stepDur = 60 / bpm / 4;
    while (this.nextNote < this.now() + 0.12) {
      this.playStep(this.step, this.nextNote, stepDur);
      this.nextNote += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  playStep(step, t, sd) {
    const I = this.intensity;
    const bar = Math.floor(step / 16), s = step % 16;
    // A minor: Am F C G
    const roots = [110, 87.31, 130.81, 98];
    const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [261.6, 329.6, 392], [196, 246.9, 293.7]];
    const root = roots[bar], chord = chords[bar];
    const m = this.music;
    // kick
    if ((I >= 1 && s % 4 === 0) || (I === 0 && (s === 0 || s === 10))) {
      this.osc('sine', 150, 40, t, 0.22, I === 0 ? 0.35 : 0.8, m, 0.002);
    }
    // clap / snare
    if (I >= 2 && (s === 4 || s === 12)) this.noise(t, 0.12, 0.35, m, 'bandpass', 1800, null, 0.8);
    // hats
    if (I >= 1 && s % 4 === 2) this.noise(t, 0.04, 0.15, m, 'highpass', 8000);
    if (I >= 3 && s % 2 === 1) this.noise(t, 0.025, 0.08, m, 'highpass', 9000);
    // bass
    if (s % 2 === 0 && (I >= 1 || s % 8 === 0)) {
      const f = root * ((s % 8 === 6) ? 2 : 1);
      const o = this.ctx.createOscillator(), fl = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f / 2;
      fl.type = 'lowpass'; fl.frequency.setValueAtTime(300 + I * 350, t); fl.frequency.exponentialRampToValueAtTime(120, t + sd * 1.8); fl.Q.value = 8;
      this.env(g, t, 0.005, 0.32, sd * 1.8);
      o.connect(fl); fl.connect(g); g.connect(m); o.start(t); o.stop(t + sd * 2);
    }
    // pad at the start of each bar
    if (s === 0) {
      for (const f of chord) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain(), fl = this.ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 14;
        fl.type = 'lowpass'; fl.frequency.value = 700 + I * 300;
        const dur = sd * 16;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.045, t + 0.4); g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(fl); fl.connect(g); g.connect(m); o.start(t); o.stop(t + dur + 0.05);
      }
    }
    // arpeggio
    if (I >= 2 || (I === 0 && s % 4 === 0)) {
      const notes = [chord[0] * 2, chord[1] * 2, chord[2] * 2, chord[1] * 4];
      const f = notes[(step * (I >= 3 ? 3 : 1)) % 4];
      this.osc('square', f, f, t, sd * 0.8, I === 0 ? 0.025 : 0.04, this.delay, 0.002);
      this.osc('square', f, f, t, sd * 0.8, I === 0 ? 0.02 : 0.035, m, 0.002);
    }
    // a lead riser for the final phase
    if (I >= 3 && s === 14 && bar === 3) this.noise(t, sd * 2, 0.2, m, 'highpass', 500, 8000, 1, sd * 1.5);
  }
}

export const audio = new AudioEngine();

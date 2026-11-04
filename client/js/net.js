// =============================================================================
// Networking: Socket.IO connection, clock synchronisation and input sending.
// =============================================================================

export class Net {
  constructor() {
    this.handlers = {};
    this.offset = 0;          // serverTime ≈ performance.now() + offset
    this.offsetTarget = 0;
    this.synced = false;
    this.rtt = 0;
    this.samples = [];
    this.connected = false;
    // ?lag=150 simulates that many ms of round-trip latency (for testing netcode)
    this.fakeLag = Math.max(0, Math.min(1000, Number(new URLSearchParams(location.search).get('lag')) || 0));
    // websocket first: lower latency, no long-polling upgrade dance
    this.socket = window.io({ transports: ['websocket', 'polling'], reconnectionDelay: 500, reconnectionDelayMax: 3000 });
    this.socket.on('connect', () => { this.connected = true; this.emitLocal('connect'); this.syncBurst(); });
    this.socket.on('disconnect', () => { this.connected = false; this.emitLocal('disconnect'); });
    for (const ev of ['joined', 'room', 'round', 's', 'results', 'podium', 'err', 'kicked']) {
      this.socket.on(ev, (d) => this.delayed(() => this.emitLocal(ev, d)));
    }
    this.pingTimer = setInterval(() => this.ping(), 1000);
  }

  delayed(fn) { if (this.fakeLag) setTimeout(fn, this.fakeLag / 2); else fn(); }

  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
  emitLocal(ev, d) { for (const fn of this.handlers[ev] || []) fn(d); }
  send(ev, d) { this.delayed(() => { if (this.socket.connected) this.socket.emit(ev, d); }); }

  /** A few quick pings right after connecting to lock the clock quickly. */
  syncBurst() {
    for (let i = 0; i < 6; i++) setTimeout(() => this.ping(), i * 120);
  }

  ping() {
    if (!this.socket.connected) return;
    const t0 = performance.now();
    this.delayed(() => this.socket.emit('png', 0, (serverT) => this.delayed(() => {
      const t1 = performance.now();
      const rtt = t1 - t0;
      this.samples.push({ rtt, off: serverT - (t0 + rtt / 2) });
      if (this.samples.length > 12) this.samples.shift();
      // the sample with the lowest round-trip is the most trustworthy
      let best = this.samples[0];
      for (const s of this.samples) if (s.rtt < best.rtt) best = s;
      this.offsetTarget = best.off;
      this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
      if (!this.synced) { this.offset = this.offsetTarget; this.synced = true; }
    })));
  }

  /** Estimated current server time (ms). Smoothly slews toward new estimates. */
  serverNow() {
    const diff = this.offsetTarget - this.offset;
    if (Math.abs(diff) > 250) this.offset = this.offsetTarget;
    else this.offset += diff * 0.02;
    return performance.now() + this.offset;
  }

  /** Called when a snapshot arrives: tightens the clock if we were behind. */
  observeSnapshot(ts) {
    const est = performance.now() + this.offset;
    // a snapshot can never come from the future
    if (ts > est + 5) { this.offset += (ts - est) * 0.5; this.offsetTarget = Math.max(this.offsetTarget, this.offset); }
  }

  sendInput(seq, inp) {
    if (!this.socket.connected) return;
    if (this.fakeLag) { const pkt = [seq, Math.round(inp.mx * 100), Math.round(inp.my * 100), inp.mode, inp.surge ? 1 : 0]; this.delayed(() => this.socket.emit('i', pkt)); return; }
    this.socket.emit('i', [seq, Math.round(inp.mx * 100), Math.round(inp.my * 100), inp.mode, inp.surge ? 1 : 0]);
  }
}

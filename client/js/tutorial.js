// =============================================================================
// Interactive ~30 s tutorial. Runs the real simulation locally (offline) with
// the player and a training dummy, and walks through each magnetic state.
// =============================================================================
import { Game } from '/shared/sim.js';
import { TUTORIAL_ARENA } from '/shared/arenas.js';
import { MODE, FLAG, PHYS } from '/shared/constants.js';
import { LocalSession } from './session.js';
import { $ } from './ui.js';

const ME = 1, DUMMY = 2;

export class Tutorial {
  constructor(profile, touch) {
    this.touch = touch;
    this.game = new Game({
      mode: 'tutorial', arena: TUTORIAL_ARENA,
      roster: [{ id: ME, name: profile.name || 'You' }, { id: DUMMY, name: 'Dummy' }],
    });
    // place the dummy and the player
    const me = this.game.players.get(ME), dm = this.game.players.get(DUMMY);
    Object.assign(me, { x: -120, y: 60 });
    Object.assign(dm, { x: 140, y: -40 });
    this.roster = new Map([
      [ME, { id: ME, name: profile.name || 'You', color: profile.color, skin: profile.skin }],
      [DUMMY, { id: DUMMY, name: 'Training Dummy', color: 9, skin: 1 }],
    ]);
    this.step = 0;
    this.t = 0;
    this.moved = 0;
    this.lastPos = { x: me.x, y: me.y };
    this.anchorTicks = 0;
    this.done = false;
    this.finished = false;
    this.events = [];
    this.session = new LocalSession(this.game, { selfId: ME, script: (g, inputs) => this.script(g, inputs) });
    this.steps = [
      { text: () => `Move with ${this.touch ? 'the joystick' : '<b>WASD</b> or the <b>arrow keys</b>'}`, check: () => this.moved > 170 },
      { text: () => `Hold ${this.key('pull')} to <b class="c-pull">PULL</b> — drag the dummy to you`, check: () => this.dist() < 75 && this.usedPull },
      { text: () => `Hold ${this.key('push')} to <b class="c-push">PUSH</b> — blast the dummy off the edge!`, check: () => this.dummyFell },
      { text: () => `Hold ${this.key('pull')} near the <b>PYLON</b> to grapple onto it`, check: () => this.pylonDist() < 80 },
      { text: () => `The dummy is going to push you! Hold ${this.key('anchor')} to <b class="c-anchor">ANCHOR</b> and stay put`, check: () => this.anchorTicks > 80 },
      { text: () => `Your <b class="c-surge">SURGE</b> is charged! Press ${this.key('surge')} to unleash it`, check: () => this.surged },
    ];
    this.showStep();
  }

  key(a) {
    if (this.touch) return `<b>${a.toUpperCase()}</b>`;
    return { pull: '<kbd>SPACE</kbd>', push: '<kbd>SHIFT</kbd>', anchor: '<kbd>E</kbd>', surge: '<kbd>Q</kbd>' }[a];
  }

  me() { return this.game.players.get(ME); }
  dummy() { return this.game.players.get(DUMMY); }
  dist() { const a = this.me(), b = this.dummy(); return Math.hypot(a.x - b.x, a.y - b.y); }
  pylonDist() { const a = this.me(), p = this.game.pylons[0]; return Math.hypot(a.x - p.x, a.y - p.y); }

  showStep() {
    const s = this.steps[this.step];
    $('tutStep').textContent = `STEP ${this.step + 1} / ${this.steps.length}`;
    const tx = $('tutText');
    tx.classList.remove('done');
    tx.innerHTML = s.text();
    $('tutProgress').style.width = (this.step / this.steps.length * 100) + '%';
    this.stepT = 0;
    this.usedPull = false;
    this.dummyFell = false;
    this.anchorTicks = 0;
    this.surged = false;
    // set-up per step
    const me = this.me();
    if (this.step === 5) me.surge = PHYS.surgeMax;
  }

  /** Called by the LocalSession every tick to drive the dummy. */
  script(g, inputs) {
    const me = this.me(), d = this.dummy();
    if (me.mode === MODE.PULL) this.usedPull = true;
    let inp = { mx: 0, my: 0, mode: 0, surge: false };
    if (this.step === 4 && (d.flags & FLAG.ALIVE)) {
      // walk up to the player and push
      const dx = me.x - d.x, dy = me.y - d.y, dist = Math.hypot(dx, dy) || 1;
      if (dist > 130) inp = { mx: dx / dist, my: dy / dist, mode: 0, surge: false };
      else inp = { mx: dx / dist * 0.3, my: dy / dist * 0.3, mode: MODE.PUSH, surge: false };
      if (d.mode === MODE.PUSH && dist < 260 && me.mode === MODE.ANCHOR && (me.flags & FLAG.ALIVE)) this.anchorTicks++;
      if (d.energy < 20) d.energy = 100; // the dummy never tires
    } else if (this.step === 1 || this.step === 2) {
      // stand still, a little bit away from the player
    }
    inputs.set(DUMMY, inp);
    // keep the player from losing the tutorial: respawn quickly
    if (this.step === 5 && me.surge < PHYS.surgeMax && !this.surged) me.surge = PHYS.surgeMax;
  }

  onEvent(ev) {
    if (ev.k === 'fall' && ev.id === DUMMY) this.dummyFell = true;
    if (ev.k === 'surge' && ev.id === ME) this.surged = true;
    if (ev.k === 'fall' && ev.id === ME && this.step === 4) this.anchorTicks = 0;
  }

  update(dt) {
    this.t += dt;
    if (this.finished) return;
    const me = this.me();
    if (me.flags & FLAG.ALIVE) {
      this.moved += Math.hypot(me.x - this.lastPos.x, me.y - this.lastPos.y);
      this.lastPos = { x: me.x, y: me.y };
    }
    if (this.done) {
      this.doneT += dt;
      if (this.doneT > 2.6) this.finished = true;
      return;
    }
    this.stepT += dt;
    if (this.stepDone) {
      this.stepDoneT += dt;
      if (this.stepDoneT > 0.9) {
        this.stepDone = false;
        this.step++;
        if (this.step >= this.steps.length) {
          this.done = true; this.doneT = 0;
          $('tutStep').textContent = 'COMPLETE';
          $('tutText').innerHTML = "You're ready! Go knock your friends into the void. 🚀";
          $('tutText').classList.add('done');
          $('tutProgress').style.width = '100%';
          return 'complete';
        }
        this.showStep();
      }
      return;
    }
    if (this.steps[this.step].check()) {
      this.stepDone = true; this.stepDoneT = 0;
      $('tutText').classList.add('done');
      $('tutText').innerHTML = ['Nice moves!', 'Gotcha!', 'Into the void!', 'Grappled!', 'Rock solid!', 'BOOM!'][this.step] + ' ✔';
      $('tutProgress').style.width = ((this.step + 1) / this.steps.length * 100) + '%';
      return 'step';
    }
    return null;
  }
}

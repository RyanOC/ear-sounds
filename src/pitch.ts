import { Engine, FADE, bandNoiseGain, earToPan } from './audio/engine';
import type { Ear } from './state';

export interface PitchToneOpts {
  source: 'tone' | 'noise';
  ear: Ear;
  q: number;
  level: number; // linear
}

type Phase = 'idle' | 'search' | 'octave' | 'done';

interface Snapshot {
  phase: Phase;
  lo: number;
  hi: number;
  best: number;
  step: number;
}

const TONE = 1.0;
const GAP = 0.4;
/** Stop searching once the range is narrower than this ratio (~2/3 of a semitone). */
const DONE_RATIO = 1.04;

/**
 * A/B pitch matching. Each round plays two tones (at 1/3 and 2/3 of the
 * current range on a log scale); picking one keeps that half of the range.
 * Then an octave check, since tones an octave apart are easy to confuse.
 */
export class PitchFinder {
  phase: Phase = 'idle';
  lo = 200;
  hi = 12000;
  best = 0;
  step = 0;
  /** Index of the candidate currently sounding, or -1. */
  playing = -1;

  private history: Snapshot[] = [];
  private voices: { src: AudioScheduledSourceNode; env: GainNode }[] = [];
  private timers: number[] = [];
  private pan: StereoPannerNode | null = null;

  constructor(
    private engine: () => Engine,
    private opts: () => PitchToneOpts,
    private onChange: () => void,
  ) {}

  get canUndo() {
    return this.history.length > 0;
  }

  get candidates(): number[] {
    switch (this.phase) {
      case 'search': {
        const r = this.hi / this.lo;
        return [this.lo * Math.pow(r, 1 / 3), this.lo * Math.pow(r, 2 / 3)];
      }
      case 'octave':
        return [this.best / 2, this.best, this.best * 2];
      case 'done':
        return [this.best];
      default:
        return [];
    }
  }

  start(lo: number, hi: number) {
    this.lo = Math.min(lo, hi);
    this.hi = Math.max(lo, hi, this.lo * 1.5);
    this.phase = 'search';
    this.step = 0;
    this.best = 0;
    this.history = [];
    this.replay();
  }

  choose(i: number) {
    const c = this.candidates;
    this.history.push({ phase: this.phase, lo: this.lo, hi: this.hi, best: this.best, step: this.step });
    if (this.phase === 'search') {
      const mid = Math.sqrt(c[0] * c[1]);
      if (i === 0) this.hi = mid;
      else this.lo = mid;
      this.step++;
      if (this.hi / this.lo < DONE_RATIO) {
        this.best = Math.sqrt(this.lo * this.hi);
        this.phase = 'octave';
      }
    } else if (this.phase === 'octave') {
      this.best = c[i];
      this.phase = 'done';
    }
    this.replay();
  }

  undo() {
    const s = this.history.pop();
    if (!s) return;
    Object.assign(this, s);
    this.replay();
  }

  /** Fine-tune the final match by a ratio, e.g. 1.01 for +1%. */
  nudge(ratio: number) {
    if (this.phase !== 'done') return;
    this.best *= ratio;
    this.replay();
  }

  reset() {
    this.silence();
    this.phase = 'idle';
    this.history = [];
    this.onChange();
  }

  stop() {
    this.silence();
    this.onChange();
  }

  replay() {
    this.playSequence(this.candidates);
    this.onChange();
  }

  private playSequence(freqs: number[]) {
    this.silence();
    const eng = this.engine();
    eng.resume();
    const ctx = eng.ctx;
    const o = this.opts();
    if (!this.pan) {
      this.pan = ctx.createStereoPanner();
      this.pan.connect(eng.master);
    }
    this.pan.pan.value = earToPan(o.ear);

    let t = ctx.currentTime + 0.1;
    freqs.forEach((f, i) => {
      this.voice(f, t, o, eng);
      const startMs = (t - ctx.currentTime) * 1000;
      this.timers.push(
        window.setTimeout(() => {
          this.playing = i;
          this.onChange();
        }, startMs),
        window.setTimeout(() => {
          if (this.playing === i) {
            this.playing = -1;
            this.onChange();
          }
        }, startMs + TONE * 1000),
      );
      t += TONE + GAP;
    });
  }

  private voice(f: number, t: number, o: PitchToneOpts, eng: Engine) {
    const ctx = eng.ctx;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + FADE);
    env.gain.setValueAtTime(1, t + TONE - FADE);
    env.gain.linearRampToValueAtTime(0, t + TONE);
    env.connect(this.pan!);

    const level = ctx.createGain();
    level.connect(env);
    let src: AudioScheduledSourceNode;
    if (o.source === 'tone') {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      osc.connect(level);
      level.gain.value = 0.5 * o.level;
      src = osc;
    } else {
      const noise = ctx.createBufferSource();
      noise.buffer = eng.noise;
      noise.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = o.q;
      noise.connect(bp).connect(level);
      level.gain.value = 0.35 * bandNoiseGain(f, o.q, ctx.sampleRate) * o.level;
      src = noise;
    }
    src.start(t);
    src.stop(t + TONE + 0.02);
    src.onended = () => env.disconnect();
    this.voices.push({ src, env });
  }

  /** Fade out anything sounding or scheduled. */
  private silence() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.playing = -1;
    if (!this.voices.length) return;
    const ctx = this.engine().ctx;
    const now = ctx.currentTime;
    for (const v of this.voices) {
      v.env.gain.cancelScheduledValues(now);
      v.env.gain.setValueAtTime(v.env.gain.value, now);
      v.env.gain.linearRampToValueAtTime(0, now + FADE);
      try {
        v.src.stop(now + FADE + 0.01);
      } catch {
        // already stopped
      }
    }
    this.voices = [];
  }
}

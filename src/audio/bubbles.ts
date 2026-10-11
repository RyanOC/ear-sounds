import { Layer } from './layer';
import { bandNoiseGain } from './engine';
import type { BubbleParams } from '../state';

/**
 * Granular engine: many tiny pops at random (optionally clustered) times.
 * Runs continuously, or in a burst window after each rhythm beat.
 */
export class BubbleLayer extends Layer<BubbleParams> {
  private out: GainNode | null = null;
  private next = 0;
  private amp = 0.3;
  /** Upcoming burst windows as [start, end] in AudioContext time. */
  private windows: [number, number][] = [];

  protected onStart() {
    this.out = this.ctx.createGain();
    this.out.connect(this.channel.input);
    this.onUpdate();
    this.next = this.ctx.currentTime + 0.03;
    this.engine.addTicker(this.tick);
  }

  protected onStop() {
    this.engine.removeTicker(this.tick);
    this.windows = [];
    this.out?.disconnect();
    this.out = null;
  }

  /** Rhythm beat: open a burst window `offsetMs` after it. */
  beat = (time: number) => {
    if (!this.out) return;
    const p = this.params();
    const start = time + p.offsetMs / 1000;
    this.windows.push([start, start + p.burstMs / 1000]);
  };

  protected onUpdate() {
    const p = this.params();
    // Overlapping pops add up; scale so density doesn't change loudness much.
    this.amp = 0.5 / Math.sqrt(Math.max(1, (p.density * p.popMs) / 1000));
  }

  /**
   * Random gap to the next pop. With clustering c, a fraction c of gaps are
   * very short (pops inside a cluster) and the rest are long, keeping the
   * average rate at `density`.
   */
  private interval(p: BubbleParams): number {
    const mean = 1 / p.density;
    const c = Math.min(p.cluster / 100, 0.95);
    const short = mean / 8;
    const long = (mean - c * short) / (1 - c);
    const m = Math.random() < c ? short : long;
    return -Math.log(1 - Math.random()) * m; // exponential: irregular, not metronomic
  }

  private tick = (until: number) => {
    const out = this.out;
    if (!out) return;
    const p = this.params();
    const now = this.ctx.currentTime;
    let guard = 0;
    if (p.mode === 'continuous') {
      if (this.next < now - 0.5) this.next = now;
      while (this.next < until && guard++ < 5000) {
        if (this.next >= now) this.pop(this.next, p, out);
        this.next += this.interval(p);
      }
      return;
    }
    while (guard++ < 5000) {
      while (this.windows.length && this.windows[0][1] <= this.next) this.windows.shift();
      const w = this.windows[0];
      if (!w) break;
      if (this.next < w[0]) this.next = w[0];
      if (this.next >= until) break;
      if (this.next >= now) this.pop(this.next, p, out);
      this.next += this.interval(p);
    }
  };

  private pop(time: number, p: BubbleParams, out: GainNode) {
    const ctx = this.ctx;
    const nyq = ctx.sampleRate / 2;
    const f = Math.min(p.pitch * Math.pow(2, p.spread * (Math.random() * 2 - 1)), nyq * 0.8);
    const amp = Math.max(0.002, this.amp * (1 - (p.loudVar / 100) * Math.random()));
    const dur = p.popMs / 1000;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(amp, time + 0.0004);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    env.connect(out);

    let src: AudioScheduledSourceNode;
    if (p.popType === 'crackle') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.engine.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = 5;
      const level = ctx.createGain();
      level.gain.value = 0.7 * bandNoiseGain(f, 5, ctx.sampleRate);
      noise.connect(bp).connect(level).connect(env);
      noise.start(time, Math.random() * 1.5, dur + 0.01);
      src = noise;
    } else {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(f, time);
      // Real bubbles rise in pitch as they collapse.
      if (p.popType === 'bubble' && p.chirp > 0) {
        osc.frequency.exponentialRampToValueAtTime(Math.min(f * (1 + p.chirp / 100), nyq * 0.9), time + dur);
      }
      osc.connect(env);
      osc.start(time);
      osc.stop(time + dur + 0.005);
      src = osc;
    }
    src.onended = () => env.disconnect();
  }
}

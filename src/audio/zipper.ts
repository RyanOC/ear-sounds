import { Layer } from './layer';
import { bandNoiseGain } from './engine';
import type { ZipperParams } from '../state';

/**
 * A train of short clicks whose rate sweeps from startRate to endRate.
 * Each rhythm beat starts one sweep.
 */
export class ZipperLayer extends Layer<ZipperParams> {
  private out: GainNode | null = null;
  private filter!: BiquadFilterNode;
  private buf: AudioBuffer | null = null;
  private bufKey = '';
  private beats: number[] = [];
  private sweeping = false;
  private sweepStart = 0;
  private next = 0;

  protected onStart() {
    const ctx = this.ctx;
    this.out = ctx.createGain();
    this.out.connect(this.channel.input);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.connect(this.out);
    this.onUpdate();
    this.engine.addTicker(this.tick);
  }

  protected onStop() {
    this.engine.removeTicker(this.tick);
    this.beats = [];
    this.sweeping = false;
    this.out?.disconnect();
    this.out = null;
  }

  /** Rhythm beat: start a sweep at `time`. */
  beat = (time: number) => {
    if (this.out) this.beats.push(time);
  };

  /** Clicks per second at `t` seconds into the sweep. */
  private rateAt(t: number, p: ZipperParams): number {
    const x = Math.min(Math.max(t / p.sweep, 0), 1);
    const s = p.startRate;
    const e = p.endRate;
    switch (p.curve) {
      case 'linear':
        return s + (e - s) * x;
      case 'exponential':
        return s * Math.pow(e / s, x);
      case 'easein':
        return s + (e - s) * x * x * x;
    }
  }

  private tick = (until: number) => {
    if (!this.out) return;
    const p = this.params();
    const now = this.ctx.currentTime;
    let guard = 0;
    while (guard++ < 4000) {
      // A new beat takes over once we reach it, even if the last sweep hasn't finished.
      const beat = this.beats[0];
      if (beat !== undefined && beat < until && (!this.sweeping || this.next >= beat)) {
        this.beats.shift();
        this.sweeping = true;
        this.sweepStart = this.next = beat;
        continue;
      }
      if (!this.sweeping || this.next >= until) break;
      const t = this.next - this.sweepStart;
      if (t > p.sweep) {
        this.sweeping = false;
        continue;
      }
      if (this.next >= now) this.click(this.next, p); // past clicks (after a stall) are skipped
      const jitter = 1 + (p.randomness / 100) * (Math.random() * 2 - 1);
      this.next += Math.max(0.0005, jitter / this.rateAt(t, p));
    }
  };

  private click(time: number, p: ZipperParams) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.clickBuffer(p);
    src.connect(p.clickType === 'noise' ? this.filter : this.out!);
    src.start(time);
  }

  /** A single click: a noise burst (filtered later) or a tonal tick, with a fast decay. */
  private clickBuffer(p: ZipperParams): AudioBuffer {
    const key = `${p.clickType}|${p.clickMs}|${p.tone}`;
    if (this.buf && key === this.bufKey) return this.buf;
    const sr = this.ctx.sampleRate;
    const n = Math.max(2, Math.round((p.clickMs / 1000) * sr));
    const attack = Math.max(1, Math.round(0.0001 * sr));
    const buf = this.ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / attack) * Math.exp((-6 * i) / n);
      const s = p.clickType === 'noise' ? Math.random() * 2 - 1 : Math.sin((2 * Math.PI * p.tone * i) / sr);
      d[i] = s * env;
    }
    this.buf = buf;
    this.bufKey = key;
    return buf;
  }

  protected onUpdate() {
    if (!this.out) return;
    const p = this.params();
    const t = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(p.tone, t, 0.01);
    this.filter.Q.setTargetAtTime(p.q, t, 0.01);
    // Long clicks at fast rates overlap and stack up; keep loudness roughly even.
    const overlap = Math.max(1, (Math.max(p.startRate, p.endRate) * p.clickMs) / 1000);
    const base = 0.6 / Math.sqrt(overlap);
    const level = p.clickType === 'noise' ? 0.6 * base * bandNoiseGain(p.tone, p.q, this.ctx.sampleRate) : base;
    this.out.gain.setTargetAtTime(Math.min(level, 8), t, 0.01);
  }
}

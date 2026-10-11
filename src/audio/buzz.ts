import { Layer } from './layer';
import { FADE, bandNoiseGain, rampTo } from './engine';
import type { BuzzParams } from '../state';

// Rough loudness matching between waveforms (square/saw carry more energy than sine).
const WAVE_LEVEL: Record<BuzzParams['wave'], number> = { sine: 0.5, triangle: 0.55, square: 0.3, sawtooth: 0.38 };

interface Source {
  kind: BuzzParams['source'];
  node: AudioScheduledSourceNode;
  gain: GainNode;
  detune: AudioParam;
  osc?: OscillatorNode;
  filter?: BiquadFilterNode;
}

/** Steady tone or narrowband hiss -> amplitude modulation ("buzz") -> out. Not beat-driven. */
export class BuzzLayer extends Layer<BuzzParams> {
  private out: GainNode | null = null;
  private am!: GainNode;
  private mod!: OscillatorNode;
  private modDepth!: GainNode;
  private src: Source | null = null;
  private jitterTimer = 0;

  protected onStart() {
    const ctx = this.ctx;
    this.out = ctx.createGain();
    this.out.connect(this.channel.input);
    this.am = ctx.createGain();
    this.am.connect(this.out);
    this.mod = ctx.createOscillator();
    this.modDepth = ctx.createGain();
    this.mod.connect(this.modDepth).connect(this.am.gain);
    this.mod.start();
    this.buildSource();
    this.onUpdate();
    this.jitterLoop();
  }

  protected onStop() {
    clearTimeout(this.jitterTimer);
    this.mod.stop();
    this.src?.node.stop();
    this.src = null;
    this.out?.disconnect();
    this.out = null;
  }

  /** (Re)build the tone/noise source, crossfading from any previous one. */
  private buildSource() {
    const ctx = this.ctx;
    const p = this.params();
    const old = this.src;
    if (old) {
      rampTo(ctx, old.gain.gain, 0);
      old.node.stop(ctx.currentTime + FADE + 0.01);
      old.node.onended = () => old.gain.disconnect();
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.am);
    rampTo(ctx, gain.gain, 1);

    if (p.source === 'tone') {
      const osc = ctx.createOscillator();
      osc.type = p.wave;
      osc.frequency.value = p.freq;
      osc.connect(gain);
      osc.start();
      this.src = { kind: 'tone', node: osc, gain, detune: osc.detune, osc };
    } else {
      const noise = ctx.createBufferSource();
      noise.buffer = this.engine.noise;
      noise.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = p.freq;
      filter.Q.value = p.noiseQ;
      noise.connect(filter).connect(gain);
      noise.start();
      this.src = { kind: 'noise', node: noise, gain, detune: filter.detune, filter };
    }
  }

  protected onUpdate() {
    if (!this.out || !this.src) return;
    const p = this.params();
    if (p.source !== this.src.kind) this.buildSource();
    const src = this.src;
    const t = this.ctx.currentTime;
    const s = 0.015;

    if (src.osc) {
      if (src.osc.type !== p.wave) src.osc.type = p.wave;
      src.osc.frequency.setTargetAtTime(p.freq, t, s);
    }
    if (src.filter) {
      src.filter.frequency.setTargetAtTime(p.freq, t, s);
      src.filter.Q.setTargetAtTime(p.noiseQ, t, s);
    }
    const level = p.source === 'tone' ? WAVE_LEVEL[p.wave] : 0.35 * bandNoiseGain(p.freq, p.noiseQ, this.ctx.sampleRate);
    this.out.gain.setTargetAtTime(level, t, s);

    // AM: gain swings between (1 - depth) and 1 at amRate.
    const depth = p.amRate < 0.1 ? 0 : p.amDepth / 100;
    this.am.gain.setTargetAtTime(1 - depth / 2, t, s);
    this.modDepth.gain.setTargetAtTime(depth / 2, t, s);
    this.mod.frequency.setTargetAtTime(Math.max(p.amRate, 0.1), t, s);
  }

  /** Random pitch wobble: glide to a new random detune a few times a second. */
  private jitterLoop = () => {
    const p = this.params();
    const period = 1 / Math.max(0.5, p.jitterRate);
    if (this.src) {
      const maxCents = 1200 * Math.log2(1 + p.jitter / 100);
      this.src.detune.setTargetAtTime((Math.random() * 2 - 1) * maxCents, this.ctx.currentTime, period / 3);
    }
    this.jitterTimer = window.setTimeout(this.jitterLoop, period * 1000);
  };
}

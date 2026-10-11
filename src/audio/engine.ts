import type { Ear } from '../state';

/** Fade time for every start/stop, in seconds. */
export const FADE = 0.05;
/** Hard cap on master gain (about -6 dB), whatever the UI asks for. */
const MAX_MASTER = 0.5;
const LOOKAHEAD = 0.12;

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const earToPan = (ear: Ear) => (ear === 'L' ? -1 : ear === 'R' ? 1 : 0);

export function rampTo(ctx: BaseAudioContext, param: AudioParam, value: number, time = FADE) {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + time);
}

/**
 * Gain that brings band-passed white noise to roughly unit RMS, so changing
 * the filter's frequency or Q doesn't make the volume jump.
 */
export function bandNoiseGain(freq: number, q: number, sampleRate: number): number {
  const bandwidth = (1.57 * freq) / q; // equivalent noise bandwidth of a 2nd-order band-pass
  const rms = 0.577 * Math.sqrt(bandwidth / (sampleRate / 2));
  return Math.min(1 / rms, 60);
}

/** Per-layer strip: gain -> on/off gate -> ear panner -> master. */
export class Channel {
  readonly input: GainNode;
  private gate: GainNode;
  private pan: StereoPannerNode;

  constructor(private ctx: AudioContext, dest: AudioNode) {
    this.input = ctx.createGain();
    this.gate = ctx.createGain();
    this.gate.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.input.connect(this.gate).connect(this.pan).connect(dest);
  }

  setGainDb(db: number) {
    this.input.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, 0.02);
  }

  setEar(ear: Ear) {
    this.pan.pan.setTargetAtTime(earToPan(ear), this.ctx.currentTime, 0.02);
  }

  open() {
    rampTo(this.ctx, this.gate.gain, 1);
  }

  close() {
    rampTo(this.ctx, this.gate.gain, 0);
  }
}

/** Called with the time (in AudioContext seconds) to schedule events up to. */
export type Ticker = (until: number) => void;

export class Engine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly noise: AudioBuffer;
  private tickers = new Set<Ticker>();

  constructor() {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;

    // Last line of defence: nothing gets past this ceiling, even transients the compressor misses.
    const clipper = ctx.createWaveShaper();
    clipper.curve = hardClipCurve(0.7);

    this.master.connect(limiter).connect(clipper).connect(ctx.destination);
    this.noise = makeNoise(ctx, 2);

    // Look-ahead scheduler: the timer only decides *what* to schedule; every click
    // and pop is placed on the audio clock. Background tabs throttle timers, so look further ahead there.
    setInterval(() => {
      const until = ctx.currentTime + (document.hidden ? 1.5 : LOOKAHEAD);
      this.tickers.forEach((t) => t(until));
    }, 25);
  }

  resume() {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  /** `db` is relative to the cap: 0 = full (MAX_MASTER), negative = quieter. Never exceeds the cap. */
  setMasterDb(db: number) {
    this.master.gain.setTargetAtTime(Math.min(dbToGain(db), 1) * MAX_MASTER, this.ctx.currentTime, 0.03);
  }

  addTicker(t: Ticker) {
    this.tickers.add(t);
  }

  removeTicker(t: Ticker) {
    this.tickers.delete(t);
  }
}

function hardClipCurve(ceiling: number): Float32Array<ArrayBuffer> {
  const n = 2049;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = clamp((i / (n - 1)) * 2 - 1, -ceiling, ceiling);
  return curve;
}

function makeNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

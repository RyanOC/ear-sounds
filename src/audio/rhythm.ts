import type { Engine } from './engine';
import type { RhythmParams } from '../state';

type BeatListener = (time: number) => void;

/**
 * Shared clock for all layers. Beats are emitted a little ahead of time
 * (within the scheduler's look-ahead) with their exact AudioContext time,
 * so every layer lines up to the sample.
 */
export class Rhythm {
  private running = false;
  private next = Infinity;
  private listeners: BeatListener[] = [];

  constructor(private engine: Engine, private params: () => RhythmParams) {
    // Registered before any layer, so beats are queued before layers schedule.
    engine.addTicker(this.tick);
  }

  onBeat(fn: BeatListener) {
    this.listeners.push(fn);
  }

  /** First beat fires right away. */
  start() {
    this.running = true;
    this.next = this.engine.ctx.currentTime + 0.05;
  }

  stop() {
    this.running = false;
    this.next = Infinity;
  }

  /** Fire a beat now and restart the cycle from here. */
  trigger() {
    const t = this.engine.ctx.currentTime + 0.03;
    this.emit(t);
    const p = this.params();
    this.next = this.running && p.mode !== 'manual' ? t + this.gap(p) : Infinity;
  }

  private gap(p: RhythmParams): number {
    const ms = p.mode === 'loop' ? p.everyMs : p.minMs + Math.random() * Math.max(0, p.maxMs - p.minMs);
    return Math.max(0.05, ms / 1000);
  }

  private emit(t: number) {
    for (const fn of this.listeners) fn(t);
  }

  private tick = (until: number) => {
    if (!this.running) return;
    const p = this.params();
    const now = this.engine.ctx.currentTime;
    if (this.next === Infinity && p.mode !== 'manual') this.next = now + 0.05; // switched out of manual
    if (this.next < now - 0.5) this.next = now; // stalled (hidden tab): don't fire a backlog
    while (this.next < until) {
      this.emit(this.next);
      this.next = p.mode === 'manual' ? Infinity : this.next + this.gap(p);
    }
  };
}

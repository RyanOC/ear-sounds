/** Tap along to a rhythm; reports the average interval between taps. */
export class TapTempo {
  private taps: number[] = [];

  constructor(private onTap: (count: number, intervalSec: number | null) => void) {}

  tap() {
    const now = performance.now();
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && now - last > 4000) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 9) this.taps.shift();
    const n = this.taps.length;
    const interval = n >= 2 ? (this.taps[n - 1] - this.taps[0]) / (n - 1) / 1000 : null;
    this.onTap(n, interval);
  }
}

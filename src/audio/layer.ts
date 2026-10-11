import { Channel, Engine, FADE } from './engine';
import type { LayerCommon } from '../state';

/**
 * A sound layer. The channel gate fades in/out; the layer's nodes are built
 * on start and torn down only after the fade-out has finished.
 */
export abstract class Layer<P extends LayerCommon> {
  readonly channel: Channel;
  protected started = false;
  private active = false;

  constructor(protected engine: Engine, protected params: () => P) {
    this.channel = new Channel(engine.ctx, engine.master);
  }

  protected get ctx() {
    return this.engine.ctx;
  }

  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    if (on) {
      this.applyChannel();
      if (!this.started) {
        this.started = true;
        this.onStart();
      }
      this.channel.open();
    } else {
      this.channel.close();
      setTimeout(() => {
        if (!this.active && this.started) {
          this.started = false;
          this.onStop();
        }
      }, FADE * 1000 + 40);
    }
  }

  update() {
    this.applyChannel();
    if (this.started) this.onUpdate();
  }

  private applyChannel() {
    const p = this.params();
    this.channel.setGainDb(p.gainDb);
    this.channel.setEar(p.ear);
  }

  protected abstract onStart(): void;
  protected abstract onStop(): void;
  protected abstract onUpdate(): void;
}

export type Ear = 'L' | 'R' | 'B';
export type LayerKey = 'buzz' | 'zipper' | 'bubbles';

export interface LayerCommon {
  enabled: boolean;
  gainDb: number;
  ear: Ear;
}

export interface BuzzParams extends LayerCommon {
  source: 'tone' | 'noise';
  wave: 'sine' | 'triangle' | 'square' | 'sawtooth';
  freq: number; // Hz
  noiseQ: number;
  amRate: number; // Hz
  amDepth: number; // %
  jitter: number; // % pitch wobble
  jitterRate: number; // Hz
}

/** The shared clock: each beat starts a zip and (optionally) a bubble burst. */
export interface RhythmParams {
  mode: 'loop' | 'random' | 'manual';
  everyMs: number; // loop: time from one beat to the next
  minMs: number; // random: shortest gap between beats
  maxMs: number; // random: longest gap between beats
}

export interface ZipperParams extends LayerCommon {
  startRate: number; // clicks/s
  endRate: number; // clicks/s
  sweep: number; // s
  curve: 'linear' | 'exponential' | 'easein';
  clickType: 'noise' | 'tick';
  tone: number; // Hz
  q: number;
  clickMs: number;
  randomness: number; // %
}

export interface BubbleParams extends LayerCommon {
  popType: 'bubble' | 'ping' | 'crackle';
  density: number; // pops/s
  pitch: number; // Hz
  spread: number; // octaves either side
  chirp: number; // % pitch rise over a pop
  popMs: number;
  loudVar: number; // %
  cluster: number; // %
  mode: 'continuous' | 'beat';
  offsetMs: number; // beat mode: burst starts this long after the beat
  burstMs: number; // beat mode: burst length
}

export interface SoundState {
  rhythm: RhythmParams;
  buzz: BuzzParams;
  zipper: ZipperParams;
  bubbles: BubbleParams;
}

export const DEFAULT_STATE: SoundState = {
  rhythm: { mode: 'loop', everyMs: 1800, minMs: 1000, maxMs: 4000 },
  buzz: {
    enabled: false, gainDb: 0, ear: 'B',
    source: 'tone', wave: 'sine', freq: 4000, noiseQ: 8,
    amRate: 0, amDepth: 0, jitter: 0.2, jitterRate: 4,
  },
  zipper: {
    enabled: false, gainDb: 0, ear: 'B',
    startRate: 8, endRate: 120, sweep: 1, curve: 'easein',
    clickType: 'noise', tone: 2000, q: 4, clickMs: 2, randomness: 10,
  },
  bubbles: {
    enabled: false, gainDb: 0, ear: 'B',
    popType: 'bubble', density: 40, pitch: 1500, spread: 0.7, chirp: 30,
    popMs: 6, loudVar: 60, cluster: 40,
    mode: 'beat', offsetMs: 0, burstMs: 1000,
  },
};

export function cloneState(s: SoundState): SoundState {
  return JSON.parse(JSON.stringify(s));
}

type Loose = Record<string, unknown>;

/**
 * Fill missing fields from defaults so older saved presets keep loading.
 * Presets saved before the shared rhythm existed had per-layer timing; convert it.
 */
export function mergeState(input: Partial<SoundState>): SoundState {
  const d = cloneState(DEFAULT_STATE);
  const oldZip = (input.zipper ?? {}) as Loose;
  const oldBub = (input.bubbles ?? {}) as Loose;
  const s: SoundState = {
    rhythm: { ...d.rhythm, ...input.rhythm },
    buzz: { ...d.buzz, ...input.buzz },
    zipper: { ...d.zipper, ...input.zipper },
    bubbles: { ...d.bubbles, ...input.bubbles },
  };
  if (!input.rhythm && typeof oldZip.gapMs === 'number') {
    s.rhythm.everyMs = Math.round(s.zipper.sweep * 1000 + oldZip.gapMs);
    if (oldZip.repeat === 'random') {
      s.rhythm.mode = 'random';
      s.rhythm.minMs = Math.round(s.zipper.sweep * 1000 + Number(oldZip.gapMinMs ?? 0));
      s.rhythm.maxMs = Math.round(s.zipper.sweep * 1000 + Number(oldZip.gapMaxMs ?? 0));
    } else if (oldZip.repeat === 'once') {
      s.rhythm.mode = 'manual';
    }
  }
  if (oldBub.mode === 'bursts') s.bubbles.mode = 'beat';
  return s;
}

interface Overrides {
  rhythm?: Partial<RhythmParams>;
  buzz?: Partial<BuzzParams>;
  zipper?: Partial<ZipperParams>;
  bubbles?: Partial<BubbleParams>;
}

function preset(o: Overrides): SoundState {
  const d = cloneState(DEFAULT_STATE);
  return {
    rhythm: { ...d.rhythm, ...o.rhythm },
    buzz: { ...d.buzz, ...o.buzz },
    zipper: { ...d.zipper, ...o.zipper },
    bubbles: { ...d.bubbles, ...o.bubbles },
  };
}

// Everything starts off; each starter sound switches on just what it uses.
const ON = { enabled: true } as const;

export const PRESETS: Record<string, SoundState> = {
  'Zipper + bubbles': preset({ zipper: ON, bubbles: ON }),
  'Bubbles after zip': preset({ zipper: ON, bubbles: { ...ON, offsetMs: 1000, burstMs: 600 } }),
  'Zipper only': preset({ zipper: ON }),
  'Bubbles only (continuous)': preset({ bubbles: { ...ON, mode: 'continuous' } }),
  Ringing: preset({ buzz: ON }),
  'Buzzing tone': preset({
    buzz: { ...ON, wave: 'square', freq: 1200, amRate: 110, amDepth: 70, jitter: 0.3, jitterRate: 6 },
  }),
};

const STORAGE_KEY = 'ear-sounds:presets';

export function loadUserPresets(): Record<string, SoundState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveUserPresets(presets: Record<string, SoundState>): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}

export function fmtTime(sec: number): string {
  if (sec >= 1) return `${sec.toFixed(2)} s`;
  const ms = sec * 1000;
  return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
}

const earName = (e: Ear) => (e === 'L' ? 'left ear' : e === 'R' ? 'right ear' : 'both ears');
const curveName = { linear: 'steady', exponential: 'exponential', easein: 'slow start, then fast' };

/** Plain-text description of the current sound, for doctors. */
export function summarize(s: SoundState): string {
  const out: string[] = [];
  const r = s.rhythm;
  if (r.mode === 'loop') out.push(`RHYTHM: repeats every ${(r.everyMs / 1000).toFixed(2)} s`);
  else if (r.mode === 'random') out.push(`RHYTHM: repeats at random, ${(r.minMs / 1000).toFixed(1)}–${(r.maxMs / 1000).toFixed(1)} s apart`);
  else out.push('RHYTHM: single events');

  const b = s.buzz;
  if (b.enabled) {
    out.push(`TONE / RINGING (${earName(b.ear)})`);
    out.push(`  Pitch: ${Math.round(b.freq)} Hz, ${b.source === 'tone' ? `${b.wave} wave` : `narrow hiss (Q ${b.noiseQ})`}`);
    if (b.amRate >= 0.1 && b.amDepth > 0) out.push(`  Buzz/flutter: ${b.amRate} Hz at ${b.amDepth}% depth`);
    if (b.jitter > 0) out.push(`  Pitch wobble: ±${b.jitter}% at ${b.jitterRate} Hz`);
  }
  const z = s.zipper;
  if (z.enabled) {
    out.push(`BUZZING / ZIPPER (${earName(z.ear)})`);
    out.push(`  Click rate: ${z.startRate} → ${z.endRate} clicks/s over ${z.sweep} s (${curveName[z.curve]})`);
    out.push(`  Time between clicks: ${fmtTime(1 / z.startRate)} → ${fmtTime(1 / z.endRate)}`);
    out.push(`  Click: ~${Math.round(z.tone)} Hz, ${z.clickMs} ms long, ${z.randomness}% timing randomness`);
  }
  const p = s.bubbles;
  if (p.enabled) {
    out.push(`BUBBLES / CRACKLE (${earName(p.ear)})`);
    out.push(`  About ${p.density} pops/s (average ${fmtTime(1 / p.density)} apart), ${p.cluster}% clustered`);
    out.push(`  Pop pitch: ~${Math.round(p.pitch)} Hz ± ${p.spread} octave, ${p.popMs} ms pops (${p.popType})`);
    if (p.mode === 'continuous') out.push('  Continuous');
    else {
      const when = z.enabled ? 'after the zip starts' : 'after each beat';
      out.push(`  Bursts of ${fmtTime(p.burstMs / 1000)}, starting ${fmtTime(p.offsetMs / 1000)} ${when}`);
    }
  }
  if (!b.enabled && !z.enabled && !p.enabled) out.push('No layers turned on.');
  return out.join('\n');
}

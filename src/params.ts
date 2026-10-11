import { DEFAULT_STATE, mergeState, type SoundState } from './state';

/**
 * Allowed values for every setting. The sliders read their ranges from here,
 * and anything loaded from outside (share links, saved presets) is clamped to them.
 */

export type Section = keyof SoundState;
type Range = readonly [min: number, max: number];

const GAIN: Range = [-40, 0];
const EARS = ['L', 'B', 'R'] as const;

export const RANGES: { [S in Section]: Partial<Record<keyof SoundState[S], Range>> } = {
  rhythm: { everyMs: [200, 10000], minMs: [200, 20000], maxMs: [200, 20000] },
  buzz: {
    gainDb: GAIN, freq: [100, 16000], noiseQ: [0.5, 60], amRate: [0, 300], amDepth: [0, 100],
    jitter: [0, 2], jitterRate: [0.5, 30],
  },
  zipper: {
    gainDb: GAIN, startRate: [1, 100], endRate: [1, 1000], sweep: [0.05, 5], tone: [200, 12000],
    q: [0.5, 30], clickMs: [0.3, 10], randomness: [0, 50],
  },
  bubbles: {
    gainDb: GAIN, density: [1, 1000], pitch: [100, 8000], spread: [0, 2], chirp: [0, 200], popMs: [0.5, 30],
    loudVar: [0, 100], cluster: [0, 95], offsetMs: [0, 5000], burstMs: [10, 5000],
  },
};

const ENUMS: { [S in Section]: Partial<Record<keyof SoundState[S], readonly string[]>> } = {
  rhythm: { mode: ['loop', 'random', 'manual'] },
  buzz: { ear: EARS, source: ['tone', 'noise'], wave: ['sine', 'triangle', 'square', 'sawtooth'] },
  zipper: { ear: EARS, curve: ['linear', 'exponential', 'easein'], clickType: ['noise', 'tick'] },
  bubbles: { ear: EARS, popType: ['bubble', 'ping', 'crackle'], mode: ['continuous', 'beat'] },
};

const SECTIONS = Object.keys(DEFAULT_STATE) as Section[];

export function rangeOf(section: Section, key: string): Range {
  const r = (RANGES[section] as Record<string, Range | undefined>)[key];
  if (!r) throw new Error(`No range defined for ${section}.${key}`);
  return r;
}

/** Clamp a value into a setting's allowed range. */
export function clampTo(section: Section, key: string, v: number): number {
  const [min, max] = rangeOf(section, key);
  return Math.min(max, Math.max(min, v));
}

/**
 * Turn untrusted input (a decoded link, a stored preset) into a valid state:
 * missing or bad values fall back to defaults, numbers are clamped, unknown keys dropped.
 */
export function sanitizeState(input: unknown): SoundState {
  const raw = input && typeof input === 'object' ? (input as Partial<SoundState>) : {};
  const s = mergeState(raw);
  for (const section of SECTIONS) {
    const out = s[section] as unknown as Record<string, unknown>;
    const def = DEFAULT_STATE[section] as unknown as Record<string, unknown>;
    const ranges = RANGES[section] as Record<string, Range | undefined>;
    const enums = ENUMS[section] as Record<string, readonly string[] | undefined>;
    for (const key of Object.keys(out)) if (!(key in def)) delete out[key];
    for (const key of Object.keys(def)) {
      const v = out[key];
      const range = ranges[key];
      const options = enums[key];
      if (range) out[key] = typeof v === 'number' && Number.isFinite(v) ? Math.min(range[1], Math.max(range[0], v)) : def[key];
      else if (options) out[key] = typeof v === 'string' && options.includes(v) ? v : def[key];
      else if (typeof def[key] === 'boolean') out[key] = typeof v === 'boolean' ? v : def[key];
      else if (typeof def[key] === 'number') out[key] = typeof v === 'number' && Number.isFinite(v) ? v : def[key];
      else out[key] = def[key];
    }
  }
  return s;
}

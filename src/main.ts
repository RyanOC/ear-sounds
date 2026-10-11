import './style.css';
import { Engine, dbToGain } from './audio/engine';
import { Rhythm } from './audio/rhythm';
import { BuzzLayer } from './audio/buzz';
import { ZipperLayer } from './audio/zipper';
import { BubbleLayer } from './audio/bubbles';
import { PitchFinder } from './pitch';
import { TapTempo } from './tap';
import {
  DEFAULT_STATE, PRESETS, cloneState, fmtTime, loadUserPresets, saveUserPresets, summarize,
  type Ear, type LayerKey, type SoundState,
} from './state';
import { clampTo, rangeOf, sanitizeState, type Section } from './params';
import { MAX_NAME, cleanName, codeFromUrl, decodeState, encodeState, urlFor, writeUrl } from './share';
import { button, choiceControl, collapsible, el, liveText, numControl, onRefresh, refreshAll, showIf, type NumDef } from './ui';

// ---------- state & audio ----------

let state: SoundState = cloneState(DEFAULT_STATE);
// Master volume is shown relative to the safety cap: 0 dB = full, -60 dB = nearly silent.
const MASTER_KEY = 'ear-sounds:masterVol';
const OLD_MASTER_KEY = 'ear-sounds:masterDb'; // older builds stored the absolute level, where full was -6
const MASTER_MIN = -60;
const MASTER_MAX = 0;

/** Last-used master volume, or full if none saved (or storage is unavailable). */
function loadMasterDb(): number {
  try {
    let raw = localStorage.getItem(MASTER_KEY);
    const old = localStorage.getItem(OLD_MASTER_KEY);
    if (raw === null && old !== null) {
      raw = String(Number(old) + 6); // carry an old setting over, same loudness
      localStorage.setItem(MASTER_KEY, raw);
    }
    if (old !== null) localStorage.removeItem(OLD_MASTER_KEY);
    const v = Number(raw);
    if (raw !== null && Number.isFinite(v)) return Math.min(MASTER_MAX, Math.max(MASTER_MIN, v));
  } catch {
    // fall through to default
  }
  return MASTER_MAX;
}

let masterDb = loadMasterDb();
let engine: Engine | null = null;
let rhythm: Rhythm | null = null;
let layers: { buzz: BuzzLayer; zipper: ZipperLayer; bubbles: BubbleLayer } | null = null;
let playing = false;
const LAYER_KEYS: LayerKey[] = ['buzz', 'zipper', 'bubbles'];

/** Creates the AudioContext on first use (must happen inside a click). */
function audio(): Engine {
  if (!engine) {
    engine = new Engine();
    engine.setMasterDb(masterDb);
    rhythm = new Rhythm(engine, () => state.rhythm);
    layers = {
      buzz: new BuzzLayer(engine, () => state.buzz),
      zipper: new ZipperLayer(engine, () => state.zipper),
      bubbles: new BubbleLayer(engine, () => state.bubbles),
    };
    rhythm.onBeat(layers.zipper.beat);
    rhythm.onBeat(layers.bubbles.beat);
  }
  engine.resume();
  return engine;
}

function applyAudibility() {
  if (!layers) return;
  for (const k of LAYER_KEYS) {
    const p = state[k];
    layers[k].setActive(playing && p.enabled);
  }
}

/** At least one sound is switched on (Play needs something to play). */
const anyOn = () => LAYER_KEYS.some((k) => state[k].enabled);

function changed(layer?: LayerKey) {
  if (layers) {
    if (layer) layers[layer].update();
    else LAYER_KEYS.forEach((k) => layers![k].update());
  }
  if (playing && !anyOn()) {
    // Last sound switched off: stop, so Play doesn't sit "on" with nothing playing.
    playing = false;
    rhythm?.stop();
  }
  applyAudibility();
  refreshAll();
  scheduleUrlUpdate();
}

// Keep the address bar in sync with the sound, so the URL is always a share link.
let urlTimer = 0;
const LAST_CODE_KEY = 'ear-sounds:lastCode'; // sessionStorage: per tab, survives reload
function scheduleUrlUpdate() {
  clearTimeout(urlTimer);
  urlTimer = window.setTimeout(async () => {
    const code = await encodeState(state, soundName);
    writeUrl(code);
    try {
      sessionStorage.setItem(LAST_CODE_KEY, code);
    } catch {
      // without it, a reload just shows the "loaded" banner
    }
  }, 300);
}

function lastWrittenCode(): string | null {
  try {
    return sessionStorage.getItem(LAST_CODE_KEY);
  } catch {
    return null;
  }
}

function play() {
  if (!anyOn()) return;
  pitch.stop();
  audio();
  playing = true;
  applyAudibility(); // start layers before the first beat so they catch it
  rhythm!.start();
  refreshAll();
}

function stop() {
  playing = false;
  rhythm?.stop();
  applyAudibility();
  refreshAll();
}

function stopAll() {
  stop();
  pitch.stop();
}

// ---------- control helpers bound to state ----------

const bag = (s: Section) => state[s] as unknown as Record<string, unknown>;

/** Slider bound to a setting; its min/max come from the shared range table. */
function num<S extends Section>(section: S, key: keyof SoundState[S] & string, def: Omit<NumDef, 'min' | 'max'>) {
  const [min, max] = rangeOf(section, key);
  return numControl({ ...def, min, max }, () => bag(section)[key] as number, (v) => {
    bag(section)[key] = v;
    changed(section === 'rhythm' ? undefined : section);
  });
}

function choice<S extends Section>(section: S, key: keyof SoundState[S] & string, label: string, opts: [string, string][]) {
  return choiceControl(label, opts, () => String(bag(section)[key]), (v) => {
    bag(section)[key] = v;
    changed(section === 'rhythm' ? undefined : section);
  });
}

const EAR_OPTS: [Ear, string][] = [['L', 'Left'], ['B', 'Both'], ['R', 'Right']];

function layerCard(key: LayerKey, title: string, blurb: string, ...body: Node[]) {
  // A sliding switch, so the state is unambiguous (not "click to turn off?").
  const switchLabel = el('span', { class: 'switch-label' });
  const onBtn = button('', () => {
    state[key].enabled = !state[key].enabled;
    changed(key);
  }, 'switch');
  onBtn.setAttribute('role', 'switch');
  onBtn.setAttribute('aria-label', `${title} sound`);
  onBtn.append(el('span', { class: 'track' }, el('span', { class: 'knob' })), switchLabel);
  const card = el(
    'section',
    { class: 'card layer' },
    el('header', {}, el('div', {}, el('h2', {}, title), el('p', { class: 'blurb' }, blurb)), el('div', { class: 'btns' }, onBtn)),
    el('div', { class: 'row2' },
      num(key, 'gainDb', { label: 'Layer volume', step: 0.5, unit: 'dB' }),
      choice(key, 'ear', 'Ear', EAR_OPTS),
    ),
    ...body,
  );
  onRefresh(() => {
    const p = state[key];
    switchLabel.textContent = p.enabled ? 'On' : 'Off';
    onBtn.classList.toggle('checked', p.enabled);
    onBtn.setAttribute('aria-checked', String(p.enabled));
    card.classList.toggle('off', !p.enabled);
  });
  return card;
}

// ---------- rhythm (shared timing) ----------

const tapBtn = button('Tap the rhythm', () => tap.tap(), 'tap');
const tap = new TapTempo((count, iv) => {
  tapBtn.textContent = iv ? `Tap (${count}) — every ${iv.toFixed(2)} s` : 'Keep tapping…';
  if (!iv) return;
  state.rhythm.mode = 'loop';
  state.rhythm.everyMs = Math.round(iv * 1000);
  changed();
});

const triggerBtn = button('Trigger now', () => {
  if (!playing) play();
  else rhythm?.trigger();
}, 'primary');
onRefresh(() => {
  triggerBtn.disabled = !anyOn();
});

/** One cycle drawn to scale: where the zip and the bubble burst sit. */
function timeline(): HTMLElement {
  const zipBar = el('div', { class: 'bar zip' }, 'zip');
  const bubBar = el('div', { class: 'bar bub' }, 'bubbles');
  const toneBar = el('div', { class: 'bar tone continuous' });
  const toneLane = el('div', { class: 'lane' }, toneBar);
  const endLabel = el('span', {});
  const track = el('div', { class: 'track' },
    el('div', { class: 'lane' }, zipBar),
    el('div', { class: 'lane' }, bubBar),
    toneLane,
  );
  onRefresh(() => {
    const { rhythm: r, zipper: z, bubbles: b } = state;
    const zipMs = z.sweep * 1000;
    const bubEnd = b.offsetMs + b.burstMs;
    const span = r.mode === 'loop' ? r.everyMs : Math.max(zipMs, bubEnd) * 1.15;
    const pct = (ms: number) => `${Math.min(100, (ms / span) * 100)}%`;
    zipBar.style.left = '0';
    zipBar.style.width = pct(zipMs);
    zipBar.hidden = !z.enabled;
    if (b.mode === 'continuous') {
      bubBar.style.left = '0';
      bubBar.style.width = '100%';
    } else {
      bubBar.style.left = pct(b.offsetMs);
      bubBar.style.width = `calc(${pct(bubEnd)} - ${pct(b.offsetMs)})`;
    }
    bubBar.hidden = !b.enabled;
    bubBar.classList.toggle('continuous', b.mode === 'continuous');
    bubBar.textContent = b.mode === 'continuous' ? 'bubbles (continuous)' : 'bubbles';
    // The tone isn't beat-driven: it plays the whole time.
    const t = state.buzz;
    toneLane.hidden = !t.enabled;
    toneBar.style.left = '0';
    toneBar.style.width = '100%';
    toneBar.textContent = `tone ${Math.round(t.freq)} Hz (continuous)`;
    endLabel.textContent = r.mode === 'loop' ? `${(span / 1000).toFixed(2)} s — next beat` : `${(span / 1000).toFixed(2)} s`;
  });
  return el('div', { class: 'timeline' }, track, el('div', { class: 'scale' }, el('span', {}, 'beat'), endLabel));
}

const rhythmCard = el(
  'section',
  { class: 'card rhythm' },
  el('header', {}, el('div', {}, el('h2', {}, 'Rhythm'), el('p', { class: 'blurb' }, 'One clock for both sounds. Each beat starts a zip and a bubble burst.'))),
  choice('rhythm', 'mode', 'Beats', [['loop', 'Steady'], ['random', 'Random gaps'], ['manual', 'Only when I trigger']]),
  showIf(num('rhythm', 'everyMs', { label: 'Repeat every', step: 10, unit: 'ms', log: true, fine: 10 }),
    () => state.rhythm.mode === 'loop'),
  showIf(el('div', { class: 'row2' },
    num('rhythm', 'minMs', { label: 'Shortest gap', step: 10, unit: 'ms', log: true }),
    num('rhythm', 'maxMs', { label: 'Longest gap', step: 10, unit: 'ms', log: true }),
  ), () => state.rhythm.mode === 'random'),
  timeline(),
  showIf(el('p', { class: 'warn-text' }, 'The zip is longer than the beat, so each zip gets cut off by the next one.'),
    () => state.rhythm.mode === 'loop' && state.zipper.enabled && state.zipper.sweep * 1000 > state.rhythm.everyMs),
  el('div', { class: 'actions' }, triggerBtn, tapBtn),
  el('p', { class: 'hint' }, 'Tap along with how often the sound repeats. "Trigger now" restarts the cycle from that moment.'),
);

// ---------- layer cards ----------

const zipperCard = layerCard(
  'zipper', 'Buzzing / Zipper', 'A train of clicks that speeds up. One zip per beat.',
  el('div', { class: 'row2' },
    num('zipper', 'startRate', { label: 'Start rate', step: 0.5, unit: 'clicks/s', log: true, fine: 0.5 }),
    num('zipper', 'endRate', { label: 'End rate', step: 1, unit: 'clicks/s', log: true, fine: 1 }),
  ),
  num('zipper', 'sweep', { label: 'Zip duration', step: 0.01, unit: 's', log: true }),
  choice('zipper', 'curve', 'Speed-up shape', [['easein', 'Slow, then fast'], ['exponential', 'Exponential'], ['linear', 'Even']]),
  liveText(() => {
    const z = state.zipper;
    return `Clicks start ${fmtTime(1 / z.startRate)} apart and end ${fmtTime(1 / z.endRate)} apart.`;
  }),
  choice('zipper', 'clickType', 'Click sound', [['noise', 'Noisy click'], ['tick', 'Tonal tick']]),
  num('zipper', 'tone', { label: 'Click pitch', step: 1, unit: 'Hz', log: true, fine: 1 }),
  showIf(num('zipper', 'q', { label: 'Click sharpness (Q)', step: 0.1, unit: 'Q', log: true }),
    () => state.zipper.clickType === 'noise'),
  num('zipper', 'clickMs', { label: 'Click length', step: 0.1, unit: 'ms' }),
  num('zipper', 'randomness', { label: 'Timing randomness', step: 1, unit: '%' }),
);

const bubbleCard = layerCard(
  'bubbles', 'Bubbles / crackle', 'Tiny pops at irregular times. Try each pop type.',
  choice('bubbles', 'mode', 'Timing', [['beat', 'Burst on each beat'], ['continuous', 'Continuous']]),
  showIf(el('div', {},
    el('div', { class: 'row2' },
      num('bubbles', 'offsetMs', { label: 'Start after beat', step: 10, unit: 'ms', fine: 10 }),
      num('bubbles', 'burstMs', { label: 'Burst length', step: 10, unit: 'ms', log: true, fine: 10 }),
    ),
    el('div', { class: 'actions' },
      button('Start with the zip', () => {
        state.bubbles.offsetMs = 0;
        changed('bubbles');
      }),
      button('Start when zip ends', () => {
        state.bubbles.offsetMs = Math.round(state.zipper.sweep * 1000);
        changed('bubbles');
      }),
      button('Same length as zip', () => {
        state.bubbles.burstMs = Math.round(state.zipper.sweep * 1000);
        changed('bubbles');
      }),
    ),
  ), () => state.bubbles.mode === 'beat'),
  choice('bubbles', 'popType', 'Pop type', [['bubble', 'Bubble'], ['ping', 'Ping'], ['crackle', 'Crackle']]),
  num('bubbles', 'density', { label: 'Pops per second', step: 1, unit: 'pops/s', log: true, fine: 1 }),
  liveText(() => `On average ${fmtTime(1 / state.bubbles.density)} between pops.`),
  num('bubbles', 'pitch', { label: 'Pop pitch', step: 1, unit: 'Hz', log: true, fine: 1 }),
  num('bubbles', 'spread', { label: 'Pitch variety', step: 0.05, unit: 'oct' }),
  showIf(num('bubbles', 'chirp', { label: 'Pitch rise per pop', step: 1, unit: '%' }),
    () => state.bubbles.popType === 'bubble'),
  num('bubbles', 'popMs', { label: 'Pop length', step: 0.5, unit: 'ms' }),
  num('bubbles', 'loudVar', { label: 'Loudness variety', step: 1, unit: '%' }),
  num('bubbles', 'cluster', { label: 'Clumping (pops arrive in clusters)', step: 1, unit: '%' }),
);

const buzzCard = layerCard(
  'buzz', 'Tone / ringing', 'A steady ringing tone or hiss, optionally with a buzzy flutter. Plays continuously, not on the beat.',
  choice('buzz', 'source', 'Sound', [['tone', 'Tone'], ['noise', 'Hiss (narrow noise)']]),
  showIf(choice('buzz', 'wave', 'Waveform', [['sine', 'Sine'], ['triangle', 'Triangle'], ['square', 'Square'], ['sawtooth', 'Saw']]),
    () => state.buzz.source === 'tone'),
  num('buzz', 'freq', { label: 'Pitch', step: 1, unit: 'Hz', log: true, fine: 1 }),
  showIf(num('buzz', 'noiseQ', { label: 'Hiss narrowness (higher = more tone-like)', step: 0.5, unit: 'Q', log: true }),
    () => state.buzz.source === 'noise'),
  num('buzz', 'amRate', { label: 'Buzz rate (flutter speed)', step: 0.5, unit: 'Hz', fine: 0.5 }),
  num('buzz', 'amDepth', { label: 'Buzz depth', step: 1, unit: '%' }),
  num('buzz', 'jitter', { label: 'Pitch wobble', step: 0.05, unit: '%' }),
  num('buzz', 'jitterRate', { label: 'Wobble speed', step: 0.5, unit: 'Hz' }),
  el('p', { class: 'hint' }, 'Not sure of the pitch? Use the Pitch finder below. Waveforms sound alike above ~6 kHz, and many speakers and earbuds fade out above ~16 kHz.'),
);

// ---------- pitch finder ----------

const pitchOpts = { source: 'tone', ear: 'B' as Ear, levelDb: 0, lo: 200, hi: 12000 };
const pitchDyn = el('div', { class: 'pitch-dyn' });

const pitch = new PitchFinder(
  () => audio(),
  () => ({
    source: pitchOpts.source === 'noise' ? 'noise' : 'tone',
    ear: pitchOpts.ear,
    q: state.buzz.noiseQ,
    level: dbToGain(pitchOpts.levelDb),
  }),
  () => renderPitch(),
);

/** The pitch finder plays on its own, so pause the layers first. */
function pitchAction(fn: () => void) {
  return () => {
    if (playing) stop();
    fn();
  };
}

function renderPitch() {
  const p = pitch;
  pitchDyn.replaceChildren();
  if (p.phase === 'idle') {
    pitchDyn.append(el('p', { class: 'info' },
      'Press Start. You will hear tone A, then tone B. Pick the one closer to the pitch you hear. ' +
      'Each answer halves the search range; it takes about 7 rounds, then an octave check.'));
    return;
  }

  const pick = (labels: string[]) =>
    el('div', { class: 'choices' }, ...labels.map((label, i) => {
      const b = button(label, pitchAction(() => p.choose(i)), 'choice');
      b.classList.toggle('playing', p.playing === i);
      return b;
    }));

  if (p.phase === 'search') {
    pitchDyn.append(
      el('p', { class: 'status' }, `Round ${p.step + 1}: which is closer to what you hear?`),
      pick(['A is closer', 'B is closer']),
      el('p', { class: 'hint' }, `Searching ${Math.round(p.lo)}–${Math.round(p.hi)} Hz.`),
    );
  } else if (p.phase === 'octave') {
    pitchDyn.append(
      el('p', { class: 'status' }, 'Octave check: tones an octave apart can sound alike. Which one matches?'),
      pick(['Lower', 'Middle', 'Higher']),
    );
  } else {
    const hz = Math.round(p.best);
    const useFor = (layer: LayerKey, label: string) =>
      button(label, () => {
        if (layer === 'buzz') state.buzz.freq = clampTo('buzz', 'freq', hz);
        if (layer === 'zipper') state.zipper.tone = clampTo('zipper', 'tone', hz);
        if (layer === 'bubbles') state.bubbles.pitch = clampTo('bubbles', 'pitch', hz);
        state[layer].enabled = true;
        changed(layer);
      });
    pitchDyn.append(
      el('p', { class: 'result' }, `Your match: ${hz} Hz`),
      el('div', { class: 'actions' },
        button('Play it', pitchAction(() => p.replay()), p.playing === 0 ? 'playing' : ''),
        button('−1%', pitchAction(() => p.nudge(1 / 1.01))),
        button('+1%', pitchAction(() => p.nudge(1.01))),
      ),
      el('div', { class: 'actions' },
        useFor('buzz', 'Use for tone'),
        useFor('bubbles', 'Use for bubble pitch'),
        useFor('zipper', 'Use for click pitch'),
      ),
    );
  }

  pitchDyn.append(el('div', { class: 'actions' },
    button(p.phase === 'done' ? 'Replay' : 'Replay tones', pitchAction(() => p.replay())),
    Object.assign(button('Undo', pitchAction(() => p.undo())), { disabled: !p.canUndo }),
    button('Start over', () => p.reset()),
  ));
}

const pitchCard = el(
  'section',
  { class: 'card' },
  el('header', {}, el('div', {}, el('h2', {}, 'Pitch finder'), el('p', { class: 'blurb' }, 'Narrow in on a ringing pitch by comparing pairs of tones.'))),
  numControl({ label: 'Search from', min: 50, max: 16000, step: 1, unit: 'Hz', log: true }, () => pitchOpts.lo, (v) => { pitchOpts.lo = v; }),
  numControl({ label: 'Search to', min: 50, max: 16000, step: 1, unit: 'Hz', log: true }, () => pitchOpts.hi, (v) => { pitchOpts.hi = v; }),
  choiceControl('Test sound', [['tone', 'Tone'], ['noise', 'Hiss']], () => pitchOpts.source, (v) => { pitchOpts.source = v; refreshAll(); }),
  choiceControl('Ear', EAR_OPTS, () => pitchOpts.ear, (v) => { pitchOpts.ear = v as Ear; refreshAll(); }),
  numControl({ label: 'Test tone volume', min: -40, max: 0, step: 0.5, unit: 'dB' }, () => pitchOpts.levelDb, (v) => { pitchOpts.levelDb = v; }),
  el('div', { class: 'actions' }, button('Start', pitchAction(() => pitch.start(pitchOpts.lo, pitchOpts.hi)), 'primary')),
  pitchDyn,
);

// ---------- summary ----------

const summaryMsg = el('p', { class: 'hint' });

const summaryCard = el(
  'section',
  { class: 'card' },
  el('header', {}, el('div', {}, el('h2', {}, 'Summary for your doctor'), el('p', { class: 'blurb' }, 'The numbers behind the sound you have built.'))),
  liveText(() => summarize(state), 'pre', 'summary'),
  el('div', { class: 'actions' },
    button('Copy text', async () => {
      try {
        await navigator.clipboard.writeText(summarize(state));
        summaryMsg.textContent = 'Summary copied.';
      } catch {
        summaryMsg.textContent = 'Could not copy. Select the text and copy it by hand.';
      }
    }),
  ),
  summaryMsg,
);

// ---------- your sound: name, save, load, share, reset ----------

const userPresets = loadUserPresets();
const soundMsg = el('p', { class: 'hint share-msg', role: 'status' });
function flash(msg: string) {
  soundMsg.textContent = msg;
}

/** The current sound's name. Empty until the user types one, loads a saved sound, or opens a named link. */
let soundName = '';

const nameInput = el('input', {
  type: 'text', maxlength: String(MAX_NAME), placeholder: 'Type a name for this sound', 'aria-label': 'Sound name', class: 'name-input',
});
nameInput.addEventListener('input', () => {
  soundName = nameInput.value;
  scheduleUrlUpdate();
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') save();
});

function setName(name: string) {
  soundName = name;
  nameInput.value = name;
}

const presetSel = el('select', { 'aria-label': 'Saved sounds' });
const loadBtn = button('Load', () => {
  const p = selectedPreset();
  if (!p) return;
  state = sanitizeState(cloneState(p.data));
  // A saved sound keeps its name; a starter leaves the name for the user to fill in.
  setName(p.builtIn ? '' : p.name);
  changed();
  flash(`Loaded "${p.name}".`);
});
const renameBtn = button('Rename', () => openRename());
const deleteBtn = button('Delete', () => {
  const p = selectedPreset();
  if (!p || p.builtIn) return;
  if (!confirm(`Delete your saved sound "${p.name}"? This cannot be undone.`)) return;
  delete userPresets[p.name];
  saveUserPresets(userPresets);
  fillPresets();
  refreshAll();
  flash(`Deleted "${p.name}".`);
});

function fillPresets(select?: string) {
  const group = (label: string, prefix: string, names: string[]) =>
    el('optgroup', { label }, ...names.map((n) => el('option', { value: prefix + n }, n)));
  const previous = presetSel.value;
  presetSel.replaceChildren(el('option', { value: '', disabled: '', selected: '' }, 'Choose a sound…'));
  const mine = Object.keys(userPresets);
  if (mine.length) presetSel.append(group('My saved sounds', 'u:', mine));
  presetSel.append(group('Starter sounds', 'b:', Object.keys(PRESETS)));
  // Nothing is chosen until the user picks one; keep a still-valid previous choice.
  if (select && userPresets[select]) presetSel.value = 'u:' + select;
  else if (previous && [...presetSel.options].some((o) => o.value === previous)) presetSel.value = previous;
  else presetSel.value = '';
  syncPresetButtons();
}

function selectedPreset(): { name: string; builtIn: boolean; data: SoundState } | null {
  const v = presetSel.value;
  const name = v.slice(2);
  const data = v.startsWith('b:') ? PRESETS[name] : userPresets[name];
  return data ? { name, builtIn: v.startsWith('b:'), data } : null;
}

/** Load needs a choice; starter sounds can be loaded but not renamed or deleted. */
function syncPresetButtons() {
  const p = selectedPreset();
  loadBtn.disabled = !p;
  const builtIn = p?.builtIn ?? true;
  renameBtn.disabled = builtIn;
  deleteBtn.disabled = builtIn;
}
presetSel.addEventListener('change', () => {
  closeRename();
  syncPresetButtons();
});

function save() {
  const name = cleanName(nameInput.value);
  if (!name) {
    nameInput.focus();
    return flash('Type a name for this sound first.');
  }
  if (PRESETS[name]) return flash('That name belongs to a starter sound. Pick another name.');
  if (userPresets[name] && !confirm(`Replace your saved sound "${name}" with the current settings?`)) return;
  userPresets[name] = cloneState(state);
  const ok = saveUserPresets(userPresets);
  setName(name);
  fillPresets(name);
  scheduleUrlUpdate();
  flash(ok ? `Saved "${name}" in this browser.` : 'Saved for this visit only (browser storage is unavailable).');
}

// Inline rename for a saved sound.
const renameInput = el('input', { type: 'text', maxlength: String(MAX_NAME), 'aria-label': 'New name' });
const renameRow = el('div', { class: 'ctl-row rename-row' }, renameInput,
  button('Save name', () => doRename(), 'primary'),
  button('Cancel', () => closeRename()),
);
renameRow.hidden = true;
renameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doRename();
});

function openRename() {
  const p = selectedPreset();
  if (!p || p.builtIn) return;
  renameInput.value = p.name;
  renameRow.hidden = false;
  renameInput.focus();
  renameInput.select();
}

function closeRename() {
  renameRow.hidden = true;
}

function doRename() {
  const p = selectedPreset();
  if (!p || p.builtIn) return closeRename();
  const to = cleanName(renameInput.value);
  if (!to) return flash('Type a name first.');
  if (to === p.name) return closeRename();
  if (PRESETS[to]) return flash('That name belongs to a starter sound. Pick another name.');
  if (userPresets[to]) return flash(`You already have a saved sound called "${to}".`);
  // Rebuild to keep the list order, with the renamed entry in place.
  const entries = Object.entries(userPresets).map(([k, v]) => [k === p.name ? to : k, v] as const);
  for (const k of Object.keys(userPresets)) delete userPresets[k];
  for (const [k, v] of entries) userPresets[k] = v;
  saveUserPresets(userPresets);
  if (soundName === p.name) setName(to);
  fillPresets(to);
  closeRename();
  scheduleUrlUpdate();
  flash(`Renamed "${p.name}" to "${to}".`);
}

// ---------- reset everything (destructive, typed confirmation) ----------

const RESET_WORD = 'RESET';
const resetInput = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': `Type ${RESET_WORD} to confirm` });
const resetConfirm = button('Reset everything', () => resetEverything(), 'danger');
const resetCount = el('li', {});
const resetDialog = el('dialog', { class: 'confirm-dialog', 'aria-labelledby': 'reset-title' },
  el('h2', { id: 'reset-title' }, 'Reset everything?'),
  el('p', {}, 'This clears all of your data from this browser and starts over as if you had never used the app:'),
  el('ul', {},
    resetCount,
    el('li', {}, 'Your current settings (back to the defaults)'),
    el('li', {}, 'Your master volume and collapsed cards'),
  ),
  el('p', { class: 'danger-text' }, el('strong', {}, 'This cannot be undone.'), ' Share links you have already sent will keep working.'),
  el('label', {}, 'To confirm, type ', el('code', {}, RESET_WORD), ' below:'),
  resetInput,
  el('div', { class: 'actions' }, button('Cancel', () => resetDialog.close()), resetConfirm),
);
resetInput.addEventListener('input', () => {
  resetConfirm.disabled = resetInput.value.trim() !== RESET_WORD;
});
resetInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !resetConfirm.disabled) resetEverything();
});

function openReset() {
  const n = Object.keys(userPresets).length;
  resetCount.textContent = n ? `Your ${n} saved sound${n === 1 ? '' : 's'}` : 'Your saved sounds (you have none right now)';
  resetInput.value = '';
  resetConfirm.disabled = true;
  resetDialog.showModal();
  resetInput.focus();
}

function resetEverything() {
  if (resetInput.value.trim() !== RESET_WORD) return;
  stopAll();
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('ear-sounds:')) localStorage.removeItem(key);
  } catch {
    // storage unavailable: nothing was saved, so nothing to clear
  }
  // Drop any share link from the URL, then start fresh.
  history.replaceState(null, '', location.pathname + location.search);
  location.reload();
}

const soundBar = el(
  'section',
  { class: 'card soundbar' },
  el('header', {}, el('div', {}, el('h2', {}, 'Your sound'), el('p', { class: 'blurb' }, 'Name it, save it in this browser, or share it as a link.'))),
  el('div', { class: 'soundbar-grid' },
    el('div', { class: 'ctl' },
      el('label', {}, 'Name'),
      el('div', { class: 'ctl-row' }, nameInput,
        button('Save', save),
        button('Copy share link', async () => {
          const url = urlFor(await encodeState(state, soundName));
          try {
            await navigator.clipboard.writeText(url);
            flash('Link copied. Anyone who opens it gets this exact sound setup.');
          } catch {
            flash(`Could not copy automatically. Here is the link: ${url}`);
          }
        }, 'primary'),
      ),
    ),
    el('div', { class: 'ctl' },
      el('label', {}, 'Saved & starter sounds'),
      el('div', { class: 'ctl-row' }, presetSel,
        loadBtn,
        renameBtn,
        deleteBtn,
      ),
      renameRow,
    ),
  ),
  soundMsg,
);
fillPresets();

// ---------- header, safety, layout ----------

const playBtn = button('', () => (playing ? stop() : play()), 'play');
const playHint = el('span', { class: 'play-hint' }, 'Turn on a sound below to play');
onRefresh(() => {
  const canPlay = anyOn();
  playBtn.textContent = playing ? '■ Stop' : '▶ Play';
  playBtn.classList.toggle('on', playing);
  playBtn.disabled = !playing && !canPlay;
  playBtn.title = playBtn.disabled ? 'Turn on at least one sound first' : '';
  playHint.hidden = canPlay;
});

const master = numControl({ label: 'Master volume', min: MASTER_MIN, max: MASTER_MAX, step: 1, unit: 'dB' }, () => masterDb, (v) => {
  masterDb = v;
  engine?.setMasterDb(v);
  try {
    localStorage.setItem(MASTER_KEY, String(v));
  } catch {
    // not remembered; still works for this visit
  }
});
master.classList.add('ctl-inline'); // one line in the top bar: label, slider, value, unit

const warning = el('div', { class: 'warning', role: 'alert' },
  el('strong', {}, 'Start with volume low. Stop immediately if anything is uncomfortable.'),
  el('span', {}, ' The master volume remembers your last setting (full the first time), so check your device volume before pressing Play. Press Esc or STOP ALL at any time.'),
  button('OK', () => warning.remove(), 'dismiss'),
);

const sharedBanner = el('div', { class: 'shared-banner', role: 'status' });
sharedBanner.hidden = true;
function showSharedBanner(text: string, isError = false) {
  sharedBanner.replaceChildren(el('span', {}, text), button('OK', () => { sharedBanner.hidden = true; }, 'dismiss'));
  sharedBanner.classList.toggle('error', isError);
  sharedBanner.hidden = false;
}

/** Load a sound from a share link in the URL. Never auto-plays. */
async function loadFromUrl() {
  const code = codeFromUrl();
  if (!code) return;
  try {
    const shared = await decodeState(code);
    if (playing) stop();
    state = shared.state;
    setName(shared.name);
    changed();
    // Reloading your own page restores silently; only links from elsewhere get the banner.
    if (code !== lastWrittenCode()) {
      const what = shared.name ? `"${shared.name}"` : 'a shared sound';
      showSharedBanner(`Loaded ${what}. Press Play when ready, and check your device volume first.`);
    }
  } catch {
    showSharedBanner('That share link could not be read. It may be incomplete; try copying it again.', true);
  }
}

const stopAllBtn = button('STOP ALL', stopAll, 'stop-all');

const REPO_URL = 'https://github.com/RyanOC/ear-sounds';

const logo = el('span', { class: 'logo', 'aria-hidden': 'true' });
logo.innerHTML =
  '<svg viewBox="0 0 32 32" width="40" height="40"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">' +
  '<path d="M5 13v6M10 9v14M15 5v22M20 10v12M25 13v6"/></g></svg>';

const githubLink = el('a', { class: 'gh-link', href: REPO_URL, target: '_blank', rel: 'noopener' });
githubLink.innerHTML =
  '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>' +
  '<span>Open source on GitHub</span>';

document.querySelector('#app')!.append(
  el('header', { class: 'hero' },
    el('div', { class: 'brand' }, logo, el('h1', {}, 'Ear Sound Recreator')),
    el('p', { class: 'tagline' },
      'Recreate the sounds of your tinnitus (ringing, clicking, crackling) by adjusting sliders until it matches what you hear. ' +
      'Then play it for your doctor, or anyone who asks what it sounds like.'),
    el('p', { class: 'tagline-meta' },
      el('span', {}, 'Free · no sign-up · runs in your browser, nothing is uploaded'),
      githubLink,
    ),
  ),
  el('div', { class: 'top' },
    el('div', { class: 'transport' }, el('div', { class: 'play-wrap' }, el('div', { class: 'play-row' }, playBtn, stopAllBtn), playHint), master),
  ),
  warning,
  sharedBanner,
  el('main', { class: 'grid' },
    soundBar,
    collapsible(rhythmCard, 'rhythm'),
    collapsible(buzzCard, 'buzz'),
    collapsible(zipperCard, 'zipper'),
    collapsible(bubbleCard, 'bubbles'),
    collapsible(pitchCard, 'pitch'),
    collapsible(summaryCard, 'summary'),
  ),
  el('footer', { class: 'site-footer' },
    el('div', { class: 'footer-info' },
      el('p', {}, el('strong', {}, 'Ear Sound Recreator'), ' · ', el('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, 'Open source on GitHub')),
      el('p', { class: 'hint' }, 'Not a medical device or treatment. Everything stays in this browser.'),
    ),
    el('div', { class: 'footer-danger' },
      el('p', { class: 'hint' }, 'Clear all saved sounds and settings from this browser.'),
      button('Reset everything…', openReset, 'danger-outline'),
    ),
  ),
  resetDialog,
);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') stopAll();
});

// A link pasted into an already-open tab changes only the hash.
window.addEventListener('hashchange', () => void loadFromUrl());

renderPitch();
refreshAll();
void loadFromUrl();

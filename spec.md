# Ear Sound Recreator — Build Spec

> This is the original spec the prototype was built from. The shipped app evolved from it (for example, WAV export, the notes field and solo were dropped, and a shared rhythm clock was added). See the [README](README.md) for what it does today.

## Goal
Build a browser-based app that lets people with tinnitus recreate the sounds they hear by tuning parameters with sliders. That way they can **play** or **export** the sounds for their doctors instead of trying to describe them. All of the sound is synthesized live with the Web Audio API. No audio samples are needed.

## The sounds to model
Model three common sound types. Each one should be its own independent **layer** that users can toggle, solo, and mix with the others:

1. **Buzz / tone**: a high-pitched buzzing that feels very close, almost inside the ear.
2. **Zipper**: a rapid train of clicks that starts slow and speeds up, like a zipper being pulled.
3. **Bubbles / crackle**: lots of tiny soap bubbles popping in fast, irregular succession.

## Tech stack
- Vite + TypeScript, vanilla (no framework), single page
- Web Audio API only (`AudioContext`, `OscillatorNode`, `AudioBufferSourceNode`, `BiquadFilterNode`, `GainNode`, `StereoPannerNode`, `DynamicsCompressorNode`, `OfflineAudioContext`)
- Mobile-friendly layout. It needs to work in Safari on iOS, so audio has to start from a user tap.
- No backend

## Audio architecture
```
[Buzz layer] ─┐
[Zipper layer]─┼─> [Ear router (L / R / Both)] -> [Master gain] -> [Limiter] -> destination
[Bubble layer]─┘
```
Each layer has its own gain, mute, and solo controls, plus an ear-routing control (Left / Right / Both).

### Layer 1: Buzz / tone
- Oscillator with selectable waveform: sine, triangle, square, sawtooth
- Frequency: 1 kHz to 16 kHz on a logarithmic slider, with fine adjustment of ±1 Hz using arrow buttons
- **Buzz modulation** (amplitude modulation): rate from 0 to 300 Hz and depth from 0 to 100%. This produces the "buzzy" texture as opposed to a pure tone.
- **Jitter**: small random pitch wobble from 0 to 2%, which makes the tone sound less synthetic
- Optional narrowband noise mode, using band-passed white noise with adjustable Q, since many ear tones sound more like hiss than a clean pitch
- Gain control

### Layer 2: Zipper
- Generates a sequence of very short clicks, each either an impulse or a 1–5 ms burst of filtered noise
- Clicks are scheduled ahead of time with `AudioContext.currentTime` for precise timing. Do not use `setTimeout` to trigger the clicks themselves.
- Parameters:
  - Start rate: 2 to 50 clicks per second
  - End rate: 20 to 500 clicks per second
  - Sweep duration: 0.2 to 5 seconds
  - Curve: linear, exponential, or ease-in. The ease-in shape gives the "starts slow, then speeds up" effect.
  - Click tone: band-pass center frequency from 500 Hz to 12 kHz, and Q
  - Click length: 0.5 to 10 ms
  - Timing randomness: 0 to 50%
  - Repeat: one-shot, loop, or random intervals (with a minimum and maximum gap)
- A "Trigger" button for one-shot mode

### Layer 3: Bubbles / crackle
- Granular engine: fires many tiny "pops" at random times
- Each pop is a short decaying sine "ping" or a filtered noise burst
- Parameters:
  - Density: 5 to 1,000 pops per second
  - Pitch center and spread (pop pitch varies randomly around the center)
  - Pop length: 1 to 20 ms
  - Loudness variation: 0 to 100%
  - Clustering: 0 to 100%. At higher values, pops arrive in bursts rather than evenly, which is closer to the "all at once" quality.
  - Burst mode: a burst lasting X ms, then silence, with optional repeating
- Uses the same look-ahead scheduler as the zipper layer

## "Closeness" control
Global presence settings to make the sound feel close or inside the head:
- Dry signal by default, with no reverb
- Optional presence boost: a peaking EQ around 3–6 kHz
- Optional "in-head" mode: the same signal sent to both ears with very slight differences

## Safety (required)
These sounds are high frequency and the app will be used with headphones, so hearing safety is essential:
- Master volume starts at **10%** every time the app loads
- A `DynamicsCompressorNode` acts as a hard limiter on the master bus, and the master gain is capped in code
- Every start and stop uses a 50 ms fade in and fade out, so there are no loud pops
- A visible warning appears on first load: "Start with volume low. Stop immediately if anything is uncomfortable."
- A large, obvious **STOP ALL** button that is always visible

## Features
- **Play / Stop**, with an always-visible STOP ALL button
- **Presets**: save named presets to localStorage, wrapping access in try/catch. Ship three starter presets: "Buzz", "Zipper", and "Bubbles".
- **Share link**: encode the full parameter state in the URL hash, so users can send an exact sound to someone
- **Export WAV**: render 5 to 30 seconds with `OfflineAudioContext` and download it as a 16-bit WAV, encoded manually with no library
- **Pitch finder helper**: a simple A/B mode that plays two tones and lets the user pick which is closer, narrowing in on their buzz frequency (similar to the pitch-matching method audiologists use)
- **Notes field**: free-text notes saved with each preset. Example: which ear, and when it is worse
- Optional: a live frequency or waveform display using `AnalyserNode` and a canvas

## UI
- One card per layer, each with an enable toggle, a solo button, a gain slider, and its parameters
- Each slider shows its current value with units (Hz, ms, clicks per second)
- Large touch targets, since most people will use this on a phone with earbuds
- Dark theme by default

## Notes on known limitations
- Frequencies above about 16 kHz may be filtered out by earbuds or sound cards. Display a note about this near the frequency slider.
- iOS will not play audio while the silent switch is on unless playback is routed correctly. Detect this if possible and show a hint.

## Definition of done
- All three layers work independently and mixed together
- The zipper audibly accelerates
- The bubble layer sounds irregular rather than metronomic
- WAV export output matches what the live preview plays
- The safety items above are implemented and verified
- `npm run dev` runs the app, and `npm run build` produces a static site that can be hosted anywhere
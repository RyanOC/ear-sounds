# Ear Sound Recreator

**Recreate the sounds of your tinnitus, then play them for your doctor or anyone who asks what you hear.**

> ### ▶ Live demo: **[ear-sounds.netlify.app](https://ear-sounds.netlify.app/)**
> Free, no sign-up, runs entirely in your browser. **Turn your device volume down before pressing Play.**

---

## Why this exists

Tinnitus is hard to describe. "Ringing" covers some of it, but many people hear something else: clicking that speeds up like a zipper, crackling like bubbles popping, buzzing, or hiss. Words rarely get it across to a doctor, a partner, or a friend who asks "what does it sound like?"

I built this after seeing first-hand how frustrating that is. You can know exactly what you're hearing and still have no way to explain it, and "it's like a ringing, but not really" doesn't help anyone.

So instead of describing it, you recreate it. Adjust the sliders until the sound matches what you hear, then press Play or send a link to whoever needs to hear it.

I'm a software engineer, but I built this as a quick AI-assisted prototype with [Claude Code](https://claude.com/claude-code), and it turned out great almost right away. I wrote the spec and tuned it by ear; the AI wrote nearly all of the code.

## What it does

- **Tone / ringing:** a steady tone or narrow hiss (100 Hz–16 kHz), with optional buzzy flutter and a slight pitch wobble.
- **Pitch finder:** an A/B "which is closer?" search, similar to the pitch matching audiologists use, with an octave check at the end. It takes about 7 rounds, and the result can be applied to any sound.
- **Zipper:** a train of clicks that speeds up, with adjustable start/end rate, duration, speed-up curve, click pitch and sharpness.
- **Bubbles / crackle:** a granular engine firing irregular little pops, with density, pitch, pop type (bubble, ping, crackle) and "clumping".
- **Rhythm:** one shared clock for the zipper and bubbles, so they stay in sync. It can be steady, random gaps, or trigger-only. **Tap along** to set the rhythm, and a timeline shows where each sound falls in the cycle.
- **Left / right / both ears**, per sound.
- **Summary for your doctor:** a plain-text readout of the numbers, e.g. *"4,120 Hz, left ear"* or *"clicks speed up from 8 to 120 per second over 1 s"*. It copies with one click.
- **Save & share:** name a sound and save it in your browser, or **copy a share link**. Anyone who opens the link gets the exact same sound setup.

## Safety

These are often high-frequency sounds, and people will play them through earbuds, so safety was built in from the start:

- A **limiter plus a hard clipper** on the output, and a **hard cap** on master volume.
- **Smooth fades** (50 ms) on every start and stop, so there are no sudden pops.
- Loudness compensation, so moving a filter or density slider doesn't suddenly make it louder.
- A big **STOP ALL** button, which is always visible, and **Esc** stops everything too.
- Opening a share link **never auto-plays**.

The app can't know how loud it is in your ear, because that depends on your device volume. **Start with your device volume low**, raise it slowly, and stop if anything is uncomfortable. Loud high-pitched tones can make tinnitus feel worse for a while.

> **This is not a medical device or a treatment.** It doesn't diagnose anything. It's a communication tool to help you show others what you hear. Please see an ENT or audiologist about your tinnitus.

## Privacy

There's no backend, no accounts, no analytics and no ads. Saved sounds and settings live only in your own browser (`localStorage`). Share links keep the settings in the URL's `#hash`, which browsers never send to the server.

## How it's built

**Stack:** Vite + TypeScript with no framework, using only the **Web Audio API**. There are no audio files; every sound is synthesized live. It's hosted as a static site on Netlify.

Some technical details:

- **Sample-accurate scheduling.** Clicks and pops aren't fired with `setTimeout`. A look-ahead scheduler wakes every 25 ms and places each event on the audio clock (`AudioContext.currentTime`) about 120 ms ahead, so timing stays exact even when the main thread is busy.
- **Bubbles that don't sound like a metronome.** The gaps between pops are drawn at random (a Poisson process). "Clumping" mixes very short and long gaps but keeps the same average rate.
- **"Bubble" pops are tiny sine pings that rise in pitch**, which is roughly what real bubbles do as they collapse.
- **Loudness compensation.** Band-passed noise gets quieter as the filter narrows, so the gain is adjusted to keep perceived loudness roughly constant.
- **Share links** are the settings as JSON, compressed with the browser's built-in `CompressionStream` (deflate) and base64url-encoded into the hash, which comes to about 420 characters. Every incoming value is validated: numbers are clamped to the slider ranges, invalid options fall back to defaults, and unknown fields are dropped. A hand-edited link can't push the app outside its safe limits.

## How the vibecoding went

- **Started with a spec.** I wrote a fairly detailed `spec.md` and asked the AI to review it *before* writing any code. It caught real problems up front: a plain compressor isn't a true limiter, random sounds can't be reproduced without a seeded random generator, and you can't detect an iPhone's silent switch.
- **Cut scope hard.** The spec had WAV export and more. I dropped most of it ("I just want to hear it"), and things moved much faster.
- **Iterated by ear.** The first pass already sounded remarkably close to the real thing. After that it was mostly feel: "sync these two", "this overlaps on mobile", "those arrows look like play buttons", "this On/Off button is confusing".
- **Rewrote the timing once.** The zipper and bubbles each had their own timing, which was fiddly to line up. Now one shared rhythm clock drives both.

## Run it locally

Requires [Node.js](https://nodejs.org/) 18 or newer.

```bash
npm install
npm run dev      # http://localhost:5173
```

Build a static site, output to `dist/`:

```bash
npm run build
npm run preview  # serve the built site locally
```

`dist/` uses relative paths, so it works on any static host or subfolder: Netlify (drag-and-drop the folder at [app.netlify.com/drop](https://app.netlify.com/drop)), Cloudflare Pages, GitHub Pages, and so on.

## Project layout

```
src/
  main.ts           UI: cards, controls, save/share bar, wiring
  state.ts          Settings model, defaults, starter sounds, doctor summary
  params.ts         Allowed range for every setting + validation of untrusted input
  share.ts          Share-link encoding/decoding (URL hash)
  pitch.ts          A/B pitch finder
  tap.ts            Tap-along rhythm
  ui.ts             Small DOM helpers (sliders, choices, collapsible cards)
  audio/
    engine.ts       AudioContext, master bus, limiter + clipper, look-ahead scheduler
    layer.ts        Base class: per-sound gain, ear routing, fades
    rhythm.ts       Shared beat clock
    buzz.ts         Tone / ringing
    zipper.ts       Accelerating click train
    bubbles.ts      Granular pops / crackle
```

## Feedback

If your tinnitus sounds like something this can't make yet, please [open an issue](https://github.com/RyanOC/ear-sounds/issues). Pulsing, whooshing and humming are all on the radar.

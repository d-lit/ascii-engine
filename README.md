# ASCII Engine

Turn a picture into living ASCII art in the browser: ripples that follow the cursor, liquid flow, glitches, decoding reveals, colour gradients — then export it as text, PNG or video, including transparent video for compositing.

<!-- media: hero clip (chunk 6 of docs/tasks/014-docs.md) -->

**Live demo:** https://d-lit.github.io/ascii-engine/

## What it does

- **Any source.** Drop a photo, or a plain-text ASCII art file (`.txt`, `.asc`, `.nfo`).
- **Proper ASCII.** Characters are chosen by measured glyph density, not by a naive brightness ladder. Five character ramps, light-on-dark or dark-on-light, block glyphs (`░▒▓█`) drawn procedurally so they tile without seams.
- **14 effects in a chain.**
  - *Displace* — `ripple`, `swirl`, `lens`, `liquid`, `glitch-rows`, `shake`;
  - *Cell* — `wave`, `pulse`, `erosion`, `decode`;
  - *Colour* — `tint`, `hue-cycle`, `glow`;
  - *System* — `particles`: characters fly off their cells and spring back (more systems coming).

  Add any of them (even twice), reorder, mix, mask.
- **Everything moves.** Any numeric parameter can be a constant, an LFO (sine, triangle, saw, square, noise) or a looping envelope. Effects have strength (`mix`) and masks (radial, rectangle, brightness, alpha). Effect centres sit on a 3×3 grid or anywhere (even off the edge), follow the cursor, or move by themselves: orbit, Lissajous, wander, sweep, bounce, keyframes — and hand over smoothly to the cursor when it arrives.
- **Canvas.** Pick a pixel frame — 1080×1080, 1080×1350, 1080×1920, 1920×1080 or your own — and crop both the source and the backdrop into it (fit, position, zoom). Screen, recording, render and PNG all use it.
- **Colour and layers.** Glyph colour: mono, the photo's own colours, or a gradient by brightness. Cell background plates. Backdrop: theme colour, any colour (chroma key), transparent, or an image — including the source photo itself, so effects can dissolve the ASCII into the picture.
- **Music.** Load a track: it plays with a transport (pause, frame step, seek), any parameter can follow its bass, mids, highs or loudness, and beats launch ripples and restart envelopes — the same on screen and in the render, with the sound in the video.
- **Presets.** Fourteen built-in looks, save and load your own as JSON, or press *random* to explore.
- **Export.**
  - text (`.txt` / clipboard);
  - PNG, with transparency;
  - live recording with the cursor (MP4 or WebM);
  - offline render at an exact frame rate and social-media sizes (1080×1080, 1080×1350, 1080×1920, 1920×1080), replaying the cursor from your last take;
  - transparent WebM (VP9 alpha) to use as an effects layer in a video editor.
- **Fast.** 60 fps at 200×110 characters on a laptop: a software compositor writes pixels directly, with zero allocations per frame.

## Quick start

Open the [live demo](https://d-lit.github.io/ascii-engine/), drop an image onto the page and pick a preset from the panel.

To run it locally (Node 24, Yarn 1):

```sh
yarn install
yarn dev          # development server
yarn run check    # type check + tests
yarn build        # production build into dist/
```

Chromium-based browsers (Chrome, Edge) are the tested target. Other browsers may lack some video formats; the panel shows what is available.

## Documentation

- [User guide](docs/guide/) — every panel setting explained, recipes, export tips (in Russian).
- [Documentation map](docs/README.md) — what each document is for.
- [Architecture](docs/SPEC.md), [decisions](docs/DECISIONS.md) and [roadmap](docs/ROADMAP.md) — for contributors (in Russian).

## Tech

TypeScript and Vite, no UI framework. Noise, random numbers, glyph atlas and compositor are written from scratch. The only runtime dependency is [mediabunny](https://github.com/Vanilagy/mediabunny) for video muxing; it loads only when you render a video.

## License

[MIT](LICENSE) © 2026 Dmitry Litvinenko

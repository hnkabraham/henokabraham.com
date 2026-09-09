# Henok Abraham — Personal Airspace

An aviation-themed personal portfolio with a Three.js aircraft scene, interactive project departures, boarding-pass briefings, public repositories, and a flight-log biography. The opening aircraft arrival, replayable nine-second scenic flight, layered clouds, and pointer-responsive paper surfaces give the page depth.

## Develop

```sh
npm install
npm run dev
```

## Validate and build

```sh
npx tsc --noEmit --incremental false
npm run build
```

Edit project descriptions and links in `app/flight-data.ts`, the experience in `app/terminal-experience.tsx`, and the theme in `app/globals.css`. The aircraft lives in `app/aircraft-scene.tsx` and loads only in the browser. Keyboard arrows and camera presets provide alternatives to dragging; motion follows system preferences and can be paused. Project information remains available when WebGL cannot initialize.

Asset sources and licenses are documented in [ASSETS.md](ASSETS.md). Hosting configuration belongs to the existing Sites project in `.openai/hosting.json`; retain its project ID when publishing updates.

The scenic-flight camera path is defined in `lib/flight-motion.ts`. `app/use-airspace-depth.ts` handles pointer depth and progressive section entrances without re-rendering React on every pointer event. The scene pauses autonomous animation while offscreen or in a hidden tab, and respects reduced-motion preferences. Dragging, selecting a camera, pausing, or pressing Escape ends a scenic flight.

# Henok Abraham — Personal Airspace

An aviation-themed personal portfolio with a Three.js aircraft scene, interactive project departures, boarding-pass briefings, public repositories, and a flight-log biography. The opening aircraft arrival, replayable nine-second scenic flight, layered clouds, and pointer-responsive paper surfaces give the page depth.

The site now opens with a full-screen dusk airfield. Visitors can begin an 8.8-second takeoff and climb into the portfolio, or skip immediately. The runway has dimensional lights, ground shadows, and distant hangars; a coordinated camera path follows the same aircraft from the ground into daylight and clouds. Optional synthesized engine and wind audio starts only after the visitor enables sound and launches. The aircraft controls' Replay intro button restarts the experience.

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

The opening sequence is separate: `app/departure-intro.tsx` owns its accessible dialog and lifecycle, `app/departure-scene.tsx` draws the airfield, and `lib/departure-motion.ts` choreographs the camera and aircraft. Escape, Skip intro, system reduced motion, and WebGL failure all provide a path to the portfolio. Its scene and audio resources are released when closed; the main aircraft scene suspends drawing while the intro is open. No reference-site code or assets are included.

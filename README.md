# Henok Abraham — Personal Airspace

An aviation-themed personal portfolio with a Three.js aircraft scene, interactive project departures, boarding-pass briefings, public repositories, and a flight-log biography.

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

# Henok Abraham — Personal Airspace

A personal portfolio opening with a scroll-controlled Boeing 787-9 departure from SFO. A single continuous camera follows preflight, runway acceleration, rotation, a climb over real San Francisco Bay imagery and terrain, and clear skies. The flight leads into the project departure board, project briefings, public repositories, biography and GitHub contact.

Native scrolling works with wheel, trackpad, touch and keyboard; no scroll interception or timed launch is used. Five chapter buttons jump along the same path. Visitors can skip directly to projects, return to preflight, or enable synthesized jet ambience. Reduced-motion preferences show a static cruise view in a short opening section. Asset or WebGL failure keeps a sky fallback and direct access to the portfolio. GPU rendering and audio pause when the scene is offscreen or the document is hidden.

## Develop

```sh
npm install
npm run dev
```

## Validate and build

```sh
npx tsc --noEmit --incremental false
node scripts/check-bay-flight.mjs
node scripts/check-bay-scenery.mjs
node scripts/check-bay-rendering.mjs
npm run build
```

`app/scroll-departure.tsx` maps native scroll to chapter progress. `lib/bay-flight.ts` defines a continuous Hermite flight path in meters and its camera shots. `app/bay-flight-scene.tsx` loads the aircraft, terrain and HDR illumination, and renders a floating-origin scene with animated gear and fans. `app/bay-departure.css` controls the sticky journey and responsive composition. `lib/bay-audio.ts` creates optional ambience only inside a user gesture.

Portfolio content lives in `app/flight-data.ts` and `app/terminal-experience.tsx`. Pointer depth on project cards is handled by `app/use-airspace-depth.ts`. General typography and the portfolio sections are in `app/globals.css`.

Sources, licenses, asset sizes and scenery approximations are documented in [ASSETS.md](ASSETS.md) and linked from Scene credits on the website. The terrain data preparation script accepts a directory containing the credited source tiles and registration JSON. Production assets are already included; no runtime mapping service, API key or external asset request is needed.

Retain the existing Sites project ID in `.openai/hosting.json` when publishing updates. This checkout does not manage VPS or custom-domain DNS configuration.

The realism pass adds public-domain NAIP detail around SFO, real OpenStreetMap terminal/hangar footprints batched into roof/wall surfaces, photographed asphalt color/normal/roughness maps, land/water-aware shading, clearcoat aircraft paint, lower telephoto departure shots, matching wing/shadow flex, and mechanically folding gear. `lib/bay-surface.ts`, `lib/sfo-buildings.ts`, and `lib/airframe-flex.ts` contain those additions. The scenery checks validate source registration, all generated building geometry, and shader patch integration; camera checks validate framing across portrait and wide viewports. Browser visual QA is separate.

The open-source rendering pass adds Takram's physically computed atmosphere, N8AO contact shadows and a half-float HDR composition pipeline with subtle bloom and AgX. `lib/bay-rendering.ts` owns the passes and resource lifecycle; `lib/bay-atmosphere.ts` anchors the atmosphere to the floating SFO scene. [RENDERING.md](RENDERING.md) records the Three.js/Cesium/3D Tiles comparison, mobile settings, fallback behavior and validation limits.

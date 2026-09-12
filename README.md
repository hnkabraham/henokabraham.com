# Henok Abraham — Personal Airspace

A personal portfolio opening with an airborne Boeing 787-9. The page begins with a moving blue sky; scrolling brings the aircraft into frame, then carries the camera past its engine, wing and tail before pulling back into open sky. The flight leads into the project departure board, project briefings, aviation logbook, public repositories, biography and contact form.

Native scrolling works with wheel, trackpad, touch and keyboard. Five chapter buttons follow the same camera path. Visitors can skip directly to projects, return to the open sky, or enable synthesized jet ambience. Reduced motion and WebGL/asset failure show a static sky with direct access to the portfolio. The initial sky does not run a WebGL render loop; drawing and sound suspend offscreen or in a hidden document.

## Airborne showcase

- `app/dreamliner-scene.tsx`: transparent Three.js renderer, HDR illumination, self-shadows, turning fans, wing flex, adaptive resolution and deterministic resource cleanup.
- `lib/dreamliner-tour.ts`: camera choreography and portrait framing. The original chapter IDs remain valid: `preflight` → Open sky, `roll` → Engine, `liftoff` → Wing, `bay` → Tail, `cruise` → Airspace.
- `lib/dreamliner-annotations.ts`: short detail captions. `app/scroll-departure.tsx` connects the tour to native scroll and the portfolio.
- `public/models/dreamliner-787-9.glb`: FlightGear 787-family exterior, 105,622 triangles in ten material groups, 4K fuselage and engine textures, 5,272,964 bytes. `scripts/prepare-dreamliner.py` reproduces it from a pinned upstream source. GPL-2.0 credits and the corresponding editable source are served at `/credits/dreamliner.html`.
- The old SFO/Bay scenery is retained as a previous experiment, but its modules and terrain preloads are absent from the active tour. Current rendering resources are spent on the aircraft.

## Develop

```sh
npm install
npm run dev
```

## Validate and build

```sh
npx tsc --noEmit -p .
npx oxlint app lib scripts
node scripts/check-dreamliner-tour.mjs
node scripts/check-dreamliner-lifecycle.mjs
node scripts/check-bay-performance.mjs
node scripts/check-bay-flight.mjs
node scripts/check-bay-scenery.mjs
node scripts/check-bay-rendering.mjs
npm run build
```

Oxlint currently reports two known errors in `app/terminal-experience.tsx` (`prefer-tag-over-role` and `no-img-element`); changes must add none. The scene checks run offline and never fetch or modify tile imagery.

## Earlier Bay terrain experiment

The following notes document the preserved terrain implementation; it is no longer mounted by the home page.

`app/scroll-departure.tsx` maps native scroll to chapter progress. `lib/bay-flight.ts` defines a continuous Hermite flight path in meters and its camera shots. `app/bay-flight-scene.tsx` loads the aircraft, terrain and HDR illumination, and renders a floating-origin scene with animated gear and fans. `app/bay-departure.css` controls the sticky journey and responsive composition. `lib/bay-audio.ts` creates optional ambience only inside a user gesture.

Portfolio content lives in `app/flight-data.ts` and `app/terminal-experience.tsx`. The featured Departure over the Bay briefing records the fixed-path scheduling decision, the 1,671-tile / 16,150,728-byte shipped budget, atlas memory and the 15-of-16 terrain sampler budget. These are asset/allocation figures, not invented performance or per-visit transfer measurements. Pointer depth on project cards is handled by `app/use-airspace-depth.ts`. General typography and the portfolio sections are in `app/globals.css`.

Sources, licenses, asset sizes and scenery approximations are documented in [ASSETS.md](ASSETS.md) and linked from Scene credits on the website. The terrain data preparation script accepts a directory containing the credited source tiles and registration JSON. Production assets are already included; no runtime mapping service, API key or external asset request is needed.

The realism pass adds public-domain NAIP detail around SFO, real OpenStreetMap terminal/hangar footprints batched into roof/wall surfaces, photographed asphalt color/normal/roughness maps, land/water-aware shading, clearcoat aircraft paint, lower telephoto departure shots, matching wing/shadow flex, and mechanically folding gear. `lib/bay-surface.ts`, `lib/sfo-buildings.ts`, and `lib/airframe-flex.ts` contain those additions. The scenery checks validate source registration, all generated building geometry, and shader patch integration; camera checks validate framing across portrait and wide viewports. Browser visual QA is separate.

The open-source rendering pass adds Takram's physically computed atmosphere, N8AO contact shadows and a half-float HDR composition pipeline with subtle bloom and AgX. `lib/bay-rendering.ts` owns the passes and resource lifecycle; `lib/bay-atmosphere.ts` anchors the atmosphere to the floating SFO scene. The scene is lit from the same scattering tables: the sun colour is sampled from the transmittance table and image-based light comes from a sky cubemap rendered around the aircraft, so sky, haze and lit surfaces share one exposure. Terrain now uses a 1025² elevation grid from zoom-12 tiles under stacked public-domain NAIP imagery (0.63 m around the runway, 3.9 m along the SFO–Marin corridor), with near-field ground grain, procedural runway wear, building glazing bands and procedural aircraft skin detail. The whole corridor from the airport to the Golden Gate carries 229,536 extruded building footprints, San Francisco's from the city's LiDAR survey and the peninsula's from OpenStreetMap, with roofs draped in the same imagery (`lib/bay-city.ts`, `scripts/prepare-city-buildings.py`), under baked building shadows and sky visibility (`scripts/prepare-bay-shadows.py`), drifting cloud shadows, some 310,000 instanced tree canopies classified from the imagery (`lib/bay-trees.ts`), an analytic livery on the aircraft (`lib/bay-livery.ts`), heat haze behind the engines and vapour off the wingtips at rotation (`lib/bay-thrust.ts`), ground imagery around the airport and the climb-out streamed as tiles scheduled along the fixed camera path (`lib/bay-tiles.ts`, `scripts/prepare-bay-tiles.py`), a sharper corridor layer and moving freeway traffic under the climb-out (`lib/bay-traffic.ts`, `scripts/prepare-bay-traffic.py`), a procedural Golden Gate Bridge placed from OpenStreetMap (`lib/bay-bridge.ts`), SFO's approach-light piers, field lighting, signs, markings and a parked fleet placed from OpenStreetMap's airfield layout (`lib/sfo-airfield.ts`), and a few easter eggs (`lib/bay-easter-eggs.ts`: click the aircraft, the Konami code, `gt350`, `karl`). The flight is rate-limited so fast scrolling cannot strobe the scenery, and heavier variants wait for a short frame-time measurement. [RENDERING.md](RENDERING.md) records the Three.js/Cesium/3D Tiles comparison, mobile settings, fallback behavior and validation limits.

## Deploy

The build targets Cloudflare Workers: `dist/server` holds the Worker and `dist/client` the static assets, and the generated `dist/server/wrangler.json` names the Worker `henokabraham-com` (set in `vite.config.ts`). The HTML document, live-data APIs, contact handler and anonymous measurement endpoint run in the Worker; static assets use Cloudflare’s asset service.

```sh
npm run check:cloudflare
npm run deploy:cloudflare
```

`npm start` serves the same build locally in workerd. JavaScript and CSS under `/_next/static/` and versioned scenery under `/scene/<content-hash>/` use immutable browser caching. Original model/scenery/tile URLs remain available for existing links. The build computes the scenery version from all asset names and bytes; changes produce new URLs.

Retain the existing Sites project ID in `.openai/hosting.json` when publishing there. `vite.config.ts` retains the direct Cloudflare custom domain for `henokabraham.com`.

## Shared chapters and aviation notes

Project selection and scroll chapters use replace-only query parameters, for example `/?project=flight-tracker&chapter=bay`. Project IDs come from `flight-data.ts`; chapters are `preflight`, `roll`, `liftoff`, `bay`, and `cruise`. `lib/flight-links.ts` validates incoming values, preserves unrelated parameters and history state, and does not add history entries. The chapter seeds the progress ref and scroll position before the scene mounts. Invalid values use the default selection/current scroll. Reduced motion keeps its static sky view. Section anchors still work for native navigation; a valid shared chapter takes precedence on initial restoration. Changes to project/chapter remove redundant `#flight`/`#departures` anchors.

In the earlier terrain experiment, `lib/bay-annotations.ts` schedules six sparse DOM annotations from scroll progress: brake release, rotation, gear retraction, wing flex, San Bruno Mountain and the Golden Gate. Each is labelled as cinematic scene data rather than real flight data. They appear only with a ready scene and are hidden at widths of 1100 px or less, heights of 700 px or less, and for reduced motion. Rapid scrolling can put these scroll-scheduled notes ahead of the rate-limited aircraft; inspect their timing in visual QA.

`app/aviation-logbook-data.ts` is a typed local dataset rendered beneath the project terminal. The initial entries are explicitly site references: the featured 787-9/SFO scene and the existing United Flight Tracker/aviation biography. They assert no personal flights or dates. Add verified personal entries with `kind: 'personal-entry'`; mark demonstrations with `kind: 'sample'`, which visibly labels them as samples to replace. Keep unknown dates `null`. Photo arrays start empty; future local photos require alt text and intrinsic dimensions and load lazily. Related-project buttons open the corresponding briefing and update the selected project URL.

## Deploy to your Cloudflare account

See [CLOUDFLARE.md](CLOUDFLARE.md) for the scoped token, account ID, local dry run and direct deployment commands.

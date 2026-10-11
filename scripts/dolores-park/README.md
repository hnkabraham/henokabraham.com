# Dolores Park scene

An offline three.js scene of 20th Street at the top of Mission Dolores Park, San Francisco, with the Garage's GT350 (`public/models/garage-gt350r.glb`) parked at the park-side curb. It renders stills in headless Chromium. The Garage section's "Dolores Park" view, `public/images/garage-dolores*.{avif,jpg}`, is one of them.

It's a reconstruction: real terrain, footprints, tree positions and city massing, plus modelled foliage, facades and street detail. It reads as CG, not as a photograph. The framing was matched by eye to a Google Street View frame at 3851 20th St. That frame isn't in this repository, and the scene never loads, samples or traces any Street View or other proprietary imagery.

## Files

- `scene.html` / `scene.js`: the shared scene builder, camera presets, lighting, reflection probes and offline post-processing. Its URL parameters are documented below.
- `houses.js`: the 18 original painted Victorians, sidewalk trees, lamps and shared garage/curb-cut layout. Returns a standalone three.js group and its resource report.
- `detail.js`: the foreground tree, verge grass and leaf litter, plus a rusty-tree experiment that's off by default.
- `palms.js`: Canary Island date palms and Mexican fan palms.
- `traffic.js`: distant parked cars along the south curb.
- `render.mjs`: the render driver. It serves this repository on a local port, and the page can't reach anything else.
- `fetch.py`: downloads the third-party assets (`assets`) or the raw public data (`data`).
- `bundle.py`, `geo.py`: pack the raw data into `archive/scenery/dolores/scene.json` and `terrain.f32`.
- `horizon.py`: writes the East Bay ridge, `horizon.json`, from `archive/scenery/bay-elevation.webp`.
- `assets.json`: every downloaded asset's URL, SHA-256, author and licence.

`archive/scenery/dolores/` holds the bundled data, the ridge and the NAIP aerial (`naip.jpg`). Its `assets/` subfolder is gitignored, because `fetch.py assets` restores it.

## Rendering

```sh
python3 scripts/dolores-park/fetch.py assets   # once; about 130 MB
node scripts/dolores-park/render.mjs out/sv.png preset=streetview w=1600 h=1360
node scripts/dolores-park/render.mjs out/east.png preset=west cam=-3,-161 heading=114 pitch=3 fov=68 camH=2 w=1600 h=1360
node scripts/dolores-park/render.mjs out/victorians.png preset=victorians w=1920 h=1200
node scripts/dolores-park/render.mjs out/hero.png preset=streetview cam=8,-161 camH=1.2 look=12.9,-154.63,1.05 fov=52 w=1920 h=1200
```

Write renders to a directory outside the repository; `out/` above is a placeholder.

This needs Playwright installed globally. A frame takes about 4 s on an M-series Mac with Metal.

The Garage image is the hero view at 1920 × 1200. It is encoded with Pillow as AVIF at quality 58 and JPEG at quality 84, at 1920 and 960 px wide (`garage-dolores.*`, `garage-dolores-960.*`).

Renders aren't bit-identical from run to run, even with `grain=0`. Two renders of the same view differ by about 0.2–0.3 of 255 on average, with a few edge pixels further apart.

## Rebuilding the data

```sh
python3 scripts/dolores-park/fetch.py data /path/to/cache
python3 scripts/dolores-park/bundle.py /path/to/cache   # numpy, pillow, matplotlib
python3 scripts/dolores-park/horizon.py
```

`bundle.py` reproduces the committed files byte for byte from the 2026-10-10 downloads. A fresh download will differ wherever the services have updated.

## Frame and coordinates

- **Local frame.** Metres, x east, y north, with the origin at 37.7596 N, 122.4270 W (`geo.py`).
- **three.js axes.** X = x, Y = elevation (NAVD88), Z = −y.
- **Angles.** Headings are compass bearings. With a preset, `fov` is horizontal.

The street view pose is a bounded visual fit around the panorama's published position:

- It's at (8.4, −162.35), 2.85 m above the road, heading 28.2°, pitch −3.5°, horizontal field of view 65°.
- That's 2.96 m from the published position, in the eastbound travel lane.
- The GT350 is at (13.3, −154.63), nose west, with a 21.5 mm lift so the tyres touch the sloped road.

## Data versus reconstruction

| Element | Basis |
|---|---|
| Terrain, the lawn's fall, and 20th St's 5.9% grade | USGS 3DEP 1 m DEM |
| Ground colour far from the camera | NAIP aerial |
| Background building footprints and heights | DataSF LiDAR-derived footprints; OSM outlines where DataSF has none |
| 20th Street Victorian row | Original designs on roughly the existing lot positions and widths; artistic heights, setbacks, bays, roofs and paint, not reconstructions of the real houses |
| Street-tree positions and species groups | DataSF street-tree inventory |
| Park canopies | Dark-green NAIP pixels, excluding buildings and roads |
| Roads and their names | OpenStreetMap |
| Downtown massing | DataSF footprints; Salesforce Tower and the Transamerica Pyramid modelled from their known shapes |
| East Bay ridge | Mapzen/Terrarium elevations, approximate registration, 1.18× vertical scale |
| Foreground tree, benches, palms' shapes, facades, grass and sky | Original procedural geometry and CC0 textures |
| Legacy Garage house shadows | Source-footprint shadow proxies in `streetview`, retaining the shallow building’s 3 m `nearRoofLift`; other presets use the new architecture’s shadows |
| Distant parked cars | Quaternius's CC0 car, repainted |

## Main parameters

| Parameter | Default | Meaning |
|---|---:|---|
| `preset` | — | `streetview`, `west` (east-looking, legacy name), or `victorians`; the latter two use artistic summer light |
| `cam`, `camH` | 8.4,−162.35 / 2.85 | Camera x,y and height above the modelled ground surface (road, sidewalk, park path or verge) |
| `heading`, `pitch`, `fov` | 28.2 / −3.5 / 65 | Street view pose |
| `look` | — | x,y,height target, height relative to the car's road level; overrides heading/pitch |
| `w`, `h` | 1600 / 1360 | Output size; `victorians` defaults to 1920 / 1200 |
| `carX`, `carY` | 13.3 / −154.63 | GT350 position |
| `sunAz`, `sunEl`, `sun` | 225 / 28 / 6.0 | Sun bearing, elevation, intensity; summer defaults below |
| `sunColor` | #fff0d8 | Sun colour; summer defaults to #ffe2b7 |
| `exposure`, `env`, `hemi` | 1.2 / .45 / .32 | Exposure, HDRI fill, hemisphere fill |
| `carEnv`, `carReflections` | 1.4 / 1 | Strength of, and switch for, the local reflection probe on the car |
| `nearRoofLift` | 3.0 | Artistic height added to the building that casts the near shadow |
| `ao`, `aoGain` | 1 / .58 | Ground-contact ambient occlusion |
| `bloom`, `grain` | 1 / .0022 | Post-processing |
| `heroLeaves`, `heroTreeScale` | 1 / 1 | Foreground tree leaf count and scale |
| `heroTree`, `benches` | 1 / 1 | Foreground tree and benches; both off for `victorians` |
| `parkClear` | 0 | Clear the west park canopy shadow corridor; 1 for `victorians` |
| `houseDetail` | 1 | Detailed row; 0 gives simple diagnostic masses |
| `legacyHouseShadows` | 1 in `streetview`, 0 otherwise | Preserve the existing Garage car lighting with shadow-only source masses |
| `clearRadius`, `grassBlades` | 33 / 55000 | Data trees cleared near the camera; verge blades (26000 in `victorians`) |
| `grassHeight` | 1 | Blade height multiplier; .35 in `victorians` |
| `benchX`, `benchGap` | 15.8 / 3.2 | Bench placement |
| `hillScale`, `hillContrast`, `cityPale` | 1.18 / .65 / .24 | Ridge and distant-city look |
| `conifer`, `traffic` | 0 / 1 | Rusty-tree experiment; distant cars |
| `debug` | 0 | 1 labels landmarks, benches, the car footprint and the curb |

## Modelled Victorians

The row contains **18 houses**: five Italianates, five Stick-Eastlake houses, four Queen Annes and four Edwardian flats. The large eastern source footprint is divided into three facades. The other source lots keep their approximate position and width. Heights and ornament are artistic, with no attempt to match Street View or any actual 20th Street house.

- Italianates have three-sided slanted bays, segmental window hoods, bracketed cornices and raised false fronts.
- Stick-Eastlake houses have square bays with paired sashes, vertical boards, recessed panels, diamond accents and spindle cornices.
- Queen Annes have asymmetric fronts, fish-scale gables, pedimented windows and columned porches.
- Edwardian flats have three residential floors, stacked polygonal bays, garages and classical cornices.

Six palettes alternate without identical neighbours: sage/ivory/oxblood, dusty blue/cream/navy, butter/ivory/plum, teal/parchment/copper, rose/bone/oxblood and celadon/cream/forest. Muted gold picks out small details. The finish uses subtly varied vertex colours, an original grain/seam texture and alpha runoff below sills and at the foundation. Cornices, dentils, curved brackets, lapped boards, reveals, sashes, muntins, stairs, railings, newels, turned columns, balusters, chimneys and vents are geometry. Dark glass uses the existing local reflection probe and has an ordinary PBR fallback. Curtains and blinds vary between windows.

Three small street trees stand in actual sidewalk openings at x=18, 37 and 61. Two cast-iron lamps and an iron garden gate provide street detail. Driveway curb cuts come from the same lot layout as the garage centres. All of this is in `houses.js`; pavement openings and lighting remain in `scene.html`.

### Presets and artistic changes

`preset=victorians` places the camera at (7.6, −148.5), **1.4 m above the modelled park verge**, looking toward (19.6, −162, 2.7), with 59° horizontal field of view. The target height is relative to the car’s road elevation. The car keeps its existing position and orientation. The view is a front three-quarter view from the park side, looking southeast toward the house fronts.

Both `victorians` and `west` use an **artistic clear summer evening**, with WNW sun at bearing 290°, elevation 10°, intensity 5 and colour #ffe2b7. These angles are plausible near the summer solstice in San Francisco, but this is an aesthetic choice, not a dated sun study. Exposure is 1.05, HDRI fill .65 and hemisphere fill .55. Individual URL parameters override all preset defaults. The existing winter sky gradient is retained as a stylised clear blue sky.

For a clean car hero, `victorians` hides the foreground tree, benches and distant traffic, reduces verge blade count/height, and removes off-camera park canopies in x=−75…24, from 5.3 to 45 m north of the road. Those canopies otherwise throw long stripes over the car. Houses, street trees, lamps and the gate remain. `streetview` keeps its original winter lighting, camera defaults, vegetation, benches and traffic.

The east command above moves the camera 3 m north of the old view and looks slightly farther toward the facades, exposing more roofline and less foreground pavement. The old `preset=west cam=-3,-164 heading=101` camera override still works, now with the summer lighting. For the former winter light, explicitly pass `sunAz=225 sunEl=28 sun=6 exposure=1.2 env=.45 hemi=.32 sunColor=#fff0d8`.

Taller new roofs initially shaded the GT350 in the two existing park-facing views. `legacyHouseShadows=1` therefore disables shadow casting by the new row in `streetview` and uses colour/depth-invisible source-footprint masses to cast the established house shadows. This retains the lit car; trim silhouettes and reflections still produce small differences. Use `legacyHouseShadows=0` to see the new physical roof shadows from those cameras.

### Export and resource budget

`buildHouses()` returns `{row, stats}`. In the standalone scene, `window.doloresHouses` exposes that group for a future `GLTFExporter` call. It contains standard/physical materials, ordinary canvas texture maps, vertex colours, merged static meshes, and instanced brackets, sash members, dentils, balusters and porch columns. There are **no house shader patches**. Repeated paint colours are stored on shared geometry rather than `instanceColor`, so they survive glTF export.

The complete row, **including its three trees, two lamps and gate**, reports:

| Resource | Count |
|---|---:|
| Submitted triangles (instances expanded) | 299,867 |
| Meshes / draw calls in one colour pass | 14 |
| Repeated-part instances | 2,971 |
| Original texture maps | 4 |
| RGBA8 texture memory including mip chains | 655,360 bytes (640 KiB) |
| Shared 256² RGBA16F window cubemap including mip chains | 4 MiB, additional |

Shadow, reflection capture and post-processing passes add rendering work beyond these 14 calls. The cubemap is a runtime scene resource; an exported viewer must supply its own environment. Without it the dark PBR glass remains usable.

A `GLTFExporter → GLTFLoader` round trip preserved 299,867 triangles, 14 mesh nodes, 2,971 instances and identical bounds. The uncompressed in-memory GLB was 30,621,720 bytes (29.2 MiB). The exporter normalised four normal attributes during writing. This verifies portability, not phone readiness: geometry compression, LOD, compact environments and mobile lighting remain next-pass work. The rest of the park scene is much heavier than the houses.

### Reference, assets and validation

The architectural proportion reference was the public-domain HABS survey photograph of the [Ortman-Shumate House, 1901 Scott Street, HABS CA-2220](https://www.loc.gov/pictures/item/ca1396/), image 016615p ([LOC image](https://tile.loc.gov/storage-services/service/pnp/habshaer/ca/ca1300/ca1396/photos/016615pv.jpg)). It isn't in this repository; it was viewed for cornice, bay and window proportions; it is not a texture or traced facade. Other style choices are original designs based on general architectural knowledge.

**No new third-party production assets or code were downloaded.** All new geometry and texture artwork is original; the previously documented CC0 scene assets remain unchanged. `python3 scripts/dolores-park/fetch.py assets` verified the manifest cleanly.

The row was developed over 29 render-and-look iterations, including close facade checks and baseline/final renders of both existing views. The car’s world position, wheel contact gaps and camera bounds remain unchanged in those views. The park and skyline match; new reflections and small foreground shadow differences remain. JavaScript passes `npx oxlint scripts/dolores-park` and explicit correctness/`prefer-const` linting of the extracted inline module. `houses.js` and the changed `detail.js` were formatted with `oxfmt`.

## Known weaknesses

- **Palms:** the crowns have a procedural rhythm.
- **Foreground tree:** it reads as modelled geometry.
- **Downtown:** it's simplified blocks.
- **Mission rooftops:** they lack a photograph's variety in the middle distance.
- **Victorians:** the kit still repeats doors, windows and ornament. Weathering is restrained; side walls and roof surfaces are simpler than the fronts. Interiors are shallow curtain/blind hints, not rooms. The street-tree leaf cards become visible very close up.
- **The offline scene's size:** about 24 M scene triangles, an 8192² shadow map, two reflection captures and full-resolution post-processing. Use the web profile below for an orbitable scene.


## Pass 5: orbitable web profile

The web scene is built by the same `scene.js`, `detail.js`, `palms.js` and `houses.js` as the still. `profile=live` selects its geometry budgets. No site React code, deployed poster, car asset, package manifest, or deployment was changed.

### Build, view, capture and verify

```sh
python3 scripts/dolores-park/fetch.py assets
node scripts/dolores-park/export.mjs
node scripts/dolores-park/server.mjs
# Open the localhost URL printed by server.mjs.
node scripts/dolores-park/verify-live.mjs
npx oxlint scripts/dolores-park lib/dolores-park-materials.js
npx oxfmt scripts/dolores-park/*.js scripts/dolores-park/*.mjs lib/dolores-park-materials.js
```

`export.mjs` uses local-only headless Metal Chromium and the existing gltf-transform, Draco, meshoptimizer and Sharp packages. It builds each profile, performs a raw GLTFExporter → GLTFLoader round trip, welds/compacts/simplifies geometry, preserves distinct material names, and writes Draco geometry plus `EXT_texture_webp`. No KTX2/transcoder is used. Export temporarily consumes substantially more CPU memory than the delivered model. Binary transfer to Node is chunked; sending the full raw GLB as a numeric Playwright array exceeds Chromium's serialization limit.

Delivery files:

- `public/models/dolores-park.glb` and `dolores-park-phone.glb`. These are lighting-independent; both suns reuse them.
- Six `public/scenery/dolores-sky-{px,nx,py,ny,pz,nz}.webp` faces, 1536² desktop; `dolores-sky-phone-*`, 768² phone.
- Separate `dolores-sky-summer-*` and `dolores-sky-summer-phone-*` faces for the alternative sun. A viewer downloads **one** set of six.
- `lib/dolores-park-materials.js` and `.d.ts`: the shared material registry.
- `live.html` / `live.js`: reference viewer; `car.js`: identical shared paint conversion, wheelbase slope, lift and contact-shadow construction; `lighting.js`: the two shared sun parameter sets.
- `export-report.json`: source and round-trip geometry census. `live-report.json`: measured delivery budgets, GPU identity, collision checks and idle/disposal results.

Example captures (set `OUT` to an absolute directory **outside** the repository):

```sh
node scripts/dolores-park/render.mjs "$OUT/default.png" page=live w=1920 h=1200
node scripts/dolores-park/render.mjs "$OUT/phone.png" page=live phone=1 w=1920 h=1200
node scripts/dolores-park/render.mjs "$OUT/summer.png" page=live sun=summer w=1920 h=1200
node scripts/dolores-park/render.mjs "$OUT/behind.png" page=live pose=20,-151,1.5,13.3,-154.63,0.6 w=1920 h=1200
node scripts/dolores-park/render.mjs "$OUT/verge.png" page=live pose=13.3,-149.2,1.4,13.3,-154.63,0.6 fov=64 w=1920 h=1200
node scripts/dolores-park/render.mjs "$OUT/high.png" page=live pose=8.4,-159.1,5.2,13.3,-154.63,0.6 w=1920 h=1200
node scripts/dolores-park/render.mjs "$OUT/benchmark.png" page=live benchmark=1 dpr=2 w=1600 h=1000
```

`render.mjs page=live` adds `shot=1`. Direct URLs support `?phone=1`, `?sun=summer` (also `?preset=victorians`), `?pose=x,y,h,lookx,looky,lookh`, `?fov=52`, `?shot=1`, and `?benchmark=1`. Camera height is above the local surface; look height is above the car's road elevation. Safety constraints still apply to supplied poses. `preset=victorians` in the **viewer** changes only the sun, keeping the default camera; the builder retains its historical preset camera.

`window.png` is a PNG data URL and `window.done` signals completion. `window.liveInfo` includes counts, texture allocations, payload bytes, load time, sun and placement. `frameTimeMs` is populated by `?benchmark=1` or `await window.doloresViewer.benchmark()`; ordinary visits do not run a hidden benchmark. The viewer stops rendering after controls settle. The benchmark restores the original pose.

### Measured budgets

Final verification on this Mac's **Apple M2 Max**, Chromium / ANGLE Metal, 1600 × 1000 CSS pixels at DPR 2 (3200 × 2000 drawing buffer). Decimal MB, not MiB. Frame timing uses 24 warmup frames and the median of 120 scripted orbit frames, including synchronous one-pixel readback to wait for GPU completion. Metal did not expose the disjoint GPU timer extension; timing only `renderer.render()` understated the cost and is not the reported metric.

| Resource, winter default pose | Desktop | Limit | Phone | Limit |
|---|---:|---:|---:|---:|
| Park GLB + selected backdrop, excluding car | 4.118 MB | 6 MB | 2.966 MB | 3 MB |
| Triangles in a settled visible frame, including car | 802,238 | 900,000 | 392,771 | 400,000 |
| Draw calls in a settled visible frame | 60 | 120 | 57 | 60 |
| Estimated resident GPU texture memory | 143.70 MB | 160 MB | 60.15 MB | 64 MB |
| Shadow map | 2048² | 2048² | 1024² | 1024² |
| Median completed frame time | 3.5 ms | 8 ms | 3.4 ms | — |
| Maximum draw calls in the 120-frame orbit | 62 | 120 | 59 | 60 |
| Local load through first frame, final run | 867 ms | — | 753 ms | — |

These are **settled-frame** budgets: the static sun shadow map and reflection probes are generated once during loading, then cached during the orbit. The initial shadow-plus-colour submission was 2,062,340 triangles / 111 calls desktop and 1,229,812 / 105 phone; six-face reflection capture is additional one-time work. Those startup passes exceed the steady-frame triangle limits and phone call limit. Do not refresh them every frame in the React port. Other orbit poses can draw more houses; the requested triangle limits were measured at the default pose (phone reaches 489,848 triangles during the scripted orbit). Local loading is not a simulated mobile network measurement. Completed desktop frame medians varied from 3.5 to 5.8 ms across validation runs.

Texture memory is a conservative allocation estimate, not a GPU-driver VRAM counter. It includes decoded RGBA8 maps and mip chains, the separate car, six background faces, both retained RGBA16F PMREMs, and shadow colour/depth storage. It excludes canvas colour/depth/MSAA attachments and CPU image buffers. Temporary cube and PMREM working targets are disposed after load. WebP reduces download bytes, not GPU texture size.

### What remains 3D; what is baked

The split is **180 m horizontally from the car**, with crossing canopy bounds retained in geometry. Individual triangles and instance transforms are classified in world space; the origin of a merged city mesh is never used as its location. The nearby block terrain/lawn, road, gutter, pavement, benches, hero trunks, palms, generic trees, lamps and all 18 houses remain geometry. Static surfaces are merged by material; house surfaces are exported as 20 m material cells so their loose bounds do not force the entire row to draw while looking into the park. The viewer combines visible facade cells into one index buffer per material, updating only when visibility changes; transparent runoff cells keep back-to-front ordering. This retains fine culling while keeping the phone under 60 calls throughout the measured orbit. Tight box culling supplements Three's sphere culling.

The far park, Mission rooftops, downtown, hills and sky are baked into cubemap faces captured at `(13.3, roadZ + 1.5, 154.63)` with the near field and car hidden. The backdrop is only the background. At the maximum 9 m orbit, the nominal boundary parallax error is about 9/180 = .05 radians (2.9°); there is still a small far-field seam/registration tradeoff. Moving the car or widening the orbit requires re-exporting, not just changing the camera.

Car/window reflections are captured once from the loaded near geometry plus the backdrop, with the car hidden, then filtered with PMREM. The lighting-only 128² desktop / 64² phone sky cube uses 25% saturation and 130% brightness to approximate the original pale HDRI fill; the visible backdrop is unchanged. This is an artistic LDR approximation, not the original HDR environment. Contact shadows stay live quads and are merged into one draw with per-vertex alpha. Paint conversion and the exact `1.36 m` half-wheelbase slope / `21.5 mm` lift come from shared `car.js`.

Live-profile reductions:

- All six 1.94 M-triangle Tree Small 02 copies are replaced by the existing original procedural canopy/trunk system. No new asset download or decimated third-party mesh is required.
- Hero branches retain their original curves but use 5/10 radial segments and 40% desktop / 24% phone longitudinal tessellation. Leaf count is 30% / 10%, with 6 / 3 longitudinal leaf segments instead of 9; slightly larger leaves retain crown coverage.
- Desktop canopy cards use 105–168 per crown, versus 145–238 offline. Phone uses one 28-card crown shape with per-tree colour, rotation and aspect variation, and four-sided trunks. Boundary membership varies slightly with each profile's crown bounds.
- Grass: 9,000 / 3,500 blades instead of 55,000. Phoenix palms: 64 / 40 live fronds instead of 108, 8 / 5 curve segments instead of 20, ten dead fronds instead of 22. Fan palms use 24 fronds instead of 38.
- Draco: 16-bit positions, 10-bit normals, 12-bit UVs. Meshoptimizer simplification uses ratios .8 / .4 and errors .0004 / .0015 with borders locked; topology can prevent reaching the requested ratio. Architectural ornament remains intact rather than forcing destructive simplification.
- Most park maps are 512 px maximum. Desktop asphalt and bark diffuse maps retain 1024 px. Original small house textures stay small. No distant traffic, legacy shadow-footprint proxies, GTAO, bloom or grain.

### Shader portability and the missing canopies

All six original `onBeforeCompile` snippets were moved verbatim into the registry: terrain detail, asphalt/wear, bark desaturation, hero-leaf translucency, palm translucency and dead palm colour. The gutter has its own named registry entry using the asphalt patch. Material names and `customProgramCacheKey` identify programs. The terrain's otherwise-black emissive map channel transports its custom detail sampler through glTF. The houses already use ordinary PBR maps/vertex colours and need no patch or shader fallback.

The previous experiment's comparison was asymmetric: its "before" kept the original **entire** instance batches whenever any near instances existed, while "after" contained only instances within 70 m. Far crowns therefore disappeared only in the second frame. This was primarily subset selection, not alpha or a missing canopy shader. The generic canopy material has no shader patch. The new exporter compares the exact same subset; all four desktop batches and the single intentional phone batch retain their instance and instance-colour counts through GLTFExporter/GLTFLoader. See `export-report.json`.

Offline regressions were captured before/after moving the registry and car code. Hero RGB mean absolute differences were about .18–.21 / 255, streetview .24–.38 / 255, within the existing nondeterminism noted above. The visual development included 28 rendered and inspected iterations, including both suns, the phone variant, and camera/LOD/batching changes. Explicit context-loss/restoration testing recreated one working canvas without errors; idle rendering, input, disposal and collision checks also passed.

### One sun and orbit constraints

| Parameter | Winter (default) | Summer (`sun=summer`) |
|---|---:|---:|
| Azimuth / elevation | 225° / 28° | 290° / 10° |
| Colour / intensity | `#fff0d8` / 6 | `#ffe2b7` / 5 |
| Exposure | 1.2 | 1.05 |
| Environment / hemisphere | .45 / .32 | .65 / .55 |

The sun never changes with the camera. Both candidates use the **same** live geometry, including the hero tree and benches; unlike the offline victorians preset, summer does not clear vegetation to light the car. New houses cast their real shadows. Winter shades most of the car; summer lights the facades better but retains foliage shadows. The softer skyline, simplified scanned-tree replacements, brighter/coarser fronds, lower-resolution shadows, LDR reflections, and missing screen-space AO remain visible differences from the still. This is an interactive reconstruction, not a pixel-identical recreation of the 24 M-triangle offline frame.

OrbitControls: no pan, damping .09, 4–9 m distance, polar angle .35–1.634 radians. The exact prescribed hero starts at `(8, -161, roadHeight(8) + 1.2)`, looking at `(12.9, -154.63, roadZ + 1.05)`. That initial look point is also the controls pivot to avoid a first-drag jump; alternative poses in the examples target car centre at +.6 m. Ground clearance is at least .45 m above a .25 m sampled tile of the builder's full `surfaceAt`, including the sloping park verge, rather than a flat road plane.

Azimuth keep-outs shorten the camera radius before the two trunk footprints, both benches, lamps and sidewalk trees. Trunks use .95 / 1.2 m footprints, benches 1.4 m, lamps/sidewalk stems .5 m, plus .25 m approach margin. Additional spheres sampled along the original large tree limbs protect the leaning trunk and overhead branches. Exported obstacle positions follow the same road centreline as the builder. A sweep of 900 angles/elevations per profile verified .45 m minimum ground clearance, ≤9 m distance, and no entry into either footprint or woody-sphere keep-outs.

### React port notes

1. Use `createDoloresViewer` as the reference lifecycle and remove the demo's bottom-level auto-call / DOM hint updates. Replace `/public/models`, `/public/scenery`, `/public/draco` with the site's public-root URLs (`/models`, `/scenery`, `/draco`). The import map is only for the standalone server; lazy-import Three, GLTFLoader, DRACOLoader, OrbitControls, the registry and shared helpers through the site's bundler.
2. Select desktop/phone once before loading. Load only its park GLB, six matching-sun background faces, and the unchanged car GLB. The viewer makes no requests to `archive/`, source data or offline textures. Retain the scene-root `userData.dolores` metadata for ground collision, road samples and placement. Keep material names during any later optimization.
3. Apply `restoreDoloresMaterials(park.scene, {toSun})` before compiling. Preserve the small lighting/reflection cube, static shadow caching, per-material batch bounds and contact merge. First-frame counts depend on these runtime choices, not just the GLB.
4. Start/crossfade only after the first render and probes complete. Use the delivered winter `poster-live.png` at the same default pose / 52° horizontal FOV / ACES exposure / aspect. The summer choice needs its summer poster. In the site shell, reduced-motion visitors can keep the poster and skip importing the viewer entirely.
5. Retain the existing `IntersectionObserver` and `document.hidden` gate. The reference schedules RAF only on input, damping, resize or load, and verifies zero frames while idle. `shot=1` ends with no scheduled loop. Do not auto-run the 120-frame diagnostic benchmark for visitors.
6. `dispose()` cancels RAF, disconnects both observers, removes visibility/context listeners, disposes controls/Draco, unique geometry/material/texture resources, decoded ImageBitmaps, PMREM targets, shadow target and renderer. Context loss pauses rendering; context restoration recreates the viewer and probes. For a React async effect, also guard late loader completion after unmount so it cannot append a new canvas.
7. Keep visible OSM attribution: **© OpenStreetMap contributors**, linked to `https://www.openstreetmap.org/copyright`. The GLBs have `asset.copyright` and top-level `extras.license` / `extras.source` for the original CC0 procedural work, CC0 Poly Haven textures, PDDL DataSF sources, public-domain USGS/USDA sources and ODbL-derived geometry. The separate car is never folded into the park GLB or relicensed. No new third-party production asset or code was downloaded.

The optional assessor-driven `houseEra=1` variant was not implemented; the existing artistic house mix remains the only house layout.

### Delivered visual review

The external `scratchpad/dolores5/renders/` directory contains the 28 development captures, JSON sidecars and final review sheets. Final captures are `18-final-default.png`, `19-orbit-behind.png`, `20-orbit-verge.png`, `21-orbit-high.png`, `22-final-phone.png`, `23-final-summer-default.png`, and `24/25-final-houses-{summer,winter}.png`. The final default was copied byte-for-byte to `scratchpad/dolores5/poster-live.png` at 1920 × 1200.

- `comparison-default.png`: full offline scene versus live, identical hero camera and winter sun, both using real house shadows.
- `comparison-deployed.png`: the legacy-shadow offline hero versus the live viewer, showing why the live car is shaded.
- `comparison-suns.png`: winter and summer at both the default and house-facing cameras.
- `orbit-contact-sheet.png`: default, three required orbit poses, phone and summer.

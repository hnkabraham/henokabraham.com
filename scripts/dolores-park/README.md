# Dolores Park scene

A three.js scene of 20th Street at the top of Mission Dolores Park, San Francisco, with the Garage's GT350 (`public/models/garage-gt350r.glb`) parked at the park-side curb. It renders offline stills in headless Chromium and exports the live Garage viewer. The site's Garage section runs the live viewer (`lib/dolores-park-viewer.js`) under a live sky: the real sun and Moon over the park, from the visitor's clock. The hero view above, formerly the site's still, remains the look reference. **Pass 6 and the live-sky section after it document the current live delivery; where they disagree, the live-sky section wins. Pass 5 is retained as historical implementation notes.**

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

The Garage posters are live-viewer renders of the default pose, one set per time of day, and the section picks the set for the sun's height at the park (above 3°, down to −6°, below): `garage-park*` with the fixed `sun=evening`, `garage-park-dusk*` at `time=2026-10-11T18:45:00-07:00` and `garage-park-night*` at `time=2026-10-11T21:30:00-07:00`. Each is `page=live w=1920 h=1200 dpr=1` for desktop, and `page=live phone=1 w=1440 h=1080 dpr=1`, kept at 1440 for tablets, for frames 800 px wide and under. They are encoded with Pillow as AVIF at quality 58 and JPEG at quality 84; the desktop poster also ships 960 px wide.

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


## Pass 6: sunlit Garage viewer

The reference page now defaults to **`sun=evening`**, with the original default pose and 52° horizontal FOV. The shared library deliberately retains its existing `winter` option default to preserve API semantics: **the site's integration should pass `{sun: 'evening', scrollFriendly: true}`**. `sun=winter`, `sun=summer`, and the reference page's `preset=victorians` alias for summer still work. The handle and existing options are unchanged; `evening` is added to the TypeScript sun union. No `app/` integration, car asset or paint-conversion values were changed.

### Chosen light and finish

| Parameter | Evening | Winter, unchanged | Summer, unchanged |
|---|---:|---:|---:|
| Azimuth / elevation | 272° / 34° | 225° / 28° | 290° / 10° |
| Colour / intensity | `#fff0dc` / 5.5 | `#fff0d8` / 6 | `#ffe2b7` / 5 |
| Exposure | 1.15 | 1.2 | 1.05 |
| Environment / hemisphere | .65 / .45 | .45 / .32 | .65 / .55 |

This is a near-west late-afternoon/early-evening summer-family sun, chosen from trials spanning 260–295° azimuth and 15–35° elevation. Raising it above the former low summer sun clears the house roofs and most tree streaks from the default car. West-facing bay returns catch direct light; the north-facing flat fronts receive mostly sky fill. It is an artistic, physically plausible San Francisco seasonal choice, not a dated solar simulation. The sun stays fixed throughout an orbit, and all real house shadows remain enabled.

The car uses a higher local probe, at road level +1.35 m, with 256² desktop / 128² phone capture faces. Its environment intensity is 1.45. The lighting-only sky cube uses 10% saturation and 145% brightness, with 1.8 background intensity during probe capture; neutral hemisphere colours reduce the former blue-grey cast. The visible backdrop is separate. This produces brighter neutral paint and more distinct body/glass reflections without changing the shared paint conversion. The probe is still a filtered LDR approximation rather than the offline HDRI.

### Geometry, surfaces and defects

- **Palms:** live Phoenix fronds have more droop, a wider range of elevations, narrower blades, lateral folds and irregular azimuths. Fan fronds use separated fingers with dropped tips, retaining the same triangle allocation per frond. Live greens are darker and less yellow; a separate `palm-fronds-live` registry patch reduces exaggerated transmission. Alpha maps retain 256 × 1024 desktop / 160 × 640 phone detail. Offline frond geometry, colours and transmission remain unchanged.
- **Lawn:** the near verge uses the existing CC0 grass diffuse map and a patchy green base instead of brown leaf-litter soil. Four-fifths of the existing 9,000 / 3,500 blades are concentrated in the visible x=1…28 m strip around the car. Narrower, lower blades and darker greens avoid paper-like triangles. The curb and pavement geometry are unchanged. Grass farther around the park keeps the existing terrain treatment.
- **Windows:** the pink-house white panel was a strong specular/clearcoat glint from the live metallic, low-roughness glass. A diagnostic with specular response disabled removed it. Live windows now use predominantly dielectric glass, higher roughness and a weak, rough clearcoat. The exporter also preserves physical-material identity during material grouping. The former summer trouble view and views around the row were inspected; soft reflections remain, but the glaring white panel is gone. Offline glass is unchanged.
- **Houses:** slight per-house value variation and baked vertex darkening on undersides and returns strengthen cornices, bays and reveals. This is inexpensive directional cavity shading, not ray-traced ambient occlusion. It survives GLB export without a new map or shader and does not add triangles or calls.
- **Horizon:** the live sky's pale-blue horizon and broader gradient replace the abrupt near-white band. Downtown remains simplified geometric massing.
- **House shadow block:** this was real winter occlusion, not a leftover proxy or backdrop rectangle. A ray from the shaded verge toward the winter sun hit the exported `Painted wood / subtle grain` house geometry; disabling direct sunlight removed the boundary. Evening moves that large shadow away from the near verge in the reviewed behind-car view. Winter intentionally retains it.
- **Licences:** exported source strings now point to [DataSF](https://data.sf.gov/). No new third-party assets were downloaded. `fetch.py assets` verifies the existing manifest.

### Backdrops and packing

Winter retains `dolores-sky-*.webp`; any other sun uses `dolores-sky-<sun>-*.webp`, with `-phone` before the face name for phone. All winter, summer and new evening sets are present. A viewer downloads only its chosen set.

Desktop faces are 1792² WebP at quality 86, without runtime mipmaps. Phone assigns 1536² faces at quality 85 to east/north (`nx`, `nz` in the image-cubemap convention), and 512² at quality 63 to the other four directions. One original background shader samples six independent 2D faces, allowing different resolutions without promoting every face to the largest allocation. It preserves the same handedness and baked colour as the desktop background and costs one draw. This doubles phone downtown resolution while keeping its transfer and texture allocation within budget. The low-resolution lighting cube is independent of those visible faces.

The exporter now carries texture names from Three's texture definitions into glTF Transform image resources before filtering. Every image receives a nonempty name, and the exclusion pattern rejects empty URIs so they cannot accidentally bypass name-based sizing. Desktop bark/asphalt diffuse maps retain 1024²; phone bark/asphalt normals use 256². Small house maps stay small. The ground collision tile's existing 0.1 mm samples are losslessly packed as gzip/base64 int32 values in GLB extras, saving roughly 115 KB. The viewer decodes them with native `DecompressionStream` before creating its WebGL context and supports the previous unpacked metadata too. This introduces no package or extra fetch.

### Current measurements

`live-report.json` is the machine-readable result from `verify-live.mjs`, using **evening**, `scrollFriendly=1`, and the site's frame sizes: desktop 950 × 593.75 CSS px at DPR 2, phone 390 × 292.5 CSS px at DPR 2. Hardware is Apple M2 Max / Chromium ANGLE Metal. Phone here means the phone profile on this Mac, not a physical-phone performance measurement. MB are decimal.

| Resource | Desktop | Limit | Phone | Limit |
|---|---:|---:|---:|---:|
| Park GLB + evening backdrop, excluding car | 4.744 MB | 6 MB | 2.986 MB | 3 MB |
| Settled default triangles, including car | 801,282 | 900,000 | 392,653 | 400,000 |
| Default draw calls | 60 | 120 | 57 | 60 |
| Orbit peak draw calls | 62 | 120 | 59 | 60 |
| Estimated texture memory | 156.64 MB | 160 MB | 60.53 MB | 64 MB |
| Shadow map | 2048² | 2048² | 1024² | 1024² |
| Median completed frame | 2.3 ms | 8 ms | 1.5 ms | — |
| Local load through first frame | 889 ms | — | 737 ms | — |

Frame time includes CPU submission and synchronous one-pixel readback, after 24 warmup frames over 120 orbit frames. These figures are not directly comparable with Pass 5's larger 3200 × 2000 drawing buffer. Static shadows and probes are still one-time load work: initial shadow-plus-colour submissions are 2,060,428 triangles / 111 calls desktop and 1,229,576 / 105 phone, with six-face probe capture additional. The triangle limit applies to the settled default pose; the phone's scripted orbit peaks at 490,355 triangles. Draw-call limits pass at the default and orbit peak.

Texture estimates include car maps, decoded backdrop faces, mip chains where used, retained PMREMs, and shadow storage; they exclude canvas colour/depth/MSAA attachments and CPU buffers. The viewer remains idle after controls settle. All 900 collision samples per profile, input, disposal, and explicit context-loss/recovery checks pass.

### Reproduce and review

Run `node scripts/dolores-park/export.mjs` after scene changes, then `node scripts/dolores-park/verify-live.mjs`. `npx oxlint --ignore-pattern '.claude/**' scripts/dolores-park lib` is clean; changed JavaScript is formatted with `oxfmt`. The asset manifest was verified with `python3 scripts/dolores-park/fetch.py assets`.

Set `OUT` to an external render directory. Poster commands use DPR 1 explicitly; the phone poster is 4:3, not a narrow crop of the desktop image:

```sh
node scripts/dolores-park/render.mjs "$OUT/poster-desktop.png" page=live sun=evening dpr=1 w=1920 h=1200
node scripts/dolores-park/render.mjs "$OUT/poster-phone.png" page=live sun=evening phone=1 dpr=1 w=1440 h=1080
node scripts/dolores-park/render.mjs "$OUT/behind.png" page=live pose=20,-151,1.5,12.9,-154.63,1.05 dpr=1 w=1920 h=1200
node scripts/dolores-park/render.mjs "$OUT/high.png" page=live pose=8.4,-159.1,5.2,12.9,-154.63,1.05 dpr=1 w=1920 h=1200
```

The external `dolores6/` delivery contains `poster-desktop.png` (1920 × 1200), `poster-phone.png` (1440 × 1080), `renders/comparison-still.png`, and `renders/orbit-sheet.png`. Posters are byte-for-byte copies of viewer captures. The six-view sheet includes default, behind, verge, high three-quarter, house-facing and the uncropped 4:3 phone frame, with orbit distances 7.74–8.05 m. More than 40 renders were generated and inspected, including sun trials, side-by-side still comparisons, material diagnostics and window views around the car.

Both prescribed offline views were rendered before and after the scene work. Streetview at 1600 × 1360 has mean absolute RGB difference **0.257 / 255**; the deployed hero camera at 1920 × 1200 has **0.198 / 255**. The 99th percentile is 4 / 255 for each. Visual inspection found no change beyond the known rendering noise. The winter/summer sun values and all offline-only material/geometry branches retain their original behaviour.

### Remaining weaknesses

The car now holds direct sunlight at the default pose, but its lower door and glass reflections still differ from the still's HDRI/post-processed result. Palms have clearer fronds yet retain procedural repetition; nearby tree cards and thin grass blades are visible at some angles. The lawn is healthier but still a repeated texture, and north-facing house fronts remain stylised without full indirect light or contact AO. Phone shadows are softer at 1024². Non-downtown phone backdrop directions are lower resolution, and the 180 m far-field split still has parallax error when orbiting. The backdrop is baked, so a different sun or wider camera travel requires another export.

### Orbit range (added after pass 6)

The orbit no longer goes all the way round. Swept at the default pose's 8 m with zoom off (the site's `scrollFriendly`), the park side was cluttered. From about 172° to 255° round from the default view, first a bench filled the foreground, then the keep-outs pulled the camera in to 5.4 m so the car's nose left a 4:3 frame, then the leaning trunk filled one side. OrbitControls' `minAzimuthAngle` and `maxAzimuthAngle` now stop the orbit either side of that arc. The bearings are taken from `DEFAULT_POSE` and reported in radians as `info.orbit.azimuth`. From 255° to about 270° the keep-outs still pull the camera in to about 6 m, with the whole car in frame. `constrainCamera()` and its keep-outs are unchanged and still verified by `verify-live.mjs`. A custom `pose=` inside the arc still renders, but the controls move it to a wall on the first drag.

## Live sky (added after pass 6)

The viewer's default sun is now `live`: the true position of the sun and Moon over the park's origin for the visitor's moment, so a visit at 8 am, at sunset or at midnight looks like that hour on 20th Street. The fixed `winter`, `summer` and `evening` suns still work; `evening` is the old look and renders the day poster.

- **Astronomy.** `lib/sun-position.js` has no three.js, so the Garage section can pick its poster without loading it. The sun uses NOAA's solar position equations, with refraction; the Moon uses the largest terms of Meeus ch. 47, topocentric parallax and the lit fraction of its disc. Checked against published San Francisco times: sunset on 2026-10-11 at 6:38 pm, solar noon at 12:56 pm at 45°, and noon at 28.8° and 75.7° on the solstices.
- **Lighting.** `doloresSky()` in `lib/dolores-park-lighting.js` interpolates key frames by sun elevation, all in display sRGB: sky zenith and horizon, the glow towards the sun and the pink belt opposite it, sun colour and strength, exposure, environment and hemisphere fill, and how far the lamps and windows are on. The 25° frame is the tuned `evening` daylight. Below about −1° the shadow-casting light becomes the Moon when it is up, scaled by its phase; otherwise it is off. Exposure opens up after dark the way eyes adjust.
- **Sky and far field.** The viewer draws the sky itself (gradient, sun disc and aureole, the Moon lit from the true sun direction, which gives its phase and bright-limb tilt, and a few stars), then composites the far field over it from six baked faces. `export.mjs` bakes four far fields: `morning` (115° at 30°), `midday` (180° at 50°), `afternoon` (245° at 30°) and `night` (lit windows, no sun). A visit fetches one: the day bake nearest in bearing, or `night` once the sun is 4° below the horizon. Each face is captured over a transparent sky twice, with black and with white fog. Their difference is the fog amount, which goes into alpha, and the colour is stored premultiplied. Distant hills therefore fade into whatever sky the viewer draws, not into the bake's haze. The faces are decoded with `premultiplyAlpha: 'none'`, or the browser premultiplies them a second time. The East Bay ridge, unlit and unfogged in `scene.js`, is captured as 65% of a blue-grey silhouette (dark in the night bake). Through dusk the day bake is tinted down; the night bake is used as is.
- **After dark.** The row's two lanterns get point lights and one additive glow draw, added the first time they're needed so daytime shaders carry no extra lights. Victorian windows light by a hash over their panes, which are found as connected pieces of the glass mesh at load. The leaves' and fronds' back-light patches scale with the sun.
- **Reflections follow the sky.** The lighting-only environment cube and the car's reflection probe are both rendered from the live sky, rather than from canvas-filtered faces.
- **Following the clock.** Without a fixed `time`, a live viewer re-evaluates once a minute while the canvas is on screen and nobody is dragging. When the sun (above −18°) or the Moon (above the horizon) has moved half a degree, about every two minutes, it relights and redraws the shadow map and probe (about 20 ms on desktop). The far-field bake stays the one loaded. The first relight that turns the lamps on also compiles the lit shaders, once, in about half a second.

Reproduce:

```sh
node scripts/dolores-park/export.mjs --backdrops-only            # all four backdrops; --backdrop=night for one
node scripts/dolores-park/render.mjs out/dusk.png page=live time=2026-10-11T18:45:00-07:00 w=1920 h=1200 dpr=1
node scripts/dolores-park/verify-live.mjs                         # a fixed day and night on both profiles
```

`live.html` takes `time=` (ISO, or milliseconds) for a fixed moment. `viewer.setTime(date)` relights an open viewer, and `info.sun` records the time, sun, Moon and backdrop a frame was lit for.

Measured at the site's frame sizes on the M2 Max (`verify-live.mjs`, 2026-10-11, three runs):

| | Download | Triangles | Calls | Texture memory | Median frame |
|---|---|---|---|---|---|
| Desktop, day | 4,786,096 | 801,282 | 60 | 156.6 MB | 2.6–3.6 ms |
| Desktop, night | 4,584,498 | 801,986 | 61 | 156.6 MB | 3.3–4.1 ms |
| Phone, day | 2,977,004 | 392,653 | 57 | 60.5 MB | 1.5–2.6 ms |
| Phone, night | 2,923,286 | 393,357 | 58 | 60.5 MB | 2.3–2.8 ms |

The largest phone download, with the `morning` bake, is 2,980,396 bytes against the 3,000,000 budget; the phone faces use lossy alpha at quality 80 to fit. Daytime frame times overlap pass 6's 2.2–2.9 ms; nights, with the lamps, run up to about a millisecond longer.

Known limits: the far field is baked for four suns, so a low sun lights distant facades from the bake's bearing, not its own. There is no weather; San Francisco's fog and overcast aren't modelled. The car sits in the row's shadow whenever the sun is low in the south or west, which is most of a winter day. That is what the street is like, but it's darker than the old fixed evening.

## Load time (added after the live sky)

The first frame needs 56 shader programs (58 at night, with the lamps). The park's surfaces need them twice: once for the reflection probe, a render target, so linear and without tone mapping, and again for the screen. The car needs its own as well. three.js links a program synchronously the first time it draws, so the probe capture and the first frame held the main thread in one task of about 580 ms.

The viewer now issues all of them with `renderer.compile()` once the sky's lighting cube exists. The car and the windows wear a blank PMREM the probe's size, so their programs match the real probe's. Then the viewer polls `KHR_parallel_shader_compile` until every program is linked, reading back finished programs' uniforms about 10 ms at a time. An abort or a lost context during that wait releases everything built so far. Afterwards `renderer.info.programs` is the same length as before the change. Frames match the old viewer's within its own run-to-run noise: the mean difference is 0, and at most 16 of 2.26 million pixels differ.

Measured on the M2 Max against the local server with a warm cache:

| | Before | After |
|---|---:|---:|
| Chromium desktop, load through first frame | ~705 ms | ~440 ms |
| Chromium desktop, longest main-thread task | ~580 ms | ~130 ms |
| Chromium phone profile, load through first frame | 719 ms | 401 ms |
| WebKit desktop, build after download (median of 6) | ~940 ms | ~840 ms |

WebKit's wait for the shaders is longer and varies from run to run, at 300–460 ms. Its gain is mostly that the page stays responsive: about half of that build is now waiting rather than blocking.

The longest remaining task is the synchronous build before the wait: house batching, the sky capture with the far-field upload, and generating the shader sources.

On an ordinary connection, though, the download was most of the wait (about 1.6 s for the park model at 30 Mbps), so the Garage component (`app/garage-park-scene.tsx`) now starts sooner:

- **Desktop prefetch.** A desktop visit fetches the viewer's files at low priority, 3 s after the page's load event, by when the tour's own downloads have normally finished. `doloresViewerFiles()` returns the list: the park, the car and the six faces of the bake for the current sun, about 5.7 MB. If the viewer starts while a prefetch is still in flight, it waits on that request instead of making its own. Files that have already arrived come from the HTTP cache, since scene files are cached immutably.
- **No prefetch on phones,** where the files are 3.9 MB. Visitors with Save-Data on get the site's simple view, with no scene at all.
- **Earlier start.** The viewer now starts when the frame is 1,200 px below the viewport rather than 300 px.

With a steady scroll from the top at 30 Mbps, the frame was ready 0.7 s before it came into view. The previous build was ready 2.0 s after.

Jumping to the Garage from the header still waits on the tour, about 0.6 s on the jump, before the viewer starts.

## Look pass (added after the load-time work)

A review with Codex Astra (gpt-6-astra) found four runtime changes that improve the frame at no measurable cost. All their values are in `LOOK` at the top of `lib/dolores-park-viewer.js`.

- **The car's reflections.** The reflection probe had been capturing the sky in the lighting-only mode: desaturated to 0.1 by day, brightened and clipped at 1. That gave the paint a flat, matte look. The probe now has its own `mode` 2, in linear light, at saturation 0.35 by day and 0.7 at night, with gain 1.5 by day and 1.25 at night. Highlights roll off smoothly towards a luminance of 4 instead of clipping. The lighting-only cube and the visible sky are unchanged.
- **Body paint.** Roughness 0.33, clearcoat 0.75 and clearcoat roughness 0.15, against 0.45, 0.35 and 0.25 before. Metalness stays at 0.1. `WheelPaint_*`, which the paint test also matches, keeps the old values.
- **Window glass.** The blue baked into the glass's vertex colours is cut to 35% saturation, so the panes read as dark glass rather than navy paint. The review also proposed sharper, more specular glass (roughness 0.27 and specular intensity 0.8, against 0.42 and 0.2). In the summer view that brought back the pink bay window's sun glint from pass 6, as cream-and-black blotches under the tree's dappled shadow. So the glass keeps its old finish.
- **Lantern glow.** The glow is now a tight core (power 90, gain 1.8) with a faint halo (power 6, gain 0.1). It no longer washes a white haze over the nearest facade. It's still one draw.

Program counts are unchanged at 56 by day and 58 at night. The night glow's probe variant is now among the shaders compiled ahead of the first frame. `verify-live.mjs` reports the same downloads, triangles, draw calls and texture memory as before. Median frames are 2.6 and 3.4 ms on desktop by day and by night, and 2.2 and 2.1 ms on the phone profile.

Tried and left out:

- **Screen-space AO (three's GTAOPass).** It took a frame from 2.6–3.5 ms to 7.0–7.5 ms at 1900 × 1188 for a faint effect. It drew the leaf cards as rectangles, and through `OutputPass` it tone-mapped the sky, which is authored without tone mapping.
- **Neutral and AgX tone mapping.** Neutral is crisper by day. At dusk and night it turns the foliage green and the road blue-purple, and every key frame's exposure would need retuning. AgX washes the frame out.
- **Street-tree crown normals and a lower leaf cutoff.** These made the crowns milky and grey-green.

Still open, in the review's order: a desktop-only baked ambient-occlusion pass for the houses at export, to give the shaded north-facing fronts their depth; rebaking the night far field with windows lit in coherent groups, not scattered pixels; and procedural variation for the near lawn.

## Pass 5: orbitable web profile (historical)

The following records Pass 5's original output and measurements. Pass 6 above supersedes its default sun, backdrop sizes, material settings, budgets and poster instructions.

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
- `lib/dolores-park-viewer.js` and `.d.ts`: the viewer itself, `createDoloresViewer(container, options)`, shared by the site's Garage section and `live.html` / `live.js` (the reference page, which maps URL parameters to options and sets the `window.*` hooks below); `lib/dolores-park-car.js`: identical shared paint conversion, wheelbase slope, lift and contact-shadow construction; `lib/dolores-park-lighting.js`: the two shared sun parameter sets.
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

Car/window reflections are captured once from the loaded near geometry plus the backdrop, with the car hidden, then filtered with PMREM. The lighting-only 128² desktop / 64² phone sky cube uses 25% saturation and 130% brightness to approximate the original pale HDRI fill; the visible backdrop is unchanged. This is an artistic LDR approximation, not the original HDR environment. Contact shadows stay live quads and are merged into one draw with per-vertex alpha. Paint conversion and the exact `1.36 m` half-wheelbase slope / `21.5 mm` lift come from shared `lib/dolores-park-car.js`.

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

1. The site imports `lib/dolores-park-viewer.js` directly: `load(path)` maps public-root paths (`/models/…`, `/scenery/…`) to versioned URLs, `dracoPath` points at the site's decoder, and `scrollFriendly` turns zoom off and sets `touch-action: pan-y`. The import map is only for the standalone server.
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

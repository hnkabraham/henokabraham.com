# Dolores Park scene

An offline three.js scene of 20th Street at the top of Mission Dolores Park, San Francisco, with the Garage's GT350 (`public/models/garage-gt350r.glb`) parked at the park-side curb. It renders stills in headless Chromium. The Garage section's "Dolores Park" view, `public/images/garage-dolores*.{avif,jpg}`, is one of them.

It's a reconstruction: real terrain, footprints, tree positions and city massing, plus modelled foliage, facades and street detail. It reads as CG, not as a photograph. The framing was matched by eye to a Google Street View frame at 3851 20th St. That frame isn't in this repository, and the scene never loads, samples or traces any Street View or other proprietary imagery.

## Files

- `scene.html`: the scene, camera presets, lighting, materials, reflection probes and post-processing. Its URL parameters are documented below.
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
- **The scene's size:** it's far too heavy to run live on a phone. It has about 24 M scene triangles, an 8192² shadow map, two reflection captures and full-resolution post-processing.
- **A live version would need:**
  - the background baked into layers for a fixed camera, with only the car interactive;
  - level-of-detail meshes for the vegetation;
  - compressed textures;
  - baked shadows and reflections.

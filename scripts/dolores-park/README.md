# Dolores Park scene

An offline three.js scene of 20th Street at the top of Mission Dolores Park, San Francisco, with the Garage's GT350 (`public/models/garage-gt350r.glb`) parked at the park-side curb. It renders stills in headless Chromium. The Garage section's "Dolores Park" view, `public/images/garage-dolores*.{avif,jpg}`, is one of them.

It's a reconstruction: real terrain, footprints, tree positions and city massing, plus modelled foliage, facades and street detail. It reads as CG, not as a photograph. The framing was matched by eye to a Google Street View frame at 3851 20th St. That frame isn't in this repository, and the scene never loads, samples or traces any Street View or other proprietary imagery.

## Files

- `scene.html`: the scene, camera presets, lighting, materials, reflection probes and post-processing. Its URL parameters are documented below.
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
node scripts/dolores-park/render.mjs out/east.png preset=west cam=-3,-164 heading=101 w=1600 h=1360
node scripts/dolores-park/render.mjs out/hero.png preset=streetview cam=8,-161 camH=1.2 look=12.9,-154.63,1.05 fov=52 w=1920 h=1200
```

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
| Building footprints and heights | DataSF LiDAR-derived footprints; OSM outlines where DataSF has none |
| Street-tree positions and species groups | DataSF street-tree inventory |
| Park canopies | Dark-green NAIP pixels, excluding buildings and roads |
| Roads and their names | OpenStreetMap |
| Downtown massing | DataSF footprints; Salesforce Tower and the Transamerica Pyramid modelled from their known shapes |
| East Bay ridge | Mapzen/Terrarium elevations, approximate registration, 1.18× vertical scale |
| Foreground tree, benches, palms' shapes, facades, grass and sky | Original procedural geometry and CC0 textures |
| House shadow across the near street | The shallow building behind the camera raised 3 m (`nearRoofLift`), an artistic override |
| Distant parked cars | Quaternius's CC0 car, repainted |

## Main parameters

| Parameter | Default | Meaning |
|---|---:|---|
| `preset` | — | `streetview`, or `west`: the east-looking view, legacy name, heading 95° unless overridden |
| `cam`, `camH` | 8.4,−162.35 / 2.85 | Camera x,y and height above the road |
| `heading`, `pitch`, `fov` | 28.2 / −3.5 / 65 | Street view pose |
| `look` | — | x,y,height target, height relative to the car's road level; overrides heading/pitch |
| `w`, `h` | 1600 / 1360 | Output size |
| `carX`, `carY` | 13.3 / −154.63 | GT350 position |
| `sunAz`, `sunEl`, `sun` | 225 / 28 / 6.0 | Sun bearing, elevation, intensity |
| `exposure`, `env`, `hemi` | 1.2 / .45 / .32 | Exposure, HDRI fill, hemisphere fill |
| `carEnv`, `carReflections` | 1.4 / 1 | Strength of, and switch for, the local reflection probe on the car |
| `nearRoofLift` | 3.0 | Artistic height added to the building that casts the near shadow |
| `ao`, `aoGain` | 1 / .58 | Ground-contact ambient occlusion |
| `bloom`, `grain` | 1 / .0022 | Post-processing |
| `heroLeaves`, `heroTreeScale` | 1 / 1 | Foreground tree leaf count and scale |
| `clearRadius`, `grassBlades` | 33 / 55000 | Data trees cleared near the camera; verge blades |
| `benchX`, `benchGap` | 15.8 / 3.2 | Bench placement |
| `hillScale`, `hillContrast`, `cityPale` | 1.18 / .65 / .24 | Ridge and distant-city look |
| `conifer`, `traffic` | 0 / 1 | Rusty-tree experiment; distant cars |
| `debug` | 0 | 1 labels landmarks, benches, the car footprint and the curb |

## Known weaknesses

- **Palms:** the crowns have a procedural rhythm.
- **Foreground tree:** it reads as modelled geometry.
- **Downtown:** it's simplified blocks.
- **Mission rooftops:** they lack a photograph's variety in the middle distance.
- **East view:** the trim and bays repeat, with little weathering.
- **The scene's size:** it's far too heavy to run live on a phone. It has about 24 M scene triangles, an 8192² shadow map, two reflection captures and full-resolution post-processing.
- **A live version would need:**
  - the background baked into layers for a fixed camera, with only the car interactive;
  - level-of-detail meshes for the vegetation;
  - compressed textures;
  - baked shadows and reflections.

# Scene assets

## Boeing 787-9

- Author: [Nobilis2](https://sketchfab.com/nobilishornet2).
- Original: [Boeing 787-9](https://sketchfab.com/3d-models/boeing-787-9-b6711e2e698e4e469675c1154a50b7a3), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Optimized derivative downloaded from [God’s Eye View](https://github.com/bilawalsidhu/gods-eye-view/blob/main/public/models/README.md): `https://raw.githubusercontent.com/bilawalsidhu/gods-eye-view/main/public/models/b789.glb`.
- Local: `public/models/boeing-787-9.glb` (470,200 bytes). The GLB embeds its author, license and original URL.
- Upstream derivative: geometry/material simplification, 256px WebP texture, real-meter scale, Y up, nose −X. Runtime additions here: folding modeled landing gear, rounded tires, fan pivots, elastic wing deformation with matching shadow geometry, physical clearcoat paint with a generated low-amplitude skin-waviness normal map, procedural skin detail drawn from model coordinates (composite barrel joints, door outlines, belly grime and sparse wing panel lines that fade below a pixel), metal finishes, scene lighting and animation. The body asset itself is retained unchanged.

## Real Bay Area terrain

- Source: [ESA, San Francisco Bay](https://www.esa.int/ESA_Multimedia/Images/2020/05/San_Francisco_Bay), acquired January 25, 2019, [CC BY-SA 3.0 IGO](https://creativecommons.org/licenses/by-sa/3.0/igo/).
- Required credit: **contains modified Copernicus Sentinel data (2019), processed by ESA**.
- Source JPEG: 10,980 × 14,367, approximately 10 m pixels. Crop: `[3500, 5200, 8300, 10000]`.
- Derivative: `public/scenery/sf-bay-mobile.webp` (2048², 23 m/px), retained under CC BY-SA 3.0 IGO and now served to every device; the 4096² version was dropped once the NAIP corridors carried everything the camera looks at closely. Crop and resize are the only image edits.
- Approximate affine registration to ten USGS reference image patches: RMS 1.06 source pixels in the central Bay. Metadata: `public/credits/bay-georeferencing.json`. Registration is scenery positioning, not survey accuracy.
- Scene axes follow source-image pixels at 10 meters per pixel, origin at estimated 28R displaced threshold `[5666.01015, 8672.84973]`. Detailed runway aligns toward the 10L end. The flight path, gear and runway details are an artistic reconstruction. Satellite city detail is draped over actual terrain; SFO buildings are extruded from the separately credited OpenStreetMap footprints below.

Elevation uses [Mapzen/Terrarium](https://github.com/tilezen/joerd/blob/master/docs/formats.md) tiles at zoom 12, columns 652–660 and rows 1579–1588 (90 tiles, about 30 m per pixel at this latitude), from `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`. Credit: Mapzen terrain tiles; United States 3DEP and global terrain data courtesy of the U.S. Geological Survey; ocean terrain data from NOAA. [Full attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).

`public/scenery/bay-elevation.webp` (422,768 bytes) is a resampled 1025² grid of quarter-meter elevations, stored losslessly as the red (high byte) and green (low byte) channels of an RGB WebP so browsers decode it natively and exactly. Ocean values are clamped to zero, the airfield apron is leveled. Preparation, including downloading any missing tiles: `python3 scripts/prepare-bay-terrain.py /path/to/source-assets`. The scene samples the grid one-to-one into 1024² terrain segments on desktop (about 47 m per vertex) and every second sample into 512² on mobile, with a floating origin for stable precision.

## Daylight

- [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky), Greg Zaal and Jarod Guest, [CC0](https://polyhaven.com/license).
- Local: `public/scenery/daylight.hdr`, 1024 × 512, 1,435,119 bytes. Image-based illumination and reflections for the fallback sky only; it is not requested when the atmosphere renders. Under Takram's scattering renderer the sun colour comes from the transmittance table and image-based light from a sky cubemap rendered around the aircraft, so the visible sky, the haze and the lit surfaces share one set of units. Three.js's Sky shader remains the compatibility fallback.

## Clouds and fallback

- `public/images/cloud-sprite.png`, 1024px transparent generated cumulus. Retained source asset; no longer rendered in the clear-sky flight.
- Generation prompt: Photoreal isolated white cumulus cloud cluster, landscape 3:2, transparent RGBA background, luminous upper-right sunlight, cool pale-blue shadows, feathered semitransparent wisps, generous transparent margins. No sky, floor, horizon, aircraft, text, or logos.
- `public/images/cruise-sky.jpg`, generated static fallback for loading and unavailable WebGL.
- Generation prompt: Photoreal 16:9 aviation sky at cruising altitude, porcelain blue sky, luminous white cumulus below a mid-low horizon, larger cloud banks lower right, warm upper-right sunlight, open left text space. No aircraft, buildings, text, logos, or window frames.

## Audio and project image

Optional jet/wind ambience is synthesized locally with Web Audio. No third-party recordings. The Downshift screenshot is an optimized copy of the user’s `Developer/RevMatchApp/docs/images/downshift-dashboard.png`, explicitly labeled as simulator mode.

## Design reference

[Henry Heffernan’s portfolio](https://github.com/henryjeff/portfolio-website) informed the ambition of a coherent environment. Its code and assets were not copied. This site’s scroll-controlled Bay departure and project terminal are original implementations.

## Close SFO scenery

- Source: [USGS / USDA NAIP, The National Map](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer), public domain. Acquisition date: 2022-05-18; source resolution 0.6 m.
- `public/scenery/sfo-detail.webp` (4096², approximately 1.59 m/px) and `sfo-detail-mobile.webp` (2048², approximately 3.17 m/px) are derived from a 6.5 km square orthoimagery mosaic. These use EPSG:3857, north up.
- Outer bounds in Web Mercator meters: west -13626825.603526574, south 4521217.699661355, east -13618619.768127132, north 4529423.535060797.
- Three further exports from the same service, prepared with `python3 scripts/prepare-naip-layers.py /path/to/tile-cache` (4 × 4 mosaics of 2048² tiles at twice the target resolution, Lanczos-downsampled), all north up in EPSG:3857 with these outer bounds in Web Mercator meters:
  - `naip-runway.webp` (4096², 0.63 m/px, 1,502,708 bytes; `-mobile` 2048², 423,470 bytes): a 2.6 km square around the 28R threshold and rotation point. West -13623646.065, south 4524879.257, east -13621046.065, north 4527479.257.
  - `naip-south.webp` (4096², 3.91 m/px, 3,041,996 bytes; `-mobile` 611,472 bytes): 16 km from the airport's north edge over the peninsula cities to San Bruno Mountain and the southern city. West -13631947.74, south 4525293.17, east -13615947.74, north 4541293.17.
  - `naip-north.webp` (4096², 3.91 m/px, 4,132,122 bytes; `-mobile` 866,060 bytes): 16 km over San Francisco, the Golden Gate, Angel Island and the Marin shore. West -13636902.989, south 4542449.687, east -13620902.989, north 4558449.687.
  - The two corridor layers are requested after the first frame and fade in over about a second, so the opening shot does not wait for them.
  - `naip-city.webp` (planned, 8192², 1.5 m/px, desktop only): a 4 × 4 mosaic of 2048² exports over northern San Francisco, west -13636000, south 4545000, east -13623712, north 4557288, produced by `python3 scripts/prepare-naip-layers.py /path/to/tile-cache city`. The layer, its bounds (`CITY_BOUNDS`) and its lazy load are wired in `lib/bay-surface.ts` and `app/bay-flight-scene.tsx` behind `CITY_IMAGERY_READY`, which stays false until the file exists: the USGS export service answered every request for this area with a gateway timeout on 2026-09-09.
- `lib/bay-surface.ts` stacks these layers coarse to fine in one Web Mercator frame derived from the existing affine registration, feathers each border, and gently balances exposure at rendering time. Under the fallback sky non-water land retains the photograph's baked light; under the physical atmosphere it is treated as albedo lit by the same sun and sky. Low-elevation water receives restrained physical reflections from a generated tileable ripple normal at three scales, from metre ripples to kilometre wind streaks. Within about 900 m of the camera, two scales of the photographed asphalt colour and normal maps below add the grain that metre-scale orthoimagery cannot carry, fading out with distance.
- `public/scenery/sfo-buildings.json`: 562 real OSM footprint features, with original IDs and geometric rings preserved. **© OpenStreetMap contributors**, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), [attribution](https://www.openstreetmap.org/copyright). This dataset remains separately licensed under ODbL.
- Source query: OpenStreetMap Overpass, bbox south37.607 / west-122.401 / north37.641 / east-122.373, retrieved 2026-09-09. Non-rendering address/contact tags were omitted. Tagged heights are preferred; floor counts use 3.2 m per floor, otherwise generic buildings use 8 m and hangars 15 m as explicit scene estimates. Most building parts are omitted to prevent overlap, except the tower cabin. The imagery is from 2022 and OSM reflects a later date.
- `lib/sfo-buildings.ts` retains polygon holes and batches roofs/walls into two draw calls, with a deterministic per-building tone and procedural glazing bands every 3.6 m on the walls. This is simplified massing, not a surveyed building reconstruction.

## Corridor city massing

- `public/scenery/bay-buildings.bin.gz` (229,536 buildings, 1,525,991 ring vertices, 4,757,242 bytes gzipped; `-mobile` 37,784 buildings, 1,105,533 bytes): every building footprint between the airport and the Golden Gate, from two public sources, packed by `python3 scripts/prepare-city-buildings.py fetch|fetch-sf|build --cache /path/to/cache`.
  - San Francisco (164,775 footprints): [DataSF Building Footprints](https://data.sf.gov/resource/ynuv-fyni.json), City and County of San Francisco, [ODC Public Domain Dedication and License](http://opendatacommons.org/licenses/pddl/1.0/). Footprints collapsed from a 2010 Pictometry model and split along parcel lines, with LiDAR-derived heights per footprint (`hgt_median_m`, the median first-return height above ground; peaks up to 35 % higher are honoured through `peak_1st_m` − `gnd_min_m`). Retrieved 2026-09-09 through the SODA API in pages of 40,000 rows.
  - Peninsula cities south of the county line at 37.7085° N (64,761 footprints): OpenStreetMap, 40 Overpass tiles covering south 37.60 / west -122.52 / north 37.715 / east -122.35, `way["building"]` and multipolygon relations with member geometry, retrieved 2026-09-09. **© OpenStreetMap contributors**, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), [attribution](https://www.openstreetmap.org/copyright). The airport bbox already covered by `sfo-buildings.json` is excluded, as are underground and `building=no` features. Tagged `height` (metres or feet) is preferred, then `building:levels` × 3.3 m plus roof levels, otherwise a per-type estimate (7.5 m houses, 9 m generic residential, 13 m apartments, 14 m offices, 8–9 m warehouses, and so on) jittered ±12 % by a hash of the OSM id; untagged `building=yes` footprints over 900 m² are treated as warehouses. Nearly all peninsula buildings use such an estimate; only a few hundred carry height or level tags.
  - The packed binary is a derived database of both sources and stays under their licences; the script regenerates it.
- Processing: only outer rings are kept, simplified with a 1 m Douglas–Peucker tolerance and quantised to 0.5 m around each footprint's centre (byte offsets where a footprint fits in ±63 m, shorts otherwise); rings are written counter-clockwise, roofs that a fan from the first vertex cannot cover (concavities deeper than 0.5 m) carry ear-clipped triangles. Footprints under 30 m² and 12 m are dropped. Building kinds (residential, commercial, industrial, tower) drive the wall glazing; DataSF has no use tags, so there they follow height and footprint area. The file is stored gzip-compressed and inflated in the browser with `DecompressionStream`, since the host does not compress binary assets.
- Roof colours are sampled per building from the NAIP corridor layers at the footprint centre, so the walls (a lighter, desaturated derivative) agree with the photograph the roof itself is textured with.
- The phone subset keeps buildings at least 12 m tall or 500 m² in footprint.
- `lib/bay-city.ts` extrudes the file into one flat-shaded indexed mesh at runtime, in short slices between frames: a bottom ring sunk 1.5 m below the terrain and a roof ring at the highest ground point plus the height, with per-vertex wall colour, glazing amount in the alpha channel and a `lift` attribute that lets the city rise out of the imagery over about two seconds. Roofs are draped in the same imagery layers as the terrain through the shared Mercator projection; walls take the tint with floor banding and a darker street level. This is block massing from footprints, not a photogrammetric city.

## Baked shadows and sky visibility

- `public/scenery/shade-south.webp`, `shade-north.webp` (4096², 3.91 m/px, 960,768 and 1,373,960 bytes) and `shade-sfo.webp` (4096², 2 m/px, 428,566 bytes), with 2048² `-mobile` versions: generated by `python3 scripts/prepare-bay-shadows.py --cache /path/to/city-cache`. Each imagery layer's height field is the terrain grid plus every building footprint (the corridor city and the airport set); the scene's fixed sun (26° elevation, west-south-west) is marched through it in image space with a 0.4 m bias and a 1.5 m soft edge, and eight horizon directions give a cosine-weighted sky-visibility term. Red is the direct-sun factor, green the sky visibility, blurred by 0.8 px and stored at WebP quality 60.
- `lib/bay-surface.ts` samples them through the same Mercator projection as the imagery, coarse to fine, and applies the sun factor to the directional light and the sky factor to image-based light (at half strength) on the terrain, the city's roofs and the tree canopies; walls only take the street-level shadow near the ground. A separate 3 m/px map for the city layer was baked and dropped: it would have pushed the terrain shader past the 16 texture units most GPUs expose.

## Cloud shadows

- A 256² tileable value noise (four octaves, seed 11, generated at load) drifts across the scene at about 6 m/s over a 3.5 km repeat. Where it exceeds a threshold it removes up to 45 % of the direct sun and 10 % of the sky light on terrain, city and trees; the aircraft samples the same field on the CPU at its own position so it darkens with the ground beneath it. The sky itself stays clear; the shadows read as thin cloud out of frame.

## Tree canopies

- `public/scenery/bay-trees.bin.gz` (309,841 canopies, 1,765,278 bytes; `-mobile` 51,845 canopies, 331,652 bytes): `python3 scripts/prepare-bay-trees.py --cache /path/to/city-cache` classifies dark green pixels of the south and north NAIP layers that are not buildings (masks left by the shadow bake, grown by one pixel) as canopy, keeps 42 % of them at random (7 % for phones), and writes local metres (1 m), a diameter of 5–14 m biased by darkness, and the photograph's colour darkened toward green. Each record is 8 bytes.
- `lib/bay-trees.ts` draws them as one instanced octahedron per tree, twisted deterministically, coloured per instance and standing on the sampled terrain; canopies grow in over 1.5 s after loading. Lawns and roofs are excluded by the classifier's brightness threshold and the building mask, so parks, hillsides and street trees are covered but not every backyard tree.

## Livery

- `lib/bay-livery.ts` draws the site's own livery into a 2048² canvas at load: a navy fin with an orange trailing-edge stripe and the monogram (one panel per side so lettering reads correctly from both), the registration N787HA on the rear fuselage and the wordmark forward of the wing. `addLivery` in `lib/airframe-flex.ts` projects it in the model's own axes (nose −X, port +Z) over the base paint, with a navy sweep on the tail cone. The registration is fictional.

## Photographed pavement

- [Asphalt 02](https://polyhaven.com/a/asphalt_02), Rob Tuytel, [CC0](https://polyhaven.com/license).
- Local 1K maps: `public/scenery/runway-color.webp`, `runway-normal.webp`, `runway-roughness.webp`. Original surface covers 3 × 3 m. OpenGL normal map; color is sRGB, normal/roughness are linear data.
- The runway samples the colour map at two scales to hide the 3 m repeat along 3.7 km, and darkens rubber deposits procedurally in both touchdown zones instead of overlaying transparent decals. The same colour and normal maps serve as the near-field ground grain on the terrain.
- The original valid 787 texture embedded in the GLB is retained. This update does not replace the aircraft atlas.

## Open-source atmosphere and rendering update

`public/scenery/atmosphere/{transmittance,scattering,irradiance}.exr` are unchanged reference lookup textures from Takram's MIT-licensed three-geospatial project, revision `eac103980f20c0956f2d3215833e73514be08462`. Together they contain 4,124,561 bytes. They are rendered by `@takram/three-atmosphere` 0.19.1, with Bruneton's BSD-licensed scattering functions. They describe atmospheric light transport, not geographic imagery. The former cloud sprites are retained as source assets but no longer rendered in the clear-sky sequence.

See [RENDERING.md](RENDERING.md) for exact source links, renderer choices, compatibility and limitations. Full software notices are retained in [public/credits/rendering-licenses.txt](public/credits/rendering-licenses.txt) and linked from the site's scene credits.

# Scene assets

## Boeing 787-9

- Author: [Nobilis2](https://sketchfab.com/nobilishornet2).
- Original: [Boeing 787-9](https://sketchfab.com/3d-models/boeing-787-9-b6711e2e698e4e469675c1154a50b7a3), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Optimized derivative downloaded from [God’s Eye View](https://github.com/bilawalsidhu/gods-eye-view/blob/main/public/models/README.md): `https://raw.githubusercontent.com/bilawalsidhu/gods-eye-view/main/public/models/b789.glb`.
- Local: `public/models/boeing-787-9.glb` (470,200 bytes). The GLB embeds its author, license and original URL.
- Upstream derivative: geometry/material simplification, 256px WebP texture, real-meter scale, Y up, nose −X. Runtime additions here: folding modeled landing gear, rounded tires, fan pivots, elastic wing deformation with matching shadow geometry, physical clearcoat paint with a generated low-amplitude skin-waviness normal map, metal finishes, scene lighting and animation. The body asset itself is retained unchanged.

## Real Bay Area terrain

- Source: [ESA, San Francisco Bay](https://www.esa.int/ESA_Multimedia/Images/2020/05/San_Francisco_Bay), acquired January 25, 2019, [CC BY-SA 3.0 IGO](https://creativecommons.org/licenses/by-sa/3.0/igo/).
- Required credit: **contains modified Copernicus Sentinel data (2019), processed by ESA**.
- Source JPEG: 10,980 × 14,367, approximately 10 m pixels. Crop: `[3500, 5200, 8300, 10000]`.
- Derivatives: `public/scenery/sf-bay.webp` (4096²) and `sf-bay-mobile.webp` (2048²), both retained under CC BY-SA 3.0 IGO. Crop and resize are the only image edits.
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
- `lib/bay-surface.ts` maps the image through the existing affine registration, feathers its border, and gently balances exposure at rendering time. Under the fallback sky non-water land retains the photograph's baked light; under the physical atmosphere it is treated as albedo lit by the same sun and sky. Low-elevation water receives restrained physical reflections and ripple normals. Within about 900 m of the camera, two scales of the photographed asphalt colour and normal maps below add the grain that metre-scale orthoimagery cannot carry, fading out with distance.
- `public/scenery/sfo-buildings.json`: 562 real OSM footprint features, with original IDs and geometric rings preserved. **© OpenStreetMap contributors**, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), [attribution](https://www.openstreetmap.org/copyright). This dataset remains separately licensed under ODbL.
- Source query: OpenStreetMap Overpass, bbox south37.607 / west-122.401 / north37.641 / east-122.373, retrieved 2026-09-09. Non-rendering address/contact tags were omitted. Tagged heights are preferred; floor counts use 3.2 m per floor, otherwise generic buildings use 8 m and hangars 15 m as explicit scene estimates. Most building parts are omitted to prevent overlap, except the tower cabin. The imagery is from 2022 and OSM reflects a later date.
- `lib/sfo-buildings.ts` retains polygon holes and batches roofs/walls into two draw calls, with a deterministic per-building tone and procedural glazing bands every 3.6 m on the walls. This is simplified massing, not a surveyed building reconstruction.

## Photographed pavement

- [Asphalt 02](https://polyhaven.com/a/asphalt_02), Rob Tuytel, [CC0](https://polyhaven.com/license).
- Local 1K maps: `public/scenery/runway-color.webp`, `runway-normal.webp`, `runway-roughness.webp`. Original surface covers 3 × 3 m. OpenGL normal map; color is sRGB, normal/roughness are linear data.
- The runway samples the colour map at two scales to hide the 3 m repeat along 3.7 km, and darkens rubber deposits procedurally in both touchdown zones instead of overlaying transparent decals. The same colour and normal maps serve as the near-field ground grain on the terrain.
- The original valid 787 texture embedded in the GLB is retained. This update does not replace the aircraft atlas.

## Open-source atmosphere and rendering update

`public/scenery/atmosphere/{transmittance,scattering,irradiance}.exr` are unchanged reference lookup textures from Takram's MIT-licensed three-geospatial project, revision `eac103980f20c0956f2d3215833e73514be08462`. Together they contain 4,124,561 bytes. They are rendered by `@takram/three-atmosphere` 0.19.1, with Bruneton's BSD-licensed scattering functions. They describe atmospheric light transport, not geographic imagery. The former cloud sprites are retained as source assets but no longer rendered in the clear-sky sequence.

See [RENDERING.md](RENDERING.md) for exact source links, renderer choices, compatibility and limitations. Full software notices are retained in [public/credits/rendering-licenses.txt](public/credits/rendering-licenses.txt) and linked from the site's scene credits.

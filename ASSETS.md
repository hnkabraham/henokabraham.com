# Scene assets

## Boeing 787-9

- Author: [Nobilis2](https://sketchfab.com/nobilishornet2).
- Original: [Boeing 787-9](https://sketchfab.com/3d-models/boeing-787-9-b6711e2e698e4e469675c1154a50b7a3), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Optimized derivative downloaded from [God’s Eye View](https://github.com/bilawalsidhu/gods-eye-view/blob/main/public/models/README.md): `https://raw.githubusercontent.com/bilawalsidhu/gods-eye-view/main/public/models/b789.glb`.
- Local: `public/models/boeing-787-9.glb` (470,200 bytes). The GLB embeds its author, license and original URL.
- Upstream derivative: geometry/material simplification, 256px WebP texture, real-meter scale, Y up, nose −X. Runtime additions here: retractable modeled landing gear, fan pivots, physical material adjustments, scene lighting and animation. The body asset itself is retained unchanged.

## Real Bay Area terrain

- Source: [ESA, San Francisco Bay](https://www.esa.int/ESA_Multimedia/Images/2020/05/San_Francisco_Bay), acquired January 25, 2019, [CC BY-SA 3.0 IGO](https://creativecommons.org/licenses/by-sa/3.0/igo/).
- Required credit: **contains modified Copernicus Sentinel data (2019), processed by ESA**.
- Source JPEG: 10,980 × 14,367, approximately 10 m pixels. Crop: `[3500, 5200, 8300, 10000]`.
- Derivatives: `public/scenery/sf-bay.webp` (4096²) and `sf-bay-mobile.webp` (2048²), both retained under CC BY-SA 3.0 IGO. Crop and resize are the only image edits.
- Approximate affine registration to ten USGS reference image patches: RMS 1.06 source pixels in the central Bay. Metadata: `public/credits/bay-georeferencing.json`. Registration is scenery positioning, not survey accuracy.
- Scene axes follow source-image pixels at 10 meters per pixel, origin at estimated 28R displaced threshold `[5666.01015, 8672.84973]`. Detailed runway aligns toward the 10L end. The flight path, gear and runway details are an artistic reconstruction. Satellite city detail is draped over actual terrain; individual buildings are not modeled.

Elevation uses [Mapzen/Terrarium](https://github.com/tilezen/joerd/blob/master/docs/formats.md) tiles `10/163/395`, `10/163/396`, `10/164/395`, `10/164/396` from `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`. Credit: Mapzen terrain tiles; United States 3DEP and global terrain data courtesy of the U.S. Geological Survey; ocean terrain data from NOAA. [Full attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).

`public/scenery/bay-elevation.bin` is a resampled 257² little-endian Uint16 grid in quarter-meter units. Ocean values are clamped to zero, the airfield apron is leveled. Preparation: `python3 scripts/prepare-bay-terrain.py /path/to/source-assets`. The scene uses 256² terrain segments on desktop and 128² on mobile, with a floating origin for stable precision.

## Daylight

- [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky), Greg Zaal and Jarod Guest, [CC0](https://polyhaven.com/license).
- Local: `public/scenery/daylight.hdr`, 1024 × 512, 1,435,119 bytes. Used for image-based illumination and reflections. The visible atmosphere uses Three.js’s Sky shader.

## Clouds and fallback

- `public/images/cloud-sprite.png`, 1024px transparent generated cumulus, used sparingly around the flight path.
- Generation prompt: Photoreal isolated white cumulus cloud cluster, landscape 3:2, transparent RGBA background, luminous upper-right sunlight, cool pale-blue shadows, feathered semitransparent wisps, generous transparent margins. No sky, floor, horizon, aircraft, text, or logos.
- `public/images/cruise-sky.jpg`, generated static fallback for loading and unavailable WebGL.
- Generation prompt: Photoreal 16:9 aviation sky at cruising altitude, porcelain blue sky, luminous white cumulus below a mid-low horizon, larger cloud banks lower right, warm upper-right sunlight, open left text space. No aircraft, buildings, text, logos, or window frames.

## Audio and project image

Optional jet/wind ambience is synthesized locally with Web Audio. No third-party recordings. The Downshift screenshot is an optimized copy of the user’s `Developer/RevMatchApp/docs/images/downshift-dashboard.png`, explicitly labeled as simulator mode.

## Design reference

[Henry Heffernan’s portfolio](https://github.com/henryjeff/portfolio-website) informed the ambition of a coherent environment. Its code and assets were not copied. This site’s scroll-controlled Bay departure and project terminal are original implementations.

# Scene assets

## Aircraft

- Source: [Cesium Air](https://github.com/CesiumGS/cesium/blob/main/Apps/SampleData/models/CesiumAir/Cesium_Air.glb)
- Local asset: `public/models/cesium-air.glb`
- Copyright: CesiumJS Contributors. Apache 2.0; full license and notices are retained at `public/credits/cesium-license.md` and linked in the website's Scene credits.
- Original GLB is unchanged. The website centers, scales, lights, and rotates the model at runtime.

## Cloud backdrop

- Local asset: `public/images/cruise-sky.jpg`
- Created with the built-in imagegen tool for this website; optimized as a JPEG.
- Generation prompt: Photoreal 16:9 aviation sky at cruising altitude, porcelain blue sky, luminous white cumulus below a mid-low horizon, larger cloud banks lower right, warm upper-right sunlight, open left text space. No aircraft, buildings, text, logos, or window frames.

## Dimensional cloud layer

- Local asset: `public/images/cloud-sprite.png`.
- Created with the built-in imagegen tool for this website; resized to 1024 pixels wide with transparency preserved.
- Used as five transparent sprites at different depths in the Three.js scene.
- Generation prompt: Photoreal isolated white cumulus cloud cluster, landscape 3:2, genuinely transparent RGBA background, luminous upper-right sunlight, cool pale-blue shadows, feathered semitransparent wisps, generous transparent margins. No sky, floor, horizon, aircraft, text, or logos.

## Downshift screenshot

- User-provided project asset from `Developer/RevMatchApp/docs/images/downshift-dashboard.png`.
- Optimized copy: `public/images/downshift-dashboard.jpg`.
- Shows simulator mode; identified as such in the project briefing.

## Design reference

[Henry Heffernan's portfolio](https://github.com/henryjeff/portfolio-website) informed the goal of a coherent explorable environment. Its code, models, and visual design were not copied. This website uses an original aviation terminal concept.

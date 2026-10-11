"""Extracts the East Bay ridge the Dolores Park scene draws on its horizon,
from this repository's archive/scenery/bay-elevation.webp (Mapzen/Terrarium
elevations, see ASSETS.md). No downloads.
Usage: python3 scripts/dolores-park/horizon.py
Registration is approximate; output is scenery, not surveyed geometry.
"""
import json, math, sys
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent))
from geo import MX, MY, LON0, LAT0
repo = Path(__file__).resolve().parents[2]
registration = json.loads((repo / 'public/credits/bay-georeferencing.json').read_text())
affine = np.asarray(registration['webMercatorToSatellitePixelMatrix'])
pixels = np.asarray(Image.open(repo / 'archive/scenery/bay-elevation.webp').convert('RGB')).astype(float)
elev = (pixels[:,:,0] * 256 + pixels[:,:,1]) / 4
samples = []
for bearing in np.arange(18, 116.01, 0.25):
    distances = np.arange(12000, 30001, 60)
    x = 7.6 + np.sin(np.radians(bearing)) * distances
    y = -159.5 + np.cos(np.radians(bearing)) * distances
    lon, lat = x / MX + LON0, y / MY + LAT0
    merc = np.stack([np.radians(lon)*6378137, np.log(np.tan(np.pi/4+np.radians(lat)/2))*6378137, np.ones_like(x)])
    px, py, _ = affine @ merc
    u, v = (px-3500)/4800*(elev.shape[1]-1), (py-5200)/4800*(elev.shape[0]-1)
    valid = (u>=0)&(u<elev.shape[1]-1)&(v>=0)&(v<elev.shape[0]-1)
    if not valid.any(): continue
    x,y,distances,u,v = (a[valid] for a in (x,y,distances,u,v))
    ix,iy = u.astype(int), v.astype(int)
    fx,fy = u-ix,v-iy
    z = (elev[iy,ix]*(1-fx)+elev[iy,ix+1]*fx)*(1-fy)+(elev[iy+1,ix]*(1-fx)+elev[iy+1,ix+1]*fx)*fy
    # Apparent ridge from camera elevation, with approximate earth curvature.
    z -= distances**2/(2*6371000)
    i = np.argmax((z-44)/distances)
    samples.append([round(float(x[i]),1),round(float(y[i]),1),round(float(z[i]),1)])
(repo / 'archive/scenery/dolores/horizon.json').write_text(json.dumps({'source':'Local bay-elevation.webp: Mapzen/AWS Terrarium elevations; approximate ESA-grid registration. No image pixels used as color.', 'points':samples}))
print('Ridge samples:',len(samples),'elevations:',min(p[2] for p in samples),max(p[2] for p in samples))

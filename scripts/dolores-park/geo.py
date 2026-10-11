# Local metres around Dolores Park: x east, y north, from lon/lat.
import numpy as np
LAT0, LON0 = 37.7596, -122.4270
MX = 111320.0 * np.cos(np.radians(LAT0))
MY = 110950.0
def local(lon, lat):
    return (np.asarray(lon) - LON0) * MX, (np.asarray(lat) - LAT0) * MY
# The DEM's bbox (exportImage, EPSG:4326).
DEM_BBOX = (-122.4345, 37.7520, -122.4195, 37.7660)

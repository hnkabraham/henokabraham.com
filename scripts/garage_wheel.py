"""The 2015-2018 Shelby GT350's own wheel face, built from measurements, for
prepare-garage-car.py.

The downloaded model wears the GT350R's seven-spoke carbon wheels; Henok's
2017 GT350 has the base car's 19-inch cast wheel (the 2019-2020 car got a
different design), and no freely licensed model of it was found. It is a
simple shape: ten straight spokes, evenly spaced every 36 degrees, that
widen into the hub through rounded roots; a hub with five lug nuts on the
114.3 mm bolt circle, one under every other opening; and a center cap with
the Ford oval. The proportions were read off a straight-on photo of the
part (FR3Z-1007-P) unwrapped into angle and radius: the openings bottom out
at about 36% of the lip's radius with rounded corners, the spokes taper
from about 29 mm at the root to 21 mm at the lip, and the lug nuts sit at
the middle of alternate openings. The photo was only measured; nothing from
it is in the model. Depths come from the source's own wheel, so the new
face fits the tire, barrel, lip and brake it already has: the hub face sits
about 60 mm behind the lip's outer face. The spokes' faces are flat, in
the plane of the lip's inner wall 13 mm behind it, and curve down into the
hub only over their last few centimetres.

`build` returns one mesh per finish for all four corners, each placed from
that corner's own measured axle centre and lip plane; the left side is a
mirror image of the right.
"""
import numpy as np

# Local frame: a is axial, outward, 0 at the lip's outer face; the wheel's
# plane is (p, q), p up and q forward. Radii and depths in metres.
SPOKES = 10
HUB_RADIUS = 0.097  # where the openings bottom out
CAP_RADIUS = 0.032
BORE_RADIUS = 0.034  # the hub's opening around the cap
SPOKE_TIP = 0.243  # inside the lip's inner wall
SPOKE_WIDTH = (0.029, 0.021)  # front face, at the root and at the tip
SPOKE_DEPTH = (0.030, 0.020)  # front to back, at the root and at the tip
# The root fillets nearly meet across each opening's bottom, rounding it
# into the photo's U; they stop short of touching, where two spokes' faces
# would overlap.
ROOT_FILLET = 0.014
TIP_FILLET = 0.006  # where the spoke flares into the lip
CROWN = 0.0015  # the spoke face's rise along its middle
LUG_CIRCLE = 0.1143 / 2
LUG_RADIUS = 0.0105
LUG_HEIGHT = 0.019
# Front-face depths: the hub dishes from its bore up to a raised rim that
# meets the spoke roots. The spokes are flat and parallel to the rotor out
# to the lip, and curve down into the hub inside SPOKE_BEND, steepest at
# the hub.
HUB_PROFILE = ([BORE_RADIUS, 0.075, HUB_RADIUS], [-0.062, -0.059, -0.050])
SPOKE_FRONT = (-0.050, -0.013)  # at the hub, and across the flat
SPOKE_BEND = 0.145
HUB_BACK = -0.085


def _spoke_front(r):
    # A parabola that leaves the hub's rim steeply and meets the flat
    # without a crease.
    t = np.clip((r - HUB_RADIUS) / (SPOKE_BEND - HUB_RADIUS), 0, 1)
    a = SPOKE_FRONT[1] - (SPOKE_FRONT[1] - SPOKE_FRONT[0]) * (1 - t) ** 2
    # Inside the hub the root dips below the hub's face, so the two
    # surfaces cross along the hub's edge rather than overlapping.
    return a - np.clip(HUB_RADIUS - r, 0, None) * 0.7


def _spoke_half_width(r):
    s = np.clip((r - HUB_RADIUS) / (SPOKE_TIP - HUB_RADIUS), 0, 1)
    half = (SPOKE_WIDTH[0] + (SPOKE_WIDTH[1] - SPOKE_WIDTH[0]) * s) / 2
    # Quarter-circle fillets from the hub's edge up the spoke's side, and
    # from the side into the lip.
    rise = np.clip(r - HUB_RADIUS, 0, ROOT_FILLET)
    root = ROOT_FILLET - np.sqrt(ROOT_FILLET**2 - (ROOT_FILLET - rise) ** 2)
    fall = np.clip(SPOKE_TIP - r, 0, TIP_FILLET)
    tip = TIP_FILLET - np.sqrt(TIP_FILLET**2 - (TIP_FILLET - fall) ** 2)
    return half + root + tip


class _Mesh:
    def __init__(self):
        self.positions, self.normals, self.indices = [], [], []
        self.count = 0

    def grid(self, points, flip=False):
        """A rows x cols grid of (a, p, q) points as one smooth surface;
        `flip` reverses which side faces forward."""
        rows, cols = points.shape[:2]
        flat = points.reshape(-1, 3)
        idx = np.arange(rows * cols).reshape(rows, cols)
        a, b, c, d = idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]
        tris = np.concatenate(
            [np.stack([a, b, c], -1).reshape(-1, 3), np.stack([a, c, d], -1).reshape(-1, 3)]
        )
        if flip:
            tris = tris[:, ::-1]
        normals = np.zeros_like(flat)
        face = np.cross(flat[tris[:, 1]] - flat[tris[:, 0]], flat[tris[:, 2]] - flat[tris[:, 0]])
        for k in range(3):
            np.add.at(normals, tris[:, k], face)
        normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
        self.positions.append(flat)
        self.normals.append(normals)
        self.indices.append(tris + self.count)
        self.count += len(flat)

    def arrays(self):
        return (
            np.vstack(self.positions),
            np.vstack(self.normals),
            np.concatenate(self.indices),
        )


def _polar(a, r, theta):
    return np.stack([a, r * np.cos(theta), r * np.sin(theta)], -1)


def _ring_surface(mesh, radii, depth_of_r, segments, flip=False, start=0.0):
    theta = start + np.linspace(0, 2 * np.pi, segments + 1)
    r = np.asarray(radii)[:, None] * np.ones_like(theta)
    mesh.grid(_polar(depth_of_r(r), r, theta[None, :] * np.ones_like(r)), flip=flip)


def _wall(mesh, radius, front, back, segments, flip=False):
    theta = np.linspace(0, 2 * np.pi, segments + 1)
    a = np.array([[front], [back]]) * np.ones_like(theta)
    mesh.grid(_polar(a, radius * np.ones_like(a), np.ones((2, 1)) * theta), flip=flip)


def _spoke(mesh, centre):
    r = np.concatenate(
        [
            [HUB_RADIUS - 0.006, HUB_RADIUS - 0.002],
            HUB_RADIUS + ROOT_FILLET * (1 - np.cos(np.linspace(0, np.pi / 2, 6))),
            np.linspace(HUB_RADIUS + ROOT_FILLET, SPOKE_BEND, 6)[1:],
            np.linspace(SPOKE_BEND, SPOKE_TIP - TIP_FILLET, 5)[1:],
            SPOKE_TIP - TIP_FILLET * np.cos(np.linspace(0, np.pi / 2, 4))[1:],
        ]
    )
    half = np.arcsin(np.minimum(_spoke_half_width(r) / r, 0.99))
    across = np.linspace(-1, 1, 5)
    theta = centre + half[:, None] * across[None, :]
    rr = r[:, None] * np.ones_like(across)
    front = _spoke_front(rr) + CROWN * (1 - across**2)[None, :]
    s = np.clip((rr - HUB_RADIUS) / (SPOKE_TIP - HUB_RADIUS), 0, 1)
    back = _spoke_front(rr) - (SPOKE_DEPTH[0] + (SPOKE_DEPTH[1] - SPOKE_DEPTH[0]) * s)
    mesh.grid(_polar(front, rr, theta))
    mesh.grid(_polar(back[:, ::2], rr[:, ::2], theta[:, ::2]), flip=True)
    for edge, flip in ((0, True), (-1, False)):
        side = np.stack([front[:, edge], back[:, edge]], 1)
        mesh.grid(_polar(side, rr[:, :2], theta[:, [edge, edge]]), flip=flip)
    tip = np.stack([front[-1], back[-1]], 0)
    mesh.grid(_polar(tip, rr[[-1, -1]], theta[[-1, -1]]), flip=True)


def _lug(mesh, theta):
    centre = np.array([0.0, LUG_CIRCLE * np.cos(theta), LUG_CIRCLE * np.sin(theta)])
    base = np.interp(LUG_CIRCLE, *HUB_PROFILE) - 0.001
    sides = 12
    phi = np.linspace(0, 2 * np.pi, sides + 1)
    # Body, a chamfer and the top, as rings of (radius, depth).
    rings = [
        (LUG_RADIUS, base),
        (LUG_RADIUS, base + LUG_HEIGHT - 0.002),
        (LUG_RADIUS - 0.002, base + LUG_HEIGHT),
        (0.0, base + LUG_HEIGHT),
    ]
    for (r0, a0), (r1, a1) in zip(rings, rings[1:]):
        r = np.array([[r0], [r1]]) * np.ones_like(phi)
        a = np.array([[a0], [a1]]) * np.ones_like(phi)
        local = np.stack([a, r * np.cos(phi), r * np.sin(phi)], -1)
        mesh.grid(local + centre, flip=True)


def _dome(r):
    return np.interp(r, [0, 0.012, 0.022, 0.028, CAP_RADIUS], [-0.0585, -0.0590, -0.0600, -0.0610, -0.0625])


def _cap(paint, chrome):
    _ring_surface(paint, [0, 0.006, 0.012, 0.018, 0.022, 0.026, 0.029, CAP_RADIUS], _dome, 64, flip=True)
    _wall(paint, CAP_RADIUS, _dome(CAP_RADIUS), -0.067, 64, flip=True)
    _wall(paint, BORE_RADIUS, HUB_PROFILE[1][0], -0.067, 64)
    # The Ford oval's bright outline, standing just off the dome.
    t = np.linspace(0, 2 * np.pi, 97)
    rows = []
    for k in (0.0, 0.0011):
        p, q = (0.0086 - k) * np.sin(t), (0.0215 - k) * np.cos(t)
        rows.append(np.stack([_dome(np.hypot(p, q)) + 0.0004, p, q], -1))
    chrome.grid(np.stack(rows), flip=True)


def wheel_face(phase):
    """One wheel face in the local frame, its spoke pattern turned by
    `phase` radians: {'paint': mesh, 'lug': mesh, 'chrome': mesh}."""
    paint, lug, chrome = _Mesh(), _Mesh(), _Mesh()
    hub_radii = [BORE_RADIUS, 0.044, 0.054, 0.064, 0.075, 0.084, 0.091, HUB_RADIUS]
    _ring_surface(paint, hub_radii, lambda r: np.interp(r, *HUB_PROFILE), 90, flip=True, start=phase)
    _wall(paint, HUB_RADIUS, HUB_PROFILE[1][-1], HUB_BACK, 90)
    for k in range(SPOKES):
        _spoke(paint, phase + k * 2 * np.pi / SPOKES)
    for k in range(5):
        _lug(lug, phase + np.pi / SPOKES + k * 4 * np.pi / SPOKES)
    _cap(paint, chrome)
    return {'paint': paint, 'lug': lug, 'chrome': chrome}


def build(corners):
    """corners: dicts with side (+1 right, -1 left), centre (y, z) and
    lip_face (the lip's outer face, |x|). Returns {finish: (positions,
    normals, indices)} in world space, every corner merged."""
    out = {}
    for n, corner in enumerate(corners):
        # Each wheel stopped at its own angle, as a parked car's are.
        faces = wheel_face(phase=np.radians(7 + 13 * n))
        side = corner['side']
        cy, cz = corner['centre']
        for finish, mesh in faces.items():
            pos, nrm, idx = mesh.arrays()
            world = np.stack(
                [side * (corner['lip_face'] + pos[:, 0]), cy + pos[:, 1], cz + pos[:, 2]], 1
            )
            normals = nrm * np.array([side, 1.0, 1.0])
            if side < 0:
                idx = idx[:, ::-1]
            out.setdefault(finish, []).append((world, normals, idx))
    merged = {}
    for finish, parts in out.items():
        offset, P, N, I = 0, [], [], []
        for world, normals, idx in parts:
            P.append(world)
            N.append(normals)
            I.append(idx + offset)
            offset += len(world)
        merged[finish] = (np.vstack(P), np.vstack(N), np.concatenate(I).reshape(-1))
    return merged

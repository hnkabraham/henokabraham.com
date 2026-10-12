import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  applyDoloresMaterial,
  restoreDoloresMaterials,
} from '../../lib/dolores-park-materials.js';

// Export-time sky visibility, desktop only. Distances are metres in the
// scene's world frame (x east, y up, z = -north), never the GIS x/y frame.
const AO_BAKE = {
  directions: 128, // aoDirections: deterministic equal-area Fibonacci samples.
  normalOffset: 0.04, // aoOffset: move the receiver off its own surface.
  bias: 0.02, // aoBias: depth tolerance, plus a texel/slope allowance below.
  strength: 0.6, // aoStrength: 0 leaves the recovered base colour unchanged.
  floor: 0.35, // aoFloor: lower bound before the underside blend.
  texelSize: 0.025, // 2.5 cm, independent of row length and viewing direction.
  maxTileSize: 2048, // One reusable RGBA8 target; includes a 1-pixel gutter.
  padding: 2, // Pad the receiver box and the full occluder depth interval.
  keepUnderside: 0.25, // Retain 25% of the heuristic when world normal.y < -0.5.
  // Exactly downward faces have no upper samples: visibility stays 1 and
  // their entire old heuristic is retained, rather than brightening soffits.
  slopeBias: 0.5, // Half a texel * tan(theta), capped at 4 for grazing rays.
  maxSlope: 4,
  // A face (coplanar triangles joined by edges) longer than this takes one
  // value, the mean of samples spread over it. Siding boards and walls have
  // corners only at their ends, so a corner's shade would otherwise smear
  // along the whole board as a dark band.
  faceSize: 0.5,
  faceSpacing: 0.25, // Metres between a large face's samples.
};

// The glass stays an occluder only: darkening recessed panes turned them
// black, and a pane's look is its reflection, not its shading.
const isAOTarget = (material) => material.name.startsWith('Painted wood');

function aoOptions(q) {
  const number = (name, fallback, min, max) => {
    const raw = q.get(name),
      value = raw === null || raw.trim() === '' ? NaN : Number(raw);
    return Number.isFinite(value)
      ? T.MathUtils.clamp(value, min, max)
      : fallback;
  };
  return {
    ...AO_BAKE,
    directions: Math.round(number('aoDirections', AO_BAKE.directions, 1, 2048)),
    normalOffset: number('aoOffset', AO_BAKE.normalOffset, 0, 1),
    bias: number('aoBias', AO_BAKE.bias, 0, 1),
    strength: number('aoStrength', AO_BAKE.strength, 0, 1),
    floor: number('aoFloor', AO_BAKE.floor, 0, 1),
    debug: q.get('aoDebug') === '1',
  };
}

// Project an entire world AABB without allocating its eight corners.
function aoBoxRange(box, axis) {
  const center = box.getCenter(new T.Vector3()),
    half = box.getSize(new T.Vector3()).multiplyScalar(0.5),
    middle = center.dot(axis),
    reach =
      half.x * Math.abs(axis.x) +
      half.y * Math.abs(axis.y) +
      half.z * Math.abs(axis.z);
  return [middle - reach, middle + reach];
}

function bakeSkyVisibility(near, r, q) {
  const started = performance.now(),
    options = aoOptions(q),
    targets = [],
    receiverBox = new T.Box3(),
    depthScene = new T.Scene();
  const depthMaterial = new T.MeshDepthMaterial({
    depthPacking: T.RGBADepthPacking,
    side: T.DoubleSide, // Solid sheets/ground also occlude from their back.
    blending: T.NoBlending,
    toneMapped: false,
  });
  let vertices = 0,
    tiles = 0;
  near.updateWorldMatrix(true, true);
  near.traverse((o) => {
    if (!o.isMesh) return;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    if (materials.some(isAOTarget)) {
      // splitScene expands all house instances before material chunking.
      if (o.isInstancedMesh || materials.length !== 1)
        throw new Error(
          'AO target must be an expanded single-material mesh: ' + o.name,
        );
      targets.push({ mesh: o, start: vertices });
      vertices += o.geometry.attributes.position.count;
      receiverBox.expandByObject(o);
    }
    if (
      materials.some(
        (m) =>
          m.transparent ||
          m.alphaTest !== 0 ||
          /leaves|canopy|fronds|palm|grass|blade/i.test(m.name),
      ) ||
      /leaves|canopy|fronds|palm|grass|blade/i.test(o.name)
    )
      return;
    // A separate scene shares the source geometry but never reparents or
    // changes near's meshes/materials. Instancing and all world transforms
    // survive. Do not use castShadow as a filter: sidewalks must occlude.
    const copy = o.clone(false);
    copy.material = depthMaterial;
    copy.matrix.copy(o.matrixWorld);
    copy.matrixAutoUpdate = false;
    copy.visible = true;
    copy.castShadow = copy.receiveShadow = false;
    depthScene.add(copy);
  });
  if (!vertices) {
    depthMaterial.dispose();
    window.aoStats = {
      vertices: 0,
      meshes: 0,
      directions: options.directions,
      tiles: 0,
      ms: performance.now() - started,
      visibility: { min: 1, mean: 1, p5: 1, p50: 1 },
    };
    console.log('House sky visibility', window.aoStats);
    return;
  }
  receiverBox.expandByScalar(options.padding + options.normalOffset);
  // Lateral coverage comes from the receivers; depth comes from ALL solid
  // near geometry. This is full-range sky visibility, not a local AO radius.
  const occluderBox = new T.Box3().setFromObject(depthScene).union(receiverBox);
  const p = new T.Vector3(),
    n = new T.Vector3(),
    normalMatrix = new T.Matrix3();
  // Large faces and their samples, per target.
  const sampleList = [];
  for (const target of targets) {
    const { mesh } = target,
      { position } = mesh.geometry.attributes,
      index = mesh.geometry.index,
      triangles = (index ? index.count : position.count) / 3,
      corner = (t, c) => (index ? index.getX(t * 3 + c) : t * 3 + c);
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    const world = (j) =>
      new T.Vector3()
        .fromBufferAttribute(position, j)
        .applyMatrix4(mesh.matrixWorld);
    // Join triangles across shared edges when their normals agree.
    const parent = Int32Array.from({ length: triangles }, (_, t) => t),
      find = (t) => {
        while (parent[t] !== t) t = parent[t] = parent[parent[t]];
        return t;
      },
      edges = new Map(),
      faceNormal = [],
      key = (v) =>
        `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(v.z * 1000)}`;
    for (let t = 0; t < triangles; t++) {
      const a = world(corner(t, 0)),
        b = world(corner(t, 1)),
        c = world(corner(t, 2));
      faceNormal.push(
        new T.Vector3()
          .subVectors(b, a)
          .cross(new T.Vector3().subVectors(c, a))
          .normalize(),
      );
      const ids = [a, b, c].map(key);
      for (let e = 0; e < 3; e++) {
        const edge = [ids[e], ids[(e + 1) % 3]].sort().join('|');
        const other = edges.get(edge);
        if (other === undefined) edges.set(edge, t);
        else if (faceNormal[other].dot(faceNormal[t]) > 0.999)
          parent[find(t)] = find(other);
      }
    }
    const faces = new Map();
    for (let t = 0; t < triangles; t++) {
      const f = find(t);
      if (!faces.has(f)) faces.set(f, { triangles: [], box: new T.Box3() });
      const face = faces.get(f);
      face.triangles.push(t);
      for (let c = 0; c < 3; c++) face.box.expandByPoint(world(corner(t, c)));
    }
    // Vertices of large faces take their face's value: face ids per vertex.
    target.vertexFace = new Int32Array(position.count).fill(-1);
    target.faceSamples = [];
    const size = new T.Vector3();
    for (const face of faces.values()) {
      if (face.box.getSize(size).length() <= options.faceSize) continue;
      const id = target.faceSamples.length,
        first = sampleList.length;
      for (const t of face.triangles) {
        for (let c = 0; c < 3; c++) target.vertexFace[corner(t, c)] = id;
        const a = world(corner(t, 0)),
          b = world(corner(t, 1)),
          c = world(corner(t, 2)),
          area =
            new T.Vector3()
              .subVectors(b, a)
              .cross(new T.Vector3().subVectors(c, a))
              .length() / 2,
          count = Math.min(
            256,
            Math.max(1, Math.round(area / options.faceSpacing ** 2)),
          );
        n.copy(faceNormal[t]);
        for (let k = 0; k < count; k++) {
          // Deterministic, evenly spread barycentric points (R2 sequence).
          let u = (0.5 + k * 0.7548776662) % 1,
            v = (0.5 + k * 0.5698402909) % 1;
          if (u + v > 1) [u, v] = [1 - u, 1 - v];
          p.copy(a)
            .addScaledVector(new T.Vector3().subVectors(b, a), u)
            .addScaledVector(new T.Vector3().subVectors(c, a), v)
            .addScaledVector(n, options.normalOffset);
          sampleList.push(p.x, p.y, p.z, n.x, n.y, n.z);
        }
      }
      target.faceSamples.push([first / 6, sampleList.length / 6]);
    }
  }
  const samples = sampleList.length / 6,
    receivers = vertices + samples;
  const positions = new Float64Array(receivers * 3),
    normals = new Float32Array(receivers * 3),
    visibleWeight = new Float64Array(receivers),
    totalWeight = new Float64Array(receivers),
    weights = new Float32Array(receivers),
    depths = new Float64Array(receivers),
    pixels = new Int32Array(receivers),
    next = new Int32Array(receivers);
  for (let s = 0; s < samples; s++) {
    const k = (vertices + s) * 3;
    positions.set(sampleList.slice(s * 6, s * 6 + 3), k);
    normals.set(sampleList.slice(s * 6 + 3, s * 6 + 6), k);
  }
  for (const { mesh, start } of targets) {
    const { position, normal } = mesh.geometry.attributes;
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    for (let j = 0; j < position.count; j++) {
      p.fromBufferAttribute(position, j).applyMatrix4(mesh.matrixWorld);
      n.fromBufferAttribute(normal, j).applyNormalMatrix(normalMatrix);
      p.addScaledVector(n, options.normalOffset);
      const k = (start + j) * 3;
      positions[k] = p.x;
      positions[k + 1] = p.y;
      positions[k + 2] = p.z;
      normals[k] = n.x;
      normals[k + 1] = n.y;
      normals[k + 2] = n.z;
    }
  }
  const size = Math.min(options.maxTileSize, r.capabilities.maxTextureSize),
    innerSize = size - 2,
    texel = options.texelSize,
    target = new T.WebGLRenderTarget(size, size, {
      format: T.RGBAFormat,
      type: T.UnsignedByteType,
      minFilter: T.NearestFilter,
      magFilter: T.NearestFilter,
      colorSpace: T.NoColorSpace,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
    }),
    rgba = new Uint8Array(size * size * 4),
    camera = new T.OrthographicCamera(),
    direction = new T.Vector3(),
    right = new T.Vector3(),
    up = new T.Vector3(),
    basis = new T.Matrix4();
  target.texture.flipY = false;
  target.texture.premultiplyAlpha = false;
  depthMaterial.premultipliedAlpha = false;
  target.scissorTest = true;
  const saved = {
    target: r.getRenderTarget(),
    face: r.getActiveCubeFace(),
    mip: r.getActiveMipmapLevel(),
    clear: r.getClearColor(new T.Color()),
    alpha: r.getClearAlpha(),
    autoClear: r.autoClear,
    autoClearColor: r.autoClearColor,
    autoClearDepth: r.autoClearDepth,
    autoClearStencil: r.autoClearStencil,
    shadows: r.shadowMap.enabled,
    xr: r.xr.enabled,
    clippingPlanes: r.clippingPlanes,
    localClipping: r.localClippingEnabled,
  };
  try {
    // render() resets the write masks before auto-clear. A manual clear can
    // inherit depthWrite=false from the live scene's transparent last draw.
    r.autoClear = r.autoClearColor = r.autoClearDepth = true;
    r.autoClearStencil = false;
    r.shadowMap.enabled = false;
    r.xr.enabled = false;
    r.clippingPlanes = [];
    r.localClippingEnabled = false;
    r.setClearColor(0xffffff, 1); // RGBA=(1,1,1,1) unpacks to far depth 1.
    for (let sample = 0; sample < options.directions; sample++) {
      const y = (sample + 0.5) / options.directions,
        azimuth = sample * Math.PI * (3 - Math.sqrt(5)),
        radius = Math.sqrt(1 - y * y);
      direction.set(Math.cos(azimuth) * radius, y, Math.sin(azimuth) * radius);
      // Camera +Z points to the sky; it looks along -direction. Align its
      // horizontal axis with projected world X (the long house row) to
      // avoid wasting most texels on a diagonally projected bounding box.
      right.set(1, 0, 0).addScaledVector(direction, -direction.x).normalize();
      up.crossVectors(direction, right).normalize();
      camera.quaternion.setFromRotationMatrix(
        basis.makeBasis(right, up, direction),
      );
      const [left, rightEdge] = aoBoxRange(receiverBox, right),
        [bottom, top] = aoBoxRange(receiverBox, up),
        [back, front] = aoBoxRange(occluderBox, direction),
        width = Math.ceil((rightEdge - left) / texel),
        height = Math.ceil((top - bottom) / texel),
        columns = Math.ceil(width / innerSize),
        rows = Math.ceil(height / innerSize),
        heads = new Int32Array(columns * rows).fill(-1);
      camera.near = 0.1;
      const eye = front + options.padding + camera.near;
      camera.far = eye - back + options.padding;
      camera.position.copy(direction).multiplyScalar(eye);
      camera.updateMatrixWorld(true);
      const depthSpan = camera.far - camera.near;
      // Bin receivers once per direction, not once per tile. Each linked
      // list visits only vertices which can see that direction (n dot d > 0).
      for (let i = 0; i < receivers; i++) {
        const k = i * 3,
          w = Math.min(
            1,
            normals[k] * direction.x +
              normals[k + 1] * direction.y +
              normals[k + 2] * direction.z,
          );
        if (w <= 0) continue;
        const x = positions[k],
          yy = positions[k + 1],
          z = positions[k + 2],
          px = Math.floor(
            (x * right.x + yy * right.y + z * right.z - left) / texel,
          ),
          py = Math.floor((x * up.x + yy * up.y + z * up.z - bottom) / texel),
          column = Math.floor(px / innerSize),
          row = Math.floor(py / innerSize),
          tile = row * columns + column,
          tileWidth = Math.min(innerSize, width - column * innerSize) + 2;
        // Pixel (0,0) is bottom-left, exactly as readPixels returns it; no
        // image/canvas Y flip. One-pixel gutters cover each tile's seams.
        pixels[i] =
          ((py - row * innerSize + 1) * tileWidth +
            px -
            column * innerSize +
            1) *
          4;
        depths[i] =
          (eye -
            (x * direction.x + yy * direction.y + z * direction.z) -
            camera.near) /
          depthSpan;
        weights[i] = w;
        totalWeight[i] += weights[i];
        next[i] = heads[tile];
        heads[tile] = i;
      }
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const tile = row * columns + column;
          if (heads[tile] === -1) continue;
          const tileWidth = Math.min(innerSize, width - column * innerSize) + 2,
            tileHeight = Math.min(innerSize, height - row * innerSize) + 2;
          camera.left = left + (column * innerSize - 1) * texel;
          camera.right = camera.left + tileWidth * texel;
          camera.bottom = bottom + (row * innerSize - 1) * texel;
          camera.top = camera.bottom + tileHeight * texel;
          camera.updateProjectionMatrix();
          // Vary the viewport/readback rectangle, never resize/reallocate
          // the target. The scissor also restricts clearing of edge tiles.
          target.viewport.set(0, 0, tileWidth, tileHeight);
          target.scissor.copy(target.viewport);
          r.setRenderTarget(target);
          r.render(depthScene, camera);
          r.readRenderTargetPixels(target, 0, 0, tileWidth, tileHeight, rgba);
          tiles++;
          for (let i = heads[tile]; i !== -1; i = next[i]) {
            const k = pixels[i],
              w = weights[i],
              // Three r185 packing.glsl.js: dot(rgba / 255,
              // vec4((255/256) / vec3(1,256,65536), 1/16777216)).
              stored =
                rgba[k] / 256 +
                rgba[k + 1] / 65536 +
                rgba[k + 2] / 16777216 +
                rgba[k + 3] / (255 * 16777216),
              slope = Math.min(
                options.maxSlope,
                Math.sqrt(Math.max(0, 1 - w * w)) / w,
              ),
              bias =
                (options.bias + texel * options.slopeBias * slope) / depthSpan;
            if (depths[i] - stored <= bias) visibleWeight[i] += w;
          }
        }
      }
    }
  } finally {
    r.setRenderTarget(saved.target, saved.face, saved.mip);
    r.setClearColor(saved.clear, saved.alpha);
    r.autoClear = saved.autoClear;
    r.autoClearColor = saved.autoClearColor;
    r.autoClearDepth = saved.autoClearDepth;
    r.autoClearStencil = saved.autoClearStencil;
    r.shadowMap.enabled = saved.shadows;
    r.xr.enabled = saved.xr;
    r.clippingPlanes = saved.clippingPlanes;
    r.localClippingEnabled = saved.localClipping;
    target.dispose();
    depthMaterial.dispose();
    // InstancedMesh clones own instance buffers, but geometry is shared.
    depthScene.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
    depthScene.clear();
  }
  const visibility = new Float32Array(vertices);
  let sum = 0;
  const seen = (i) =>
    totalWeight[i] > 0 ? visibleWeight[i] / totalWeight[i] : 1;
  for (const { mesh, start, vertexFace, faceSamples } of targets) {
    const { color, cavity } = mesh.geometry.attributes,
      faceValue = faceSamples.map(([from, to]) => {
        let total = 0;
        for (let s = from; s < to; s++) total += seen(vertices + s);
        return total / (to - from);
      });
    for (let j = 0; j < color.count; j++) {
      const i = start + j,
        value = vertexFace[j] >= 0 ? faceValue[vertexFace[j]] : seen(i),
        old = cavity?.getX(j) ?? 1,
        keep =
          normals[i * 3 + 1] < -0.5
            ? totalWeight[i] === 0
              ? 1
              : options.keepUnderside
            : 0,
        ao = Math.max(options.floor, 1 - options.strength * (1 - value)),
        multiplier = ao * (1 + (old - 1) * keep);
      visibility[i] = value;
      sum += value;
      if (options.debug) color.setXYZ(j, multiplier, multiplier, multiplier);
      else
        color.setXYZ(
          j,
          (color.getX(j) / old) * multiplier,
          (color.getY(j) / old) * multiplier,
          (color.getZ(j) / old) * multiplier,
        );
    }
    color.needsUpdate = true;
  }
  visibility.sort();
  window.aoStats = {
    vertices,
    meshes: targets.length,
    samples,
    largeFaces: targets.reduce((sum, t) => sum + t.faceSamples.length, 0),
    directions: options.directions,
    tiles,
    ms: performance.now() - started,
    visibility: {
      min: visibility[0],
      mean: sum / vertices,
      p5: visibility[Math.floor((vertices - 1) * 0.05)],
      p50: visibility[Math.floor((vertices - 1) * 0.5)],
    },
  };
  console.log('House sky visibility', window.aoStats);
}

// Split by actual world-space triangles/instances, never the origin of a merged
// city mesh. Both sides use the identical partition, including crossing crowns.
export function splitScene(scene, carHolder, car, radius = 180) {
  scene.updateMatrixWorld(true);
  const near = new T.Group(),
    far = new T.Group();
  near.name = 'Dolores Park near field';
  const excluded = new Set();
  carHolder.traverse((o) => excluded.add(o));
  const buckets = new Map(),
    materials = new Map();
  const position = new T.Vector3(),
    matrix = new T.Matrix4(),
    tint = new T.Color();
  function canonical(original) {
    const key = [
      original.name.startsWith('dolores/') ? original.name : '',
      original.map?.uuid,
      original.normalMap?.uuid,
      original.emissiveMap?.uuid,
      original.roughnessMap?.uuid,
      original.transparent,
      original.opacity,
      original.alphaTest,
      original.side,
      original.isMeshBasicMaterial,
      original.isMeshPhysicalMaterial,
      original.metalness > 0.2 ? original.metalness : 0,
    ].join('|');
    if (!materials.has(key)) {
      const m = original.clone();
      m.color?.setRGB(1, 1, 1);
      m.vertexColors = true;
      m.envMap = null;
      if (!m.name) m.name = 'Dolores surface ' + materials.size;
      if (m.name.startsWith('dolores/')) applyDoloresMaterial(m);
      materials.set(key, m);
    }
    return materials.get(key);
  }
  function append(geometry, original, world, color, cast, receive) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(world);
    if (!g.index)
      g.setIndex(
        Array.from({ length: g.attributes.position.count }, (_, i) => i),
      );
    g.clearGroups();
    const count = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv)
      g.setAttribute(
        'uv',
        new T.Float32BufferAttribute(new Float32Array(count * 2), 2),
      );
    const colors = new Float32Array(count * 3),
      old = g.attributes.color;
    for (let i = 0; i < count; i++) {
      tint.copy(original.color || new T.Color(1, 1, 1)).multiply(color);
      if (old)
        tint.multiply(new T.Color(old.getX(i), old.getY(i), old.getZ(i)));
      colors.set(tint.toArray(), i * 3);
    }
    g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    // All parts in a material bucket need matching attributes. Glass and
    // expanded instanced trim never had the house add() heuristic applied.
    if (!g.attributes.cavity)
      g.setAttribute(
        'cavity',
        new T.Float32BufferAttribute(new Float32Array(count).fill(1), 1),
      );
    for (const key of Object.keys(g.attributes))
      if (!['position', 'normal', 'uv', 'color', 'cavity'].includes(key))
        g.deleteAttribute(key);
    const mat = canonical(original),
      key = mat.uuid;
    if (!buckets.has(key))
      buckets.set(key, { mat, parts: [], cast: false, receive: false });
    const b = buckets.get(key);
    b.parts.push(g);
    b.cast ||= cast;
    b.receive ||= receive;
  }
  scene.traverse((o) => {
    if (!o.isMesh || excluded.has(o) || !o.visible) return;
    const original = o.material;
    if (Array.isArray(original))
      throw new Error('Unexpected multi-material mesh: ' + o.name);
    if (original.isShaderMaterial || o.geometry.parameters?.width === 12000) {
      const c = o.clone();
      c.matrix.copy(o.matrixWorld);
      c.matrixAutoUpdate = false;
      far.add(c);
      return;
    }
    if (o.isInstancedMesh) {
      o.geometry.computeBoundingSphere();
      const sets = [[], []];
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, matrix);
        matrix.premultiply(o.matrixWorld);
        position.copy(o.geometry.boundingSphere.center).applyMatrix4(matrix);
        const reach =
          o.geometry.boundingSphere.radius * matrix.getMaxScaleOnAxis();
        sets[
          Math.hypot(position.x - car.x, position.z + car.y) - reach <= radius
            ? 0
            : 1
        ].push(i);
      }
      sets.forEach((indices, which) => {
        if (!indices.length) return;
        if (which === 0 && o.name.startsWith('Instanced ')) {
          for (const i of indices) {
            o.getMatrixAt(i, matrix);
            matrix.premultiply(o.matrixWorld);
            const color = new T.Color(1, 1, 1);
            if (o.instanceColor) o.getColorAt(i, color);
            append(
              o.geometry,
              original,
              matrix,
              color,
              o.castShadow,
              o.receiveShadow,
            );
          }
          return;
        }
        const c = new T.InstancedMesh(o.geometry, original, indices.length);
        c.name = o.name;
        indices.forEach((i, j) => {
          o.getMatrixAt(i, matrix);
          matrix.premultiply(o.matrixWorld);
          c.setMatrixAt(j, matrix);
          if (o.instanceColor) {
            o.getColorAt(i, tint);
            c.setColorAt(j, tint);
          }
        });
        c.castShadow = o.castShadow;
        c.receiveShadow = o.receiveShadow;
        c.computeBoundingBox();
        c.computeBoundingSphere();
        (which ? far : near).add(c);
      });
      return;
    }
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld),
      pa = g.attributes.position;
    const index =
        g.index?.array || Array.from({ length: pa.count }, (_, i) => i),
      sets = [[], []];
    for (let i = 0; i < index.length; i += 3) {
      let distance = Infinity;
      for (let j = 0; j < 3; j++) {
        const k = index[i + j];
        distance = Math.min(
          distance,
          Math.hypot(pa.getX(k) - car.x, pa.getZ(k) + car.y),
        );
      }
      const dest = sets[distance <= radius ? 0 : 1];
      dest.push(index[i], index[i + 1], index[i + 2]);
    }
    sets.forEach((indices, which) => {
      if (!indices.length) return;
      const part = g.clone();
      part.setIndex(indices);
      part.clearGroups();
      if (which) {
        const mesh = new T.Mesh(part, original);
        mesh.castShadow = o.castShadow;
        mesh.receiveShadow = o.receiveShadow;
        far.add(mesh);
      } else
        append(
          part,
          original,
          new T.Matrix4(),
          new T.Color(1, 1, 1),
          o.castShadow,
          o.receiveShadow,
        );
    });
    g.dispose();
  });
  for (const b of buckets.values()) {
    const combined = mergeGeometries(b.parts);
    // A 180 m-wide facade row has a very loose bounding sphere and box.
    // Keep 20 m material batches so the park-facing camera actually culls it.
    const chunks = new Map();
    if (
      /Painted wood|Stone, brick|Window glass|Subtle runoff/.test(b.mat.name)
    ) {
      const pa = combined.attributes.position,
        indices = combined.index.array;
      for (let i = 0; i < indices.length; i += 3) {
        const key = Math.floor(
          (pa.getX(indices[i]) +
            pa.getX(indices[i + 1]) +
            pa.getX(indices[i + 2])) /
            60,
        );
        if (!chunks.has(key)) chunks.set(key, []);
        chunks.get(key).push(indices[i], indices[i + 1], indices[i + 2]);
      }
    } else chunks.set('all', null);
    for (const [cell, indices] of chunks) {
      let geometry = combined;
      if (indices) {
        const part = combined.clone();
        part.setIndex(indices);
        geometry = part.toNonIndexed();
        part.dispose();
      }
      const mesh = new T.Mesh(geometry, b.mat);
      mesh.name = b.mat.name + ' / ' + cell;
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.receive;
      near.add(mesh);
    }
    if (!chunks.has('all')) combined.dispose();
    b.parts.forEach((g) => g.dispose());
  }
  near.traverse((o) => {
    if (o.isMesh) {
      o.userData.shadows = { cast: o.castShadow, receive: o.receiveShadow };
    }
  });
  return { near, far };
}

// Night windows for the far field's extruded walls, whose UVs count window
// bays across and floors up (scene.js extrude()). Each bay and floor is lit
// or dark by a hash, warmer in houses and whiter in the office towers.
function lightWindows(far) {
  const patched = new Set();
  far.traverse((o) => {
    const m = o.material;
    const kind = o.isMesh && !Array.isArray(m) ? m.map?.name : undefined;
    if ((kind !== 'facade' && kind !== 'office') || patched.has(m)) return;
    patched.add(m);
    const office = kind === 'office';
    m.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 nightWorld;',
        )
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nnightWorld=(modelMatrix*vec4(transformed,1.)).xyz;',
        );
      s.fragmentShader = s.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 nightWorld;',
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          vec2 cell=floor(vMapUv),f=fract(vMapUv);
          float block=floor(nightWorld.x/13.)+floor(nightWorld.z/13.)*57.;
          float r=fract(sin(dot(vec3(cell,block),vec3(12.9898,78.233,37.719)))*43758.5453);
          ${
            office
              ? `float pane=step(f.y,.92)*step(.06,fract(f.x*8.));
          float on=step(.74,r);
          vec3 lamp=mix(vec3(.9,.92,1.),vec3(1.,.74,.46),fract(r*7.));`
              : `float pane=step(.25,f.x)*step(f.x,.75)*step(.3,f.y)*step(f.y,.81);
          float on=step(.76,r)*step(0.,cell.y);
          vec3 lamp=mix(vec3(1.,.52,.22),vec3(1.,.7,.4),fract(r*7.));`
          }
          totalEmissiveRadiance+=lamp*pane*on*(.35+.65*fract(r*13.))*${office ? '0.6' : '1.3'};`,
        );
    };
    m.customProgramCacheKey = () => 'dolores-night-' + kind;
    m.needsUpdate = true;
  });
}

function census(root) {
  let triangles = 0,
    meshes = 0,
    instances = 0;
  const canopies = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const n = o.isInstancedMesh ? o.count : 1;
    instances += n;
    triangles +=
      ((o.geometry.index?.count || o.geometry.attributes.position.count) / 3) *
      n;
    if (o.name.replaceAll('_', ' ').startsWith('Park canopy'))
      canopies.push({
        name: o.name.replaceAll('_', ' '),
        count: n,
        colors: o.instanceColor?.count || 0,
      });
  });
  return { triangles, meshes, instances, canopies };
}

export async function prepareLiveScene({
  scene,
  r,
  camera,
  carHolder,
  car,
  roadZ,
  roadHeight,
  roadY,
  surfaceAt,
  sun,
  toSun,
  q,
}) {
  const { near, far } = splitScene(scene, carHolder, car);
  // A compact height tile covers every allowed orbit camera, including the
  // falling park verge. Road samples preserve the exact wheelbase slope.
  const heights = [];
  for (let y = -171; y <= -139; y += 0.25)
    for (let x = -3; x <= 30; x += 0.25)
      heights.push(Math.round(surfaceAt(x, y) * 10000) / 10000);
  near.userData.dolores = {
    version: 1,
    splitDistance: 180,
    car,
    roadZ,
    roadSamples: Array.from({ length: 441 }, (_, i) => {
      const x = -130 + i * 0.5;
      return [x, roadHeight(x)];
    }),
    ground: { x0: -3, y0: -171, step: 0.25, w: 133, h: 129, heights },
    sourceCensus: census(near),
    cameraSpheres: scene.userData.cameraSpheres || [],
    obstacles: [
      { name: 'hero trunk', x: 10.6, y: -148.5, r: 0.95, top: 15 },
      { name: 'leaning trunk', x: 7.8, y: -149.4, r: 1.2, top: 15 },
      ...[15.8, 19].map((x, i) => ({
        name: 'bench ' + (i + 1),
        x,
        y: roadY(x) + 9.77,
        r: 1.4,
        top: 1.55,
      })),
      ...[-17, 43].map((x) => ({
        name: 'lamp',
        x,
        y: roadY(x) - 6.55,
        r: 0.5,
        top: 5.1,
      })),
      ...[18, 37, 61].map((x) => ({
        name: 'street tree',
        x,
        y: roadY(x) - 6.55,
        r: 0.5,
        top: 5.5,
      })),
    ],
  };
  const originals = scene.children.filter(
    (o) => !o.isLight && o !== sun.target,
  );
  originals.forEach((o) => scene.remove(o));
  scene.add(near, far, carHolder);
  sun.shadow.mapSize.set(
    q.get('phone') === '1' ? 1024 : 2048,
    q.get('phone') === '1' ? 1024 : 2048,
  );
  Object.assign(sun.shadow.camera, {
    left: -30,
    right: 30,
    top: 30,
    bottom: -30,
  });
  sun.shadow.camera.updateProjectionMatrix();
  let aoBaked = false;
  window.exportPark = async () => {
    if (q.get('phone') !== '1' && !aoBaked) {
      bakeSkyVisibility(near, r, q);
      aoBaked = true; // Repeated exports must not multiply the colours again.
    }
    // Helpers never enter either GLB; phone keeps its original colours.
    near.traverse((o) => {
      if (o.isMesh) o.geometry.deleteAttribute('cavity');
    });
    const result = await new GLTFExporter().parseAsync(near, {
      binary: true,
      onlyVisible: false,
    });
    // Round-trip uses exactly the same subset, unlike the old 70 m experiment.
    const loaded = await new GLTFLoader().parseAsync(result, '');
    restoreDoloresMaterials(loaded.scene, { toSun });
    window.roundTrip = { before: census(near), after: census(loaded.scene) };
    if (
      JSON.stringify(window.roundTrip.before.canopies) !==
      JSON.stringify(window.roundTrip.after.canopies)
    )
      throw new Error(
        'Canopy round-trip mismatch ' + JSON.stringify(window.roundTrip),
      );
    window.parkBytes = new Uint8Array(result);
    return result.byteLength;
  };
  if (q.get('night') === '1') lightWindows(far);
  // The live viewer draws its own sky, for any time of day, so the far
  // field is captured over a transparent sky. Each face is rendered with
  // black and then white fog: their difference is the fog amount, which
  // export.mjs turns into alpha, so distant hills melt into whatever sky
  // the viewer draws rather than into this bake's haze colour.
  window.captureBand = async (size = 1024) => {
    const saved = {
      background: scene.background,
      fog: scene.fog.color.clone(),
      clear: r.getClearColor(new T.Color()),
      alpha: r.getClearAlpha(),
    };
    // The split carries scene.js's sky dome (its one ShaderMaterial) over
    // into the far field; it is the sky the viewer now replaces.
    const domes = [];
    far.traverse((o) => {
      if (o.isMesh && o.material.isShaderMaterial && o.visible) {
        domes.push(o);
        o.visible = false;
      }
    });
    // The ridge is an unlit silhouette, its own atmospheric blend of haze
    // into blue-grey rather than fogged. Capture it as that blend: 65% of a
    // surface colour over whatever sky the viewer draws (dark at night).
    const night = q.get('night') === '1',
      ridges = [];
    far.traverse((o) => {
      const m = o.material;
      if (o.isMesh && m.isMeshBasicMaterial && m.vertexColors && !m.fog) {
        ridges.push([o, m]);
        o.material = new T.ShaderMaterial({
          uniforms: {
            surface: {
              value: new T.Color().setHex(
                night ? 0x1d2230 : 0xa0adbb,
                T.LinearSRGBColorSpace,
              ),
            },
            fogColor: { value: scene.fog.color },
          },
          side: T.DoubleSide,
          vertexShader:
            'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
          // Display values straight to the canvas: no tone mapping or encoding.
          fragmentShader:
            'uniform vec3 surface,fogColor;void main(){gl_FragColor=vec4(surface*.65+fogColor*.35,1.);}',
        });
      }
    });
    scene.background = null;
    r.setClearColor(0x000000, 0);
    const faces = {};
    for (const [name, png] of Object.entries(
      await captureFaces(size, () => scene.fog.color.set(0x000000)),
    ))
      faces[name] = { black: png };
    for (const [name, png] of Object.entries(
      await captureFaces(size, () => scene.fog.color.set(0xffffff)),
    ))
      faces[name].white = png;
    domes.forEach((o) => (o.visible = true));
    for (const [o, m] of ridges) {
      o.material.dispose();
      o.material = m;
    }
    scene.background = saved.background;
    scene.fog.color.copy(saved.fog);
    r.setClearColor(saved.clear, saved.alpha);
    return faces;
  };
  async function captureFaces(size, prepare) {
    prepare();
    return window.captureBackdrop(size);
  }
  window.captureBackdrop = async (size = 1024) => {
    near.visible = carHolder.visible = false;
    const faces = {};
    const c = new T.PerspectiveCamera(90, 1, 0.15, 40000);
    c.position.set(car.x, roadZ + 1.5, -car.y);
    const saved = r.getSize(new T.Vector2());
    // CubeTextureLoader's +X is mirrored by WebGLBackground; render with the
    // standard image-cubemap camera orientation (not render-target cubemap).
    for (const [name, dir, up] of [
      ['px', [-1, 0, 0], [0, -1, 0]],
      ['nx', [1, 0, 0], [0, -1, 0]],
      ['py', [0, 1, 0], [0, 0, 1]],
      ['ny', [0, -1, 0], [0, 0, -1]],
      ['pz', [0, 0, 1], [0, -1, 0]],
      ['nz', [0, 0, -1], [0, -1, 0]],
    ]) {
      const faceSize = typeof size === 'number' ? size : size[name];
      r.setSize(faceSize, faceSize, false);
      c.up.set(up[0], up[1], up[2]);
      c.lookAt(c.position.clone().add(new T.Vector3(dir[0], dir[1], dir[2])));
      r.render(scene, c);
      faces[name] = r.domElement.toDataURL('image/png');
    }
    r.setSize(saved.x, saved.y, false);
    near.visible = carHolder.visible = true;
    return faces;
  };
  window.liveBuild = { scene, near, far, r, camera };
  r.render(scene, camera);
  window.png = r.domElement.toDataURL('image/png');
  window.sceneInfo.live = census(near);
  window.done = true;
}

import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  applyDoloresMaterial,
  restoreDoloresMaterials,
} from '../../lib/dolores-park-materials.js';

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
    for (const key of Object.keys(g.attributes))
      if (!['position', 'normal', 'uv', 'color'].includes(key))
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
  window.exportPark = async () => {
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

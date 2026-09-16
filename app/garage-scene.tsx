'use client';
import { useEffect, useRef } from 'react';
import type {
  BufferGeometry,
  Material,
  Mesh,
  MeshStandardMaterial,
  Texture,
  WebGLRenderer,
} from 'three';
import { sceneAsset } from '@/lib/scene-assets';

type Props = {
  reducedMotion: boolean;
  onStatus: (value: 'loading' | 'ready' | 'unavailable') => void;
};

// A soft radial studio floor, drawn once at load rather than shipped as an
// image asset — the same "generate it, don't fetch it" approach the sky's
// cloud-shadow noise uses elsewhere in this codebase.
function floorTexture(T: typeof import('@/lib/garage-three')) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, 'rgba(10,11,13,0.6)');
  gradient.addColorStop(0.35, 'rgba(10,11,13,0.4)');
  gradient.addColorStop(0.7, 'rgba(10,11,13,0.16)');
  gradient.addColorStop(1, 'rgba(10,11,13,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new T.Texture(canvas);
  texture.needsUpdate = true;
  return texture;
}

const fetchAsset = async (path: string, signal: AbortSignal) => {
  const response = await fetch(sceneAsset(path), {
    signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
  });
  if (!response.ok) throw new Error('Garage asset unavailable');
  return response.arrayBuffer();
};

export default function GarageScene({ reducedMotion, onStatus }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const status = useRef(onStatus);
  useEffect(() => {
    status.current = onStatus;
  }, [onStatus]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    if (reducedMotion) {
      status.current('ready');
      return;
    }
    status.current('loading');
    const controller = new AbortController();
    let disposed = false,
      started = false,
      visible = false,
      interacting = false,
      frame = 0,
      settleFrames = 0;
    let renderer: WebGLRenderer | undefined;
    const cleanups: (() => void)[] = [];
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    const textures = new Set<Texture>();
    const release = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      cleanups.splice(0).forEach((dispose) => dispose());
      geometries.forEach((g) => g.dispose());
      geometries.clear();
      materials.forEach((m) => m.dispose());
      materials.clear();
      textures.forEach((t) => t.dispose());
      textures.clear();
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
        renderer = undefined;
      }
    };
    const fail = () => {
      if (disposed) return;
      disposed = true;
      controller.abort();
      release();
      status.current('unavailable');
    };
    let requestRender = () => {};
    const start = async () => {
      if (started) return;
      started = true;
      const [
        T,
        { GLTFLoader },
        { DRACOLoader },
        { OrbitControls: Controls },
        { HDRLoader },
      ] = await Promise.all([
        import('@/lib/garage-three'),
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/loaders/DRACOLoader.js'),
        import('three/addons/controls/OrbitControls.js'),
        import('three/addons/loaders/HDRLoader.js'),
      ]);
      if (disposed) return;
      const r = (renderer = new T.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
      }));
      r.setClearColor(0x000000, 0);
      r.outputColorSpace = T.SRGBColorSpace;
      r.toneMapping = T.ACESFilmicToneMapping;
      r.toneMappingExposure = 0.85;
      element.appendChild(r.domElement);
      const lost = (e: Event) => {
        e.preventDefault();
        fail();
      };
      r.domElement.addEventListener('webglcontextlost', lost);
      cleanups.push(() =>
        r.domElement.removeEventListener('webglcontextlost', lost),
      );
      // No scene.background: the canvas clears to transparent (the
      // renderer's `alpha: true` plus the clear color's zero alpha below),
      // so the car sits directly on the page/frame behind it rather than
      // inside a modeled sky or studio backdrop.
      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(36, 1, 0.1, 50);
      camera.position.set(4.6, 1.9, 5.4);
      scene.add(new T.HemisphereLight(0xdfe6ea, 0x33363c, 0.9));
      const sun = new T.DirectionalLight(0xfff6e8, 1.5);
      sun.position.set(-6, 8, 5);
      scene.add(sun);
      const fill = new T.DirectionalLight(0xcfe0ff, 0.4);
      fill.position.set(6, 3, -6);
      scene.add(fill);
      // A cool rim/kicker light from behind separates the car's silhouette
      // from whatever sits behind the transparent canvas -- without it the
      // shaded side of the body reads as flat as the void it's floating in.
      const rim = new T.DirectionalLight(0xcfe3ff, 1.1);
      rim.position.set(-1.5, 5, -7);
      scene.add(rim);
      // The only place that calls requestAnimationFrame -- always gated on
      // `frame` already being empty. render() itself calls this at its own
      // tail, but orbit.update() (called from inside render(), a few lines
      // down) can *synchronously* dispatch OrbitControls' own 'change' event
      // whenever there's residual damping motion, which reaches this same
      // function through requestFrame below. Without the `frame` guard,
      // that inner call and render()'s own tail call each schedule a frame,
      // doubling the pending count every frame damping is still settling --
      // confirmed empirically (a single test drag queued 48,610 pending
      // frames within under a second) before this guard was unified here.
      const scheduleFrame = () => {
        if (disposed || frame) return;
        frame = requestAnimationFrame(render);
      };
      requestRender = () => {
        settleFrames = 40;
        scheduleFrame();
      };
      // A frame during active dragging: keeps the loop alive without
      // resetting the settle window, unlike requestRender -- OrbitControls'
      // own damping keeps firing 'change' for a couple dozen frames after
      // release, on top of whatever's still decaying from the drag itself,
      // and if that also reset settleFrames every time it would perpetually
      // push the 40-frame cutoff back out, rendering far longer than a
      // settle tail ever needs to.
      const requestFrame = scheduleFrame;
      const orbit = new Controls(camera, r.domElement);
      orbit.enableDamping = true;
      orbit.dampingFactor = 0.08;
      orbit.target.set(0, 0.55, 0);
      orbit.minDistance = 3.2;
      orbit.maxDistance = 11;
      orbit.maxPolarAngle = Math.PI * 0.49;
      orbit.minPolarAngle = Math.PI * 0.12;
      orbit.enablePan = false;
      orbit.update();
      // Declared here (before resize()'s first call below, which requests a
      // render) rather than down by the gltf load — requestRender can be
      // invoked synchronously during setup, and referencing a later `const`
      // before its own declaration line has run is a temporal-dead-zone
      // crash, not just a stale closure.
      const render = () => {
        frame = 0;
        if (disposed || !renderer || !visible || document.hidden) return;
        orbit.update();
        r.render(scene, camera);
        if (!interacting) settleFrames = Math.max(0, settleFrames - 1);
        if (interacting || settleFrames > 0) scheduleFrame();
      };
      orbit.addEventListener('start', () => {
        interacting = true;
        requestRender();
      });
      orbit.addEventListener('change', requestFrame);
      orbit.addEventListener('end', () => {
        interacting = false;
        settleFrames = 40;
      });
      cleanups.push(() => orbit.dispose());
      let width = 1,
        height = 1;
      const resize = () => {
        if (disposed || !renderer) return;
        width = Math.max(1, element.clientWidth);
        height = Math.max(1, element.clientHeight);
        r.setPixelRatio(Math.min(2, devicePixelRatio));
        r.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        requestRender();
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(element);
      cleanups.push(() => resizeObserver.disconnect());
      resize();
      void fetchAsset('/scenery/daylight.hdr', controller.signal)
        .then((bytes) => {
          if (disposed) return;
          const data = new HDRLoader().parse(bytes);
          const texture = new T.DataTexture(
            data.data,
            data.width,
            data.height,
            T.RGBAFormat,
            data.type,
          );
          texture.mapping = T.EquirectangularReflectionMapping;
          texture.needsUpdate = true;
          const pmrem = new T.PMREMGenerator(r);
          const environment = pmrem.fromEquirectangular(texture);
          // The same daylight dome the aircraft tour uses, sampled for
          // reflections only -- there's no visible backdrop for it to
          // double as; scene.background is left unset (see above).
          scene.environment = environment.texture;
          scene.environmentIntensity = 0.6;
          texture.dispose();
          pmrem.dispose();
          cleanups.push(() => environment.dispose());
          requestRender();
        })
        .catch(() => {
          /* Flat hemisphere/directional lighting remains a usable fallback. */
        });
      const bytes = await fetchAsset(
        '/models/garage-gt350r.glb',
        controller.signal,
      );
      if (disposed) return;
      const draco = new DRACOLoader().setDecoderPath(sceneAsset('/draco/'));
      const gltf = await new GLTFLoader()
        .setDRACOLoader(draco)
        .parseAsync(bytes, '')
        .finally(() => draco.dispose());
      gltf.scene.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        geometries.add(mesh.geometry);
        for (const material of Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material]) {
          materials.add(material);
          Object.values(material).forEach((value) => {
            if (value instanceof T.Texture) textures.add(value);
          });
        }
      });
      if (disposed) {
        release();
        return;
      }
      // The body paint reads as a showroom finish with a clearcoat pass; the
      // rest of the car keeps whatever PBR values the conversion produced.
      gltf.scene.traverse((node) => {
        const mesh = node as Mesh;
        const original = mesh.material as MeshStandardMaterial | undefined;
        if (
          !mesh.isMesh ||
          !original ||
          !original.name?.toLowerCase().includes('paint')
        )
          return;
        const finish = new T.MeshPhysicalMaterial();
        T.MeshStandardMaterial.prototype.copy.call(finish, original);
        finish.defines = { STANDARD: '', PHYSICAL: '' };
        finish.roughness = 0.45;
        finish.metalness = 0.1;
        finish.clearcoat = 0.35;
        finish.clearcoatRoughness = 0.25;
        mesh.material = finish;
        materials.add(finish);
      });
      const floor = floorTexture(T);
      if (floor) {
        // A soft contact shadow floating on its own -- there's no road or
        // sky plane to layer it above now, just this and the transparent
        // canvas -- so the car reads as resting on something instead of
        // hovering with no grounding at all.
        const ground = new T.Mesh(
          new T.CircleGeometry(5.5, 48),
          new T.MeshBasicMaterial({
            map: floor,
            transparent: true,
            depthWrite: false,
          }),
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = 0.001;
        scene.add(ground);
        geometries.add(ground.geometry);
        materials.add(ground.material);
        textures.add(floor);
      }
      scene.add(gltf.scene);
      r.compile(scene, camera);
      if (disposed) return;
      status.current('ready');
      requestRender();
      const hidden = () => {
        if (document.hidden) {
          cancelAnimationFrame(frame);
          frame = 0;
        } else requestRender();
      };
      document.addEventListener('visibilitychange', hidden);
      cleanups.push(() =>
        document.removeEventListener('visibilitychange', hidden),
      );
    };
    // The WebGL context itself waits until the section is near the
    // viewport — it sits below the fold, and the tour above it already owns
    // one canvas and its own render budget. The same observer then gates
    // render-on-demand once the viewer is live: no RAF while scrolled away.
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) {
          void start().catch(fail);
          requestRender();
        } else {
          cancelAnimationFrame(frame);
          frame = 0;
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(element);
    return () => {
      disposed = true;
      observer.disconnect();
      controller.abort();
      release();
    };
  }, [reducedMotion]);
  return <div className="garage-canvas" ref={host} />;
}

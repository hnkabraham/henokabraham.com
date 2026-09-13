'use client';
import { useEffect, useRef, type RefObject } from 'react';
import type { Material, Mesh, Texture, WebGLRenderer } from 'three';
import { sceneAsset } from '@/lib/scene-assets';
import { sampleDreamlinerTour, tourPixelRatio } from '@/lib/dreamliner-tour';
import {
  createFlightPerformance,
  createScrollPerformance,
  followFlightProgress,
} from '@/lib/bay-performance';
import { addWingFlex } from '@/lib/airframe-flex';
import { addLivery, createLiveryTexture } from '@/lib/bay-livery';
import { recordFlightMetric } from '@/lib/flight-metrics';
import type { createBayAudio } from '@/lib/bay-audio';

type Props = {
  progress: RefObject<number>;
  reducedMotion: boolean;
  paused?: boolean;
  audio: RefObject<ReturnType<typeof createBayAudio> | null>;
  onStatus: (value: 'loading' | 'ready' | 'unavailable') => void;
};

export default function DreamlinerScene({
  progress,
  reducedMotion,
  paused = false,
  audio,
  onStatus,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const status = useRef(onStatus);
  const pausedRef = useRef(paused);
  const wakeRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    pausedRef.current = paused;
    wakeRef.current?.();
  }, [paused]);
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
      frame = 0,
      visible = true,
      ready = false;
    let renderer: WebGLRenderer | undefined;
    const cleanups: (() => void)[] = [];
    const geometries = new Set<import('three').BufferGeometry>();
    const materials = new Set<Material>();
    const textures = new Set<Texture>();
    const release = () => {
      cancelAnimationFrame(frame);
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
      audio.current?.update(0, false);
    };
    const fail = () => {
      if (disposed) return;
      ready = false;
      disposed = true;
      controller.abort();
      release();
      recordFlightMetric('scene_asset_failure', 1);
      status.current('unavailable');
    };
    const start = async () => {
      const [T, { GLTFLoader }, { DRACOLoader }, { HDRLoader }] =
        await Promise.all([
          import('three'),
          import('three/addons/loaders/GLTFLoader.js'),
          import('three/addons/loaders/DRACOLoader.js'),
          import('three/addons/loaders/HDRLoader.js'),
        ]);
      if (disposed) return;
      const r = (renderer = new T.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      }));
      r.setClearColor(0x000000, 0);
      r.outputColorSpace = T.SRGBColorSpace;
      r.toneMapping = T.AgXToneMapping;
      r.toneMappingExposure = 1.1;
      r.shadowMap.enabled = true;
      r.shadowMap.type = T.PCFShadowMap;
      element.appendChild(r.domElement);
      const lost = (e: Event) => {
        e.preventDefault();
        fail();
      };
      r.domElement.addEventListener('webglcontextlost', lost);
      cleanups.push(() =>
        r.domElement.removeEventListener('webglcontextlost', lost),
      );
      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(34, 1, 0.15, 1200);
      const aircraft = new T.Group();
      scene.add(aircraft);
      scene.add(new T.HemisphereLight(0xcbe8ff, 0x7c8f9c, 1.15));
      const sun = new T.DirectionalLight(0xfff4dc, 3.5);
      const sunlightOffset = new T.Vector3(-45, 75, 50);
      sun.position.copy(sunlightOffset);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, {
        left: -44,
        right: 44,
        top: 44,
        bottom: -44,
        near: 1,
        far: 200,
      });
      sun.shadow.bias = -0.00012;
      sun.shadow.normalBias = 0.04;
      scene.add(sun, sun.target);
      cleanups.push(() => sun.shadow.map?.dispose());
      const performanceControl = createFlightPerformance();
      const scrollPerformance = createScrollPerformance();
      let width = 1,
        height = 1,
        current = progress.current,
        previous = 0,
        elapsed = 0;
      let devReport = 0;
      const resize = () => {
        if (disposed || !renderer) return;
        width = Math.max(1, element.clientWidth);
        height = Math.max(1, element.clientHeight);
        r.setPixelRatio(
          tourPixelRatio(
            width,
            height,
            devicePixelRatio,
            performanceControl.quality,
          ),
        );
        r.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        element.dataset.pixelRatio = r.getPixelRatio().toFixed(2);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(element);
      cleanups.push(() => observer.disconnect());
      resize();
      const fetchBytes = async (path: string) => {
        const response = await fetch(sceneAsset(path), {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(25000),
          ]),
        });
        if (!response.ok) throw new Error('Aircraft asset unavailable');
        return response.arrayBuffer();
      };
      // HDR is optional: directional/hemisphere light remains a usable fallback,
      // so the aircraft never waits for it. Should it land after the scene is
      // ready, recompile once so the environment map is not built mid-frame.
      void fetchBytes('/scenery/daylight.hdr')
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
          scene.environment = environment.texture;
          scene.environmentIntensity = 1.25;
          texture.dispose();
          pmrem.dispose();
          cleanups.push(() => environment.dispose());
          if (ready) r.compile(scene, camera);
        })
        .catch(() => {
          /* The aircraft also has ordinary direct and sky lighting. */
        });
      const bytes = await fetchBytes('/models/dreamliner-787-9.glb');
      if (disposed) return;
      // The mesh is Draco-compressed, 1.3 MB against 5.3 MB plain. The wasm
      // decoder is served beside the model; its workers end once parsed.
      const draco = new DRACOLoader().setDecoderPath(sceneAsset('/draco/'));
      const gltf = await new GLTFLoader()
        .setDRACOLoader(draco)
        .parseAsync(bytes, '')
        .finally(() => draco.dispose());
      // Parsing can finish after React has unmounted. Register resources before
      // testing the lifecycle so late completions are disposed as well.
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
      const livery = createLiveryTexture();
      if (livery) textures.add(livery);
      const flex = { value: 0.45 };
      const wingDepth = new T.MeshDepthMaterial({
        depthPacking: T.RGBADepthPacking,
      });
      addWingFlex(wingDepth, flex);
      materials.add(wingDepth);
      const fans: import('three').Group[] = [];
      gltf.scene.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        const original = mesh.material as import('three').MeshStandardMaterial;
        const finish = new T.MeshPhysicalMaterial();
        T.MeshStandardMaterial.prototype.copy.call(finish, original);
        finish.defines = { STANDARD: '', PHYSICAL: '' };
        const paint = ['skin', 'nacelle'].includes(original.name);
        finish.roughness = paint
          ? 0.3
          : original.name === 'glass'
            ? 0.15
            : 0.36;
        finish.metalness = paint ? 0.08 : original.name === 'glass' ? 0.4 : 0.7;
        finish.clearcoat = paint ? 0.75 : 0.15;
        finish.clearcoatRoughness = 0.18;
        finish.envMapIntensity = original.name.includes('fan') ? 1.8 : 1;
        if (finish.map)
          finish.map.anisotropy = Math.min(
            16,
            r.capabilities.getMaxAnisotropy(),
          );
        if (['skin', 'wing-metal', 'chrome'].includes(original.name)) {
          addWingFlex(finish, flex);
          mesh.customDepthMaterial = wingDepth;
          if (livery && original.name === 'skin')
            addLivery(finish, livery, [0, 4.6, 0]);
        }
        if (original.name === 'beacon') {
          finish.emissive.set(0xff1705);
          finish.emissiveIntensity = 0.3;
        }
        mesh.material = finish;
        materials.add(finish);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (original.name.startsWith('fan-')) {
          const pivot = new T.Group();
          pivot.position.set(
            -7.5616,
            -1.12702,
            original.name === 'fan-port' ? 9.41336 : -9.41336,
          );
          // Delay reparenting until traversal completes.
          fans.push(pivot);
          pivot.userData.mesh = mesh;
        }
      });
      for (const pivot of fans) {
        const mesh = pivot.userData.mesh as Mesh;
        mesh.position.copy(pivot.position).negate();
        pivot.add(mesh);
        gltf.scene.add(pivot);
        delete pivot.userData.mesh;
      }
      aircraft.add(gltf.scene);
      // Synchronous warm-up avoids an uncancellable driver poll after unmount.
      r.compile(scene, camera);
      if (disposed) return;
      ready = true;
      let lastShown = false;
      let wakeFrames = 0;
      const render = (now: number) => {
        frame = 0;
        if (
          disposed ||
          !renderer ||
          !ready ||
          !visible ||
          document.hidden ||
          pausedRef.current
        )
          return;
        const dt = Math.min(0.05, previous ? (now - previous) / 1000 : 1 / 60);
        previous = now;
        const before = current;
        current = followFlightProgress(current, progress.current, dt);
        const shot = sampleDreamlinerTour(current, width / height);
        elapsed += dt;
        camera.position.set(...shot.camera);
        camera.lookAt(...shot.target);
        camera.fov = shot.fov;
        camera.setViewOffset(
          width,
          height,
          width * shot.offsetX,
          height * shot.offsetY,
          width,
          height,
        );
        camera.updateProjectionMatrix();
        aircraft.visible = shot.visible;
        aircraft.position.set(...shot.aircraft);
        aircraft.position.y += Math.sin(elapsed * 0.65) * 0.08;
        aircraft.rotation.x = shot.bank + Math.sin(elapsed * 0.4) * 0.003;
        flex.value = 0.45 + Math.sin(elapsed * 0.8) * 0.075;
        for (const fan of fans) fan.rotation.x = (elapsed * 11) % (Math.PI * 2);
        sun.target.position.copy(aircraft.position);
        sun.position.copy(aircraft.position).add(sunlightOffset);
        const shown = shot.visible;
        // The opening remains CSS-only; clear once when scrolling back to it.
        if (shown || lastShown) r.render(scene, camera);
        lastShown = shown;
        audio.current?.update(current < 0.29 ? current : 0.4, shown);
        if (shown) {
          const sample = performanceControl.sample(now);
          if (sample?.changed) {
            r.shadowMap.enabled = sample.quality > 0;
            resize();
          }
          if (sample) {
            recordFlightMetric('scene_fps', sample.fps);
            if (process.env.NODE_ENV !== 'production') {
              element.dataset.fps = sample.fps.toFixed(1);
              element.dataset.frameP95 = sample.p95.toFixed(1);
            }
          }
          const scrolling = scrollPerformance.sample(
            now,
            current,
            Math.abs(current - before) > 0.000015,
          );
          if (scrolling) {
            recordFlightMetric('scene_scroll_fps', scrolling.fps);
            recordFlightMetric('scene_scroll_p95_ms', scrolling.p95);
            recordFlightMetric('scene_scroll_jank_pct', scrolling.jank);
          }
        } else {
          performanceControl.reset();
          scrollPerformance.reset();
        }
        if (process.env.NODE_ENV !== 'production' && now - devReport > 400) {
          element.dataset.tourProgress = current.toFixed(4);
          element.dataset.triangles = String(r.info.render.triangles);
          element.dataset.drawCalls = String(r.info.render.calls);
          element.dataset.aircraftVisible = String(shown);
          element.dataset.quality = String(performanceControl.quality);
          devReport = now;
        }
        // No RAF while the opening is settled or the scene is off screen.
        wakeFrames = Math.max(0, wakeFrames - 1);
        if (
          shown ||
          wakeFrames > 0 ||
          Math.abs(current - progress.current) > 0.00001
        )
          frame = requestAnimationFrame(render);
      };
      const wake = () => {
        if (!visible || document.hidden || pausedRef.current) {
          cancelAnimationFrame(frame);
          frame = 0;
          previous = 0;
          performanceControl.reset();
          scrollPerformance.reset();
          audio.current?.update(0, false);
          return;
        }
        // Allow the parent’s scroll RAF to update the progress ref first.
        wakeFrames = 2;
        if (!frame) frame = requestAnimationFrame(render);
      };
      wakeRef.current = wake;
      cleanups.push(() => {
        wakeRef.current = undefined;
      });
      const visibility = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        wake();
      });
      visibility.observe(element);
      addEventListener('scroll', wake, { passive: true });
      addEventListener('resize', wake);
      document.addEventListener('visibilitychange', wake);
      cleanups.push(() => {
        visibility.disconnect();
        removeEventListener('scroll', wake);
        removeEventListener('resize', wake);
        document.removeEventListener('visibilitychange', wake);
      });
      r.domElement.classList.add('is-ready');
      status.current('ready');
      wake();
    };
    void start().catch(fail);
    return () => {
      disposed = true;
      controller.abort();
      release();
    };
  }, [progress, reducedMotion, audio]);
  return (
    <div
      className="bay-canvas dreamliner-canvas"
      ref={host}
      aria-hidden="true"
    />
  );
}

'use client';
import { useEffect, useRef, type RefObject } from 'react';
import type {
  Material,
  Mesh,
  Sprite,
  SpriteMaterial,
  Texture,
  WebGLRenderer,
} from 'three';
import { sceneAsset } from '@/lib/scene-assets';
import { sampleDreamlinerTour, tourPixelRatio } from '@/lib/dreamliner-tour';
import {
  ENGINE_AXIS,
  EXHAUST_STATION,
  TURBINE_STATION,
  glowDisc,
  turbineRing,
  wingLift,
} from '@/lib/dreamliner-engine';
import {
  createFlightPerformance,
  createScrollPerformance,
  followFlightProgress,
} from '@/lib/bay-performance';
import { addEngineFinish, addWingFlex } from '@/lib/airframe-flex';
import { addLivery, createLiveryTexture } from '@/lib/bay-livery';
import { projectWing, type WingWake } from '@/lib/dreamliner-wake';
import { recordFlightMetric } from '@/lib/flight-metrics';
import type { createBayAudio } from '@/lib/bay-audio';

type Props = {
  progress: RefObject<number>;
  reducedMotion: boolean;
  paused?: boolean;
  audio: RefObject<ReturnType<typeof createBayAudio> | null>;
  /** The story text's springs, fed the wings' screen outlines each frame. */
  wake?: RefObject<WingWake | null>;
  onStatus: (value: 'loading' | 'ready' | 'unavailable') => void;
};

export default function DreamlinerScene({
  progress,
  reducedMotion,
  paused = false,
  audio,
  wake: springs,
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
          import('@/lib/dreamliner-three'),
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
      // A narrow viewport never resolves the 4096² maps, so it takes the
      // 611 KB variant: the same Draco mesh under 2048² textures. The wide
      // model is 1.3 MB against 5.3 MB plain. The wasm decoder is served
      // beside the model; its workers end once parsed.
      const bytes = await fetchBytes(
        width < 800
          ? '/models/dreamliner-787-9-phone.glb'
          : '/models/dreamliner-787-9.glb',
      );
      if (disposed) return;
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
      const heat = { value: 1 };
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
        // The engines ride the flexed wing too, else the pylon would lift
        // off the nacelle at cruise flex. The fans cannot take the vertex
        // patch (their meshes turn on pivots, so an object-space lift would
        // turn with the blades); their pivots are raised in the loop instead.
        if (
          [
            'skin',
            'wing-metal',
            'chrome',
            'inlet',
            'nacelle',
            'engine-interior',
          ].includes(original.name)
        ) {
          addWingFlex(finish, flex);
          mesh.customDepthMaterial = wingDepth;
          if (livery && original.name === 'skin')
            addLivery(finish, livery, [0, 4.6, 0]);
        }
        if (original.name === 'beacon') {
          finish.emissive.set(0xff1705);
          finish.emissiveIntensity = 0.3;
        }
        if (original.name === 'engine-interior') addEngineFinish(finish, heat);
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
      // The tour opens looking up the port engine's tailpipe, and the GLB
      // has nothing there: its turbine stages were pruned with the rest of
      // the simulator-only interior. Each core nozzle gets a ring of turbine
      // blades on the fan's own shaft, dark metal with a dull ember, inside
      // the tempered-titanium nozzle that `addEngineFinish` paints, and a
      // faint warm haze at the lip that only shows from astern.
      const turbineGeometry = turbineRing(T);
      geometries.add(turbineGeometry);
      const turbineMaterial = new T.MeshStandardMaterial({
        vertexColors: true,
        color: 0x3a3532,
        metalness: 0.85,
        roughness: 0.45,
        emissive: 0xff5a10,
        emissiveIntensity: 0.3,
        side: T.DoubleSide,
      });
      materials.add(turbineMaterial);
      const halo = glowDisc(T);
      textures.add(halo);
      const turbines: import('three').Group[] = [];
      const glows: Sprite[] = [];
      for (const side of [1, -1]) {
        const turbine = new T.Group();
        turbine.position.set(
          TURBINE_STATION,
          ENGINE_AXIS.y,
          side * ENGINE_AXIS.z,
        );
        turbine.add(new T.Mesh(turbineGeometry, turbineMaterial));
        gltf.scene.add(turbine);
        turbines.push(turbine);
        const glowMaterial = new T.SpriteMaterial({
          map: halo,
          color: 0xff6a1c,
          transparent: true,
          opacity: 0,
          blending: T.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        materials.add(glowMaterial);
        const glow = new T.Sprite(glowMaterial);
        glow.position.set(EXHAUST_STATION, ENGINE_AXIS.y, side * ENGINE_AXIS.z);
        glow.scale.set(2.1, 2.1, 1);
        gltf.scene.add(glow);
        glows.push(glow);
      }
      const toGlow = new T.Vector3();
      // Bank about the body axis after the heading, not the world's X.
      aircraft.rotation.order = 'YXZ';
      aircraft.add(gltf.scene);
      // The aircraft's motion relative to the lens, for the wake's push.
      let relative: [number, number, number] | undefined;
      let wing: ReturnType<typeof projectWing> = [];
      let wakeMoving = false;
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
        aircraft.rotation.y = shot.heading;
        // The wing breathes slowly and, once loaded up, flutters a little.
        flex.value =
          shot.flex +
          Math.sin(elapsed * 0.8) * 0.06 +
          Math.sin(elapsed * 2.9) * 0.02 * shot.flex;
        // The low-pressure turbine drives the fan on one shaft, so they turn together.
        const spin = (elapsed * 11) % (Math.PI * 2);
        for (const fan of fans) fan.rotation.x = spin;
        for (const turbine of turbines) turbine.rotation.x = spin;
        for (const part of [...fans, ...turbines, ...glows])
          part.position.y =
            ENGINE_AXIS.y +
            wingLift(part.position.x, part.position.z, flex.value);
        heat.value =
          1.05 +
          Math.sin(elapsed * 31) * 0.07 +
          Math.sin(elapsed * 17.3) * 0.05;
        turbineMaterial.emissiveIntensity = 0.3 * heat.value;
        for (const glow of glows) {
          // The haze is only convincing looking up the tailpipe: fade it by
          // how far the lens sits off the exhaust axis (+X is astern).
          glow.getWorldPosition(toGlow).sub(camera.position);
          const astern = -toGlow.x / (toGlow.length() || 1);
          (glow.material as SpriteMaterial).opacity =
            Math.max(0, Math.min(1, (astern - 0.55) / 0.3)) * 0.1 * heat.value;
        }
        sun.target.position.copy(aircraft.position);
        sun.position.copy(aircraft.position).add(sunlightOffset);
        const shown = shot.visible;
        // The opening remains CSS-only; clear once when scrolling back to it.
        if (shown || lastShown) r.render(scene, camera);
        lastShown = shown;
        // After the render, so the matrices are the ones just drawn. The
        // wing's outline on screen drives the story text's wake.
        if (springs?.current) {
          const now3: [number, number, number] = [
            shot.aircraft[0] - shot.camera[0],
            shot.aircraft[1] - shot.camera[1],
            shot.aircraft[2] - shot.camera[2],
          ];
          const motion: [number, number, number] = relative
            ? [
                (now3[0] - relative[0]) / dt,
                (now3[1] - relative[1]) / dt,
                (now3[2] - relative[2]) / dt,
              ]
            : [0, 0, 0];
          relative = now3;
          wing = shown
            ? projectWing(camera, gltf.scene, flex.value, width, height, motion)
            : [];
          // The wake reaches the viewer through the pass and the hold and
          // is gone once the aircraft has flown some 60 m off.
          const range = Math.hypot(...now3);
          const strength = Math.max(0, Math.min(1, (60 - range) / 30));
          wakeMoving = springs.current.update(
            wing.length ? wing : null,
            dt,
            strength * strength * (3 - 2 * strength),
          );
        }
        // The ambience swells as the aircraft overtakes and settles to a
        // cruise hum once it has pulled ahead (the exhaust passes the lens
        // with the aircraft some 14 m short of its resting place).
        const pass = Math.exp(-(((shot.aircraft[0] - 14) / 12) ** 2));
        audio.current?.update(0.12 + 0.18 * (0.45 + 0.55 * pass), shown);
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
          element.dataset.wing = JSON.stringify(
            wing.map((poly) => poly.map(Math.round)),
          );
          devReport = now;
        }
        // No RAF while the opening is settled or the scene is off screen,
        // once the text's springs have settled too (a flick back to the top
        // mid-pass must not freeze letters off their rest).
        wakeFrames = Math.max(0, wakeFrames - 1);
        if (
          shown ||
          wakeMoving ||
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
  }, [progress, reducedMotion, audio, springs]);
  return (
    <div
      className="bay-canvas dreamliner-canvas"
      ref={host}
      aria-hidden="true"
    />
  );
}

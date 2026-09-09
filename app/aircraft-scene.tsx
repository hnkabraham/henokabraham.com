'use client';

import { useEffect, useRef, useState } from 'react';
import type { Group, Mesh, Material, Texture } from 'three';
import { LoaderCircle } from 'lucide-react';

export type AircraftView = 'cruise' | 'overhead' | 'nose';
type Props = {
  view: AircraftView;
  moving: boolean;
  destination: number;
  reset: number;
};

export default function AircraftScene({
  view,
  moving,
  destination,
  reset,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef({ view, moving, destination, reset });
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  );
  useEffect(() => {
    state.current = { view, moving, destination, reset };
  }, [view, moving, destination, reset]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let cleanUp: (() => void) | undefined;
    async function start() {
      const [THREE, { GLTFLoader }, { OrbitControls }, { RoomEnvironment }] =
        await Promise.all([
          import('three'),
          import('three/addons/loaders/GLTFLoader.js'),
          import('three/addons/controls/OrbitControls.js'),
          import('three/addons/environments/RoomEnvironment.js'),
        ]);
      if (disposed || !container) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: 'low-power',
        });
      } catch {
        setStatus('unavailable');
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.35;
      container.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
      camera.position.set(0, 4.5, 16.8);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableZoom = false;
      controls.enablePan = false;
      controls.enableDamping = true;
      controls.dampingFactor = 0.065;
      controls.minPolarAngle = 0.1;
      controls.maxPolarAngle = Math.PI * 0.77;
      controls.rotateSpeed = 0.6;
      renderer.domElement.style.touchAction = 'pan-y';
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      const environment = pmrem.fromScene(room, 0.03);
      scene.environment = environment.texture;
      room.dispose();
      pmrem.dispose();
      scene.add(new THREE.HemisphereLight(0xe3f1ff, 0x7b8895, 2.4));
      const sun = new THREE.DirectionalLight(0xfff3d7, 3.8);
      sun.position.set(7, 9, 4);
      scene.add(sun);
      const rim = new THREE.DirectionalLight(0xa6ceff, 2.1);
      rim.position.set(-8, 2, -4);
      scene.add(rim);
      const plane = new THREE.Group();
      scene.add(plane);
      let loaded: Group | undefined;
      let visible = true;
      let manual = false;
      let lastView = state.current.view;
      let lastReset = state.current.reset;
      let lastTime = 0;
      let elapsed = 0;
      let lastDestination = state.current.destination;
      const reducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      );
      const targetCamera = new THREE.Vector3(0, 4.5, 16.8);
      let targetHeading = 2.12;
      const resize = () => {
        if (!container) return;
        const width = container.clientWidth,
          height = container.clientHeight;
        if (!width || !height) return;
        camera.aspect = width / height;
        camera.zoom = Math.min(1, camera.aspect / 1.15);
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      };
      const onStart = () => {
        manual = true;
      };
      controls.addEventListener('start', onStart);
      const onKey = (event: KeyboardEvent) => {
        if (
          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
            event.key,
          )
        )
          return;
        event.preventDefault();
        if (event.key === 'ArrowLeft') targetHeading -= 0.2;
        if (event.key === 'ArrowRight') targetHeading += 0.2;
        if (event.key === 'ArrowUp')
          targetCamera.y = Math.min(15, targetCamera.y + 1);
        if (event.key === 'ArrowDown')
          targetCamera.y = Math.max(-3, targetCamera.y - 1);
        manual = false;
      };
      const onContextLost = (event: Event) => {
        event.preventDefault();
        renderer.setAnimationLoop(null);
        setStatus('unavailable');
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      resize();
      const intersection = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
      });
      intersection.observe(container);
      const frame = (time: number) => {
        const delta = Math.min((time - lastTime) / 1000, 0.04);
        lastTime = time;
        if (!visible || document.hidden) return;
        const current = state.current;
        if (current.view !== lastView || current.reset !== lastReset) {
          lastReset = current.reset;
          targetHeading = 2.12;
          lastView = current.view;
          manual = false;
          if (current.view === 'overhead') targetCamera.set(0, 18, 0.4);
          else if (current.view === 'nose') targetCamera.set(-13, 2, 11);
          else targetCamera.set(0, 4.5, 16.8);
        }
        if (current.destination !== lastDestination) {
          targetHeading += 0.25;
          lastDestination = current.destination;
        }
        const animate = current.moving && !reducedMotion.matches;
        if (animate) elapsed += delta;
        if (!manual)
          camera.position.lerp(targetCamera, reducedMotion.matches ? 1 : 0.04);
        plane.rotation.y = THREE.MathUtils.lerp(
          plane.rotation.y,
          targetHeading,
          reducedMotion.matches ? 1 : 0.035,
        );
        plane.rotation.z = animate
          ? Math.sin(elapsed * 0.4) * 0.025 - 0.055
          : -0.055;
        plane.position.y = animate ? Math.sin(elapsed * 0.65) * 0.09 : 0;
        controls.update();
        renderer.render(scene, camera);
      };
      plane.rotation.y = targetHeading;
      container.addEventListener('keydown', onKey);
      renderer.domElement.addEventListener('webglcontextlost', onContextLost);
      renderer.setAnimationLoop(frame);
      const disposeModel = (root: Group) => {
        const textures = new Set<Texture>();
        const materials = new Set<Material>();
        root.traverse((object) => {
          const mesh = object as Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry.dispose();
          for (const material of Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]) {
            materials.add(material);
            Object.values(material).forEach((value) => {
              if (value?.isTexture) textures.add(value);
            });
          }
        });
        textures.forEach((texture) => texture.dispose());
        materials.forEach((material) => material.dispose());
      };
      cleanUp = () => {
        renderer.setAnimationLoop(null);
        observer.disconnect();
        intersection.disconnect();
        controls.dispose();
        container.removeEventListener('keydown', onKey);
        renderer.domElement.removeEventListener(
          'webglcontextlost',
          onContextLost,
        );
        if (loaded) disposeModel(loaded);
        environment.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
      new GLTFLoader().load(
        '/models/cesium-air.glb',
        (gltf) => {
          if (disposed) {
            disposeModel(gltf.scene);
            return;
          }
          loaded = gltf.scene;
          const box = new THREE.Box3().setFromObject(loaded);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          loaded.position.sub(center);
          const wrapper = new THREE.Group();
          wrapper.add(loaded);
          wrapper.scale.setScalar(10.8 / Math.max(size.x, size.y, size.z));
          plane.add(wrapper);
          setStatus('ready');
        },
        undefined,
        () => {
          if (!disposed) setStatus('unavailable');
        },
      );
    }
    start().catch(() => {
      if (!disposed) setStatus('unavailable');
    });
    return () => {
      disposed = true;
      cleanUp?.();
    };
  }, []);

  return (
    <div className={`aircraft-stage aircraft-${status}`}>
      <div
        ref={host}
        className="aircraft-canvas"
        tabIndex={0}
        role="group"
        aria-label="Interactive aircraft. Drag to orbit, or use arrow keys to rotate."
      />
      {status === 'loading' && (
        <div className="scene-notice mono" role="status">
          <LoaderCircle size={15} className="loading-icon" /> Preparing the
          aircraft
        </div>
      )}
      {status === 'unavailable' && (
        <div className="scene-notice mono">
          Aircraft view unavailable. Your destinations are below.
        </div>
      )}
    </div>
  );
}

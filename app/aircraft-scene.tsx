'use client';

import { useEffect, useRef, useState } from 'react';
import type { Group, Mesh, Material, Texture, Object3D } from 'three';
import { LoaderCircle } from 'lucide-react';
import {
  CRUISE_CAMERA,
  FLIGHT_DURATION,
  sampleFlight,
  smoothFlightEase,
} from '@/lib/flight-motion';

export type AircraftView = 'cruise' | 'overhead' | 'nose';
export type SceneStatus = 'loading' | 'ready' | 'unavailable';
type Props = {
  view: AircraftView;
  moving: boolean;
  destination: number;
  reset: number;
  cinematic: boolean;
  onCinematicEnd: () => void;
  onStatusChange: (status: SceneStatus) => void;
};

export default function AircraftScene({
  view,
  moving,
  destination,
  reset,
  cinematic,
  onCinematicEnd,
  onStatusChange,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef({
    view,
    moving,
    destination,
    reset,
    cinematic,
    onCinematicEnd,
  });
  const [status, setStatus] = useState<SceneStatus>('loading');
  useEffect(() => {
    state.current = {
      view,
      moving,
      destination,
      reset,
      cinematic,
      onCinematicEnd,
    };
  }, [view, moving, destination, reset, cinematic, onCinematicEnd]);
  useEffect(() => {
    onStatusChange(status);
  }, [status, onStatusChange]);

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
      renderer.toneMappingExposure = 1.22;
      container.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 130);
      camera.position.set(...CRUISE_CAMERA);
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
      scene.add(new THREE.HemisphereLight(0xe3f1ff, 0x7b8895, 2.1));
      const sun = new THREE.DirectionalLight(0xfff3d7, 3.5);
      sun.position.set(7, 9, 4);
      scene.add(sun);
      const rim = new THREE.DirectionalLight(0xa6ceff, 2.1);
      rim.position.set(-8, 2, -4);
      scene.add(rim);
      const plane = new THREE.Group();
      scene.add(plane);
      let loaded: Group | undefined;
      const propellers: Object3D[] = [];
      const cloudTexture = new THREE.TextureLoader().load(
        '/images/cloud-sprite.png',
      );
      cloudTexture.colorSpace = THREE.SRGBColorSpace;
      const clouds = [
        { position: [-11, -5, -17], size: 25, opacity: 0.45 },
        { position: [12, -4, -23], size: 29, opacity: 0.53 },
        { position: [7, -5, -8], size: 16, opacity: 0.38 },
        { position: [-13, -5.8, 4], size: 16, opacity: 0.33 },
        { position: [14, -5.5, 5], size: 19, opacity: 0.3 },
      ].map((cloud, index) => {
        const material = new THREE.SpriteMaterial({
          map: cloudTexture,
          transparent: true,
          opacity: cloud.opacity,
          depthWrite: false,
          toneMapped: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(
          cloud.position[0],
          cloud.position[1],
          cloud.position[2],
        );
        sprite.scale.set(cloud.size, (cloud.size * 2) / 3, 1);
        scene.add(sprite);
        return {
          sprite,
          material,
          origin: sprite.position.clone(),
          phase: index * 1.9,
        };
      });
      let visible = true,
        manual = false,
        lastTime = 0,
        elapsed = 0,
        intro = 0;
      let lastView = state.current.view,
        lastReset = state.current.reset,
        lastDestination = state.current.destination;
      let filmRunning = false,
        filmTime = 0,
        filmBlend = 0,
        cinematicRequested = false;
      let cameraTransition = 1,
        heading = 2.12,
        bank = -0.055;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
      const finePointer = window.matchMedia('(pointer: fine)');
      const targetCamera = new THREE.Vector3(...CRUISE_CAMERA);
      const cameraFrom = new THREE.Spherical().setFromVector3(camera.position);
      const cameraTo = new THREE.Spherical().copy(cameraFrom);
      const pointerTarget = new THREE.Vector2(),
        pointer = new THREE.Vector2();
      const lookTarget = new THREE.Vector3();
      const zeroPointer = new THREE.Vector2(),
        origin = new THREE.Vector3(),
        unitScale = new THREE.Vector3(1, 1, 1),
        bobPosition = new THREE.Vector3();
      const flightStartCamera = new THREE.Vector3();
      const frameCamera = new THREE.Vector3();
      const changeCamera = () => {
        cameraFrom.setFromVector3(camera.position.clone().sub(controls.target));
        cameraTo.setFromVector3(targetCamera);
        const difference = cameraTo.theta - cameraFrom.theta;
        cameraTo.theta =
          cameraFrom.theta +
          Math.atan2(Math.sin(difference), Math.cos(difference));
        cameraTransition = 0;
      };
      const setPreset = (preset: AircraftView) => {
        if (preset === 'overhead') targetCamera.set(0, 18, 0.4);
        else if (preset === 'nose') targetCamera.set(-13, 2, 11);
        else targetCamera.set(...CRUISE_CAMERA);
        changeCamera();
      };
      const endFlight = () => {
        filmRunning = false;
        filmTime = 0;
        intro = 3.4;
        heading = 2.12;
        state.current.onCinematicEnd();
        setPreset(state.current.view);
      };
      const resize = () => {
        const width = container.clientWidth,
          height = container.clientHeight;
        if (!width || !height) return;
        camera.aspect = width / height;
        camera.zoom = Math.min(1, camera.aspect / 1.28);
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      };
      const onStart = () => {
        if (filmRunning) endFlight();
        manual = true;
        intro = 3.4;
      };
      const onPointer = (event: PointerEvent) => {
        if (event.pointerType !== 'mouse' || !finePointer.matches) return;
        const rect = container.getBoundingClientRect();
        pointerTarget.set(
          Math.max(
            -1,
            Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1),
          ),
          Math.max(
            -1,
            Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1),
          ),
        );
      };
      const resetPointer = () => pointerTarget.set(0, 0);
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && filmRunning) {
          event.preventDefault();
          endFlight();
          return;
        }
        if (
          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
            event.key,
          )
        )
          return;
        event.preventDefault();
        if (filmRunning) endFlight();
        intro = 3.4;
        if (event.key === 'ArrowLeft') heading -= 0.2;
        if (event.key === 'ArrowRight') heading += 0.2;
        if (event.key === 'ArrowUp')
          targetCamera.y = Math.min(17, targetCamera.y + 1);
        if (event.key === 'ArrowDown')
          targetCamera.y = Math.max(-3, targetCamera.y - 1);
        changeCamera();
        manual = false;
      };
      const onLost = (event: Event) => {
        event.preventDefault();
        renderer.setAnimationLoop(null);
        setStatus('unavailable');
        state.current.onCinematicEnd();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      resize();
      const intersection = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
      });
      intersection.observe(container);
      const spherical = new THREE.Spherical();
      const frame = (time: number) => {
        const delta = Math.min(Math.max((time - lastTime) / 1000, 0), 0.04);
        lastTime = time;
        if (!visible || document.hidden) return;
        const current = state.current;
        const animate = current.moving && !reduced.matches;
        if (!animate) {
          intro = 3.4;
          if (filmRunning) endFlight();
        }
        if (current.view !== lastView || current.reset !== lastReset) {
          lastView = current.view;
          lastReset = current.reset;
          intro = 3.4;
          manual = false;
          heading = 2.12;
          if (filmRunning) endFlight();
          setPreset(current.view);
        }
        if (current.cinematic && !cinematicRequested && animate && loaded) {
          filmRunning = true;
          filmTime = 0;
          filmBlend = 0;
          intro = 3.4;
          manual = false;
          flightStartCamera.copy(camera.position);
        } else if (!current.cinematic && filmRunning) {
          endFlight();
        }
        cinematicRequested = current.cinematic;
        if (current.destination !== lastDestination) {
          heading = 2.12 + current.destination * 0.14;
          lastDestination = current.destination;
          bank = -0.19;
        }
        if (animate) elapsed += delta;
        pointer.lerp(
          animate ? pointerTarget : zeroPointer,
          1 - Math.exp(-delta * 3.8),
        );
        const response = 1 - Math.exp(-delta * 5.5);
        bank = THREE.MathUtils.lerp(bank, -0.055, response * 0.4);
        if (filmRunning) {
          filmTime += delta;
          filmBlend = Math.min(1, filmBlend + delta / 1.1);
          const pose = sampleFlight(filmTime / FLIGHT_DURATION);
          frameCamera
            .set(...pose.camera)
            .lerp(flightStartCamera, 1 - smoothFlightEase(filmBlend));
          camera.position.copy(frameCamera);
          lookTarget.set(...pose.position);
          controls.target.lerp(lookTarget, 0.08);
          plane.position.set(...pose.position);
          plane.rotation.set(
            Math.sin(elapsed * 0.7) * 0.025,
            pose.heading,
            pose.bank,
          );
          plane.scale.setScalar(pose.scale);
          if (filmTime >= FLIGHT_DURATION) endFlight();
        } else if (loaded && intro < 3.4 && animate) {
          intro = Math.min(3.4, intro + delta);
          const t = smoothFlightEase(intro / 3.4);
          camera.position.set(
            6 * (1 - t),
            4.5 + 3 * (1 - t),
            16.8 + 6 * (1 - t),
          );
          plane.position.set(3.5 * (1 - t), -0.8 * (1 - t), -4 * (1 - t));
          plane.rotation.set(
            0,
            2.12 + 0.7 * (1 - t),
            -0.055 - 0.34 * Math.sin(((1 - t) * Math.PI) / 2),
          );
          plane.scale.setScalar(0.64 + 0.36 * t);
          controls.target.set(0, 0, 0);
        } else {
          cameraTransition = Math.min(1, cameraTransition + delta / 1.45);
          const t = reduced.matches ? 1 : smoothFlightEase(cameraTransition);
          if (!manual) {
            spherical.set(
              THREE.MathUtils.lerp(cameraFrom.radius, cameraTo.radius, t),
              THREE.MathUtils.lerp(cameraFrom.phi, cameraTo.phi, t),
              THREE.MathUtils.lerp(cameraFrom.theta, cameraTo.theta, t),
            );
            camera.position.setFromSpherical(spherical);
            if (animate && current.view === 'cruise') {
              camera.position.x += pointer.x * 0.8;
              camera.position.y += pointer.y * 0.32;
            }
          }
          controls.target.lerp(origin, response);
          plane.rotation.y = THREE.MathUtils.lerp(
            plane.rotation.y,
            heading,
            response * 0.55,
          );
          plane.rotation.x = THREE.MathUtils.lerp(
            plane.rotation.x,
            animate ? pointer.y * 0.018 : 0,
            response,
          );
          plane.rotation.z = THREE.MathUtils.lerp(
            plane.rotation.z,
            bank +
              (animate
                ? Math.sin(elapsed * 0.48) * 0.045 - pointer.x * 0.045
                : 0),
            response,
          );
          bobPosition.set(0, animate ? Math.sin(elapsed * 0.72) * 0.14 : 0, 0);
          plane.position.lerp(bobPosition, response);
          plane.scale.lerp(unitScale, response);
        }
        clouds.forEach((cloud) => {
          cloud.sprite.position.x =
            cloud.origin.x + Math.sin(elapsed * 0.07 + cloud.phase) * 1.4;
          cloud.sprite.position.y =
            cloud.origin.y + Math.sin(elapsed * 0.11 + cloud.phase) * 0.18;
        });
        if (animate)
          propellers.forEach((propeller) => {
            propeller.rotation.x += delta * 34;
          });
        controls.update();
        renderer.render(scene, camera);
      };
      plane.rotation.y = heading;
      controls.addEventListener('start', onStart);
      container.addEventListener('keydown', onKey);
      container.addEventListener('pointermove', onPointer);
      container.addEventListener('pointerleave', resetPointer);
      renderer.domElement.addEventListener('webglcontextlost', onLost);
      renderer.setAnimationLoop(frame);
      const disposeModel = (root: Group) => {
        const textures = new Set<Texture>(),
          materials = new Set<Material>();
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
        container.removeEventListener('pointermove', onPointer);
        container.removeEventListener('pointerleave', resetPointer);
        renderer.domElement.removeEventListener('webglcontextlost', onLost);
        if (loaded) disposeModel(loaded);
        clouds.forEach((cloud) => cloud.material.dispose());
        cloudTexture.dispose();
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
          const box = new THREE.Box3().setFromObject(loaded),
            center = box.getCenter(new THREE.Vector3()),
            size = box.getSize(new THREE.Vector3());
          loaded.position.sub(center);
          loaded.traverse((object) => {
            if (object.name === 'Prop' || object.name === 'Prop__2_')
              propellers.push(object);
          });
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
      cleanUp?.();
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
        aria-label="Interactive aircraft. Drag or use arrow keys to orbit. Escape ends a scenic flight."
      />
      {status === 'loading' && (
        <div className="scene-notice mono" role="status">
          <LoaderCircle size={15} className="loading-icon" />
          Preparing the aircraft
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

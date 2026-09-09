'use client';

import { useEffect, useRef } from 'react';
import type { Group, Mesh, Material, Texture, Object3D } from 'three';
import {
  DEPARTURE_SECONDS,
  sampleDeparture,
  type DeparturePhase,
} from '@/lib/departure-motion';

type Props = {
  started: boolean;
  onReady: (status: 'ready' | 'unavailable') => void;
  onPhase: (phase: DeparturePhase) => void;
  onComplete: () => void;
};

export default function DepartureScene(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef(props);
  useEffect(() => {
    state.current = props;
  }, [props]);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    async function setup() {
      const [T, { GLTFLoader }, { RoomEnvironment }] = await Promise.all([
        import('three'),
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/environments/RoomEnvironment.js'),
      ]);
      if (disposed || !container) return;
      let renderer: InstanceType<typeof T.WebGLRenderer>;
      try {
        renderer = new T.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
        });
      } catch {
        state.current.onReady('unavailable');
        return;
      }
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      container.appendChild(renderer.domElement);
      const scene = new T.Scene();
      const night = new T.Color(0x142432),
        day = new T.Color(0xbed4e5);
      scene.fog = new T.FogExp2(night, 0.007);
      const camera = new T.PerspectiveCamera(38, 1, 0.15, 1400);
      const pmrem = new T.PMREMGenerator(renderer),
        room = new RoomEnvironment();
      const environment = pmrem.fromScene(room, 0.04);
      scene.environment = environment.texture;
      scene.environmentIntensity = 0.7;
      room.dispose();
      pmrem.dispose();
      const ambient = new T.HemisphereLight(0x9dc9ee, 0x172738, 1.3);
      scene.add(ambient);
      const sun = new T.DirectionalLight(0xffd4a0, 3.4);
      sun.position.set(-18, 28, 20);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.left = -17;
      sun.shadow.camera.right = 17;
      sun.shadow.camera.top = 17;
      sun.shadow.camera.bottom = -17;
      sun.shadow.camera.near = 0.5;
      sun.shadow.camera.far = 80;
      sun.shadow.normalBias = 0.05;
      scene.add(sun, sun.target);
      const rim = new T.DirectionalLight(0x73beff, 3.5);
      rim.position.set(14, 5, -20);
      scene.add(rim);
      const plane = new T.Group();
      scene.add(plane);
      let model: Group | undefined;
      const propellers: Object3D[] = [];

      const asphalt = new T.MeshStandardMaterial({
        color: 0x172029,
        roughness: 0.62,
        metalness: 0.28,
      });
      const grass = new T.MeshStandardMaterial({
        color: 0x0e1920,
        roughness: 1,
      });
      const ground = new T.Mesh(new T.PlaneGeometry(1400, 1400), grass);
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(0, -1.83, -380);
      ground.receiveShadow = true;
      scene.add(ground);
      const runway = new T.Mesh(new T.PlaneGeometry(23, 950), asphalt);
      runway.rotation.x = -Math.PI / 2;
      runway.position.set(0, -1.8, -360);
      runway.receiveShadow = true;
      scene.add(runway);
      const paint = new T.MeshStandardMaterial({
        color: 0xabb5b9,
        roughness: 0.9,
      });
      const stripeGeometry = new T.PlaneGeometry(0.23, 8);
      const stripes = new T.InstancedMesh(stripeGeometry, paint, 56);
      const dummy = new T.Object3D();
      dummy.rotation.x = -Math.PI / 2;
      for (let i = 0; i < 56; i++) {
        dummy.position.set(0, -1.775, 80 - i * 16);
        dummy.updateMatrix();
        stripes.setMatrixAt(i, dummy.matrix);
      }
      scene.add(stripes);
      for (const x of [-10.5, 10.5]) {
        const line = new T.Mesh(new T.PlaneGeometry(0.12, 920), paint);
        line.rotation.x = -Math.PI / 2;
        line.position.set(x, -1.77, -360);
        scene.add(line);
      }
      const thresholdGeometry = new T.PlaneGeometry(0.7, 7);
      for (let i = 0; i < 12; i++) {
        const mark = new T.Mesh(thresholdGeometry, paint);
        mark.rotation.x = -Math.PI / 2;
        mark.position.set((i - 5.5) * 1.25, -1.76, 28);
        scene.add(mark);
      }
      // Shared radial light texture gives each runway lamp a restrained halo.
      const glowCanvas = document.createElement('canvas');
      glowCanvas.width = glowCanvas.height = 64;
      const ctx = glowCanvas.getContext('2d');
      if (ctx) {
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.08, 'rgba(255,255,255,.85)');
        gradient.addColorStop(0.3, 'rgba(255,255,255,.14)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
      }
      const glow = new T.CanvasTexture(glowCanvas);
      const lampMaterial = new T.SpriteMaterial({
        map: glow,
        color: 0xffd3a1,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        toneMapped: false,
      });
      const blueMaterial = lampMaterial.clone();
      blueMaterial.color.set(0x55aaff);
      const greenMaterial = lampMaterial.clone();
      greenMaterial.color.set(0x6effcd);
      for (let i = 0; i < 72; i++) {
        for (const side of [-1, 1]) {
          const lamp = new T.Sprite(i < 5 ? greenMaterial : lampMaterial);
          lamp.position.set(side * 11.5, -1.55, 70 - i * 12);
          lamp.scale.set(1.4, 1.4, 1);
          scene.add(lamp);
          if (i % 2 === 0) {
            const taxi = new T.Sprite(blueMaterial);
            taxi.position.set(side * 20, -1.55, 70 - i * 12);
            taxi.scale.set(1.05, 1.05, 1);
            scene.add(taxi);
          }
        }
      }
      // Sparse airfield structures provide scale and a distant horizon.
      const buildingMaterial = new T.MeshStandardMaterial({
        color: 0x263643,
        metalness: 0.35,
        roughness: 0.65,
      });
      for (let i = 0; i < 7; i++) {
        const hangar = new T.Mesh(
          new T.BoxGeometry(20 + (i % 3) * 5, 7 + (i % 2) * 3, 28),
          buildingMaterial,
        );
        hangar.position.set(65 + (i % 2) * 27, 1.7, 10 - i * 65);
        scene.add(hangar);
        const strip = new T.Mesh(
          new T.PlaneGeometry(18, 0.1),
          new T.MeshBasicMaterial({
            color: 0xe6caa7,
            transparent: true,
            opacity: 0.7,
          }),
        );
        strip.position.set(hangar.position.x, 5.4, hangar.position.z + 14.02);
        scene.add(strip);
      }
      const cloudTexture = new T.TextureLoader().load(
        '/images/cloud-sprite.png',
      );
      cloudTexture.colorSpace = T.SRGBColorSpace;
      const clouds = [
        [-38, 27, -105, 55],
        [33, 45, -148, 65],
        [-25, 55, -203, 66],
        [46, 63, -235, 70],
        [-56, 68, -278, 70],
        [0, 40, -330, 120],
      ].map(([x, y, z, size]) => {
        const material = new T.SpriteMaterial({
          map: cloudTexture,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          color: 0xe3ecf5,
          toneMapped: false,
        });
        const sprite = new T.Sprite(material);
        sprite.position.set(x, y, z);
        sprite.scale.set(size, (size * 2) / 3, 1);
        scene.add(sprite);
        return material;
      });
      const pointer = new T.Vector2(),
        targetPointer = new T.Vector2();
      const onPointer = (event: PointerEvent) => {
        if (event.pointerType !== 'mouse') return;
        const rect = container.getBoundingClientRect();
        targetPointer.set(
          (event.clientX - rect.left) / rect.width - 0.5,
          (event.clientY - rect.top) / rect.height - 0.5,
        );
      };
      const clearPointer = () => targetPointer.set(0, 0);
      const resize = () => {
        const width = container.clientWidth,
          height = container.clientHeight;
        if (!width || !height) return;
        camera.aspect = width / height;
        camera.zoom = Math.min(1, camera.aspect / 1.22);
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      resize();
      let last = 0,
        elapsed = 0,
        idleTime = 0,
        done = false;
      let lightTime = 0;
      let lastPhase: DeparturePhase = 'preflight';
      let previousRender = 0;
      const target = new T.Vector3();
      const fog = scene.fog as InstanceType<typeof T.FogExp2>;
      const frame = (time: number) => {
        const delta = Math.min(Math.max((time - last) / 1000, 0), 0.05);
        last = time;
        if (document.hidden) return;
        const running = state.current.started && !!model;
        if (!running && time - previousRender < 32) return;
        previousRender = time;
        if (running && !done) elapsed += delta;
        else idleTime += delta;
        const p = Math.min(elapsed / DEPARTURE_SECONDS, 1);
        const pose = sampleDeparture(p);
        if (model) lightTime = Math.min(1.4, lightTime + delta);
        const power = T.MathUtils.smoothstep(lightTime, 0, 1.4);
        lampMaterial.opacity = power;
        blueMaterial.opacity = power;
        greenMaterial.opacity = power;
        sun.intensity = 1 + power * 2.4;
        pointer.lerp(targetPointer, 1 - Math.exp(-delta * 3));
        camera.position.set(...pose.camera);
        target.set(...pose.target);
        const entranceBlend = 1 - T.MathUtils.smoothstep(elapsed, 0, 1.3);
        if (entranceBlend > 0) {
          camera.position.x +=
            (pointer.x * 1.8 + Math.sin(idleTime * 0.14) * 0.45) *
            entranceBlend;
          camera.position.y += pointer.y * 0.5 * entranceBlend;
          // The portrait layout reserves the upper half for the introduction.
          if (camera.aspect < 0.9) {
            target.y += 4.2 * entranceBlend;
            target.x *= 1 - entranceBlend;
          }
        }
        camera.lookAt(target);
        plane.position.set(0, pose.altitude + 0.025, -pose.distance);
        plane.rotation.set(pose.pitch, pose.heading, pose.bank);
        propellers.forEach((prop) => {
          prop.rotation.x += delta * (running ? 30 + p * 45 : 7);
        });
        sun.position.set(-18, 28 + pose.altitude, 20 - pose.distance);
        sun.target.position.copy(plane.position);
        ambient.intensity = 1.3 + pose.climb * 1.2;
        scene.environmentIntensity = 0.7 + pose.climb * 0.35;
        fog.color.copy(night).lerp(day, pose.climb);
        fog.density = 0.007 - pose.climb * 0.004;
        clouds.forEach((material) => {
          material.opacity = Math.min(0.85, pose.climb * 1.3);
        });
        container.style.setProperty('--daybreak', String(pose.climb));
        if (running && pose.phase !== lastPhase) {
          lastPhase = pose.phase;
          state.current.onPhase(pose.phase);
        }
        renderer.render(scene, camera);
        if (p >= 1 && !done) {
          done = true;
          state.current.onComplete();
        }
      };
      const disposeObjects = (root: Object3D) => {
        const textures = new Set<Texture>(),
          materials = new Set<Material>();
        root.traverse((object) => {
          const mesh = object as Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          if (!mesh.material) return;
          for (const material of Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]) {
            materials.add(material);
            Object.values(material).forEach((value) => {
              if (value?.isTexture) textures.add(value);
            });
          }
        });
        materials.forEach((material) => material.dispose());
        textures.forEach((texture) => texture.dispose());
      };
      const lost = (event: Event) => {
        event.preventDefault();
        renderer.setAnimationLoop(null);
        state.current.onReady('unavailable');
        if (state.current.started) state.current.onComplete();
      };
      container.addEventListener('pointermove', onPointer, { passive: true });
      container.addEventListener('pointerleave', clearPointer);
      renderer.domElement.addEventListener('webglcontextlost', lost);
      cleanup = () => {
        observer.disconnect();
        renderer.setAnimationLoop(null);
        container.removeEventListener('pointermove', onPointer);
        container.removeEventListener('pointerleave', clearPointer);
        renderer.domElement.removeEventListener('webglcontextlost', lost);
        disposeObjects(scene);
        environment.dispose();
        sun.shadow.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
      renderer.setAnimationLoop(frame);
      new GLTFLoader().load(
        '/models/cesium-air.glb',
        (gltf) => {
          if (disposed) {
            disposeObjects(gltf.scene);
            return;
          }
          model = gltf.scene;
          const box = new T.Box3().setFromObject(model),
            size = box.getSize(new T.Vector3());
          model.position.sub(box.getCenter(new T.Vector3()));
          model.traverse((object) => {
            if ((object as Mesh).isMesh) {
              object.castShadow = true;
              object.receiveShadow = true;
            }
            if (object.name === 'Prop' || object.name === 'Prop__2_')
              propellers.push(object);
          });
          const wrapper = new T.Group();
          wrapper.scale.setScalar(12 / Math.max(size.x, size.y, size.z));
          wrapper.add(model);
          plane.add(wrapper);
          state.current.onReady('ready');
        },
        undefined,
        () => {
          if (!disposed) state.current.onReady('unavailable');
        },
      );
    }
    setup().catch(() => {
      cleanup?.();
      if (!disposed) state.current.onReady('unavailable');
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
  return (
    <div className="departure-scene" ref={host} aria-hidden="true">
      <div className="departure-daybreak" />
    </div>
  );
}

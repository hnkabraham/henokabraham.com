import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Camera position (x, y in scene metres, height above ground) and look-at
 * point (x, y, height above the road). */
export type DoloresPose = [number, number, number, number, number, number];

export const DEFAULT_POSE: DoloresPose;

export interface DoloresViewerOptions {
  phone?: boolean;
  sun?: 'winter' | 'summer' | 'evening';
  /** Fetches a public-root path such as '/models/dolores-park.glb'. */
  load?: (path: string) => Promise<ArrayBuffer>;
  dracoPath?: string;
  pixelRatio?: number;
  /** Horizontal field of view, degrees. */
  fov?: number;
  pose?: number[];
  /** Fixed drawing-buffer size; otherwise the container's size. */
  size?: [number, number];
  preserveDrawingBuffer?: boolean;
  /** No zoom, and `touch-action: pan-y`, for a canvas inside a scrolling page. */
  scrollFriendly?: boolean;
  signal?: AbortSignal;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export interface DoloresViewer {
  info: Record<string, unknown>;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  renderer: WebGLRenderer;
  render(): void;
  invalidate(): void;
  benchmark(): Promise<Record<string, unknown>>;
  dispose(): void;
  groundAt(x: number, y: number): number;
  constrainCamera(): void;
  snapshot(): string;
  readonly renderedFrames: number;
}

export function createDoloresViewer(
  container: HTMLElement,
  options?: DoloresViewerOptions,
): Promise<DoloresViewer>;

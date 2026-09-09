declare module 'n8ao' {
  import { Pass } from 'postprocessing';
  import type { Camera, Color, Scene, WebGLRenderTarget } from 'three';

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      color: Color;
      gammaCorrection: boolean;
      halfRes: boolean;
      depthAwareUpsampling: boolean;
      accumulate: boolean;
      transparencyAware: boolean;
    };
    outputTargetInternal: WebGLRenderTarget;
    setQualityMode(
      mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra',
    ): void;
  }
}

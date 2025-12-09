// Preprocessing interfaces and contracts

import { PerspectiveCamera } from '../camera';
import { PointCloud } from '../point_cloud';
import { SortedSplats } from '../sort';

/**
 * Arguments passed to preprocessing operations
 */
export interface PreprocessArgs {
  /** Camera parameters for projection */
  camera: PerspectiveCamera;
  /** Viewport dimensions [width, height] */
  viewport: [number, number];
  /** Point cloud data */
  pointCloud: PointCloud;
  /** Sort resources for output */
  sortStuff: SortedSplats;
  /** Render settings */
  settings: {
    gaussianScaling: number;
    maxSHDegree: number;
    showEnvMap: boolean;
    mipSplatting: boolean;
    kernelSize: number;
    walltime: number;
    sceneExtend: number;
    center: Float32Array;
    clippingBoxMin: Float32Array;
    clippingBoxMax: Float32Array;
  };
  /** Optional count buffer from ONNX for dynamic point count */
  countBuffer?: GPUBuffer;
}

/**
 * Generic interface for preprocessing 3D data to 2D screen space
 */
export interface IPreprocessor {
  /**
   * Initialize the preprocessor with GPU resources
   */
  initialize(device: GPUDevice, shDegree: number): Promise<void>;
  
  /**
   * Get the bind group layout for preprocessing
   */
  getBindGroupLayout(device: GPUDevice): GPUBindGroupLayout;
}

/**
 * Results from preprocessing operations
 */
export interface PreprocessResults {
  /** Number of visible splats after culling */
  visibleCount: number;
  /** Indirect dispatch parameters */
  dispatchX: number;
  dispatchY: number;
  dispatchZ: number;
}

// Export concrete implementations
export { GaussianPreprocessor } from './gaussian_preprocessor';
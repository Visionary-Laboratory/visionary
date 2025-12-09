// Renderer interfaces and contracts

import { PerspectiveCamera } from '../camera';
import { PointCloud } from '../point_cloud';

/**
 * Arguments for rendering operations
 */
export interface RenderArgs {
  /** Camera for view/projection transforms */
  camera: PerspectiveCamera;
  /** Viewport dimensions [width, height] */
  viewport: [number, number];
  /** Optional clipping box for culling */
  clippingBox?: { min: [number,number,number], max: [number,number,number] };
  /** Maximum spherical harmonics degree */
  maxSHDegree?: number;
  /** Show environment map */
  showEnvMap?: boolean;
  /** Enable mip-splatting */
  mipSplatting?: boolean;
  /** Kernel size for splatting */
  kernelSize?: number;
  /** Animation time */
  walltime?: number;
  /** Scene extent for LOD */
  sceneExtend?: number;
  /** Scene center for culling */
  sceneCenter?: [number,number,number];
}

/**
 * Generic interface for Gaussian splatting renderers
 */
export interface IRenderer {
  /**
   * Initialize GPU resources asynchronously
   */
  initialize(): Promise<void>;
  
  /**
   * Prepare rendering resources for multiple point clouds in a frame
   * This handles preprocessing, sorting, and resource setup using global sorting
   */
  prepareMulti(encoder: GPUCommandEncoder, queue: GPUQueue, pointClouds: PointCloud[], args: RenderArgs): void;
  
  /**
   * Record rendering commands to a render pass
   */
  render(pass: GPURenderPassEncoder, pointCloud: PointCloud): void;
  
  /**
   * Record rendering commands for multiple point clouds to a render pass
   */
  renderMulti(pass: GPURenderPassEncoder, pointClouds: PointCloud[]): void;
  
  /**
   * Get pipeline information for external integrations
   */
  getPipelineInfo(): {
    format: GPUTextureFormat;
    bindGroupLayouts: GPUBindGroupLayout[];
  };
}

/**
 * Render statistics for profiling and debugging
 */
export interface RenderStats {
  /** Number of Gaussians rendered */
  gaussianCount: number;
  /** Number of visible splats after culling */
  visibleSplats: number;
  /** GPU memory usage in bytes */
  memoryUsage: number;
}

/**
 * Configuration options for renderer creation
 */
export interface RendererConfig {
  /** WebGPU device */
  device: GPUDevice;
  /** Target texture format */
  format: GPUTextureFormat;
  /** Maximum spherical harmonics degree */
  shDegree: number;
  /** Use compressed data formats */
  compressed?: boolean;
  /** Enable debug features */
  debug?: boolean;
}

// Export concrete implementations
export { GaussianRenderer, DEFAULT_KERNEL_SIZE } from './gaussian_renderer';
// Re-export for compatibility with old imports
export type { RenderArgs as SplattingArgs } from './index';
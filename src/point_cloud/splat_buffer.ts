// SplatBuffer interface and data structure definitions

import { Aabb } from '../utils';

export type f16u = number; // placeholder alias if you choose to keep f32 on CPU

export interface SplatBuffer {
  gaussianBuffer: GPUBuffer;
  shBuffer: GPUBuffer;
  numPoints: number;
  shDegree: number;
  bbox: Aabb;
}

export interface GenericGaussianPointCloud {
  gaussianBuffer(): ArrayBuffer;
  shCoefsBuffer(): ArrayBuffer;
  numPoints(): number;
  shDegree(): number;
  bbox(): Aabb; // in world units
  center?: [number, number, number];
  up?: [number, number, number] | null;
  kernelSize?: number;
  mipSplatting?: boolean;
  backgroundColor?: [number, number, number];
}

export class GaussianCompressed {
  // Layout mirrors Rust `GaussianCompressed`; actual fields depend on your shader path.
  // Keeping a raw view here to avoid layout mismatches until WGSL is finalized.
  bytes: Uint8Array;
  constructor(bytes: ArrayBuffer) { this.bytes = new Uint8Array(bytes); }
}

export class Gaussian {
  // xyz: Point3<f16>, opacity: f16, cov[6]: f16
  // For CPU-side clarity we expose f32s; pack into f16 on upload if you prefer.
  xyz: [number, number, number];
  opacity: number;
  cov: [number, number, number, number, number, number];
  constructor(xyz: [number, number, number], opacity: number, cov: [number, number, number, number, number, number]) {
    this.xyz = xyz; this.opacity = opacity; this.cov = cov;
  }
}
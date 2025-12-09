import { f32_to_f16 } from '../utils/half';
import { buildCov } from '../utils';
import { planeFromPoints } from '../utils/vector-math';
import { quat } from 'gl-matrix';
import { ILoader, LoadingOptions } from './index';
import { PLYGaussianData } from './GaussianData';

export class SplatLoader implements ILoader<PLYGaussianData> {
  
  async loadFile(file: File, options?: LoadingOptions): Promise<PLYGaussianData> {
    return this.loadBuffer(await file.arrayBuffer(), options);
  }
  
  async loadUrl(url: string, options?: LoadingOptions): Promise<PLYGaussianData> {
    const response = await fetch(url, { signal: options?.signal });
    if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
    return this.loadBuffer(await response.arrayBuffer(), options);
  }
  
  async loadBuffer(buffer: ArrayBuffer, options?: LoadingOptions): Promise<PLYGaussianData> {
    const progress = (stage: string, p: number, msg?: string) => {
      options?.onProgress?.({ stage, progress: p, message: msg });
    };
    
    progress('Parsing SPLAT', 0.1);
    
    const SPLAT_SIZE = 32;
    const view = new DataView(buffer);
    const numPoints = Math.floor(buffer.byteLength / SPLAT_SIZE);
    
    if (buffer.byteLength % SPLAT_SIZE !== 0) {
      console.warn('SPLAT file size not aligned to 32 bytes, truncating');
    }
    
    progress('Loading SPLAT data', 0.3);
    
    const GAUSS_STRIDE = 10;
    const gaussHalf = new Uint16Array(numPoints * GAUSS_STRIDE);
    const WORDS_PER_POINT = 24;
    const shPacked = new Uint32Array(numPoints * WORDS_PER_POINT);
    const SH_C0 = 0.28209479177387814;
    
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const positions: [number, number, number][] = [];
    
    for (let i = 0; i < numPoints; i++) {
      if (i % 5000 === 0) {
        progress('Processing SPLAT points', 0.3 + 0.5 * (i / numPoints));
      }
      
      let offset = i * SPLAT_SIZE;
      
      const x = view.getFloat32(offset, true); offset += 4;
      const y = view.getFloat32(offset, true); offset += 4;
      const z = view.getFloat32(offset, true); offset += 4;
      positions.push([x, y, z]);
      
      const sx = view.getFloat32(offset, true); offset += 4;
      const sy = view.getFloat32(offset, true); offset += 4;
      const sz = view.getFloat32(offset, true); offset += 4;
      
      const r = view.getUint8(offset++) / 255.0;
      const g = view.getUint8(offset++) / 255.0;
      const b = view.getUint8(offset++) / 255.0;
      const opacity = view.getUint8(offset++) / 255.0;
      
      const qx = (view.getUint8(offset++) / 255.0) * 2 - 1;
      const qy = (view.getUint8(offset++) / 255.0) * 2 - 1;
      const qz = (view.getUint8(offset++) / 255.0) * 2 - 1;
      const qw = (view.getUint8(offset++) / 255.0) * 2 - 1;
      
      const q = quat.fromValues(qx, qy, qz, qw);
      quat.normalize(q, q);
      
      const s = new Float32Array([sx, sy, sz]);
      const [m00, m01, m02, m11, m12, m22] = buildCov(q as any, s as any);
      
      const base = i * GAUSS_STRIDE;
      gaussHalf[base + 0] = f32_to_f16(x);
      gaussHalf[base + 1] = f32_to_f16(y);
      gaussHalf[base + 2] = f32_to_f16(z);
      gaussHalf[base + 3] = f32_to_f16(opacity);
      gaussHalf[base + 4] = f32_to_f16(m00);
      gaussHalf[base + 5] = f32_to_f16(m01);
      gaussHalf[base + 6] = f32_to_f16(m02);
      gaussHalf[base + 7] = f32_to_f16(m11);
      gaussHalf[base + 8] = f32_to_f16(m12);
      gaussHalf[base + 9] = f32_to_f16(m22);
      
      const shBase = i * WORDS_PER_POINT;
      const dc_r = (r - 0.5) / SH_C0;
      const dc_g = (g - 0.5) / SH_C0;
      const dc_b = (b - 0.5) / SH_C0;

      const sh0_r = f32_to_f16(dc_r);
      const sh0_g = f32_to_f16(dc_g);
      const sh0_b = f32_to_f16(dc_b);
      shPacked[shBase + 0] = sh0_r | (sh0_g << 16);
      shPacked[shBase + 1] = sh0_b;
      
      min[0] = Math.min(min[0], x);
      min[1] = Math.min(min[1], y);
      min[2] = Math.min(min[2], z);
      max[0] = Math.max(max[0], x);
      max[1] = Math.max(max[1], y);
      max[2] = Math.max(max[2], z);
    }
    
    progress('Computing geometry', 0.9);
    const { centroid, normal } = planeFromPoints(positions);
    
    return new PLYGaussianData({
      gaussianBuffer: gaussHalf.buffer,
      shCoefsBuffer: shPacked.buffer,
      numPoints,
      shDegree: 0, 
      bbox: { min, max },
      center: [centroid[0], centroid[1], centroid[2]],
      up: normal ? [normal[0], normal[1], normal[2]] : [1, 0, 0],
    });
  }
  
  canHandle(filename: string): boolean {
    return filename.toLowerCase().endsWith('.splat');
  }
  
  getSupportedExtensions(): string[] {
    return ['.splat'];
  }
}
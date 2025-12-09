import { f32_to_f16 } from '../utils/half';
import { buildCov } from '../utils';
import { vec3, quat } from 'gl-matrix';
import { ILoader, LoadingOptions } from './index';
import { PLYGaussianData } from './GaussianData';

export class CompressedPLYLoader implements ILoader<PLYGaussianData> {
  private static readonly CHUNK_SIZE = 256;

  async loadFile(file: File, options?: LoadingOptions): Promise<PLYGaussianData> {
    const buffer = await file.arrayBuffer();
    return this.loadBuffer(buffer, options);
  }

  async loadUrl(url: string, options?: LoadingOptions): Promise<PLYGaussianData> {
    const resp = await fetch(url, { signal: options?.signal });
    if (!resp.ok) throw new Error(`Failed to fetch compressed PLY: ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    return this.loadBuffer(buffer, options);
  }

  canHandle(filename: string): boolean {
    return filename.toLowerCase().endsWith('.compressed.ply');
  }

  getSupportedExtensions(): string[] {
    return ['.compressed.ply'];
  }
  
  async loadBuffer(buffer: ArrayBuffer, options?: LoadingOptions): Promise<PLYGaussianData> {
    const text = new TextDecoder().decode(buffer.slice(0, Math.min(1 << 20, buffer.byteLength)));
    const headerEnd = text.indexOf('end_header') + 'end_header'.length + 1;
    const headerLines = text.slice(0, headerEnd).split(/\r?\n/);

    let format: 'binary_little_endian' | 'binary_big_endian' = 'binary_little_endian';
    let vertexCount = 0, chunkCount = 0;
    let shPropertyCount = 0;
    let inShElement = false;

    for (const line of headerLines) {
      if (line.startsWith('format ')) {
        if (line.includes('binary_little_endian')) format = 'binary_little_endian';
        else if (line.includes('binary_big_endian')) format = 'binary_big_endian';
      }
      if (line.startsWith('element vertex')) vertexCount = parseInt(line.split(/\s+/)[2]);
      if (line.startsWith('element chunk')) chunkCount = parseInt(line.split(/\s+/)[2]);
      
      if (line.startsWith('element sh')) {
        inShElement = true;
      } else if (inShElement && line.startsWith('property')) {
        shPropertyCount++;
      } else if (inShElement && line.startsWith('element')) {
        inShElement = false;
      }
    }

    const littleEndian = format === 'binary_little_endian';
    const view = new DataView(buffer, headerEnd);

    const chunkStride = 18 * 4; 
    const chunks: {
      minPos: [number, number, number];
      maxPos: [number, number, number];
      minScale: [number, number, number];
      maxScale: [number, number, number];
      minColor: [number, number, number];
      maxColor: [number, number, number];
    }[] = [];

    for (let ci = 0; ci < chunkCount; ci++) {
      const base = ci * chunkStride;
      chunks.push({
        minPos: [view.getFloat32(base + 0, littleEndian),
                view.getFloat32(base + 4, littleEndian),
                view.getFloat32(base + 8, littleEndian)],
        maxPos: [view.getFloat32(base + 12, littleEndian),
                view.getFloat32(base + 16, littleEndian),
                view.getFloat32(base + 20, littleEndian)],
        minScale: [view.getFloat32(base + 24, littleEndian),
                  view.getFloat32(base + 28, littleEndian),
                  view.getFloat32(base + 32, littleEndian)],
        maxScale: [view.getFloat32(base + 36, littleEndian),
                  view.getFloat32(base + 40, littleEndian),
                  view.getFloat32(base + 44, littleEndian)],
        minColor: [view.getFloat32(base + 48, littleEndian),
                  view.getFloat32(base + 52, littleEndian),
                  view.getFloat32(base + 56, littleEndian)],
        maxColor: [view.getFloat32(base + 60, littleEndian),
                  view.getFloat32(base + 64, littleEndian),
                  view.getFloat32(base + 68, littleEndian)],
      });
    }

    const vertexOffset = chunkCount * chunkStride;
    const vertexStride = 4 * 4; 
    const shOffset = vertexOffset + vertexCount * vertexStride;
    const shStride = shPropertyCount;
    const GAUSS_STRIDE = 10; 
    
    let shDegree: number;
    let totalShCoeffs: number;
    if (shPropertyCount === 9) {
      shDegree = 1;
      totalShCoeffs = 12;
    } else if (shPropertyCount === 24) {
      shDegree = 2;
      totalShCoeffs = 27;
    } else if (shPropertyCount === 45) {
      shDegree = 3;
      totalShCoeffs = 48;
    } else {
      shDegree = 0;
      totalShCoeffs = 3;
    }
  
    const wordsPerPoint = Math.ceil(totalShCoeffs / 2);
    const gaussHalf = new Uint16Array(vertexCount * GAUSS_STRIDE);
    const shPacked = new Uint32Array(vertexCount * wordsPerPoint);
    const positions: [number, number, number][] = [];

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;
    const unpackUnorm = (value: number, bits: number) => {
        const t = (1 << bits) - 1;
        return (value & t) / t;
    };

    const unpack111011 = (value: number) => ({
        x: unpackUnorm(value >>> 21, 11),
        y: unpackUnorm(value >>> 11, 10),
        z: unpackUnorm(value, 11)
    });

    const unpack8888 = (value: number) => ({
        r: unpackUnorm(value >>> 24, 8),
        g: unpackUnorm(value >>> 16, 8),
        b: unpackUnorm(value >>> 8, 8),
        a: unpackUnorm(value, 8)
    });

    const unpackRot = (value: number) => {
        const norm = 1.0 / (Math.sqrt(2) * 0.5);
        const a = (unpackUnorm(value >>> 20, 10) - 0.5) * norm;
        const b = (unpackUnorm(value >>> 10, 10) - 0.5) * norm;
        const c = (unpackUnorm(value, 10) - 0.5) * norm;
        const m = Math.sqrt(Math.max(0, 1.0 - (a * a + b * b + c * c)));
        
        const which = value >>> 30;
        
        switch (which) {
            case 0: return { w: m, x: a, y: b, z: c }; 
            case 1: return { w: a, x: m, y: b, z: c }; 
            case 2: return { w: a, x: b, y: m, z: c }; 
            default: return { w: a, x: b, y: c, z: m }; 
        }
    };

    const SH_C0 = 0.28209479177387814;

    const packSH = (i: number, dc: [number, number, number], rest: Uint8Array) => {
      const shCoeffs = new Float32Array(totalShCoeffs);
      
      shCoeffs[0] = (dc[0] - 0.5) / SH_C0;
      shCoeffs[1] = (dc[1] - 0.5) / SH_C0;
      shCoeffs[2] = (dc[2] - 0.5) / SH_C0;

      const coeffsPerChannel = rest.length / 3; 
      
      for (let k = 0; k < coeffsPerChannel; k++) {
          const destIdx = 3 + k * 3; 
          
          if (destIdx + 2 >= shCoeffs.length) break;

          const idxR = k;
          const idxG = k + coeffsPerChannel;
          const idxB = k + coeffsPerChannel * 2;
          
          const r_val = rest[idxR];
          const g_val = rest[idxG];
          const b_val = rest[idxB];

          shCoeffs[destIdx + 0] = (r_val / 255.0 - 0.5) * 8; 
          shCoeffs[destIdx + 1] = (g_val / 255.0 - 0.5) * 8; 
          shCoeffs[destIdx + 2] = (b_val / 255.0 - 0.5) * 8; 
      }
      
      const base = i * wordsPerPoint;
      for (let j = 0; j < shCoeffs.length; j += 2) {
        const a = f32_to_f16(shCoeffs[j]);
        const b = j + 1 < shCoeffs.length ? f32_to_f16(shCoeffs[j + 1]) : 0;
        shPacked[base + (j >> 1)] = (b << 16) | a;
      }
    };

    const tempQ = quat.create(); 
    const tempS = vec3.create();

    for (let i = 0; i < vertexCount; i++) {
      const vBase = vertexOffset + i * vertexStride;
      const shBase = shOffset + i * shStride;
      const ci = Math.floor(i / CompressedPLYLoader.CHUNK_SIZE);

      const packedPos = view.getUint32(vBase + 0, littleEndian);
      const packedRot = view.getUint32(vBase + 4, littleEndian);
      const packedScale = view.getUint32(vBase + 8, littleEndian);
      const packedColor = view.getUint32(vBase + 12, littleEndian);

      const pNorm = unpack111011(packedPos);
      const qObj = unpackRot(packedRot);
      const sNorm = unpack111011(packedScale);
      const c = unpack8888(packedColor);

      const px = lerp(chunks[ci].minPos[0], chunks[ci].maxPos[0], pNorm.x);
      const py = lerp(chunks[ci].minPos[1], chunks[ci].maxPos[1], pNorm.y);
      const pz = lerp(chunks[ci].minPos[2], chunks[ci].maxPos[2], pNorm.z);

      const scaleLogX = lerp(chunks[ci].minScale[0], chunks[ci].maxScale[0], sNorm.x);
      const scaleLogY = lerp(chunks[ci].minScale[1], chunks[ci].maxScale[1], sNorm.y);
      const scaleLogZ = lerp(chunks[ci].minScale[2], chunks[ci].maxScale[2], sNorm.z);
      
      const scaleX = Math.exp(scaleLogX);
      const scaleY = Math.exp(scaleLogY);
      const scaleZ = Math.exp(scaleLogZ);

      const cr = lerp(chunks[ci].minColor[0], chunks[ci].maxColor[0], c.r);
      const cg = lerp(chunks[ci].minColor[1], chunks[ci].maxColor[1], c.g);
      const cb = lerp(chunks[ci].minColor[2], chunks[ci].maxColor[2], c.b);
      const dc: [number, number, number] = [cr, cg, cb];

      const opacity = c.a; 

      quat.set(tempQ, qObj.x, qObj.y, qObj.z, qObj.w);
      vec3.set(tempS, scaleX, scaleY, scaleZ);
      quat.normalize(tempQ, tempQ);
      const [m00, m01, m02, m11, m12, m22] = buildCov(tempQ, tempS);
      
      const gBase = i * GAUSS_STRIDE;
      gaussHalf[gBase + 0] = f32_to_f16(px);
      gaussHalf[gBase + 1] = f32_to_f16(py);
      gaussHalf[gBase + 2] = f32_to_f16(pz);
      gaussHalf[gBase + 3] = f32_to_f16(opacity);
      gaussHalf[gBase + 4] = f32_to_f16(m00);
      gaussHalf[gBase + 5] = f32_to_f16(m01);
      gaussHalf[gBase + 6] = f32_to_f16(m02);
      gaussHalf[gBase + 7] = f32_to_f16(m11);
      gaussHalf[gBase + 8] = f32_to_f16(m12);
      gaussHalf[gBase + 9] = f32_to_f16(m22);

      const restBytes = new Uint8Array(buffer, headerEnd + shBase, shStride);
      packSH(i, dc, restBytes);

      positions.push([px, py, pz]);
      minX = Math.min(minX, px); minY = Math.min(minY, py); minZ = Math.min(minZ, pz);
      maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); maxZ = Math.max(maxZ, pz);
    }

    const min: [number, number, number] = [minX, minY, minZ];
    const max: [number, number, number] = [maxX, maxY, maxZ];
    const center: [number, number, number] = [(minX + maxX)/2, (minY + maxY)/2, (minZ + maxZ)/2];

    return new PLYGaussianData({
      gaussianBuffer: gaussHalf.buffer,
      shCoefsBuffer: shPacked.buffer,
      numPoints: vertexCount,
      shDegree,
      bbox: { min, max },
      center,
      up: [0, 1, 0],
    });
  }
}
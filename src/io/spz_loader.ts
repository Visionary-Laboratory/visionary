import { f32_to_f16 } from '../utils/half';
import { buildCov } from '../utils';
import { vec3, quat } from 'gl-matrix';
import { planeFromPoints } from '../utils/vector-math';
import { ILoader, LoadingOptions } from './index';
import { PLYGaussianData } from './GaussianData';

export class SPZLoader implements ILoader<PLYGaussianData> {
  
  async loadFile(file: File, options?: LoadingOptions): Promise<PLYGaussianData> {
    return this.loadBuffer(await file.arrayBuffer(), options);
  }
  
  async loadUrl(url: string, options?: LoadingOptions): Promise<PLYGaussianData> {
    const response = await fetch(url, { signal: options?.signal });
    if (!response.ok) throw new Error(`Failed to fetch SPZ: ${response.statusText}`);
    return this.loadBuffer(await response.arrayBuffer(), options);
  }
  
  async loadBuffer(buffer: ArrayBuffer, options?: LoadingOptions): Promise<PLYGaussianData> {
    const progress = (stage: string, p: number, msg?: string) => {
      options?.onProgress?.({ stage, progress: p, message: msg });
    };
    
    progress('Decompressing SPZ', 0.1);
    
    const compressed = new Uint8Array(buffer);
    const stream = new Blob([compressed]).stream();
    const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
    const decompressed = await new Response(decompressedStream).arrayBuffer();
    
    progress('Parsing Data', 0.2);
    
    const view = new DataView(decompressed);
    const bytes = new Uint8Array(decompressed); 
    let offset = 0;
    
    const magic = view.getUint32(offset, true); offset += 4;
    if (magic !== 0x5053474e) throw new Error(`Invalid SPZ magic: 0x${magic.toString(16)}`);
    
    const version = view.getUint32(offset, true); offset += 4;
    const numPoints = view.getUint32(offset, true); offset += 4;
    const shDegree = view.getUint8(offset++);
    const fractionalBits = view.getUint8(offset++);
    const flags = view.getUint8(offset++);
    offset++; 
    
    if (version < 1 || version > 3) throw new Error(`Unsupported SPZ version: ${version}`);

    const posOffset = offset;
    if (version === 1) {
        offset += numPoints * 6; 
    } else {
        offset += numPoints * 9; 
    }

    const alphaOffset = offset;
    offset += numPoints; 

    const colorOffset = offset;
    offset += numPoints * 3; 

    const scaleOffset = offset;
    offset += numPoints * 3; 

    const rotOffset = offset;
    if (version === 3) {
        offset += numPoints * 4; 
    } else {
        offset += numPoints * 3; 
    }

    const shDataOffset = offset;
    const SH_VECS: Record<number, number> = { 1: 3, 2: 8, 3: 15 };
    const numShVecs = SH_VECS[shDegree] || 0;

    const GAUSS_STRIDE = 10;
    const gaussHalf = new Uint16Array(numPoints * GAUSS_STRIDE);
    const WORDS_PER_POINT = 24; 
    const shPacked = new Uint32Array(numPoints * WORDS_PER_POINT);
    
    const positions: [number, number, number][] = []; 
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    const fixedScale = 1 << fractionalBits;
    const SH_C0 = 0.28209479177387814;
    const colorScale = SH_C0 / 0.15;
    const tempQ = quat.create();
    const tempS = vec3.create();

    progress('Processing Points', 0.3);

    for (let i = 0; i < numPoints; i++) {
        if (i % 10000 === 0) {
             if (i % 50000 === 0) progress('Processing Points', 0.3 + 0.6 * (i / numPoints));
        }

        let x: number, y: number, z: number;
        if (version === 1) {
            x = this.readHalfFloat(view, posOffset + i * 6 + 0);
            y = this.readHalfFloat(view, posOffset + i * 6 + 2);
            z = this.readHalfFloat(view, posOffset + i * 6 + 4);
        } else {
            const base = posOffset + i * 9;
            const v0 = bytes[base] | (bytes[base + 1] << 8) | (bytes[base + 2] << 16);
            const v1 = bytes[base + 3] | (bytes[base + 4] << 8) | (bytes[base + 5] << 16);
            const v2 = bytes[base + 6] | (bytes[base + 7] << 8) | (bytes[base + 8] << 16);
            x = ((v0 << 8) >> 8) / fixedScale;
            y = ((v1 << 8) >> 8) / fixedScale;
            z = ((v2 << 8) >> 8) / fixedScale;
        }

        const opacity = bytes[alphaOffset + i] / 255.0;

        const cBase = colorOffset + i * 3;
        const dr = (bytes[cBase] / 255.0 - 0.5) / 0.15;
        const dg = (bytes[cBase + 1] / 255.0 - 0.5) / 0.15;
        const db = (bytes[cBase + 2] / 255.0 - 0.5) / 0.15;

        const sBase = scaleOffset + i * 3;
        const sx = Math.exp(bytes[sBase] / 16.0 - 10.0);
        const sy = Math.exp(bytes[sBase + 1] / 16.0 - 10.0);
        const sz = Math.exp(bytes[sBase + 2] / 16.0 - 10.0);

        if (version === 3) {
            const rBase = rotOffset + i * 4;
            const combinedValues = bytes[rBase] | (bytes[rBase + 1] << 8) | (bytes[rBase + 2] << 16) | (bytes[rBase + 3] << 24);
            
            const maxValue = 0.70710678; 
            const valueMask = 511; 
            
            const largestIndex = combinedValues >>> 30;
            let remaining = combinedValues;
            
            const tempVals = [0, 0, 0, 0]; 
            let sumSquares = 0;
            
            for (let j = 3; j >= 0; j--) {
                if (j !== largestIndex) {
                    const val = remaining & valueMask;
                    const sign = (remaining >>> 9) & 1;
                    remaining >>>= 10;
                    
                    let realVal = maxValue * (val / 511.0);
                    if (sign) realVal = -realVal;
                    tempVals[j] = realVal;
                    sumSquares += realVal * realVal;
                }
            }
            tempVals[largestIndex] = Math.sqrt(Math.max(1.0 - sumSquares, 0));
            
            quat.set(tempQ, tempVals[0], tempVals[1], tempVals[2], tempVals[3]);

        } else {
            const rBase = rotOffset + i * 3;
            const qx = bytes[rBase] / 127.5 - 1;
            const qy = bytes[rBase + 1] / 127.5 - 1;
            const qz = bytes[rBase + 2] / 127.5 - 1;
            const qw = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy - qz * qz));
            quat.set(tempQ, qx, qy, qz, qw);
        }
        
        quat.normalize(tempQ, tempQ);
        vec3.set(tempS, sx, sy, sz);

        const [m00, m01, m02, m11, m12, m22] = buildCov(tempQ, tempS);
        
        const gIdx = i * GAUSS_STRIDE;
        gaussHalf[gIdx + 0] = f32_to_f16(x);
        gaussHalf[gIdx + 1] = f32_to_f16(y);
        gaussHalf[gIdx + 2] = f32_to_f16(z);
        gaussHalf[gIdx + 3] = f32_to_f16(opacity);
        gaussHalf[gIdx + 4] = f32_to_f16(m00);
        gaussHalf[gIdx + 5] = f32_to_f16(m01);
        gaussHalf[gIdx + 6] = f32_to_f16(m02);
        gaussHalf[gIdx + 7] = f32_to_f16(m11);
        gaussHalf[gIdx + 8] = f32_to_f16(m12);
        gaussHalf[gIdx + 9] = f32_to_f16(m22);

        const shIdx = i * WORDS_PER_POINT;
        
        shPacked[shIdx + 0] = f32_to_f16(dr) | (f32_to_f16(dg) << 16);
        shPacked[shIdx + 1] = f32_to_f16(db); 
        
        if (numShVecs > 0) {
            const shBaseSrc = shDataOffset + i * numShVecs * 3;
            let currentUint32Index = shIdx + 1;
            let isHigh = true; 

            for (let k = 0; k < numShVecs * 3; k++) {
                const val = (bytes[shBaseSrc + k] - 128.0) / 128.0;
                const half = f32_to_f16(val);

                if (isHigh) {
                    shPacked[currentUint32Index] |= (half << 16);
                    currentUint32Index++;
                    isHigh = false;
                } else {
                    shPacked[currentUint32Index] = half; 
                    isHigh = true;
                }
            }
        }

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
        
        positions.push([x, y, z]); 
    }

    progress('Finalizing', 0.95);
    
    const { centroid, normal } = planeFromPoints(positions);

    console.log(`[SPZLoader] Loaded ${numPoints} points efficiently.`);

    return new PLYGaussianData({
      gaussianBuffer: gaussHalf.buffer,
      shCoefsBuffer: shPacked.buffer,
      numPoints,
      shDegree,
      bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
      center: [centroid[0], centroid[1], centroid[2]],
      up: normal ? [normal[0], normal[1], normal[2]] : [0, 1, 0],
    });
  }
  
  canHandle(filename: string): boolean {
    return filename.toLowerCase().endsWith('.spz');
  }
  
  getSupportedExtensions(): string[] {
    return ['.spz'];
  }
  
  private readHalfFloat(view: DataView, offset: number): number {
    const h = view.getUint16(offset, true);
    const sign = (h & 0x8000) >> 15;
    const exponent = (h & 0x7C00) >> 10;
    const fraction = h & 0x03FF;
    if (exponent === 0) {
      return (sign ? -1 : 1) * Math.pow(2, -14) * (fraction / 1024);
    } else if (exponent === 0x1F) {
      return fraction ? NaN : (sign ? -Infinity : Infinity);
    }
    return (sign ? -1 : 1) * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
  }
}
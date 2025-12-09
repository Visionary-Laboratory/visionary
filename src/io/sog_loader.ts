import { unzip } from 'fflate';
import { f32_to_f16 } from '../utils/half';
import { buildCov, sigmoid } from '../utils';
import { vec3, quat } from 'gl-matrix';
import { ILoader, LoadingOptions } from './index';
import { PLYGaussianData } from './GaussianData';

export class SOGLoader implements ILoader<PLYGaussianData> {
  
  async loadFile(file: File, options?: LoadingOptions): Promise<PLYGaussianData> {
    return this.loadBuffer(await file.arrayBuffer(), options);
  }
  
  async loadUrl(url: string, options?: LoadingOptions): Promise<PLYGaussianData> {
    const response = await fetch(url, { signal: options?.signal });
    if (!response.ok) throw new Error(`Failed to fetch SOG: ${response.statusText}`);
    return this.loadBuffer(await response.arrayBuffer(), options);
  }
  
  async loadBuffer(buffer: ArrayBuffer, options?: LoadingOptions): Promise<PLYGaussianData> {
    const view = new DataView(buffer);
    const magic = view.getUint32(0, true);

    if (magic === 0x04034B50) {
        return this.loadCompressedSOG(buffer, options);
    }

    return this.loadRawSOG(buffer, options);
  }

  private async loadRawSOG(buffer: ArrayBuffer, options?: LoadingOptions): Promise<PLYGaussianData> {
    const progress = (stage: string, p: number, msg?: string) => {
      options?.onProgress?.({ stage, progress: p, message: msg });
    };
    progress('Parsing SOG header', 0.1);
    const view = new DataView(buffer);
    let offset = 0;
    
    const magic = view.getUint32(offset, true); offset += 4;
    if (magic !== 0x534F4700 && magic !== 0x00474F53) {
        throw new Error('Invalid SOG file');
    }
    
    const version = view.getUint32(offset, true); offset += 4;
    const numPoints = view.getUint32(offset, true); offset += 4;
    const shDegree = view.getUint32(offset, true); offset += 4;

    console.log(`[SOGLoader] Ver:${version}, Points:${numPoints}, SH Degree:${shDegree}`);
    
    progress('Loading SOG data', 0.3);
    
    const GAUSS_STRIDE = 10;
    const gaussHalf = new Uint16Array(numPoints * GAUSS_STRIDE);
    const WORDS_PER_POINT = 24;
    const shPacked = new Uint32Array(numPoints * WORDS_PER_POINT);
    
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let sumX = 0, sumY = 0, sumZ = 0;
    
    const tempQ = quat.create();
    const tempS = vec3.create();
    
    for (let i = 0; i < numPoints; i++) {
      if (i % 10000 === 0) {
        progress('Processing SOG points', 0.3 + 0.6 * (i / numPoints));
      }
      
      const x = view.getFloat32(offset, true); offset += 4;
      const y = view.getFloat32(offset, true); offset += 4;
      const z = view.getFloat32(offset, true); offset += 4;
      
      const rawSx = view.getFloat32(offset, true); offset += 4;
      const rawSy = view.getFloat32(offset, true); offset += 4;
      const rawSz = view.getFloat32(offset, true); offset += 4;

      const sx = Math.exp(rawSx);
      const sy = Math.exp(rawSy);
      const sz = Math.exp(rawSz);
      
      const qw = view.getFloat32(offset, true); offset += 4;
      const qx = view.getFloat32(offset, true); offset += 4;
      const qy = view.getFloat32(offset, true); offset += 4;
      const qz = view.getFloat32(offset, true); offset += 4;
      
      const rawOpacity = view.getFloat32(offset, true); offset += 4;
      const opacity = sigmoid(rawOpacity);
      
      quat.set(tempQ, qx, qy, qz, qw); 
      quat.normalize(tempQ, tempQ);
      
      vec3.set(tempS, sx, sy, sz);
      
      const [m00, m01, m02, m11, m12, m22] = buildCov(tempQ, tempS);
      
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
      
      const numCoeffs = 3 * Math.pow(shDegree + 1, 2);
      const shBase = i * WORDS_PER_POINT;

      for (let j = 0; j < numCoeffs && j < WORDS_PER_POINT * 2; j++) {
        const shVal = view.getFloat32(offset, true); offset += 4;
        const halfVal = f32_to_f16(shVal);
        
        const wordIdx = Math.floor(j / 2);
        const isHigh = j % 2 === 1; 
        
        if (isHigh) {
          shPacked[shBase + wordIdx] |= (halfVal << 16);
        } else {
          shPacked[shBase + wordIdx] = halfVal;
        }
      }
      
      if (numCoeffs > WORDS_PER_POINT * 2) {
          const remaining = numCoeffs - WORDS_PER_POINT * 2;
          offset += remaining * 4;
      }
      
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      sumX += x; sumY += y; sumZ += z;
    }
    
    progress('Finalizing', 0.9);
    
    const centerX = sumX / numPoints;
    const centerY = sumY / numPoints;
    const centerZ = sumZ / numPoints;
    
    return new PLYGaussianData({
      gaussianBuffer: gaussHalf.buffer,
      shCoefsBuffer: shPacked.buffer,
      numPoints,
      shDegree,
      bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
      center: [centerX, centerY, centerZ],
      up: [0, 1, 0],
    });
  }

  private async loadCompressedSOG(buffer: ArrayBuffer, options?: LoadingOptions): Promise<PLYGaussianData> {
    const progress = (p: number, msg: string) => options?.onProgress?.({ stage: 'SOG-WebP', progress: p, message: msg });
    progress(0.1, 'Unzipping SOG');

    const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
        unzip(new Uint8Array(buffer), (err, data) => {
            if (err) reject(err);
            else resolve(data);
        });
    });

    if (!entries['meta.json']) throw new Error('Invalid SOG ZIP: missing meta.json');

    const meta = JSON.parse(new TextDecoder().decode(entries['meta.json']));
    const numPoints = meta.count;
    console.log(`[SOGLoader] Compressed SOG, Points: ${numPoints}`);

    const decodeTexture = async (filename: string): Promise<{ data: Uint8Array, width: number, height: number }> => {
        if (!entries[filename]) throw new Error(`Missing texture: ${filename}`);
        const blob = new Blob([new Uint8Array(entries[filename])], { type: 'image/webp' });
        const bitmap = await createImageBitmap(blob);
        
        let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        const { width, height } = bitmap;

        if (typeof OffscreenCanvas !== 'undefined') {
            const canvas = new OffscreenCanvas(width, height);
            ctx = canvas.getContext('2d');
            ctx?.drawImage(bitmap, 0, 0);
            // @ts-ignore
            const imgData = ctx?.getImageData(0, 0, width, height);
            return { data: new Uint8Array(imgData!.data.buffer), width, height };
        } else {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            ctx = canvas.getContext('2d');
            ctx?.drawImage(bitmap, 0, 0);
            const imgData = ctx?.getImageData(0, 0, width, height);
            return { data: new Uint8Array(imgData!.data.buffer), width, height };
        }
    };

    progress(0.2, 'Decoding Base Textures');

    const [meansLo, meansHi, quats, scales, sh0] = await Promise.all([
        decodeTexture(meta.means.files[0]),
        decodeTexture(meta.means.files[1]),
        decodeTexture(meta.quats.files[0]),
        decodeTexture(meta.scales.files[0]),
        decodeTexture(meta.sh0.files[0])
    ]);

    let shDegree = 0;
    let decodedCentroids: Float32Array | null = null;
    let labelsTex: { data: Uint8Array } | null = null;
    let floatsPerCentroid = 0;
    let shRestTextures: { data: Uint8Array }[] = [];
    let shRestCode: Float32Array | null = null;

    if (meta.shN) {
        const shN = meta.shN;
        shDegree = shN.bands; 
        console.log(`[SOGLoader] Found shN (Vector Quantized). Degree: ${shDegree}`);

        progress(0.4, 'Decoding SH Vector Tables');

        let centroidsTex: { data: Uint8Array };
        [labelsTex, centroidsTex] = await Promise.all([
            decodeTexture(shN.files[1]), 
            decodeTexture(shN.files[0])
        ]);

        const shCodebook = new Float32Array(shN.codebook);
        const numCentroids = shN.count;
        const numCoeffsPerBand = shDegree === 3 ? 15 : (shDegree === 2 ? 8 : 3); 
        floatsPerCentroid = numCoeffsPerBand * 3; 
        
        decodedCentroids = new Float32Array(numCentroids * floatsPerCentroid);
        const cData = centroidsTex.data;

        for (let i = 0; i < numCentroids; i++) {
            for (let j = 0; j < numCoeffsPerBand; j++) {
                const baseIdx = (i * numCoeffsPerBand + j) * 4; 
                const idxR = cData[baseIdx + 0];
                const idxG = cData[baseIdx + 1];
                const idxB = cData[baseIdx + 2];

                const outIdx = i * floatsPerCentroid + j * 3;
                decodedCentroids[outIdx + 0] = shCodebook[idxR];
                decodedCentroids[outIdx + 1] = shCodebook[idxG];
                decodedCentroids[outIdx + 2] = shCodebook[idxB];
            }
        }

    } else if (meta.sh_rest && meta.sh_rest.files.length > 0) {
        console.log(`[SOGLoader] Found sh_rest (Scalar Quantized).`);
        shRestCode = new Float32Array(meta.sh_rest.codebook);
        shRestTextures = await Promise.all(meta.sh_rest.files.map((f: string) => decodeTexture(f)));
        
        const totalShChannels = 3 + (shRestTextures.length * 3);
        shDegree = Math.round(Math.sqrt(totalShChannels / 3) - 1);
    } else {
        console.log(`[SOGLoader] No high-order SH data. Degree: 0`);
    }

    const GAUSS_STRIDE = 10; 
    const gaussHalf = new Uint16Array(numPoints * GAUSS_STRIDE);
    const WORDS_PER_POINT = 24; 
    const shPacked = new Uint32Array(numPoints * WORDS_PER_POINT); 

    const tempQ = quat.create();
    const tempS = vec3.create();
    
    const xMin = meta.means.mins[0], xScale = (meta.means.maxs[0] - xMin) || 1;
    const yMin = meta.means.mins[1], yScale = (meta.means.maxs[1] - yMin) || 1;
    const zMin = meta.means.mins[2], zScale = (meta.means.maxs[2] - zMin) || 1;
    
    const sCode = new Float32Array(meta.scales.codebook);
    const cCode = new Float32Array(meta.sh0.codebook);
    
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let sumX = 0, sumY = 0, sumZ = 0;

    progress(0.6, 'Reconstructing Gaussians');

    for (let i = 0; i < numPoints; i++) {
        if (i % 50000 === 0) progress(0.6 + 0.3 * (i / numPoints), 'Reconstructing...');

        const pxIdx = i * 4;

        const u16x = meansLo.data[pxIdx + 0] | (meansHi.data[pxIdx + 0] << 8);
        const u16y = meansLo.data[pxIdx + 1] | (meansHi.data[pxIdx + 1] << 8);
        const u16z = meansLo.data[pxIdx + 2] | (meansHi.data[pxIdx + 2] << 8);
        
        const x = this.invLogTransform(xMin + xScale * (u16x / 65535));
        const y = this.invLogTransform(yMin + yScale * (u16y / 65535));
        const z = this.invLogTransform(zMin + zScale * (u16z / 65535));

        const tag = quats.data[pxIdx + 3];
        this.unpackQuatToRef(quats.data[pxIdx], quats.data[pxIdx+1], quats.data[pxIdx+2], tag, tempQ);

        const sx = Math.exp(sCode[scales.data[pxIdx + 0]]);
        const sy = Math.exp(sCode[scales.data[pxIdx + 1]]);
        const sz = Math.exp(sCode[scales.data[pxIdx + 2]]);
        vec3.set(tempS, sx, sy, sz);

        const [m00, m01, m02, m11, m12, m22] = buildCov(tempQ, tempS);
        const opacity = sh0.data[pxIdx + 3] / 255.0;

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

        let shBaseIdx = i * WORDS_PER_POINT;
        let coeffCounter = 0;

        const pushSH = (val: number) => {
            const half = f32_to_f16(val);
            const wordIdx = shBaseIdx + (coeffCounter >> 1); 
            if ((coeffCounter & 1) === 1) {
                shPacked[wordIdx] |= (half << 16); 
            } else {
                shPacked[wordIdx] = half; 
            }
            coeffCounter++;
        };

        pushSH(cCode[sh0.data[pxIdx + 0]]);
        pushSH(cCode[sh0.data[pxIdx + 1]]);
        pushSH(cCode[sh0.data[pxIdx + 2]]);

        if (decodedCentroids && labelsTex) {
            const lIdx = i * 4;
            const labelLo = labelsTex.data[lIdx + 0];
            const labelHi = labelsTex.data[lIdx + 1];
            const centroidIdx = labelLo | (labelHi << 8);

            const cBase = centroidIdx * floatsPerCentroid;
            for (let c = 0; c < floatsPerCentroid; c++) {
                pushSH(decodedCentroids[cBase + c]);
            }
        } else if (shRestCode && shRestTextures.length > 0) {
            for (let t = 0; t < shRestTextures.length; t++) {
                const texData = shRestTextures[t].data;
                pushSH(shRestCode[texData[pxIdx + 0]]);
                pushSH(shRestCode[texData[pxIdx + 1]]);
                pushSH(shRestCode[texData[pxIdx + 2]]);
            }
        }

        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        sumX += x; sumY += y; sumZ += z;
    }
    
    return new PLYGaussianData({
        gaussianBuffer: gaussHalf.buffer,
        shCoefsBuffer: shPacked.buffer,
        numPoints,
        shDegree,
        bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
        center: [sumX / numPoints, sumY / numPoints, sumZ / numPoints],
        up: [0, 1, 0],
    });
  }

  private invLogTransform(v: number): number {
      const a = Math.abs(v);
      const e = Math.exp(a) - 1;
      return v < 0 ? -e : e;
  }

  private unpackQuatToRef(px: number, py: number, pz: number, tag: number, out: quat) {
      const maxComp = tag - 252;
      if (maxComp < 0 || maxComp > 3) {
          quat.set(out, 0, 0, 0, 1);
          return;
      }

      const a = px / 255.0 * 2.0 - 1.0;
      const b = py / 255.0 * 2.0 - 1.0;
      const c = pz / 255.0 * 2.0 - 1.0;
      const sqrt2 = 1.41421356;
      
      let q0=0, q1=0, q2=0, q3=0;
      
      if (maxComp === 0) {
          q1 = a / sqrt2; q2 = b / sqrt2; q3 = c / sqrt2;
          q0 = Math.sqrt(Math.max(0, 1 - (q1*q1 + q2*q2 + q3*q3)));
      } else if (maxComp === 1) {
          q0 = a / sqrt2; q2 = b / sqrt2; q3 = c / sqrt2;
          q1 = Math.sqrt(Math.max(0, 1 - (q0*q0 + q2*q2 + q3*q3)));
      } else if (maxComp === 2) {
          q0 = a / sqrt2; q1 = b / sqrt2; q3 = c / sqrt2;
          q2 = Math.sqrt(Math.max(0, 1 - (q0*q0 + q1*q1 + q3*q3)));
      } else {
          q0 = a / sqrt2; q1 = b / sqrt2; q2 = c / sqrt2;
          q3 = Math.sqrt(Math.max(0, 1 - (q0*q0 + q1*q1 + q2*q2)));
      }
      
      quat.set(out, q1, q2, q3, q0);
      quat.normalize(out, out);
  }
  
  canHandle(filename: string): boolean {
    return filename.toLowerCase().endsWith('.sog');
  }
  
  getSupportedExtensions(): string[] {
    return ['.sog'];
  }
}
import { f32_to_f16 } from '../utils/half';
import { buildCov } from '../utils';
import { vec3, quat } from 'gl-matrix';
import { ILoader, LoadingOptions } from './index';
import { PLYGaussianData } from './GaussianData';

export class KSplatLoader implements ILoader<PLYGaussianData> {
  
  async loadFile(file: File, options?: LoadingOptions): Promise<PLYGaussianData> {
    return this.loadBuffer(await file.arrayBuffer(), options);
  }
  
  async loadUrl(url: string, options?: LoadingOptions): Promise<PLYGaussianData> {
    const response = await fetch(url, { signal: options?.signal });
    if (!response.ok) throw new Error(`Failed to fetch KSplat: ${response.statusText}`);
    return this.loadBuffer(await response.arrayBuffer(), options);
  }
  
  async loadBuffer(buffer: ArrayBuffer, options?: LoadingOptions): Promise<PLYGaussianData> {
    const progress = (stage: string, p: number, msg?: string) => {
      options?.onProgress?.({ stage, progress: p, message: msg });
    };
    
    progress('Parsing KSplat Header', 0.1);
  
    const HEADER_BYTES = 4096;
    const SECTION_BYTES = 1024;
    
    let headerOffset = 0;
    const header = new DataView(buffer, headerOffset, HEADER_BYTES);
    
    const versionMajor = header.getUint8(0);
    const versionMinor = header.getUint8(1);
    
    if (versionMajor !== 0 || versionMinor < 1) {
       console.warn(`KSplat version ${versionMajor}.${versionMinor} might not be fully supported.`);
    }
    
    const maxSectionCount = header.getUint32(4, true);
    const splatCount = header.getUint32(16, true);
    const compressionLevel = header.getUint16(20, true);
    
    const minSphericalHarmonicsCoeff = header.getFloat32(36, true) || -1.5;
    const maxSphericalHarmonicsCoeff = header.getFloat32(40, true) || 1.5;
    
    const COMPRESSION: Record<number, any> = {
      0: { bytesPerCenter: 12, bytesPerScale: 12, bytesPerRotation: 16, bytesPerColor: 4, bytesPerSphericalHarmonicsComponent: 4, scaleOffsetBytes: 12, rotationOffsetBytes: 24, colorOffsetBytes: 40, sphericalHarmonicsOffsetBytes: 44, scaleRange: 1 },
      1: { bytesPerCenter: 6, bytesPerScale: 6, bytesPerRotation: 8, bytesPerColor: 4, bytesPerSphericalHarmonicsComponent: 2, scaleOffsetBytes: 6, rotationOffsetBytes: 12, colorOffsetBytes: 20, sphericalHarmonicsOffsetBytes: 24, scaleRange: 32767 },
      2: { bytesPerCenter: 6, bytesPerScale: 6, bytesPerRotation: 8, bytesPerColor: 4, bytesPerSphericalHarmonicsComponent: 1, scaleOffsetBytes: 6, rotationOffsetBytes: 12, colorOffsetBytes: 20, sphericalHarmonicsOffsetBytes: 24, scaleRange: 32767 },
    };
    const SH_COMPONENTS = [0, 9, 24, 45]; 

    progress('Loading Data', 0.2);

    const GAUSS_STRIDE = 10;
    const gaussHalf = new Uint16Array(splatCount * GAUSS_STRIDE);
    const WORDS_PER_POINT = 24; 
    const shPacked = new Uint32Array(splatCount * WORDS_PER_POINT);
    
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let sumX = 0, sumY = 0, sumZ = 0;

    let sectionBase = HEADER_BYTES + maxSectionCount * SECTION_BYTES;
    let globalSplatIndex = 0;
    let maxShDegree = 0;

    const tempQ = quat.create();
    const tempS = vec3.create();
    const SH_C0 = 0.28209479177387814;
    
    const shReorder = [
        0, 3, 6, 1, 4, 7, 2, 5, 8,
        9, 14, 19, 10, 15, 20, 11, 16, 21, 12, 17, 22, 13, 18, 23,
        24, 31, 38, 25, 32, 39, 26, 33, 40, 27, 34, 41, 28, 35, 42, 29, 36, 43, 30, 37, 44
    ];

    headerOffset = HEADER_BYTES; 

    for (let sectionIdx = 0; sectionIdx < maxSectionCount; sectionIdx++) {
        const sectionView = new DataView(buffer, headerOffset, SECTION_BYTES);
        headerOffset += SECTION_BYTES;

        const sectionSplatCount = sectionView.getUint32(0, true);
        if (sectionSplatCount === 0) continue; 

        const sectionMaxSplatCount = sectionView.getUint32(4, true);
        const bucketSize = sectionView.getUint32(8, true);
        const bucketCount = sectionView.getUint32(12, true);
        const bucketBlockSize = sectionView.getFloat32(16, true);
        const bucketStorageSizeBytes = sectionView.getUint16(20, true);
        const compressionScaleRange = sectionView.getUint32(24, true) || COMPRESSION[compressionLevel].scaleRange;
        const fullBucketCount = sectionView.getUint32(32, true);
        const fullBucketSplats = fullBucketCount * bucketSize;
        const partiallyFilledBucketCount = sectionView.getUint32(36, true);
        const sphericalHarmonicsDegree = sectionView.getUint16(40, true);

        maxShDegree = Math.max(maxShDegree, sphericalHarmonicsDegree);
        const shComponentsCount = SH_COMPONENTS[sphericalHarmonicsDegree];

        const comp = COMPRESSION[compressionLevel];
        const bytesPerSplat = comp.bytesPerCenter + comp.bytesPerScale + comp.bytesPerRotation + comp.bytesPerColor + shComponentsCount * comp.bytesPerSphericalHarmonicsComponent;
        
        const bucketsMetaDataSizeBytes = partiallyFilledBucketCount * 4;
        const bucketsStorageSizeBytes = bucketStorageSizeBytes * bucketCount + bucketsMetaDataSizeBytes;
        const splatDataStorageSizeBytes = bytesPerSplat * sectionMaxSplatCount;
        
        const bucketsBase = sectionBase + bucketsMetaDataSizeBytes;
        const dataBase = sectionBase + bucketsStorageSizeBytes;
        const storageSizeBytes = splatDataStorageSizeBytes + bucketsStorageSizeBytes;

        const dataView = new DataView(buffer, dataBase, splatDataStorageSizeBytes);
        const bucketArray = new Float32Array(buffer, bucketsBase, bucketCount * 3);
        const partiallyFilledBucketLengths = new Uint32Array(buffer, sectionBase, partiallyFilledBucketCount);
        
        const compressionScaleFactor = bucketBlockSize / 2 / compressionScaleRange;

        let partialBucketIndex = fullBucketCount;
        let partialBucketBase = fullBucketSplats;

        for (let i = 0; i < sectionSplatCount; i++) {
            if (globalSplatIndex % 20000 === 0) {
                progress('Processing Splats', 0.3 + 0.6 * (globalSplatIndex / splatCount));
            }

            const splatOffset = i * bytesPerSplat;

            let bucketIndex: number;
            if (i < fullBucketSplats) {
                bucketIndex = Math.floor(i / bucketSize);
            } else {
                const bucketLength = partiallyFilledBucketLengths[partialBucketIndex - fullBucketCount];
                if (i >= partialBucketBase + bucketLength) {
                    partialBucketIndex += 1;
                    partialBucketBase += bucketLength;
                }
                bucketIndex = partialBucketIndex;
            }

            let x: number, y: number, z: number;
            if (compressionLevel === 0) {
                x = dataView.getFloat32(splatOffset + 0, true);
                y = dataView.getFloat32(splatOffset + 4, true);
                z = dataView.getFloat32(splatOffset + 8, true);
            } else {
                const bx = bucketArray[3 * bucketIndex + 0];
                const by = bucketArray[3 * bucketIndex + 1];
                const bz = bucketArray[3 * bucketIndex + 2];
                x = (dataView.getUint16(splatOffset + 0, true) - compressionScaleRange) * compressionScaleFactor + bx;
                y = (dataView.getUint16(splatOffset + 2, true) - compressionScaleRange) * compressionScaleFactor + by;
                z = (dataView.getUint16(splatOffset + 4, true) - compressionScaleRange) * compressionScaleFactor + bz;
            }

            let sx: number, sy: number, sz: number;
            if (compressionLevel === 0) {
                sx = dataView.getFloat32(splatOffset + comp.scaleOffsetBytes, true);
                sy = dataView.getFloat32(splatOffset + comp.scaleOffsetBytes + 4, true);
                sz = dataView.getFloat32(splatOffset + comp.scaleOffsetBytes + 8, true);
            } else {
                sx = this.fromHalf(dataView.getUint16(splatOffset + comp.scaleOffsetBytes, true));
                sy = this.fromHalf(dataView.getUint16(splatOffset + comp.scaleOffsetBytes + 2, true));
                sz = this.fromHalf(dataView.getUint16(splatOffset + comp.scaleOffsetBytes + 4, true));
            }
            sx = Math.max(sx, 1e-6);
            sy = Math.max(sy, 1e-6);
            sz = Math.max(sz, 1e-6);

            let qw: number, qx: number, qy: number, qz: number;
            if (compressionLevel === 0) {
                qw = dataView.getFloat32(splatOffset + comp.rotationOffsetBytes, true);
                qx = dataView.getFloat32(splatOffset + comp.rotationOffsetBytes + 4, true);
                qy = dataView.getFloat32(splatOffset + comp.rotationOffsetBytes + 8, true);
                qz = dataView.getFloat32(splatOffset + comp.rotationOffsetBytes + 12, true);
            } else {
                qw = this.fromHalf(dataView.getUint16(splatOffset + comp.rotationOffsetBytes, true));
                qx = this.fromHalf(dataView.getUint16(splatOffset + comp.rotationOffsetBytes + 2, true));
                qy = this.fromHalf(dataView.getUint16(splatOffset + comp.rotationOffsetBytes + 4, true));
                qz = this.fromHalf(dataView.getUint16(splatOffset + comp.rotationOffsetBytes + 6, true));
            }

            const r = dataView.getUint8(splatOffset + comp.colorOffsetBytes) / 255.0;
            const g = dataView.getUint8(splatOffset + comp.colorOffsetBytes + 1) / 255.0;
            const b = dataView.getUint8(splatOffset + comp.colorOffsetBytes + 2) / 255.0;
            const opacity = dataView.getUint8(splatOffset + comp.colorOffsetBytes + 3) / 255.0;

            quat.set(tempQ, qx, qy, qz, qw); 
            quat.normalize(tempQ, tempQ);
            vec3.set(tempS, sx, sy, sz);
            
            const [m00, m01, m02, m11, m12, m22] = buildCov(tempQ, tempS);

            const gIdx = globalSplatIndex * GAUSS_STRIDE;
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

            const shIdx = globalSplatIndex * WORDS_PER_POINT;
            
            const dcR = (r - 0.5) / SH_C0;
            const dcG = (g - 0.5) / SH_C0;
            const dcB = (b - 0.5) / SH_C0;
            
            shPacked[shIdx + 0] = f32_to_f16(dcR) | (f32_to_f16(dcG) << 16);
            shPacked[shIdx + 1] = f32_to_f16(dcB); 

            if (sphericalHarmonicsDegree > 0) {
                let currentUint32Idx = shIdx + 1;
                let isHigh = true;
                
                for (let k = 0; k < shComponentsCount; k++) {
                    const shMapIdx = shReorder[k];
                    
                    let val: number;
                    const shOffset = splatOffset + comp.sphericalHarmonicsOffsetBytes;
                    
                    if (compressionLevel === 0) {
                        val = dataView.getFloat32(shOffset + shMapIdx * 4, true);
                    } else if (compressionLevel === 1) {
                        val = this.fromHalf(dataView.getUint16(shOffset + shMapIdx * 2, true));
                    } else {
                        const t = dataView.getUint8(shOffset + shMapIdx) / 255.0;
                        val = minSphericalHarmonicsCoeff + t * (maxSphericalHarmonicsCoeff - minSphericalHarmonicsCoeff);
                    }
                    
                    const half = f32_to_f16(val);
                    if (isHigh) {
                        shPacked[currentUint32Idx] |= (half << 16);
                        currentUint32Idx++;
                        isHigh = false;
                    } else {
                        shPacked[currentUint32Idx] = half;
                        isHigh = true;
                    }
                }
            }

            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
            sumX += x; sumY += y; sumZ += z;

            globalSplatIndex++;
        }

        sectionBase += storageSizeBytes;
    }

    progress('Finalizing', 0.95);
    
    const centerX = globalSplatIndex > 0 ? sumX / globalSplatIndex : 0;
    const centerY = globalSplatIndex > 0 ? sumY / globalSplatIndex : 0;
    const centerZ = globalSplatIndex > 0 ? sumZ / globalSplatIndex : 0;

    console.log(`[KSplatLoader] Loaded ${globalSplatIndex} splats.`);

    return new PLYGaussianData({
      gaussianBuffer: gaussHalf.buffer,
      shCoefsBuffer: shPacked.buffer,
      numPoints: splatCount,
      shDegree: maxShDegree,
      bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
      center: [centerX, centerY, centerZ],
      up: [0, 1, 0],
    });
  }
  
  canHandle(filename: string): boolean {
    return filename.toLowerCase().endsWith('.ksplat');
  }
  
  getSupportedExtensions(): string[] {
    return ['.ksplat'];
  }
  
  private fromHalf(h: number): number {
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
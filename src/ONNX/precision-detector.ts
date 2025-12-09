import * as ort from 'onnxruntime-web/webgpu';
import { PrecisionMetadata, calcSizeInBytes } from './precision-types';

export class PrecisionDetector {
  // 新逻辑：仅基于输出名称后缀判断精度
  static detectOutputPrecisionFromName(outputName: string): PrecisionMetadata {
    const lower = (outputName || '').toLowerCase();
    if (lower.includes('_f32') || lower.includes('_float32')) return { dataType: 'float32', bytesPerElement: 4 };
    if (lower.includes('_f16') || lower.includes('_float16')) return { dataType: 'float16', bytesPerElement: 2 };
    if (lower.includes('_i8')  || lower.includes('_int8'))    return { dataType: 'int8',   bytesPerElement: 1 };
    if (lower.includes('_u8')  || lower.includes('_uint8'))   return { dataType: 'uint8',  bytesPerElement: 1 };
    return { dataType: 'float16', bytesPerElement: 2 };
  }

  // 从 outputMetadata 获取对应条目，优先使用 meta type 判断；只有没有 meta 信息时才回退到名称
  static detectFromMetadataPreferringNameSuffix(session: ort.InferenceSession, outputName: string): PrecisionMetadata {
    try {
      const meta: any = (session as any).outputMetadata;
      if (meta && typeof meta === 'object') {
        const getEntry = (key: string | number): any => {
          if (meta instanceof Map) return meta.get(key) ?? meta.get(String(key));
          if (Array.isArray(meta) && typeof key === 'number') return meta[key];
          return (meta as any)[key as any] ?? (meta as any)[String(key)];
        };

        const entries: any[] = meta instanceof Map
          ? Array.from(meta.values())
          : Object.keys(meta).map(k => (meta as any)[k]);

        let matchedEntry: any | undefined = outputName ? getEntry(outputName) : undefined;

        if (!matchedEntry && entries.length) {
          matchedEntry = entries.find(entry => entry?.name === outputName);
        }

        if (!matchedEntry && outputName) {
          const names: readonly string[] = session.outputNames;
          const idx = Array.isArray(names) ? names.findIndex(n => n === outputName) : -1;
          if (idx >= 0) matchedEntry = getEntry(idx);
        }

        if (matchedEntry) {
          const t: string | undefined = (matchedEntry as any)?.type ?? (matchedEntry as any)?.dataType;
          if (t) {
            const mapped = this.mapOrtTypeToPrecision(t);
            if (mapped) return mapped;
          }
        }
      }
    } catch {}
    // 兜底：再根据名称判断；detectOutputPrecisionFromName 会默认返回 float16
    return this.detectOutputPrecisionFromName(outputName);
  }

  private static mapOrtTypeToPrecision(ortType: string): PrecisionMetadata | undefined {
    const t = String(ortType).toLowerCase();
    if (t.includes('float16') || t === 'float16' || t === 'tensor(float16)') return { dataType: 'float16', bytesPerElement: 2 };
    if (t.includes('float32') || t === 'float32' || t === 'float' || t === 'tensor(float)') return { dataType: 'float32', bytesPerElement: 4 };
    if (t.includes('int8') || t === 'int8' || t === 'tensor(int8)') return { dataType: 'int8', bytesPerElement: 1 };
    if (t.includes('uint8') || t === 'uint8' || t === 'tensor(uint8)') return { dataType: 'uint8', bytesPerElement: 1 };
    return undefined;
  }

  static extractQuantizationParams(session: ort.InferenceSession, tensorName: string): { scale?: number; zeroPoint?: number } {
    // Best effort: look into model initializers/constants
    try {
      const model: any = (session as any).model;
      const inits: any[] = model?.graph?.initializer ?? [];
      let scale: number | undefined;
      let zero: number | undefined;
      for (const t of inits) {
        const name = t?.name as string | undefined;
        if (!name) continue;
        const lname = name.toLowerCase();
        if (lname.includes('scale') && lname.includes(tensorName.toLowerCase())) {
          const val = (t?.floatData?.[0] ?? t?.doubleData?.[0]) as number | undefined;
          if (typeof val === 'number') scale = val;
        }
        if ((lname.includes('zero') || lname.includes('zeropoint')) && lname.includes(tensorName.toLowerCase())) {
          const val = (t?.int32Data?.[0] ?? t?.int64Data?.[0]) as number | undefined;
          if (typeof val === 'number') zero = val;
        }
      }
      return { scale, zeroPoint: zero };
    } catch {
      return {};
    }
  }

  static calculateBufferSize(dims: number[], precision: PrecisionMetadata): number {
    return calcSizeInBytes(dims, precision);
  }
}



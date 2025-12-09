// Precision type definitions for ONNX outputs/inputs handling

export type OnnxDataType = 'float32' | 'float16' | 'int8' | 'uint8';

export interface PrecisionMetadata {
  dataType: OnnxDataType;
  bytesPerElement: number;
  scale?: number;      // for quantized int8/uint8
  zeroPoint?: number;  // for quantized int8/uint8
}

export interface OutputBufferDescriptor {
  name: string;
  precision: PrecisionMetadata;
  dims: number[];
  sizeInBytes: number;
}

export interface PrecisionConfig {
  gaussian?: Partial<PrecisionMetadata>;
  color?: Partial<PrecisionMetadata>;
  autoDetect?: boolean; // 已不使用，保留以避免上层破坏性变更
}

// 移除 onnxTypeToPrecision：改为基于输出名称后缀判断

export function align16(n: number): number {
  return Math.ceil(n / 16) * 16;
}

export function calcSizeInBytes(dims: number[], p: PrecisionMetadata): number {
  const elements = dims.reduce((a, b) => a * Math.max(1, b), 1);
  return align16(elements * p.bytesPerElement);
}

export function dataTypeToOrtString(p: PrecisionMetadata): 'float16' | 'float32' | 'int8' | 'uint8' {
  return p.dataType;
}



// Uniform buffer management module
// Provides abstractions for GPU uniform data handling

/**
 * Valid data types for uniform buffers
 */
export type UniformData = ArrayBufferView | ArrayBuffer;

/**
 * Generic interface for uniform buffer implementations
 */
export interface IUniformBuffer {
  /** The underlying GPU buffer */
  readonly buffer: GPUBuffer;
  
  /** Pre-created bind group for this uniform */
  readonly bindGroup: GPUBindGroup;
  
  /** Size in bytes */
  readonly size: number;
  
  /** Optional debug label */
  readonly label?: string;
  
  /**
   * Get a copy of the current CPU-side data
   */
  readonly data: ArrayBuffer;
  
  /**
   * Update uniform data from a typed array view
   */
  setData(view: ArrayBufferView): void;
  
  /**
   * Upload CPU-side changes to the GPU
   */
  flush(device?: GPUDevice): void;
  
  /**
   * Create a clone with the same data
   */
  clone(device?: GPUDevice): IUniformBuffer;
  
  /**
   * Clean up GPU resources
   */
  destroy(): void;
}

/**
 * Configuration for creating uniform buffers
 */
export interface UniformConfig {
  /** WebGPU device */
  device: GPUDevice;
  
  /** Initial data */
  data: UniformData;
  
  /** Debug label */
  label?: string;
  
  /** Additional buffer usage flags */
  usage?: GPUBufferUsageFlags;
}

/**
 * Helper functions for working with uniform data
 */
export class UniformUtils {
  /**
   * Align size to WebGPU uniform buffer requirements (16-byte alignment)
   */
  static alignSize(size: number): number {
    return Math.ceil(size / 16) * 16;
  }
  
  /**
   * Create a properly aligned ArrayBuffer for uniform data
   */
  static createAlignedBuffer(size: number): ArrayBuffer {
    return new ArrayBuffer(UniformUtils.alignSize(size));
  }
  
  /**
   * Pack multiple values into a uniform-friendly format
   */
  static packFloat32Array(values: number[], targetSize?: number): Float32Array {
    const size = targetSize || values.length;
    const buffer = new Float32Array(size);
    buffer.set(values);
    return buffer;
  }
  
  /**
   * Pack vec2/vec3/vec4 with proper padding
   */
  static packVec(values: number[], vecSize: 2 | 3 | 4): Float32Array {
    const paddedSize = vecSize === 3 ? 4 : vecSize; // vec3 needs vec4 alignment
    const result = new Float32Array(paddedSize);
    result.set(values.slice(0, vecSize));
    return result;
  }
  
  /**
   * Pack a 4x4 matrix in column-major order
   */
  static packMat4(matrix: Float32Array | number[]): Float32Array {
    if (matrix.length !== 16) {
      throw new Error('Matrix must have 16 elements');
    }
    return matrix instanceof Float32Array ? matrix : new Float32Array(matrix);
  }
}

// Export concrete implementation
export { UniformBuffer } from './uniform_buffer';
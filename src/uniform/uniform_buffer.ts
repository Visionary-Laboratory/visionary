// GPU Uniform Buffer Management
// Provides efficient CPU-GPU data synchronization for uniform data

import { IUniformBuffer, UniformData } from './index';

/**
 * WebGPU Uniform Buffer implementation
 * Manages uniform data transfer between CPU and GPU with caching
 */
export class UniformBuffer implements IUniformBuffer {
  readonly buffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  readonly label?: string;
  readonly size: number;
  
  private _data: ArrayBuffer;
  private device: GPUDevice;
  
  /**
   * Create bind group layout for uniform buffers
   * Cached per device for efficiency
   */
  static bindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
    return device.createBindGroupLayout({
      label: "uniform bind group layout",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      }],
    });
  }

  constructor(device: GPUDevice, init: UniformData, label?: string) {
    this.device = device;
    this.label = label;
    
    // Normalize input to Uint8Array
    const data = init instanceof ArrayBuffer 
      ? new Uint8Array(init) 
      : new Uint8Array(init.buffer, init.byteOffset, init.byteLength);
    
    this.size = data.byteLength;
    
    // Create CPU-side copy for updates
    this._data = new ArrayBuffer(this.size);
    new Uint8Array(this._data).set(data);

    // Create GPU buffer
    this.buffer = device.createBuffer({
      label,
      size: this.size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: false,
    });
    
    // Initial upload
    device.queue.writeBuffer(this.buffer, 0, this._data as ArrayBuffer);


    // Create bind group
    this.bindGroup = device.createBindGroup({
      label: label ? `${label} bind group` : undefined,
      layout: UniformBuffer.bindGroupLayout(device),
      entries: [{ binding: 0, resource: { buffer: this.buffer } }],
    });
  }

  /**
   * Get a copy of the current CPU-side data
   */
  get data(): ArrayBuffer { 
    return this._data.slice(0); 
  }

  /**
   * Replace CPU-side data (must call flush() to upload)
   */
  set dataBytes(bytes: ArrayBuffer) {
    if (bytes.byteLength !== this.size) {
      throw new Error(`Uniform size mismatch: expected ${this.size}, got ${bytes.byteLength}`);
    }
    this._data = bytes.slice(0);
  }

  /**
   * Update from a typed array view (size must match)
   */
  setData(view: ArrayBufferView): void {
    if (view.byteLength !== this.size) {
      throw new Error(`Uniform size mismatch: expected ${this.size}, got ${view.byteLength}`);
    }
    new Uint8Array(this._data).set(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    );
  }

  /**
   * Upload CPU-side data to the GPU
   */
  flush(device?: GPUDevice): void {
    const dev = device || this.device;
    dev.queue.writeBuffer(this.buffer, 0, new Uint8Array(this._data));
  }

  /**
   * Create a clone with the same data
   */
  clone(device?: GPUDevice): UniformBuffer {
    const dev = device || this.device;
    return new UniformBuffer(dev, this._data, this.label);
  }
  
  /**
   * Destroy GPU resources
   */
  destroy(): void {
    this.buffer.destroy();
  }
}
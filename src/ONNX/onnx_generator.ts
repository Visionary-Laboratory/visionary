// src/onnx_generator.ts
import { OnnxGpuIO } from './onnx_gpu_io';
import { PrecisionMetadata, PrecisionConfig } from './precision-types';

export type ONNXGeneratorConfig = {
  modelUrl: string;
  maxPoints?: number;  // Optional, will be auto-detected from model metadata
  debugLogging?: boolean;
  device?: GPUDevice; // Pass the app's WebGPU device to avoid mismatch
  precisionConfig?: PrecisionConfig;  // 精度配置支持
};

export class ONNXGenerator {
  private io!: OnnxGpuIO;
  private inited = false;

  constructor(private cfg: ONNXGeneratorConfig) {}

  async initialize(device?: GPUDevice) {
    const targetDevice = device || this.cfg.device;
    if (!targetDevice) {
      throw new Error('WebGPU device is required. Pass device to initialize() or provide it in config.');
    }
    
    this.io = new OnnxGpuIO();
    await this.io.init({ 
      modelUrl: this.cfg.modelUrl, 
      maxPoints: this.cfg.maxPoints,
      device: targetDevice,
      verbose: false, //this.cfg.debugLogging
      precisionConfig: this.cfg.precisionConfig
    });
    this.inited = true;
  }

  // 仅在需要时调用；通常初始化时 run 一次后全程复用显存数据
  async generate(inputData: { cameraMatrix?: Float32Array, projectionMatrix?: Float32Array, time?: number } = {}) {
    if (!this.inited) throw new Error('ONNXGenerator not initialized');
    await this.io.runInference(inputData);
  }

  // 提供渲染阶段取用 GPUBuffer 的方法
  getGaussianBuffer(): GPUBuffer { return this.io.gaussBuf; }
  getSHBuffer(): GPUBuffer { return this.io.shBuf; }
  getCountBuffer(): GPUBuffer { return this.io.countBuf; }
  getDevice(): GPUDevice { return this.io.device; }
  getInputNames(): readonly string[] { return this.io.inputNames || []; }

  // 获取检测到的模型参数
  getDetectedCapacity(): number { return this.io.detectedCapacity; }
  getDetectedColorMode(): 'sh' | 'rgb' { return this.io.detectedColorMode; }
  getDetectedColorDim(): number { return this.io.detectedColorDim; }
  getActualMaxPoints(): number { return this.io.maxPoints; }

  // 精度信息
  getGaussianPrecision(): PrecisionMetadata { return (this.io as any).gaussianPrecisionInfo ?? (this.io as any).gaussianPrecision; }
  getColorPrecision(): PrecisionMetadata { return (this.io as any).colorPrecisionInfo ?? (this.io as any).colorPrecision; }

  dispose() { this.io?.destroy(); }
}
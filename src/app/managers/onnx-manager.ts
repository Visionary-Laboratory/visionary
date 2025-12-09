// src/app/managers/onnx-manager.ts
import { ONNXGenerator } from '../../ONNX/onnx_generator';
import { DynamicPointCloud } from '../../point_cloud/dynamic_point_cloud';
import { mat4 } from 'gl-matrix';
import { ModelManager } from './model-manager';
import { ModelEntry } from '../../models/model-entry';
import * as ort from 'onnxruntime-web/webgpu';

import type { PrecisionConfig } from '../../ONNX/precision-types';

export type ONNXLoadOptions = {
  staticInference?: boolean;
  maxPoints?: number;
  debugLogging?: boolean;
  precisionConfig?: PrecisionConfig;  // 精度配置支持
};

export class ONNXManager {
  private generators: Map<string, ONNXGenerator> = new Map();
  private pointClouds: Map<string, DynamicPointCloud> = new Map();
  
  constructor(private modelManager: ModelManager) {}


  async loadONNXModel(
    device: GPUDevice,
    modelPath: string,
    cameraMatrix: Float32Array,
    projectionMatrix: Float32Array,
    name?: string,
    options: ONNXLoadOptions = {}
  ): Promise<ModelEntry> {
    console.log(options)
    console.log(`Loading ONNX model from: ${modelPath}`);
    const { staticInference = true, maxPoints, debugLogging = false } = options;

    // Create NEW isolated instances for this model
    const gen = new ONNXGenerator({ 
      modelUrl: modelPath, 
      maxPoints, // undefined if not provided, will be auto-detected
      debugLogging,
      precisionConfig: options.precisionConfig
    });
    await gen.initialize(device);

    // Create initial data for the model
    const inputNames = gen.getInputNames();
    
    // For dynamic models, provide required inputs as structured data
    if (!staticInference && inputNames.length > 0) {
      const initialData = {
        cameraMatrix,
        projectionMatrix,
        time: 0.0
      };
      console.log(`Initial data for dynamic model - inputs: ${inputNames.join(', ')}`);
      await gen.generate(initialData);
    } else {
      // For static models, no inputs needed
      await gen.generate({});
      console.log(staticInference,inputNames.length,inputNames)
      console.log("Static model - ran single inference with no inputs");
    }

    // Get actual point count from the generator if available
    const actualPoints = (gen as any).io?.actualPoints || maxPoints || 0;
    
    // Get color mode information from the ONNX generator FIRST
    const colorMode = (gen as any).io?.detectedColorMode || 'sh';
    const colorChannels = (gen as any).io?.detectedColorDim || 48;
    const colorOutputName = (gen as any).io?.detectedColorOutputName || null;

    // Create NEW isolated DynamicPointCloud for this model
    const dpc = new DynamicPointCloud(
      device,
      gen.getGaussianBuffer(), // gaussianBuffer
      gen.getSHBuffer(),       // shBuffer  
      maxPoints || gen.getActualMaxPoints(), // maxPoints (use detected if not provided)
      gen.getCountBuffer(),    // countBuffer (旁路句柄，仅保存引用)
      colorChannels,                // colorChannels for dynamic SH degree calculation
      {
        gaussian: gen.getGaussianPrecision?.(),
        color: gen.getColorPrecision?.()
      }
    );

    // Generate unique name and register with ModelManager
    const detected = (gen as any).io?.detectedPrecisionLabel || 'float16';
    const modelName = name || `ONNX Model (${detected})`;
    const uniqueName = this.modelManager.generateUniqueName(modelName);
    
    if (debugLogging) {
      console.log(`ONNX Color Detection Results:`);
      console.log(`  Color Mode: ${colorMode}`);
      console.log(`  Color Channels: ${colorChannels}`);
      console.log(`  Color Output Name: ${colorOutputName || 'default'}`);
      console.log(`  Actual Points: ${actualPoints}`);
      console.log(`  Max Points: ${maxPoints}`);
    }
    
    // CRITICAL: Wire up generator for dynamic mode
    if (!staticInference) {
      dpc.setOnnxGenerator(gen);
      if (debugLogging) console.log('🎬 Dynamic mode enabled - will update per frame');
    }
    
    // Add to model manager and return ModelEntry
    const entry = this.modelManager.addModel({
      name: uniqueName,
      visible: true,
      pointCloud: dpc,
      pointCount: actualPoints,
      isDynamic: !staticInference,
      modelType: 'onnx',
      colorMode,
      colorChannels
    });
    
    // Store the isolated instances for proper resource management
    this.generators.set(entry.id, gen);
    this.pointClouds.set(entry.id, dpc);
    
    if (debugLogging) console.log(`ONNX Model '${uniqueName}' (ID: ${entry.id}) registered with isolated resources - color mode: ${colorMode} (${colorChannels} channels)`);

    return entry;
  }

  async loadONNXFromFile(
    device: GPUDevice,
    file: File,
    cameraMatrix?: Float32Array | null,
    projectionMatrix?: Float32Array | null
  ): Promise<ModelEntry> {
    // Create URL from file
    const modelPath = URL.createObjectURL(file);
    
    try {
      // Use default matrices if not provided
      const defaultCameraMatrix = new Float32Array(16);
      const defaultProjectionMatrix = new Float32Array(16);
      
      // Set camera at (0, 0, -5) looking at origin
      const eye: [number, number, number] = [0, 0, 5];
      const center: [number, number, number] = [0, 0, 0];
      const up: [number, number, number] = [0, 1, 0];
      mat4.lookAt(defaultCameraMatrix, eye, center, up);
      
      // Create proper perspective projection
      mat4.perspective(defaultProjectionMatrix, Math.PI / 4, 16/9, 0.01, 1000);
      
      return await this.loadONNXModel(
        device,
        modelPath,
        cameraMatrix || defaultCameraMatrix,
        projectionMatrix || defaultProjectionMatrix,
        file.name.replace('.onnx', ''),
        { staticInference: true, maxPoints: 4000000, debugLogging: true }
      );
    } finally {
      // Clean up the object URL
      URL.revokeObjectURL(modelPath);
    }
  }

  async updateCameraMatrices(
    modelName: string,
    _cameraMatrix: Float32Array,
    _projectionMatrix: Float32Array
  ): Promise<void> {
    // For now, this is a placeholder - the current ONNX implementation runs inference once
    // In dynamic mode, this would re-run inference with updated camera matrices
    console.log(`Updating camera matrices for model: ${modelName}`);
    // TODO: Implement camera matrix updates for dynamic ONNX models
  }

  /**
   * Dispose a specific ONNX model by ID
   */
  disposeModel(modelId: string): void {
    const gen = this.generators.get(modelId);
    const dpc = this.pointClouds.get(modelId);
    
    gen?.dispose();
    dpc?.dispose?.();
    
    this.generators.delete(modelId);
    this.pointClouds.delete(modelId);
    
    console.log(`ONNXManager: Disposed model ${modelId}`);
  }

  /**
   * Dispose all ONNX resources
   */
  dispose(): void {
    // Dispose all generators and point clouds
    for (const [id, gen] of this.generators.entries()) {
      gen?.dispose();
      console.log(`ONNXManager: Disposed generator ${id}`);
    }
    
    for (const [id, dpc] of this.pointClouds.entries()) {
      dpc?.dispose?.();
      console.log(`ONNXManager: Disposed point cloud ${id}`);
    }
    
    // Clear the maps
    this.generators.clear();
    this.pointClouds.clear();
    
    console.log('ONNXManager: All resources disposed');
  }
  
  /**
   * Get generator for a specific model (for debugging/advanced use)
   */
  getGenerator(modelId: string): ONNXGenerator | undefined {
    return this.generators.get(modelId);
  }
  
  /**
   * Get point cloud for a specific model (for debugging/advanced use)
   */
  getPointCloud(modelId: string): DynamicPointCloud | undefined {
    return this.pointClouds.get(modelId);
  }

  /**
   * Check if there are any ONNX models loaded
   */
  hasONNXModels(): boolean {
    return this.generators.size > 0;
  }

  /**
   * Get list of all loaded ONNX models
   */
  getONNXModels(): string[] {
    return Array.from(this.generators.keys());
  }

  /**
   * Get performance stats for ONNX models
   */
  getONNXPerformanceStats(): { modelCount: number; totalGenerators: number; totalPointClouds: number } {
    return {
      modelCount: this.generators.size,
      totalGenerators: this.generators.size,
      totalPointClouds: this.pointClouds.size
    };
  }
}
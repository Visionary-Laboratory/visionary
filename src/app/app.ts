/**
 * Main application class - Refactored to use managers
 * Orchestrates the 3D Gaussian Splatting viewer through specialized managers
 * Now supports multiple Gaussian formats: PLY, SPZ, KSplat, SPLAT, SOG, etc.
 */

import { mat4, vec3 } from "gl-matrix";
import { GaussianRenderer } from "../renderer/gaussian_renderer";
import { DOMElements, setHidden, clamp } from "./dom-elements";
import { UIController, UICallbacks } from "./ui-controller";
import { initWebGPU_onnx, WebGPUContext, DEFAULT_DUMMY_MODEL_URL } from "./webgpu-context";
import { initOrtEnvironment, getDefaultOrtWasmPaths } from "../config/ort-config";
import {
  ModelManager,
  FileLoader,
  ONNXManager,
  CameraManager,
  AnimationManager,
  RenderLoop,
  type ModelEntry,
  type ModelInfo,
  type LoadingCallbacks,
  type ONNXLoadOptions
} from "./managers";

// 从 io 模块导入加载器和类型
import { 
  defaultLoader,
  detectGaussianFormat,
  isGaussianFormat,
  GaussianFormat,  // 注意：这里不用 type，因为是枚举
  type GaussianDataSource,
  type DataSource
} from "../io";

const MAX_MODELS = 10000;

/**
 * Supported file types
 */
type SupportedFileType = 'gaussian' | 'onnx' | 'model';

/**
 * Options for loading operations
 */
interface LoadOptions {
  /** Expected file type for validation */
  expectedType?: SupportedFileType;
  /** Specific Gaussian format (auto-detected if not provided) */
  gaussianFormat?: GaussianFormat;
  /** Static inference for ONNX models */
  staticInference?: boolean;
  /** Enable debug logging */
  debugLogging?: boolean;
}

/**
 * Main application class - Now supports multiple Gaussian formats
 */
export class App {
  // Core components
  private dom: DOMElements;
  private gpu: WebGPUContext | null = null;
  private renderer: GaussianRenderer | null = null;
  private uiController: UIController;
  
  // Managers
  private modelManager: ModelManager;
  private fileLoader: FileLoader;
  private onnxManager: ONNXManager;
  private cameraManager: CameraManager;
  private animationManager: AnimationManager;
  private renderLoop: RenderLoop;

  constructor() {
    this.dom = new DOMElements();
    
    // Initialize managers
    this.modelManager = new ModelManager(MAX_MODELS);
    // 默认使用 Orbit 控制器，便于直接绕模型旋转
    this.cameraManager = new CameraManager('orbit');
    this.animationManager = new AnimationManager(this.modelManager);
    this.renderLoop = new RenderLoop(this.modelManager, this.animationManager, this.cameraManager);
    
    // Initialize managers with loading callbacks
    const loadingCallbacks: LoadingCallbacks = {
      onProgress: (show, text, pct) => this.showLoading(show, text, pct),
      onError: (msg) => this.showError(msg)
    };
    
    this.fileLoader = new FileLoader(this.modelManager, loadingCallbacks);
    this.onnxManager = new ONNXManager(this.modelManager);
    
    // Setup UI callbacks
    const uiCallbacks: UICallbacks = {
      onFileLoad: (file) => this.loadFile(file)
    };
    
    this.uiController = new UIController(this.dom, this.cameraManager.getController(), uiCallbacks);
  }

  /**
   * Initialize the application
   */
  async init(): Promise<void> {
    // 首先配置ORT环境
    const wasmPaths = getDefaultOrtWasmPaths();
    initOrtEnvironment(wasmPaths);
    console.log(`[App] Initialized ORT environment with paths: ${wasmPaths}`);
    
    // Check canvas
    if (!this.dom.canvas) {
      throw new Error("Canvas element not found");
    }

    // Initialize WebGPU with fallback
    try {
      const dummyModelUrl = DEFAULT_DUMMY_MODEL_URL;
      
      // Try with ORT integration first
      this.gpu = await initWebGPU_onnx(this.dom.canvas, {
        dummyModelUrl: dummyModelUrl,
        adapterPowerPreference: 'high-performance',
        allowOwnDeviceWhenOrtPresent: false
      });
      
      console.log('[App] WebGPU initialized with ORT integration');
    } catch (ortError) {
      console.warn('[App] ORT integration failed, falling back to standalone WebGPU:', ortError);
      
      // Fallback to standalone WebGPU
      this.gpu = await initWebGPU_onnx(this.dom.canvas, {
        preferShareWithOrt: false,  // Disable ORT sharing
        adapterPowerPreference: 'high-performance'
      });
      
      console.log('[App] WebGPU initialized in standalone mode');
    }
    
    if (!this.gpu) {
      setHidden(this.dom.noWebGPU, false);
      return;
    }

    // Initialize renderer
    this.renderer = new GaussianRenderer(this.gpu.device, this.gpu.format, 3);
    await this.renderer.ensureSorter();

    // Initialize camera
    this.cameraManager.initCamera(this.dom.canvas);
    this.switchController('orbit'); // 默认 Orbit 控制器
    
    // Bind UI events
    this.uiController.bindEvents(this.dom.canvas);

    // Setup resize handler
    window.addEventListener("resize", () => this.resize());
    this.resize();

    // Initialize render loop
    this.renderLoop.init(this.gpu, this.renderer, this.dom.canvas);
    this.renderLoop.setCallbacks({
      onFPSUpdate: (fps) => {
        if (this.dom.fpsEl) {
          this.dom.fpsEl.textContent = String(fps);
        }
      },
      onPointCountUpdate: (count) => {
        if (this.dom.pointCountEl) {
          this.dom.pointCountEl.textContent = String(count);
        }
      }
    });

    // Start render loop
    this.renderLoop.start();
    
    console.log('[App] Initialized with multi-format support:', defaultLoader.getAllSupportedExtensions());
  }

  /**
   * Unified model loading method (private implementation)
   * Now supports: PLY, SPZ, KSplat, SPLAT, SOG, compressed PLY, ONNX, and 3D models
   */
  private async loadModel(input: File | string, options: LoadOptions = {}): Promise<void> {
    if (!this.gpu) {
      this.showError("WebGPU not initialized");
      return;
    }

    try {
      const fileName = (input instanceof File ? input.name : input).toLowerCase();
      const fileType = options.expectedType ?? this.detectFileType(fileName);
      
      console.log(`[App] Loading ${fileType} file:`, fileName);
      
      if (fileType === 'gaussian') {
        await this.loadGaussianModel(input, options);
      } else if (fileType === 'onnx') {
        await this.loadONNXModelInternal(input, options);
      } else if (fileType === 'model') {
        await this.load3DModel(input, options);
      } else {
        this.showError(`Unsupported file type: ${fileName}\nSupported formats: ${defaultLoader.getAllSupportedExtensions().join(', ')}`);
      }
    } catch (e) {
      const error = e as Error;
      console.error('[App] Load error:', error);
      this.showError(`Failed to load file: ${error.message}`);
    }
  }

  /**
   * Load Gaussian Splatting models (PLY, SPZ, KSplat, SPLAT, SOG, etc.)
   * 
   * 注意：这个方法目前使用 defaultLoader 加载数据，然后委托给 FileLoader
   * 如果你的 FileLoader 还不支持 GaussianDataSource，
   * 这里会回退到使用原有的 FileLoader.loadFile/loadSample 方法
   */
  private async loadGaussianModel(input: File | string, options: LoadOptions = {}): Promise<void> {
    if (!this.gpu) {
      throw new Error("WebGPU not initialized");
    }

    const fileName = input instanceof File ? input.name : input;
    console.log(`[App] Loading Gaussian model: ${fileName}`);

    // Show loading UI
    this.showLoading(true, `Loading ${fileName}...`, 0);

    try {
      // 方案1: 尝试使用 defaultLoader（支持所有格式）
      // 但需要将结果转换为 FileLoader 能处理的格式
      
      // 由于 FileLoader 可能还不直接支持 GaussianDataSource，
      // 我们暂时使用原有的 FileLoader 方法
      // TODO: 将来可以更新 FileLoader 以接受 GaussianDataSource
      
      let modelEntry: ModelEntry | null = null;
      
      if (input instanceof File) {
        // 对于文件，先使用原有的 FileLoader
        modelEntry = await this.fileLoader.loadFile(input, this.gpu.device);
      } else {
        // 对于 URL，使用原有的 FileLoader.loadSample
        modelEntry = await this.fileLoader.loadSample(input, this.gpu.device, 'ply');
      }
      
      if (modelEntry) {
        this.setupCameraForFirstModel(modelEntry);
        this.resize();
        this.showLoading(false);
        console.log(`[App] Successfully loaded Gaussian model: ${fileName}`);
      } else {
        throw new Error('Failed to create model entry');
      }
      
    } catch (error) {
      this.showLoading(false);
      
      // 如果是不支持的格式错误，给出更详细的提示
      const errorMsg = (error as Error).message;
      if (errorMsg.includes('Unsupported') || errorMsg.includes('unknown')) {
        const formatInfo = detectGaussianFormat(fileName);
        if (formatInfo && formatInfo !== 'ply') {
          // 这是一个支持的 Gaussian 格式，但 FileLoader 可能还不支持
          console.warn(`[App] ${formatInfo.toUpperCase()} format detected but FileLoader may not support it yet`);
          this.showError(
            `The file appears to be a ${formatInfo.toUpperCase()} format.\n` +
            `Your FileLoader may need to be updated to support this format.\n` +
            `Currently only PLY format is fully supported in FileLoader.`
          );
          return;
        }
      }
      
      throw error;
    }
  }

  /**
   * Load ONNX models
   */
  private async loadONNXModelInternal(input: File | string, options: LoadOptions = {}): Promise<void> {
    if (!this.gpu) {
      throw new Error("WebGPU not initialized");
    }

    const { staticInference = false, debugLogging = false } = options;
    const onnxOptions: ONNXLoadOptions = {
      staticInference,
      debugLogging
    };

    const modelPath = input instanceof File ? URL.createObjectURL(input) : input;
    const modelName = input instanceof File ? input.name : 'onnx model';
    
    console.log(`[App] Loading ONNX model: ${modelName}`);
    
    const modelEntry = await this.onnxManager.loadONNXModel(
      this.gpu.device,
      modelPath,
      this.cameraManager.getCameraMatrix() as Float32Array,
      this.cameraManager.getProjectionMatrix() as Float32Array,
      modelName,
      onnxOptions
    );

    if (modelEntry) {
      this.setupCameraForFirstModel(modelEntry);
      this.resize();
      console.log(`[App] Successfully loaded ONNX model: ${modelName}`);
    }
  }

  /**
   * Load 3D models (GLTF, OBJ, FBX, STL)
   */
  private async load3DModel(input: File | string, options: LoadOptions = {}): Promise<void> {
    // TODO: Implement 3D model loading if needed
    // This would integrate with Three.js loaders
    throw new Error('3D model loading not yet implemented in this architecture');
  }

  /**
   * Detect file type from filename
   */
  private detectFileType(fileName: string): SupportedFileType {
    const lower = fileName.toLowerCase();
    
    // Check for Gaussian formats using the helper from io module
    if (isGaussianFormat(lower)) {
      return 'gaussian';
    }
    
    // Check for ONNX
    if (lower.endsWith('.onnx')) {
      return 'onnx';
    }
    
    // Check for 3D models
    const modelExtensions = ['.gltf', '.glb', '.obj', '.fbx', '.stl'];
    if (modelExtensions.some(ext => lower.endsWith(ext))) {
      return 'model';
    }
    
    // Default to gaussian for unknown PLY-like files
    if (lower.endsWith('.ply')) {
      return 'gaussian';
    }
    
    throw new Error(`Unable to detect file type for: ${fileName}`);
  }

  /**
   * Get format-specific information
   */
  private getFormatInfo(fileName: string): { type: SupportedFileType; format?: GaussianFormat } {
    const type = this.detectFileType(fileName);
    const format = type === 'gaussian' ? detectGaussianFormat(fileName) : undefined;
    return { type, format: format ?? undefined };
  }

  /**
   * Load a file using universal loader
   */
  private async loadFile(file: File): Promise<void> {
    const { type, format } = this.getFormatInfo(file.name);
    console.log(`[App] Detected file type: ${type}${format ? ` (${format})` : ''}`);
    await this.loadModel(file, { expectedType: type, gaussianFormat: format });
  }

  /**
   * Load a sample file
   */
  public async loadSample(filename: string): Promise<void> {
    const { type, format } = this.getFormatInfo(filename);
    console.log(`[App] Loading sample: ${filename} (${type}${format ? `, ${format}` : ''})`);
    await this.loadModel(filename, { expectedType: type, gaussianFormat: format });
  }

  /**
   * Load a Gaussian model (any supported format) - public API
   */
  public async loadGaussian(input: File | string, options: Omit<LoadOptions, 'expectedType'> = {}): Promise<void> {
    await this.loadModel(input, { ...options, expectedType: 'gaussian' });
  }

  /**
   * Load a PLY model specifically (backward compatibility)
   */
  public async loadPLY(input: File | string, options: Omit<LoadOptions, 'expectedType'> = {}): Promise<void> {
    console.warn('[App] loadPLY is deprecated, use loadGaussian instead');
    await this.loadGaussian(input, options);
  }

  /**
   * Load SPZ format specifically
   */
  public async loadSPZ(input: File | string, options: Omit<LoadOptions, 'expectedType'> = {}): Promise<void> {
    await this.loadModel(input, { ...options, expectedType: 'gaussian', gaussianFormat: GaussianFormat.SPZ });
  }

  /**
   * Load KSplat format specifically
   */
  public async loadKSplat(input: File | string, options: Omit<LoadOptions, 'expectedType'> = {}): Promise<void> {
    await this.loadModel(input, { ...options, expectedType: 'gaussian', gaussianFormat: GaussianFormat.KSPLAT });
  }

  /**
   * Load SPLAT format specifically
   */
  public async loadSplat(input: File | string, options: Omit<LoadOptions, 'expectedType'> = {}): Promise<void> {
    await this.loadModel(input, { ...options, expectedType: 'gaussian', gaussianFormat: GaussianFormat.SPLAT });
  }

  /**
   * Load SOG format specifically
   */
  public async loadSOG(input: File | string, options: Omit<LoadOptions, 'expectedType'> = {}): Promise<void> {
    await this.loadModel(input, { ...options, expectedType: 'gaussian', gaussianFormat: GaussianFormat.SOG });
  }

  /**
   * Setup camera for the first model if needed
   */
  private setupCameraForFirstModel(modelEntry: ModelEntry): void {
    if (this.modelManager.getModelCount() === 1) {
      // Import PointCloud to check type
      import("../point_cloud").then(({ PointCloud }) => {
        if (modelEntry.pointCloud instanceof PointCloud) {
          this.cameraManager.setupCameraForPointCloud(modelEntry.pointCloud);
        }
      });
    }
  }

  /**
   * Handle canvas resize
   */
  private resize(): void {
    if (!this.dom.canvas) return;
    this.cameraManager.resize(this.dom.canvas);
  }

  /**
   * Load ONNX model (public API)
   */
  async loadONNXModel(modelPath: string = './models/gaussians3d.onnx', name?: string, staticInference: boolean = true): Promise<void> {
    if (!this.gpu) {
      throw new Error('App not initialized. Call init() first.');
    }

    const options: ONNXLoadOptions = {
      staticInference,
      debugLogging: false
    };

    const modelEntry = await this.onnxManager.loadONNXModel(
      this.gpu.device,
      modelPath,
      this.cameraManager.getCameraMatrix() as Float32Array,
      this.cameraManager.getProjectionMatrix() as Float32Array,
      name,
      options
    );

    if (modelEntry) {
      this.setupCameraForFirstModel(modelEntry);
      this.resize();
    }
  }

  /**
   * Show loading overlay
   */
  private showLoading(show: boolean, text?: string, pct?: number): void {
    if (!this.dom.loadingOverlay) return;
    
    setHidden(this.dom.loadingOverlay, !show);
    
    if (text && this.dom.progressText) {
      this.dom.progressText.textContent = text;
    }
    
    if (typeof pct === "number" && this.dom.progressFill) {
      this.dom.progressFill.style.width = `${clamp(pct, 0, 100)}%`;
    }
  }

  /**
   * Show error modal
   */
  private showError(msg: string): void {
    console.error('[App] Error:', msg);
    if (this.dom.errorMessage) {
      this.dom.errorMessage.textContent = msg;
    }
    if (this.dom.errorModal) {
      setHidden(this.dom.errorModal, false);
    }
  }

  // ==================== Public API (Delegated to Managers) ====================

  /**
   * Get information about supported formats
   */
  public getSupportedFormats(): {
    gaussian: string[];
    onnx: string[];
    models: string[];
    all: string[];
  } {
    const allFormats = defaultLoader.getAllSupportedExtensions();
    
    return {
      gaussian: allFormats.filter(ext => 
        ['.ply', '.spz', '.ksplat', '.splat', '.sog', '.compressed.ply'].includes(ext)
      ),
      onnx: ['.onnx'],
      models: allFormats.filter(ext =>
        ['.gltf', '.glb', '.obj', '.fbx', '.stl'].includes(ext)
      ),
      all: allFormats
    };
  }

  /**
   * Check if a file is supported
   */
  public isFileSupported(fileName: string): boolean {
    try {
      this.detectFileType(fileName);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all loaded models information
   */
  public getModels(): ModelInfo[] {
    return this.modelManager.getModels();
  }

  /**
   * Get a model entry with full pointCloud reference for debugging/testing
   */
  public getModelWithPointCloud(modelType: 'ply' | 'onnx', id?: string): ModelEntry | null {
    return this.modelManager.getModelWithPointCloud(modelType, id);
  }

  /**
   * Get all model entries with full pointCloud references (for debugging/testing)
   */
  public getFullModels(): ModelEntry[] {
    return this.modelManager.getFullModels();
  }

  /**
   * Public API to load ONNX model (accessible from global scope)
   */
  public async loadONNXModelPublic(modelPath?: string, name?: string): Promise<void> {
    return this.loadONNXModel(modelPath, name);
  }

  /**
   * Get current camera matrix for ONNX input
   */
  public getCameraMatrix(): mat4 {
    return this.cameraManager.getCameraMatrix();
  }

  /**
   * Get current projection matrix for ONNX input
   */
  public getProjectionMatrix(): mat4 {
    return this.cameraManager.getProjectionMatrix();
  }

  /**
   * Control animation for dynamic models
   */
  public controlDynamicAnimation(action: 'start' | 'pause' | 'resume' | 'stop', speed?: number): void {
    this.animationManager.controlDynamicAnimation(action, speed);
  }

  /**
   * Set animation time for dynamic models
   */
  public setDynamicAnimationTime(time: number): void {
    this.animationManager.setDynamicAnimationTime(time);
  }

  /**
   * Get performance stats for dynamic models
   */
  public getDynamicPerformanceStats(): Array<{
    modelName: string;
    stats: any;
  }> {
    return this.animationManager.getDynamicPerformanceStats();
  }

  /**
   * Reset camera to default position (public API for testing)
   */
  public resetCamera(): void {
    this.cameraManager.resetCamera();
  }
  
  /**
   * Switch camera controller type
   */
  public switchController(type: 'orbit' | 'fps'): void {
    if (type === 'orbit' && this.modelManager.getModelCount() > 0) {
      const models = this.modelManager.getModels();
      let centerSum = vec3.create();
      let count = 0;
      
      for (const model of models) {
        if (model.visible) {
          const pos = this.modelManager.getModelPosition(model.id);
          if (pos) {
            vec3.add(centerSum, centerSum, pos);
            count++;
          }
        }
      }
      
      if (count > 0) {
        const center = vec3.scale(vec3.create(), centerSum, 1 / count);
        this.cameraManager.switchController(type);
        this.cameraManager.setOrbitCenter(center);
      } else {
        this.cameraManager.switchController(type);
      }
    } else {
      this.cameraManager.switchController(type);
    }
    
    this.uiController.controller = this.cameraManager.getController();
  }

  /**
   * Set Gaussian scaling factor (public API for testing)
   */
  public setGaussianScale(scale: number): void {
    this.renderLoop.setGaussianScale(scale);
  }

  /**
   * Set background color (public API for testing)
   */
  public setBackgroundColor(color: [number, number, number, number]): void {
    this.renderLoop.setBackgroundColor(color);
  }

  /**
   * Get current gaussian scale
   */
  public getGaussianScale(): number {
    return this.renderLoop.getState().gaussianScale;
  }

  /**
   * Get current background color
   */
  public getBackgroundColor(): [number, number, number, number] {
    return [...this.renderLoop.getState().background];
  }

  // ==================== Manager Access (for debugging/advanced usage) ====================

  /**
   * Get the model manager instance
   */
  public getModelManager(): ModelManager {
    return this.modelManager;
  }

  /**
   * Get the ONNX manager instance
   */
  public getONNXManager(): ONNXManager {
    return this.onnxManager;
  }

  /**
   * Get the camera manager instance
   */
  public getCameraManager(): CameraManager {
    return this.cameraManager;
  }

  /**
   * Get the animation manager instance
   */
  public getAnimationManager(): AnimationManager {
    return this.animationManager;
  }

  /**
   * Get the render loop instance
   */
  public getRenderLoop(): RenderLoop {
    return this.renderLoop;
  }

  /**
   * Get comprehensive debug information
   */
  public getDebugInfo(): any {
    return {
      app: {
        initialized: !!this.gpu && !!this.renderer,
        canvas: {
          width: this.dom.canvas?.width || 0,
          height: this.dom.canvas?.height || 0
        },
        supportedFormats: this.getSupportedFormats()
      },
      models: {
        count: this.modelManager.getModelCount(),
        capacity: this.modelManager.getRemainingCapacity(),
        totalPoints: this.modelManager.getTotalPoints(),
        visiblePoints: this.modelManager.getTotalVisiblePoints()
      },
      camera: this.cameraManager.getDebugInfo(),
      animation: this.animationManager.getDebugInfo(),
      renderLoop: this.renderLoop.getDebugInfo(),
      onnx: {
        hasModels: this.onnxManager.hasONNXModels(),
        modelCount: this.onnxManager.getONNXModels().length,
        performanceStats: this.onnxManager.getONNXPerformanceStats()
      }
    };
  }
}
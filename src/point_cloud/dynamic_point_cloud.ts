// Dynamic point cloud supporting real-time updates from ONNX generators
import { mat4 } from 'gl-matrix';
import { PointCloud } from './point_cloud';
import { GenericGaussianPointCloudTS } from "../utils";
import { TimelineController, TimeUpdateMode } from '../timeline';

/**
 * Dynamic point cloud that can update its data in real-time
 * Extends the base PointCloud class with direct GPU buffer support
 */
export class DynamicPointCloud extends PointCloud {
  private _countBuf?: GPUBuffer;
  private onnxGenerator?: any; // Reference to ONNXGenerator for dynamic updates
  private timeline: TimelineController; // Timeline controller for time management
  private gaussianPrecision?: any;
  private colorPrecision?: any;
  private is_loop: boolean = true;
  // Color mode information for renderer
  public readonly colorMode: 'sh' | 'rgb';
  public readonly colorChannels: number;
  
  constructor(
    device: GPUDevice,
    gaussianBuffer: GPUBuffer,
    shBuffer: GPUBuffer,
    maxPoints: number,
    countBuffer?: GPUBuffer,
    colorChannels: number = 48,  // Default to SH with 48 channels
    precisionInfo?: { gaussian: any; color: any }
  ) {
    // Calculate SH degree from color channels
    // SH degree mapping: degree 0 = 3 channels, degree 1 = 12, degree 2 = 27, degree 3 = 48
    let shDegree: number;
    switch (colorChannels) {
      case 3:  shDegree = 0; break;  // RGB direct color or degree 0 SH  
      case 12: shDegree = 1; break;  // Degree 1 SH
      case 27: shDegree = 2; break;  // Degree 2 SH  
      case 48: shDegree = 3; break;  // Degree 3 SH (default)
      default: 
        console.warn(`⚠️ Unexpected color channels: ${colorChannels}, Maybe rgb channels`);
        shDegree = 3;
    }

    console.log(`🎨 DynamicPointCloud: ${colorChannels} channels → SH degree ${shDegree}`);

    // Create a minimal point cloud source to satisfy parent constructor
    const dummyPC = {
      numPoints: () => maxPoints,
      shDegree: () => shDegree,
      bbox: () => ({ min: [-1, -1, -1], max: [1, 1, 1] }),
      center: [0, 0, 0] as [number, number, number],
      up: null,
      gaussianBuffer: () => new ArrayBuffer(0), // Will be overridden
      shCoefsBuffer: () => new ArrayBuffer(0), // Will be overridden
    };
    
    // Use the enhanced PointCloud constructor with external GPU buffers
    super(device, dummyPC as GenericGaussianPointCloudTS, { 
      gaussianBuffer, 
      shBuffer 
    });
    
    // Store color information for renderer (AFTER super() call)
    this.colorChannels = colorChannels;
    this.colorMode = (colorChannels === 4) ? 'rgb' : 'sh';
    
    console.log(`🎨 Color mode set: ${this.colorMode} (${this.colorChannels} channels)`);
    
    this._countBuf = countBuffer; // Store count buffer reference
    this.gaussianPrecision = precisionInfo?.gaussian;
    this.colorPrecision = precisionInfo?.color;
    
    // Initialize timeline controller
    this.timeline = new TimelineController({
      timeScale: 1.0,
      timeOffset: 0.0,
      timeUpdateMode: 'fixed_delta',
      animationSpeed: 1.0
    });
    
    console.log('🌟 DynamicPointCloud created with direct GPU buffers (no CPU upload)');
  }
  
  countBuffer(): GPUBuffer | undefined {
    return this._countBuf;
  }

  /**
   * Set ONNX generator for dynamic updates
   */
  setOnnxGenerator(generator: any): void {
    this.onnxGenerator = generator;
    console.log('🔗 ONNX generator linked for dynamic updates');
  }

  getGaussianPrecision(): any | undefined { return this.gaussianPrecision; }
  getColorPrecision(): any | undefined { return this.colorPrecision; }

  /**
   * Inject precision metadata into ModelParams uniform buffer so shader can adapt
   */
  setPrecisionForShader(): void {
    const bytes = this.modelParamsUniforms.data; // CPU-side copy
    const dv = new DataView(bytes);
    const mapType = (t: any): number => {
      switch (t) {
        case 'float32': return 0;
        case 'float16': return 1;
        case 'int8': return 2;
        case 'uint8': return 3;
        default: return 1;
      }
    };
    if (this.gaussianPrecision) {
      dv.setUint32(96, mapType(this.gaussianPrecision.dataType), true);
      if (typeof this.gaussianPrecision.scale === 'number') dv.setFloat32(104, this.gaussianPrecision.scale, true);
      if (typeof this.gaussianPrecision.zeroPoint === 'number') dv.setFloat32(108, this.gaussianPrecision.zeroPoint, true);
    }
    if (this.colorPrecision) {
      dv.setUint32(100, mapType(this.colorPrecision.dataType), true);
      if (typeof this.colorPrecision.scale === 'number') dv.setFloat32(112, this.colorPrecision.scale, true);
      if (typeof this.colorPrecision.zeroPoint === 'number') dv.setFloat32(116, this.colorPrecision.zeroPoint, true);
    }
    this.modelParamsUniforms.dataBytes = bytes;
  }

  /**
   * Mark precision as FP16 in model params and replace buffers (used by runtime conversion)
   */
  public applyFP16(device: GPUDevice, newGauss: GPUBuffer, newColor: GPUBuffer): void {
    this.replaceStorageBuffers(device, { gaussianBuffer: newGauss, shBuffer: newColor });
    this.gaussianPrecision = { dataType: 'float16', bytesPerElement: 2 } as any;
    this.colorPrecision = { dataType: 'float16', bytesPerElement: 2 } as any;
    this.setPrecisionForShader();
    // Ensure uniforms are flushed by caller during next dispatch
  }

  /**
   * Update method called by AnimationManager for dynamic inference
   * @param cameraMatrix - Camera view matrix
   * @param modelTransform - Model transform matrix (from GaussianModel/Object3D)
   * @param time - Optional time parameter for animation
   * @param projectionMatrix - Optional projection matrix
   * @param rafNow - Optional current time for variable delta mode
   */
  async update(
    cameraMatrix: mat4, 
    modelTransform: Float32Array,
    time?: number, 
    projectionMatrix?: mat4,
    rafNow?: number
  ): Promise<void> {
    if (!this.onnxGenerator) {
      console.warn('⚠️ No ONNX generator available for dynamic update');
      return;
    }
    
    // Use timeline controller to calculate adjusted time
    var adjustedFrameTime = 0.0;
    
    adjustedFrameTime = this.timeline.getCurrentTime();
    
    adjustedFrameTime = adjustedFrameTime * 0.4 % 1.0
    // Check if in fallback preview mode
    if (this.timeline.isFallbackPreviewMode()) {
      adjustedFrameTime = time ?? 0;
      adjustedFrameTime = adjustedFrameTime * 0.4 
      adjustedFrameTime = adjustedFrameTime % 1.0
    }
    // console.log(adjustedFrameTime)
    try {
      // Get model's expected input names
      const inputNames = this.onnxGenerator.getInputNames();
      // console.log('🔍 Model expects inputs:', inputNames);
      
      // Prepare input data for GPU buffer pipeline
      // Combine the object's model transform with the camera's view matrix
      const combinedMatrix = mat4.create();
      mat4.multiply(combinedMatrix, cameraMatrix, modelTransform as any);
      

      if(this.is_loop)
      {
        adjustedFrameTime = adjustedFrameTime % 1.0;
      }else
      {
        adjustedFrameTime = Math.max(0.0, Math.min(adjustedFrameTime, 1.0));
      }

      const inputData = {
        cameraMatrix: new Float32Array(combinedMatrix), // Use combined view*model matrix
        projectionMatrix: projectionMatrix ? new Float32Array(projectionMatrix) : undefined,
        time: adjustedFrameTime // Cycle 0-1 with time scaling and offset applied
      };
      
      // console.log(`🔄 Dynamic update: t=${inputData.time.toFixed(3)}, inputs=${inputNames.join(', ')}`);
      
      // Run inference - writes DIRECTLY to GPU buffers with full GPU pipeline!
      // const startTime = performance.now();
      await this.onnxGenerator.generate(inputData);
      
      // const inferenceTime = performance.now() - startTime;
      // console.log(`⚡ Dynamic inference completed: ${inferenceTime.toFixed(2)}ms`);
      
    } catch (error) {
      console.error('❌ Dynamic update failed:', error);
      // Don't throw - let rendering continue with previous frame data
    }
  }

  /**
   * Animation control methods - delegate to timeline controller
   */
  startAnimation(speed: number = 1.0): void {
    this.timeline.startAnimation(speed);
  }

  pauseAnimation(): void {
    this.timeline.pauseAnimation();
  }

  resumeAnimation(): void {
    this.timeline.resumeAnimation();
  }

  stopAnimation(): void {
    this.timeline.stopAnimation();
  }

  setAnimationTime(time: number): void {
    this.timeline.setAnimationTime(time);
  }

  setAnimationSpeed(speed: number): void {
    this.timeline.setAnimationSpeed(speed);
  }

  getAnimationSpeed(): number {
    return this.timeline.getAnimationSpeed();
  }

  get isAnimationRunning(): boolean {
    return this.timeline.isPlaying();
  }

  get isAnimationPaused(): boolean {
    return this.timeline.isPaused();
  }

  get isAnimationStopped(): boolean {
    return this.timeline.isStopped();
  }

  /**
   * Time control methods - delegate to timeline controller
   */
  
  /**
   * Set time scaling factor
   * @param scale - Time scaling factor (1.0 = normal speed, 2.0 = 2x faster, 0.5 = 2x slower)
   */
  public setTimeScale(scale: number): void {
    this.timeline.setTimeScale(scale);
  }
  
  /**
   * Get current time scaling factor
   * @returns Current time scale value
   */
  public getTimeScale(): number {
    return this.timeline.getTimeScale();
  }

  /**
   * Set time offset
   * @param offset - Time offset in seconds
   */
  public setTimeOffset(offset: number): void {
    this.timeline.setTimeOffset(offset);
  }
  
  public setAnimationIsLoop(Is_loop: boolean): void {
    this.is_loop = Is_loop;
  }
  

  /**
   * Get current time offset
   * @returns Current time offset value
   */
  public getTimeOffset(): number {
    return this.timeline.getTimeOffset();
  }

  /**
   * Get current frame time (before offset adjustment)
   * @returns Current frame time
   */
  public getFrameTime(): number {
    return this.timeline.getCurrentTime();
  }

  /**
   * Reset frame time to zero
   */
  public resetFrameTime(): void {
    this.timeline.setTime(0);
  }

  /**
   * Set time update mode
   * @param mode - Time update mode (FIXED_DELTA or VARIABLE_DELTA)
   */
  public setTimeUpdateMode(mode: TimeUpdateMode): void {
    this.timeline.setTimeUpdateMode(mode as 'fixed_delta' | 'variable_delta');
  }
  
  /**
   * Get current time update mode
   * @returns Current time update mode
   */
  public getTimeUpdateMode(): TimeUpdateMode {
    const mode = this.timeline.getTimeUpdateMode();
    return mode === 'fixed_delta' ? TimeUpdateMode.FIXED_DELTA : TimeUpdateMode.VARIABLE_DELTA;
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(): any {
    const timelineStats = this.timeline.getStats();
    return {
      ...timelineStats,
      hasOnnxGenerator: !!this.onnxGenerator,
      colorMode: this.colorMode,
      colorChannels: this.colorChannels,
      numPoints: this.numPoints
    };
  }

  /**
   * Dispose of dynamic point cloud resources
   */
  dispose(): void {
    // Clear timeline event listeners
    this.timeline.clearEventListeners();
    
    // Note: GPU buffers are managed externally
    console.log('🧹 DynamicPointCloud disposed');
  }
}
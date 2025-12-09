/**
 * Render Loop Manager
 * Handles the main render loop, FPS tracking, and frame timing coordination
 */

import { GaussianRenderer } from "../../renderer/gaussian_renderer";
import { PointCloud } from "../../point_cloud";
import { WebGPUContext } from "../webgpu-context";
import { ModelManager } from "./model-manager";
import { AnimationManager } from "./animation-manager";
import { CameraManager } from "./camera-manager";

export interface AppState {
  background: [number, number, number, number];
  gaussianScale: number;
  animationId: number;
  lastTime: number;
  frames: number;
  fpsAccumStart: number;
}

export interface FPSCallbacks {
  onFPSUpdate?: (fps: number) => void;
  onPointCountUpdate?: (count: number) => void;
}

export class RenderLoop {
  private modelManager: ModelManager;
  private animationManager: AnimationManager;
  private cameraManager: CameraManager;
  private renderer: GaussianRenderer | null = null;
  private gpu: WebGPUContext | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private startTime: number = performance.now();
  // Render state
  private state: AppState = {
    background: [0, 0, 0, 1],
    gaussianScale: 1.0,
    animationId: 0,
    lastTime: performance.now(),
    frames: 0,
    fpsAccumStart: performance.now()
  };
  
  // Callbacks
  private callbacks: FPSCallbacks = {};
  private isRunning: boolean = false;

  constructor(
    modelManager: ModelManager,
    animationManager: AnimationManager,
    cameraManager: CameraManager
  ) {
    this.modelManager = modelManager;
    this.animationManager = animationManager;
    this.cameraManager = cameraManager;
  }

  /**
   * Initialize the render loop with GPU context and renderer
   */
  init(gpu: WebGPUContext, renderer: GaussianRenderer, canvas: HTMLCanvasElement): void {
    this.gpu = gpu;
    this.renderer = renderer;
    this.canvas = canvas;
    
    console.log('🎬 RenderLoop initialized');
  }

  /**
   * Start the render loop
   */
  start(): void {
    if (this.isRunning) {
      console.warn('RenderLoop already running');
      return;
    }
    
    this.isRunning = true;
    this.state.lastTime = performance.now();
    this.state.fpsAccumStart = performance.now();
    this.state.frames = 0;
    
    this.state.animationId = requestAnimationFrame(() => this.frame());
    console.log('RenderLoop started');
  }

  /**
   * Stop the render loop
   */
  stop(): void {
    if (!this.isRunning) {
      console.warn('RenderLoop not running');
      return;
    }
    
    this.isRunning = false;
    if (this.state.animationId) {
      cancelAnimationFrame(this.state.animationId);
      this.state.animationId = 0;
    }
    
    console.log('RenderLoop stopped');
  }

  /**
   * Main render loop frame
   */
  private async frame(): Promise<void> {
    if (!this.isRunning) return;

    // not ready, return
    if (!this.gpu || !this.renderer || !this.cameraManager.isInitialized()) {
      this.state.animationId = requestAnimationFrame(() => this.frame());
      return;
    }

    // Calculate delta time
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.state.lastTime) / 1000);
    this.state.lastTime = now;

    const elapsed = now - this.startTime;
    
    // Update camera
    this.cameraManager.update(dt);

    // Update dynamic point clouds (with debug logging for first few frames)
    // if (this.state.frames < 5) {
    //   const dynamicCount = this.animationManager.getActiveDynamicModelCount();
    //   if (dynamicCount > 0)
    //   console.log(`🎬 Frame ${this.state.frames}: Updating ${dynamicCount} dynamic models`);
    // }
    // const t0 = performance.now();

    // console.log(elapsed /500.0)
    
    // console.log('------')
    // console.log(this.cameraManager.getCameraPosition())
    await this.animationManager.updateDynamicPointClouds(
      this.cameraManager.getCameraMatrix(),
      this.cameraManager.getProjectionMatrix(),
      elapsed /500.0
    );

    // const ms2 = performance.now() - t0;
    // console.log(`==============updateDynamicPointClouds before sumbit 一次耗时：${ms2.toFixed(2)} ms`);
    // await this.gpu.device?.queue?.onSubmittedWorkDone?.();

    // const ms = performance.now() - t0;
    // console.log(`==============updateDynamicPointClouds 一次耗时：${ms.toFixed(2)} ms`);

  


    // Update FPS counter
    this.updateFPS(now);

    // Render frame
    this.renderFrame();

    // Continue loop
    if (this.isRunning) {
      this.state.animationId = requestAnimationFrame(() => this.frame());
    }
  }

  /**
   * Render a single frame
   */
  private renderFrame(): void {
    if (!this.gpu || !this.renderer || !this.canvas) return;
    
    const camera = this.cameraManager.getCamera();
    if (!camera) return;
    
    const visibleModels = this.modelManager.getVisibleModels();
    if (visibleModels.length === 0) return;

    const encoder = this.gpu.device.createCommandEncoder({ label: "frame" });
    const colorView = this.gpu.context.getCurrentTexture().createView();


    // core render part
    const pcs = visibleModels.map(m => m.pointCloud as PointCloud);
    this.renderer.prepareMulti(encoder, this.gpu.device.queue, pcs, {
      camera: camera,
      viewport: [this.canvas.width, this.canvas.height],
      gaussianScaling: this.state.gaussianScale,
    } as any);

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: colorView,
        clearValue: {
          r: this.state.background[0],
          g: this.state.background[1],
          b: this.state.background[2],
          a: this.state.background[3]
        },
        loadOp: "clear",
        storeOp: "store",
      }],
    });



    this.renderer.renderMulti(pass, pcs);
    pass.end();
  

    this.gpu.device.queue.submit([encoder.finish()]);
  }

  /**
   * Update FPS counter and point count
   */
  private updateFPS(now: number): void {
    this.state.frames++;
    
    if (now - this.state.fpsAccumStart >= 1000) {
      const fps = Math.round((this.state.frames * 1000) / (now - this.state.fpsAccumStart));
      
      // Notify callbacks
      if (this.callbacks.onFPSUpdate) {
        this.callbacks.onFPSUpdate(fps);
      }
      
      // Update points display periodically as well
      this.updatePointStats();
      
      this.state.frames = 0;
      this.state.fpsAccumStart = now;
    }
  }

  /**
   * Update point count display
   */
  private updatePointStats(): void {
    const total = this.modelManager.getTotalVisiblePoints();
    
    if (this.callbacks.onPointCountUpdate) {
      this.callbacks.onPointCountUpdate(total);
    }
  }

  /**
   * Set render state
   */
  setBackgroundColor(color: [number, number, number, number]): void {
    this.state.background = [...color];
  }

  /**
   * Set Gaussian scaling factor
   */
  setGaussianScale(scale: number): void {
    this.state.gaussianScale = scale;
  }

  /**
   * Get render state
   */
  getState(): Readonly<AppState> {
    return { ...this.state };
  }

  /**
   * Set FPS and point count callbacks
   */
  setCallbacks(callbacks: FPSCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Force render of current frame (without animation loop)
   */
  renderOnce(): void {
    if (this.isRunning) {
      console.warn('Cannot render once while render loop is running');
      return;
    }
     console.warn('⚠️ Cannot render once while render loop is running');
    this.renderFrame();
  }

  /**
   * Check if render loop is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get current FPS (approximate)
   */
  getCurrentFPS(): number {
    const now = performance.now();
    const elapsed = now - this.state.fpsAccumStart;
    
    if (elapsed === 0) return 0;
    return Math.round((this.state.frames * 1000) / elapsed);
  }

  /**
   * Get frame count since start
   */
  getFrameCount(): number {
    return this.state.frames;
  }

  /**
   * Reset FPS counter
   */
  resetFPSCounter(): void {
    this.state.frames = 0;
    this.state.fpsAccumStart = performance.now();
  }

  /**
   * Get performance info
   */
  getPerformanceInfo(): {
    fps: number;
    frameCount: number;
    elapsedTime: number;
    averageFrameTime: number;
    isRunning: boolean;
  } {
    const now = performance.now();
    const elapsed = now - this.state.fpsAccumStart;
    const fps = this.getCurrentFPS();
    const avgFrameTime = this.state.frames > 0 ? elapsed / this.state.frames : 0;

    return {
      fps,
      frameCount: this.state.frames,
      elapsedTime: elapsed,
      averageFrameTime: avgFrameTime,
      isRunning: this.isRunning
    };
  }

  /**
   * Get render debug info
   */
  getDebugInfo(): any {
    const performance = this.getPerformanceInfo();
    const visibleModels = this.modelManager.getVisibleModels();
    
    return {
      performance,
      state: this.getState(),
      models: {
        total: this.modelManager.getModelCount(),
        visible: visibleModels.length,
        dynamic: this.animationManager.getActiveDynamicModelCount(),
        totalPoints: this.modelManager.getTotalVisiblePoints()
      },
      renderer: {
        initialized: !!this.renderer,
        // @kangan 此接口无人实现，打包错误
        globalSorting: false // this.renderer?.isGlobalSortingEnabled() || false
      },
      gpu: {
        initialized: !!this.gpu,
        device: !!this.gpu?.device
      }
    };
  }
}
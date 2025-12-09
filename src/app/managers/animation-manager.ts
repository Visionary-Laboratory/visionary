/**
 * Animation Manager
 * Handles dynamic model updates, animation control, and performance tracking
 */

import { mat4 } from "gl-matrix";
import { DynamicPointCloud } from "../../point_cloud";
import { ModelManager } from "./model-manager";
import { ModelEntry } from "../../models/model-entry";

export interface AnimationStats {
  updateCount: number;
  averageUpdateTime: number;
  lastUpdateTime: number;
  totalDynamicModels: number;
  activeDynamicModels: number;
}

export class AnimationManager {
  private modelManager: ModelManager;
  
  // Update tracking
  private lastUpdateTime: number = 0;
  private minUpdateInterval: number = 16; // ~60 FPS max
  private forceNextUpdate: boolean = false;
  
  // Performance metrics
  private updateCount: number = 0;
  private totalUpdateTime: number = 0;
  private debugLogging: boolean = false;

  constructor(modelManager: ModelManager) {
    this.modelManager = modelManager;
  }

    /**
     * Update all dynamic point clouds with current camera and time
     */
  // 在 AnimationManager 里加一个字段
  private _frameUpdating = false;

  updateDynamicPointClouds(
    cameraMatrix: mat4,
    projectionMatrix: mat4,
    time: number
  ): Promise<void> {
    // 防重入：上一帧还在跑，直接跳过这一帧
    // if (this._frameUpdating) {
    //   if (this.debugLogging) console.warn('⏳ Skip frame: previous update still running');
    //   return Promise.resolve();
    // }
    this._frameUpdating = true;
    // console.log('updateDynamicPointClouds');
    const dynamicModels = this.modelManager.getDynamicModels().filter(m => m.visible);
    if (dynamicModels.length === 0) { this._frameUpdating = false; return Promise.resolve(); }

    const start = performance.now();

    const runModelUpdate = (model: ModelEntry): Promise<void> => {
      if (!(model.pointCloud instanceof DynamicPointCloud)) {
        return Promise.resolve();
      }
      const dynamicPC = model.pointCloud;

      // 获取模型的变换矩阵
      const modelTransform = dynamicPC.transform || new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ]);

      return dynamicPC.update(cameraMatrix, modelTransform, time, projectionMatrix)
        .catch(err => {
          console.warn(`⚠️ Failed to update dynamic model '${model.name}':`, err);
          // 标记为暂不动态，避免连续报错
          // model.isDynamic = false;
          // setTimeout(() => {
          //   model.isDynamic = true;
          //   console.log(`🔄 Re-enabled dynamic updates for '${model.name}'`);
          // }, 50000);
        });
    };

    const updateChain = dynamicModels.reduce<Promise<void>>(
      (chain, model) => chain.then(() => runModelUpdate(model)),
      Promise.resolve()
    );

    return updateChain
      .then(() => {
        // 统计信息
        this.lastUpdateTime = performance.now();
        this.updateCount++;
        const dt = this.lastUpdateTime - start;
        this.totalUpdateTime += dt;

        if (this.debugLogging && (this.updateCount % 60 === 0)) {
          const avg = this.totalUpdateTime / this.updateCount;
          console.log(`📊 Animation update #${this.updateCount}: ${dynamicModels.length} models, avg: ${avg.toFixed(2)}ms`);
        }
      })
      .finally(() => {
        this._frameUpdating = false;
      });
  }





  /**
   * Control animation for all dynamic models
   */
  controlDynamicAnimation(action: 'start' | 'pause' | 'resume' | 'stop', speed?: number): void {
    const dynamicModels = this.modelManager.getDynamicModels();
    let actionCount = 0;
    
    dynamicModels.forEach(model => {
      if (!(model.pointCloud instanceof DynamicPointCloud)) return;
      const dynamicPC = model.pointCloud;
      
      switch (action) {
        case 'start':
          dynamicPC.startAnimation(speed || 1.0);
          actionCount++;
          break;
        case 'pause':
          dynamicPC.pauseAnimation();
          actionCount++;
          break;
        case 'resume':
          dynamicPC.resumeAnimation();
          actionCount++;
          break;
        case 'stop':
          dynamicPC.stopAnimation();
          actionCount++;
          break;
      }
    });

    const speedText = speed ? ` at ${speed}x speed` : '';
    console.log(`🎬 Animation ${action}${speedText} for ${actionCount} dynamic models`);
  }

  /**
   * Set animation time for all dynamic models
   */
  setDynamicAnimationTime(time: number): void {
    const dynamicModels = this.modelManager.getDynamicModels();
    let updateCount = 0;
    
    dynamicModels.forEach(model => {
      if (!(model.pointCloud instanceof DynamicPointCloud)) return;
      const dynamicPC = model.pointCloud;
      dynamicPC.setAnimationTime(time);
      updateCount++;
    });

    console.log(`⏰ Set animation time to ${time.toFixed(3)} for ${updateCount} dynamic models`);
  }

  /**
   * Get performance statistics for all dynamic models
   */
  getDynamicPerformanceStats(): Array<{
    modelName: string;
    stats: ReturnType<DynamicPointCloud['getPerformanceStats']>;
  }> {
    return this.modelManager.getDynamicModels()
      .filter(model => model.pointCloud instanceof DynamicPointCloud)
      .map(model => ({
        modelName: model.name,
        stats: (model.pointCloud as DynamicPointCloud).getPerformanceStats()
      }));
  }

  /**
   * Get overall animation statistics
   */
  getAnimationStats(): AnimationStats {
    const dynamicModels = this.modelManager.getDynamicModels();
    const activeDynamicModels = dynamicModels.filter(m => m.visible);

    return {
      updateCount: this.updateCount,
      averageUpdateTime: this.updateCount > 0 ? this.totalUpdateTime / this.updateCount : 0,
      lastUpdateTime: this.lastUpdateTime,
      totalDynamicModels: dynamicModels.length,
      activeDynamicModels: activeDynamicModels.length
    };
  }

  /**
   * Reset performance statistics
   */
  resetPerformanceStats(): void {
    this.updateCount = 0;
    this.totalUpdateTime = 0;
    this.lastUpdateTime = 0;
    console.log('📊 Animation performance stats reset');
  }

  /**
   * Force next update regardless of interval
   */
  forceUpdate(): void {
    this.forceNextUpdate = true;
  }

  /**
   * Set minimum update interval (in milliseconds)
   */
  setUpdateInterval(intervalMs: number): void {
    this.minUpdateInterval = Math.max(1, intervalMs);
    console.log(`⏱️ Animation update interval set to ${this.minUpdateInterval}ms`);
  }

  /**
   * Get minimum update interval
   */
  getUpdateInterval(): number {
    return this.minUpdateInterval;
  }

  /**
   * Enable/disable debug logging
   */
  setDebugLogging(enabled: boolean): void {
    this.debugLogging = enabled;
    console.log(`🐛 Animation debug logging ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if updates are needed (throttling)
   */
  shouldUpdate(): boolean {
    if (this.forceNextUpdate) {
      return true;
    }

    const now = performance.now();
    return (now - this.lastUpdateTime) >= this.minUpdateInterval;
  }

  /**
   * Get all dynamic models (convenience method)
   */
  getDynamicModels(): ModelEntry[] {
    return this.modelManager.getDynamicModels();
  }

  /**
   * Check if any dynamic models are active
   */
  hasDynamicModels(): boolean {
    return this.getDynamicModels().length > 0;
  }

  /**
   * Get count of active dynamic models
   */
  getActiveDynamicModelCount(): number {
    return this.modelManager.getDynamicModels().filter(m => m.visible).length;
  }

  /**
   * Pause all animations
   */
  pauseAll(): void {
    this.controlDynamicAnimation('pause');
  }

  /**
   * Resume all animations
   */
  resumeAll(): void {
    this.controlDynamicAnimation('resume');
  }

  /**
   * Stop all animations
   */
  stopAll(): void {
    this.controlDynamicAnimation('stop');
  }

  /**
   * Start all animations
   */
  startAll(speed: number = 1.0): void {
    this.controlDynamicAnimation('start', speed);
  }

  /**
   * Get animation debug info
   */
  getDebugInfo(): any {
    const stats = this.getAnimationStats();
    const performanceStats = this.getDynamicPerformanceStats();
    
    return {
      stats,
      performanceStats,
      settings: {
        minUpdateInterval: this.minUpdateInterval,
        debugLogging: this.debugLogging,
        forceNextUpdate: this.forceNextUpdate
      },
      dynamicModels: this.getDynamicModels().map(m => ({
        name: m.name,
        visible: m.visible,
        pointCount: m.pointCount,
        isAnimating: m.pointCloud instanceof DynamicPointCloud ? 
          m.pointCloud.isAnimationRunning : false
      }))
    };
  }
}
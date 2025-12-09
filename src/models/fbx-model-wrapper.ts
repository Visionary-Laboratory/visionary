/**
 * FBX Model Wrapper
 * 包装 Three.js FBX 模型和动画混合器，实现 ITimelineTarget 接口
 */

import * as THREE from "three/webgpu";
import { ITimelineTarget } from "../timeline/types";

export interface FBXLoadOptions {
  /** 是否自动播放第一个动画 */
  autoPlay?: boolean;
  /** 默认播放速度 */
  defaultSpeed?: number;
  /** 是否循环播放 */
  loop?: boolean;
  /** 动画混合模式 */
  blendMode?: 'normal' | 'additive';
}

/**
 * FBX 模型包装器类
 * 包装 Three.js 的 Group/Object3D 和 AnimationMixer
 * 实现 ITimelineTarget 接口以支持 Timeline 控制
 */
export class FBXModelWrapper implements ITimelineTarget {
  public readonly object3D: THREE.Group;
  public readonly mixer: THREE.AnimationMixer;
  public readonly clips: THREE.AnimationClip[];
  public transform: Float32Array;
  
  private currentAction: THREE.AnimationAction | null = null;
  private isPlaying: boolean = false;
  private isPaused: boolean = false;
  private animationSpeed: number = 1.0;
  private timeScale: number = 1.0;
  private timeOffset: number = 0.0;
  private timeUpdateMode: 'fixed_delta' | 'variable_delta' = 'variable_delta';
  private lastUpdateTime: number = 0;
  private frameTime: number = 0;

  constructor(
    object3D: THREE.Group,
    clips: THREE.AnimationClip[],
    options: FBXLoadOptions = {}
  ) {
    this.object3D = object3D;
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(object3D);
    
    // 初始化变换矩阵为单位矩阵
    this.transform = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]);

    // 应用初始变换
    this.applyTransform();

    // 如果有动画剪辑，设置第一个为当前动作
    if (clips.length > 0) {
      this.currentAction = this.mixer.clipAction(clips[0]);
      this.currentAction.setLoop(THREE.LoopRepeat, options.loop ? Infinity : 1);
      
      if (options.autoPlay !== false) {
        this.startAnimation(options.defaultSpeed || 1.0);
      }
    }
  }

  /**
   * 应用变换矩阵到 Three.js 对象
   */
  private applyTransform(): void {
    const matrix = new THREE.Matrix4();
    matrix.fromArray(this.transform);
    this.object3D.matrix.copy(matrix);
    this.object3D.matrixAutoUpdate = false;
  }

  /**
   * 设置变换矩阵
   */
  setTransform(transform: Float32Array | number[]): void {
    this.transform = new Float32Array(transform);
    this.applyTransform();
  }

  /**
   * 获取顶点数量（估算）
   */
  getVertexCount(): number {
    let count = 0;
    this.object3D.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geometry = child.geometry;
        if (geometry.attributes.position) {
          count += geometry.attributes.position.count;
        }
      }
    });
    return count;
  }

  /**
   * 设置可见性
   */
  setVisible(visible: boolean): void {
    this.object3D.visible = visible;
  }

  /**
   * 获取可见性
   */
  getVisible(): boolean {
    return this.object3D.visible;
  }

  // ITimelineTarget 接口实现

  /**
   * 设置动画时间
   */
  setAnimationTime(time: number): void {
    if (this.currentAction) {
      this.currentAction.time = time;
      this.mixer.update(0); // 立即应用时间变化
    }
    this.frameTime = time;
  }

  /**
   * 设置动画速度
   */
  setAnimationSpeed(speed: number): void {
    this.animationSpeed = speed;
    if (this.currentAction) {
      this.currentAction.timeScale = speed * this.timeScale;
    }
  }

  /**
   * 获取动画速度
   */
  getAnimationSpeed(): number {
    return this.animationSpeed;
  }

  /**
   * 开始动画
   */
  startAnimation(speed?: number): void {
    if (speed !== undefined) {
      this.setAnimationSpeed(speed);
    }
    
    if (this.currentAction) {
      this.currentAction.reset();
      this.currentAction.play();
      this.isPlaying = true;
      this.isPaused = false;
    }
  }

  /**
   * 暂停动画
   */
  pauseAnimation(): void {
    if (this.currentAction) {
      this.currentAction.paused = true;
      this.isPaused = true;
    }
  }

  /**
   * 恢复动画
   */
  resumeAnimation(): void {
    if (this.currentAction) {
      this.currentAction.paused = false;
      this.isPaused = false;
    }
  }

  /**
   * 停止动画
   */
  stopAnimation(): void {
    if (this.currentAction) {
      this.currentAction.stop();
      this.isPlaying = false;
      this.isPaused = false;
    }
  }

  /**
   * 设置时间缩放
   */
  setTimeScale(scale: number): void {
    this.timeScale = scale;
    if (this.currentAction) {
      this.currentAction.timeScale = this.animationSpeed * scale;
    }
  }

  /**
   * 获取时间缩放
   */
  getTimeScale(): number {
    return this.timeScale;
  }

  /**
   * 设置时间偏移
   */
  setTimeOffset(offset: number): void {
    this.timeOffset = offset;
  }

  /**
   * 获取时间偏移
   */
  getTimeOffset(): number {
    return this.timeOffset;
  }

  /**
   * 设置时间更新模式
   */
  setTimeUpdateMode(mode: 'fixed_delta' | 'variable_delta'): void {
    this.timeUpdateMode = mode;
  }

  /**
   * 获取时间更新模式
   */
  getTimeUpdateMode(): 'fixed_delta' | 'variable_delta' {
    return this.timeUpdateMode;
  }

  /**
   * 获取当前时间
   */
  getCurrentTime(): number {
    return this.currentAction ? this.currentAction.time : 0;
  }

  /**
   * 是否支持动画
   */
  supportsAnimation(): boolean {
    return this.clips.length > 0;
  }

  /**
   * 更新动画（每帧调用）
   */
  update(deltaTime: number): void {
    if (this.isPlaying && !this.isPaused) {
      // 应用时间缩放和偏移
      const adjustedDeltaTime = deltaTime * this.timeScale;
      this.mixer.update(adjustedDeltaTime);
      this.frameTime += adjustedDeltaTime;
    }
    this.lastUpdateTime = performance.now();
  }

  /**
   * 切换到指定动画剪辑
   */
  switchToClip(clipIndex: number): boolean {
    if (clipIndex >= 0 && clipIndex < this.clips.length) {
      // 停止当前动画
      if (this.currentAction) {
        this.currentAction.stop();
      }
      
      // 切换到新动画
      this.currentAction = this.mixer.clipAction(this.clips[clipIndex]);
      this.currentAction.setLoop(THREE.LoopRepeat, Infinity);
      this.currentAction.timeScale = this.animationSpeed * this.timeScale;
      
      // 如果之前正在播放，继续播放新动画
      if (this.isPlaying && !this.isPaused) {
        this.currentAction.play();
      }
      
      return true;
    }
    return false;
  }

  /**
   * 获取动画剪辑信息
   */
  getClipInfo(): Array<{name: string, duration: number}> {
    return this.clips.map(clip => ({
      name: clip.name,
      duration: clip.duration
    }));
  }

  /**
   * 销毁资源
   */
  dispose(): void {
    if (this.currentAction) {
      this.currentAction.stop();
    }
    this.mixer.stopAllAction();
    this.object3D.clear();
  }
}

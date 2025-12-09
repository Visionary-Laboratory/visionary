/**
 * 核心时间轴控制器
 * 统一管理时间轴的所有功能，包括播放控制、时间计算、状态管理等
 */

import { AnimationState } from './AnimationState';
import { TimeCalculator } from './TimeCalculator';
import { 
  TimelineConfig, 
  TimelineStats, 
  ITimelineTarget, 
  AnimationStateChangeEvent,
  TimelineEventListener 
} from './types';

/**
 * Fallback 预览模式的阈值
 * 当 frameTime < 此值时，表示处于 fallback preview 模式
 */
const FALLBACK_PREVIEW_THRESHOLD = -0.5;

/**
 * 时间轴控制器类
 * 提供统一的时间轴控制接口
 */
export class TimelineController implements ITimelineTarget {
  private animationState: AnimationState;
  private timeCalculator: TimeCalculator;
  private config: TimelineConfig;
  private frameCount: number = 0;
  private eventListeners: TimelineEventListener[] = [];

  constructor(config: Partial<TimelineConfig> = {}) {
    this.config = {
      timeScale: 1.0,
      timeOffset: 0.0,
      timeUpdateMode: 'fixed_delta',
      animationSpeed: 1.0,
      fixedDeltaTime: 0.016 * 1.10, // 约 60 FPS
      maxDeltaTime: 0.05, // 50ms
      ...config
    };

    this.animationState = new AnimationState();
    this.timeCalculator = new TimeCalculator(this.config);

    // 监听动画状态变化事件
    this.animationState.addEventListener((event) => {
      this._emitEvent(event);
    });
  }

  /**
   * 播放控制方法
   */

  /**
   * 开始播放
   * @param speed 播放速度倍数
   */
  start(speed?: number): void {
    this.animationState.play(speed);
  }

  /**
   * 暂停播放
   */
  pause(): void {
    this.animationState.pause();
  }

  /**
   * 恢复播放
   */
  resume(): void {
    this.animationState.resume();
  }

  /**
   * 停止播放
   */
  stop(): void {
    this.animationState.stop();
    this.frameCount = 0;
  }

  /**
   * 时间控制方法
   */

  /**
   * 设置当前时间
   * @param time 时间值 (秒)
   */
  setTime(time: number): void {
    this.timeCalculator.setTime(time);
    this._emitEvent({
      type: 'timeChange',
      timestamp: performance.now(),
      data: { time }
    });
  }

  /**
   * 设置播放速度
   * @param speed 播放速度倍数
   */
  setSpeed(speed: number): void {
    this.animationState.setSpeed(speed);
    this.timeCalculator.setAnimationSpeed(speed);
  }

  /**
   * 设置时间缩放
   * @param scale 时间缩放因子
   */
  setTimeScale(scale: number): void {
    this.timeCalculator.setTimeScale(scale);
    this.config.timeScale = scale;
  }

  /**
   * 设置时间偏移
   * @param offset 时间偏移量 (秒)
   */
  setTimeOffset(offset: number): void {
    this.timeCalculator.setTimeOffset(offset);
    this.config.timeOffset = offset;
  }

  /**
   * 设置时间更新模式
   * @param mode 时间更新模式
   */
  setTimeUpdateMode(mode: 'fixed_delta' | 'variable_delta'): void {
    this.timeCalculator.setTimeUpdateMode(mode);
    this.config.timeUpdateMode = mode;
  }

  /**
   * 兼容性方法 - 为了保持与现有代码的兼容性
   */

  /**
   * 开始动画 (兼容性方法)
   * @param speed 动画速度
   */
  startAnimation(speed: number = 1.0): void {
    this.start(speed);
  }

  /**
   * 暂停动画 (兼容性方法)
   */
  pauseAnimation(): void {
    this.pause();
  }

  /**
   * 恢复动画 (兼容性方法)
   */
  resumeAnimation(): void {
    this.resume();
  }

  /**
   * 停止动画 (兼容性方法)
   */
  stopAnimation(): void {
    this.stop();
  }

  /**
   * 设置动画时间 (兼容性方法)
   * @param time 动画时间
   */
  setAnimationTime(time: number): void {
    this.setTime(time);
  }

  /**
   * 设置动画速度 (兼容性方法)
   * @param speed 动画速度
   */
  setAnimationSpeed(speed: number): void {
    this.setSpeed(speed);
  }

  /**
   * 获取动画速度 (兼容性方法)
   * @returns 当前动画速度
   */
  getAnimationSpeed(): number {
    return this.animationState.getSpeed();
  }

  /**
   * 获取时间缩放 (兼容性方法)
   * @returns 当前时间缩放因子
   */
  getTimeScale(): number {
    return this.timeCalculator.getTimeScale();
  }

  /**
   * 获取时间偏移 (兼容性方法)
   * @returns 当前时间偏移量
   */
  getTimeOffset(): number {
    return this.timeCalculator.getTimeOffset();
  }

  /**
   * 获取时间更新模式 (兼容性方法)
   * @returns 当前时间更新模式
   */
  getTimeUpdateMode(): 'fixed_delta' | 'variable_delta' {
    return this.timeCalculator.getTimeUpdateMode();
  }

  /**
   * 时间计算方法
   */

  /**
   * 更新时间轴 (每帧调用)
   * @param rafNow 当前时间戳
   * @returns 调整后的当前时间
   */
  update(rafNow?: number): number {
    const result = this.timeCalculator.calculateTime(
      rafNow,
      this.animationState.isPlaying,
      this.animationState.isPaused
    );

    if (result.shouldUpdate) {
      this.frameCount++;
    }

    return result.adjustedTime;
  }

  /**
   * 获取当前时间
   * @returns 当前时间
   */
  getCurrentTime(): number {
    return this.timeCalculator.getAdjustedTime();
  }

  /**
   * 获取原始帧时间（未调整的时间）
   * @returns 原始帧时间
   */
  getFrameTime(): number {
    return this.timeCalculator.frameTime;
  }

  /**
   * 检查是否处于 fallback preview 模式
   * @returns 如果 frameTime < FALLBACK_PREVIEW_THRESHOLD，返回 true
   */
  isFallbackPreviewMode(): boolean {
    return this.timeCalculator.frameTime < FALLBACK_PREVIEW_THRESHOLD;
  }

  /**
   * 状态查询方法
   */

  /**
   * 是否正在播放
   * @returns 是否正在播放
   */
  isPlaying(): boolean {
    return this.animationState.isPlaying;
  }

  /**
   * 是否暂停
   * @returns 是否暂停
   */
  isPaused(): boolean {
    return this.animationState.isPaused;
  }

  /**
   * 是否停止
   * @returns 是否停止
   */
  isStopped(): boolean {
    return this.animationState.isStopped;
  }

  /**
   * 是否支持动画
   * @returns 总是返回 true
   */
  supportsAnimation(): boolean {
    return true;
  }

  /**
   * 获取时间轴统计信息
   * @returns 统计信息
   */
  getStats(): TimelineStats {
    const timeStats = this.timeCalculator.getStats();
    const animationState = this.animationState.getStateInfo();

    return {
      currentTime: timeStats.frameTime,
      adjustedTime: timeStats.adjustedTime,
      timeScale: timeStats.timeScale,
      timeOffset: timeStats.timeOffset,
      timeUpdateMode: timeStats.timeUpdateMode,
      animationSpeed: timeStats.animationSpeed,
      playbackState: animationState.playbackState,
      isPlaying: animationState.isPlaying,
      isPaused: animationState.isPaused,
      isStopped: animationState.isStopped,
      lastUpdateTime: timeStats.lastUpdateTime,
      frameCount: this.frameCount
    };
  }

  /**
   * 清除所有事件监听器
   */
  clearEventListeners(): void {
    this.eventListeners = [];
    this.animationState.clearEventListeners();
  }

  /**
   * 发出事件
   * @param event 事件对象
   */
  private _emitEvent(event: AnimationStateChangeEvent): void {
    this.eventListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in timeline event listener:', error);
      }
    });
  }

  /**
   * 导出常量供外部使用
   */
  static readonly FALLBACK_PREVIEW_THRESHOLD = FALLBACK_PREVIEW_THRESHOLD;
}

/**
 * 时间计算工具类
 * 封装时间计算逻辑，包括帧时间累积、时间缩放、时间偏移等
 */

import { TimeUpdateMode, TimeUpdateModeHelper } from './TimeUpdateMode';
import { TimeCalculationParams, TimeCalculationResult, TimelineConfig } from './types';

/**
 * 时间计算器类
 * 负责管理帧时间累积和时间参数的应用
 */
export class TimeCalculator {
  private _frameTime: number = -1.0;
  private _lastUpdateTime: number = 0;
  private _config: TimelineConfig;

  constructor(config: Partial<TimelineConfig> = {}) {
    this._config = {
      timeScale: 1.0,
      timeOffset: 0.0,
      timeUpdateMode: 'fixed_delta',
      animationSpeed: 1.0,
      fixedDeltaTime: TimeUpdateModeHelper.getDefaultFixedDeltaTime(),
      maxDeltaTime: TimeUpdateModeHelper.getDefaultMaxDeltaTime(),
      ...config
    };
  }

  /**
   * 获取当前帧时间
   */
  get frameTime(): number {
    return this._frameTime;
  }

  /**
   * 获取配置
   */
  get config(): Readonly<TimelineConfig> {
    return { ...this._config };
  }

  /**
   * 更新配置
   * @param newConfig 新的配置
   */
  updateConfig(newConfig: Partial<TimelineConfig>): void {
    this._config = { ...this._config, ...newConfig };
  }

  /**
   * 设置时间缩放
   * @param scale 时间缩放因子
   */
  setTimeScale(scale: number): void {
    this._config.timeScale = Math.max(0.01, scale);
    console.log(`[TimeCalculator] Time scale set to: ${this._config.timeScale}`);
  }

  /**
   * 获取时间缩放
   * @returns 当前时间缩放因子
   */
  getTimeScale(): number {
    return this._config.timeScale;
  }

  /**
   * 设置时间偏移
   * @param offset 时间偏移量 (秒)
   */
  setTimeOffset(offset: number): void {
    this._config.timeOffset = offset;
    console.log(`[TimeCalculator] Time offset set to: ${this._config.timeOffset}`);
  }

  /**
   * 获取时间偏移
   * @returns 当前时间偏移量
   */
  getTimeOffset(): number {
    return this._config.timeOffset;
  }

  /**
   * 设置时间更新模式
   * @param mode 时间更新模式
   */
  setTimeUpdateMode(mode: 'fixed_delta' | 'variable_delta'): void {
    this._config.timeUpdateMode = mode;
    if (mode === 'variable_delta') {
      this._lastUpdateTime = 0; // 重置用于可变模式
    }
    console.log(`[TimeCalculator] Time update mode set to: ${mode}`);
  }

  /**
   * 获取时间更新模式
   * @returns 当前时间更新模式
   */
  getTimeUpdateMode(): 'fixed_delta' | 'variable_delta' {
    return this._config.timeUpdateMode;
  }

  /**
   * 设置动画速度
   * @param speed 动画速度倍数
   */
  setAnimationSpeed(speed: number): void {
    this._config.animationSpeed = Math.max(0.1, speed);
    console.log(`[TimeCalculator] Animation speed set to: ${this._config.animationSpeed}`);
  }

  /**
   * 获取动画速度
   * @returns 当前动画速度
   */
  getAnimationSpeed(): number {
    return this._config.animationSpeed;
  }

  /**
   * 计算时间增量并更新帧时间
   * @param rafNow 当前时间戳 (performance.now())
   * @param isPlaying 是否正在播放
   * @param isPaused 是否暂停
   * @returns 时间计算结果
   */
  calculateTime(
    rafNow: number = performance.now(),
    isPlaying: boolean = true,
    isPaused: boolean = false
  ): TimeCalculationResult {
    let deltaTime = 0;
    let shouldUpdate = false;

    // 只有在播放且未暂停时才更新时间
    if (isPlaying && !isPaused) {
      const params: TimeCalculationParams = {
        currentTime: rafNow,
        lastUpdateTime: this._lastUpdateTime,
        timeScale: this._config.timeScale,
        animationSpeed: this._config.animationSpeed,
        timeUpdateMode: this._config.timeUpdateMode,
        fixedDeltaTime: this._config.fixedDeltaTime,
        maxDeltaTime: this._config.maxDeltaTime
      };

      // 计算时间增量
      deltaTime = TimeUpdateModeHelper.calculateDeltaTime({
        mode: this._config.timeUpdateMode as TimeUpdateMode,
        currentTime: rafNow,
        lastUpdateTime: this._lastUpdateTime,
        fixedDeltaTime: this._config.fixedDeltaTime,
        maxDeltaTime: this._config.maxDeltaTime
      });

      // 应用时间缩放和动画速度
      deltaTime *= this._config.timeScale * this._config.animationSpeed;
      
      // 更新帧时间
      this._frameTime += deltaTime;
      shouldUpdate = true;
    } else if (isPaused) {
      // 暂停时更新最后更新时间，防止恢复时时间跳跃
      if (this._config.timeUpdateMode === 'variable_delta') {
        this._lastUpdateTime = rafNow;
      }
    }

    // 更新最后更新时间
    this._lastUpdateTime = rafNow;

    // 计算调整后的时间
    const adjustedTime = this.getAdjustedTime();

    return {
      deltaTime,
      frameTime: this._frameTime,
      adjustedTime,
      shouldUpdate
    };
  }

  /**
   * 获取调整后的时间 (应用了时间偏移)
   * @returns 调整后的时间
   */
  getAdjustedTime(): number {
    return (this._frameTime - this._config.timeOffset) * this._config.timeScale ; //* this._config.animationSpeed;
  }

  /**
   * 设置当前时间
   * @param time 时间值 (秒)
   */
  setTime(time: number): void {
    this._frameTime = time;
    this._lastUpdateTime = 0; // 重置用于可变模式
    console.log(`[TimeCalculator] Time set to: ${time.toFixed(3)}s`);
  }

  /**
   * 重置时间到零
   */
  resetTime(): void {
    this._frameTime = 0;
    this._lastUpdateTime = 0;
    console.log(`[TimeCalculator] Time reset to 0`);
  }

  /**
   * 获取性能统计信息
   * @returns 统计信息
   */
  getStats(): {
    frameTime: number;
    adjustedTime: number;
    timeScale: number;
    timeOffset: number;
    timeUpdateMode: string;
    animationSpeed: number;
    lastUpdateTime: number;
  } {
    return {
      frameTime: this._frameTime,
      adjustedTime: this.getAdjustedTime(),
      timeScale: this._config.timeScale,
      timeOffset: this._config.timeOffset,
      timeUpdateMode: this._config.timeUpdateMode,
      animationSpeed: this._config.animationSpeed,
      lastUpdateTime: this._lastUpdateTime
    };
  }

  /**
   * 克隆时间计算器
   * @returns 新的时间计算器实例
   */
  clone(): TimeCalculator {
    const cloned = new TimeCalculator(this._config);
    cloned._frameTime = this._frameTime;
    cloned._lastUpdateTime = this._lastUpdateTime;
    return cloned;
  }
}

/**
 * Timeline 模块类型定义
 * 定义时间轴相关的所有接口和类型
 */

/**
 * 动画播放状态枚举
 */
export enum AnimationPlaybackState {
  STOPPED = 'stopped',
  PLAYING = 'playing',
  PAUSED = 'paused'
}

/**
 * 时间轴配置接口
 */
export interface TimelineConfig {
  /** 时间缩放因子 (1.0 = 正常速度, 2.0 = 2倍速, 0.5 = 0.5倍速) */
  timeScale: number;
  /** 时间偏移量 (秒) */
  timeOffset: number;
  /** 时间更新模式 */
  timeUpdateMode: 'fixed_delta' | 'variable_delta';
  /** 动画播放速度倍数 */
  animationSpeed: number;
  /** 固定时间步长 (仅在 fixed_delta 模式下使用) */
  fixedDeltaTime: number;
  /** 最大时间步长限制 (防止极端值) */
  maxDeltaTime: number;
}

/**
 * 时间轴统计信息
 */
export interface TimelineStats {
  /** 当前帧时间 */
  currentTime: number;
  /** 调整后的时间 (应用了缩放和偏移) */
  adjustedTime: number;
  /** 时间缩放因子 */
  timeScale: number;
  /** 时间偏移量 */
  timeOffset: number;
  /** 时间更新模式 */
  timeUpdateMode: string;
  /** 动画播放速度 */
  animationSpeed: number;
  /** 播放状态 */
  playbackState: AnimationPlaybackState;
  /** 是否正在播放 */
  isPlaying: boolean;
  /** 是否暂停 */
  isPaused: boolean;
  /** 是否停止 */
  isStopped: boolean;
  /** 最后更新时间 */
  lastUpdateTime: number;
  /** 累积帧数 */
  frameCount: number;
}

/**
 * 可被时间轴控制的对象接口
 */
export interface ITimelineTarget {
  /** 设置动画时间 */
  setAnimationTime(time: number): void;
  /** 设置动画速度 */
  setAnimationSpeed(speed: number): void;
  /** 获取动画速度 */
  getAnimationSpeed(): number;
  /** 开始动画 */
  startAnimation(speed?: number): void;
  /** 暂停动画 */
  pauseAnimation(): void;
  /** 恢复动画 */
  resumeAnimation(): void;
  /** 停止动画 */
  stopAnimation(): void;
  /** 设置时间缩放 */
  setTimeScale(scale: number): void;
  /** 获取时间缩放 */
  getTimeScale(): number;
  /** 设置时间偏移 */
  setTimeOffset(offset: number): void;
  /** 获取时间偏移 */
  getTimeOffset(): number;
  /** 设置时间更新模式 */
  setTimeUpdateMode(mode: 'fixed_delta' | 'variable_delta'): void;
  /** 获取时间更新模式 */
  getTimeUpdateMode(): 'fixed_delta' | 'variable_delta';
  /** 获取当前时间 */
  getCurrentTime(): number;
  /** 是否支持动画 */
  supportsAnimation(): boolean;
}

/**
 * 时间计算参数
 */
export interface TimeCalculationParams {
  /** 当前时间戳 (performance.now()) */
  currentTime: number;
  /** 上一帧时间戳 */
  lastUpdateTime: number;
  /** 时间缩放因子 */
  timeScale: number;
  /** 动画速度倍数 */
  animationSpeed: number;
  /** 时间更新模式 */
  timeUpdateMode: 'fixed_delta' | 'variable_delta';
  /** 固定时间步长 */
  fixedDeltaTime: number;
  /** 最大时间步长 */
  maxDeltaTime: number;
}

/**
 * 时间计算结果
 */
export interface TimeCalculationResult {
  /** 计算出的时间增量 */
  deltaTime: number;
  /** 累积的帧时间 */
  frameTime: number;
  /** 调整后的时间 (应用缩放和偏移) */
  adjustedTime: number;
  /** 是否应该更新时间 */
  shouldUpdate: boolean;
}

/**
 * 动画状态变化事件
 */
export interface AnimationStateChangeEvent {
  /** 变化类型 */
  type: 'play' | 'pause' | 'resume' | 'stop' | 'timeChange' | 'speedChange';
  /** 时间戳 */
  timestamp: number;
  /** 相关数据 */
  data?: any;
}

/**
 * 时间轴事件监听器
 */
export type TimelineEventListener = (event: AnimationStateChangeEvent) => void;

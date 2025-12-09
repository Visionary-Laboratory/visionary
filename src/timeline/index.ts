/**
 * Timeline 模块导出
 * 统一导出所有时间轴相关的公共接口
 */

// 核心控制器
export { TimelineController } from './TimelineController';

// 时间更新模式
export { TimeUpdateMode, TimeUpdateModeHelper } from './TimeUpdateMode';

// 动画状态管理
export { AnimationState } from './AnimationState';

// 时间计算器
export { TimeCalculator } from './TimeCalculator';

// 类型定义
export * from './types';

// 重新导出常用类型，方便使用
export type {
  TimelineConfig,
  TimelineStats,
  ITimelineTarget,
  AnimationPlaybackState,
  TimeCalculationParams,
  TimeCalculationResult,
  AnimationStateChangeEvent,
  TimelineEventListener
} from './types';

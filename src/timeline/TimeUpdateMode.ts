/**
 * 时间更新模式枚举和逻辑
 * 从 DynamicPointCloud 中抽离的时间更新相关功能
 */

/**
 * 时间更新模式枚举
 */
export enum TimeUpdateMode {
  /** 固定时间步长模式 */
  FIXED_DELTA = 'fixed_delta',
  /** 可变时间步长模式 */
  VARIABLE_DELTA = 'variable_delta'
}

/**
 * 时间更新模式工具类
 * 提供时间增量计算的静态方法
 */
export class TimeUpdateModeHelper {
  /**
   * 根据更新模式计算时间增量
   * @param params 时间计算参数
   * @returns 时间增量 (秒)
   */
  static calculateDeltaTime(params: {
    mode: TimeUpdateMode;
    currentTime: number;
    lastUpdateTime: number;
    fixedDeltaTime: number;
    maxDeltaTime: number;
  }): number {
    const { mode, currentTime, lastUpdateTime, fixedDeltaTime, maxDeltaTime } = params;

    switch (mode) {
      case TimeUpdateMode.FIXED_DELTA:
        // 固定时间步长模式
        return fixedDeltaTime;

      case TimeUpdateMode.VARIABLE_DELTA:
        // 可变时间步长模式
        if (lastUpdateTime === 0) {
          // 第一帧，返回 0
          return 0;
        }
        
        // 计算实际时间差
        let deltaTime = (currentTime - lastUpdateTime) / 1000; // 转换为秒
        
        // 限制时间增量范围，防止极端值
        deltaTime = Math.min(Math.max(deltaTime, 0), maxDeltaTime);
        
        return deltaTime;

      default:
        console.warn(`Unknown time update mode: ${mode}, using fixed delta`);
        return fixedDeltaTime;
    }
  }

  /**
   * 检查时间更新模式是否有效
   * @param mode 时间更新模式
   * @returns 是否有效
   */
  static isValidMode(mode: string): mode is TimeUpdateMode {
    return Object.values(TimeUpdateMode).includes(mode as TimeUpdateMode);
  }

  /**
   * 从字符串转换为 TimeUpdateMode 枚举
   * @param modeString 模式字符串
   * @returns TimeUpdateMode 枚举值
   */
  static fromString(modeString: string): TimeUpdateMode {
    if (this.isValidMode(modeString)) {
      return modeString as TimeUpdateMode;
    }
    
    console.warn(`Invalid time update mode: ${modeString}, defaulting to FIXED_DELTA`);
    return TimeUpdateMode.FIXED_DELTA;
  }

  /**
   * 获取默认的固定时间步长
   * @returns 默认固定时间步长 (秒)
   */
  static getDefaultFixedDeltaTime(): number {
    return 0.016 * 1.10; // 约 60 FPS 的固定步长
  }

  /**
   * 获取默认的最大时间步长
   * @returns 默认最大时间步长 (秒)
   */
  static getDefaultMaxDeltaTime(): number {
    return 0.05; // 50ms 最大步长
  }

  /**
   * 获取时间更新模式的描述
   * @param mode 时间更新模式
   * @returns 模式描述
   */
  static getModeDescription(mode: TimeUpdateMode): string {
    switch (mode) {
      case TimeUpdateMode.FIXED_DELTA:
        return '固定时间步长 - 每帧使用固定的时间增量，确保动画播放稳定';
      case TimeUpdateMode.VARIABLE_DELTA:
        return '可变时间步长 - 根据实际帧间隔计算时间增量，更接近真实时间';
      default:
        return '未知模式';
    }
  }
}

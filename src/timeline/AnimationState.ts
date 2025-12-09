/**
 * 动画状态管理类
 * 管理动画播放状态和相关的状态变化
 */

import { AnimationPlaybackState, AnimationStateChangeEvent, TimelineEventListener } from './types';

/**
 * 动画状态管理类
 * 负责管理动画的播放、暂停、停止等状态
 */
export class AnimationState {
  private _playbackState: AnimationPlaybackState = AnimationPlaybackState.STOPPED;
  private _animationSpeed: number = 1.0;
  private _eventListeners: TimelineEventListener[] = [];

  /**
   * 获取当前播放状态
   */
  get playbackState(): AnimationPlaybackState {
    return this._playbackState;
  }

  /**
   * 获取动画速度
   */
  get animationSpeed(): number {
    return this._animationSpeed;
  }

  /**
   * 是否正在播放
   */
  get isPlaying(): boolean {
    return this._playbackState === AnimationPlaybackState.PLAYING;
  }

  /**
   * 是否暂停
   */
  get isPaused(): boolean {
    return this._playbackState === AnimationPlaybackState.PAUSED;
  }

  /**
   * 是否停止
   */
  get isStopped(): boolean {
    return this._playbackState === AnimationPlaybackState.STOPPED;
  }

  /**
   * 开始播放动画
   * @param speed 动画速度倍数
   */
  play(speed: number = 1.0): void {
    this._animationSpeed = Math.max(0.1, speed); // 防止负值或零值
    this._playbackState = AnimationPlaybackState.PLAYING;
    this._emitEvent({
      type: 'play',
      timestamp: performance.now(),
      data: { speed: this._animationSpeed }
    });
    console.log(`🎬 Animation started at ${this._animationSpeed}x speed`);
  }

  /**
   * 暂停动画
   */
  pause(): void {
    if (this._playbackState === AnimationPlaybackState.PLAYING) {
      this._playbackState = AnimationPlaybackState.PAUSED;
      this._emitEvent({
        type: 'pause',
        timestamp: performance.now()
      });
      console.log('⏸️ Animation paused');
    } else {
      console.warn('Cannot pause: animation is not playing');
    }
  }

  /**
   * 恢复动画
   */
  resume(): void {
    if (this._playbackState === AnimationPlaybackState.PAUSED) {
      this._playbackState = AnimationPlaybackState.PLAYING;
      this._emitEvent({
        type: 'resume',
        timestamp: performance.now()
      });
      console.log('▶️ Animation resumed');
    } else {
      console.warn('Cannot resume: animation is not paused');
    }
  }

  /**
   * 停止动画
   */
  stop(): void {
    this._playbackState = AnimationPlaybackState.STOPPED;
    this._emitEvent({
      type: 'stop',
      timestamp: performance.now()
    });
    console.log('⏹️ Animation stopped');
  }

  /**
   * 设置动画速度
   * @param speed 动画速度倍数
   */
  setSpeed(speed: number): void {
    const oldSpeed = this._animationSpeed;
    this._animationSpeed = Math.max(0.1, speed);
    
    if (oldSpeed !== this._animationSpeed) {
      this._emitEvent({
        type: 'speedChange',
        timestamp: performance.now(),
        data: { 
          oldSpeed, 
          newSpeed: this._animationSpeed 
        }
      });
      console.log(`🎯 Animation speed changed from ${oldSpeed}x to ${this._animationSpeed}x`);
    }
  }

  /**
   * 获取动画速度
   * @returns 当前动画速度
   */
  getSpeed(): number {
    return this._animationSpeed;
  }

  /**
   * 重置状态到停止
   */
  reset(): void {
    this._playbackState = AnimationPlaybackState.STOPPED;
    this._animationSpeed = 1.0;
    this._emitEvent({
      type: 'stop',
      timestamp: performance.now(),
      data: { reset: true }
    });
    console.log('🔄 Animation state reset');
  }

  /**
   * 添加事件监听器
   * @param listener 事件监听器
   */
  addEventListener(listener: TimelineEventListener): void {
    this._eventListeners.push(listener);
  }

  /**
   * 移除事件监听器
   * @param listener 事件监听器
   */
  removeEventListener(listener: TimelineEventListener): void {
    const index = this._eventListeners.indexOf(listener);
    if (index > -1) {
      this._eventListeners.splice(index, 1);
    }
  }

  /**
   * 清除所有事件监听器
   */
  clearEventListeners(): void {
    this._eventListeners = [];
  }

  /**
   * 获取状态信息
   * @returns 状态信息对象
   */
  getStateInfo(): {
    playbackState: AnimationPlaybackState;
    animationSpeed: number;
    isPlaying: boolean;
    isPaused: boolean;
    isStopped: boolean;
  } {
    return {
      playbackState: this._playbackState,
      animationSpeed: this._animationSpeed,
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      isStopped: this.isStopped
    };
  }

  /**
   * 发出事件
   * @param event 事件对象
   */
  private _emitEvent(event: AnimationStateChangeEvent): void {
    this._eventListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in animation state event listener:', error);
      }
    });
  }
}

/**
 * 时间轴控制器接口
 * Core 层定义，Editor 层实现
 * 用于解耦 Core 层和 Editor 层，避免 Core 依赖 Editor 的具体实现
 */
export interface ITimelineController {
    /**
     * 获取总帧数
     */
    getTotalFrames(): number;
    
    /**
     * 获取帧率
     */
    getFrameRate(): number;
    
    /**
     * 获取当前帧索引
     */
    getCurrentIndex(): number;
    
    /**
     * 获取最后一个关键帧的索引
     * 如果没有关键帧，返回 -1
     * @returns 最后一个关键帧的索引，如果没有关键帧则返回 -1
     */
    getLastKeyframeIndex(): number;
    
    /**
     * 设置当前帧索引（会触发回调）
     * @param frameIndex 帧索引（0 到 totalFrames - 1）
     * @returns Promise，等待所有回调完成
     */
    setFrameIndex(frameIndex: number): Promise<void>;
    
    /**
     * 注册帧更新回调
     * 当 setFrameIndex 被调用时，会触发所有注册的回调
     * @param callback 回调函数，在帧索引更新时调用
     * @returns 取消注册函数
     */
    registerFrameUpdateCallback(
        callback: () => void | Promise<void>
    ): () => void;
}


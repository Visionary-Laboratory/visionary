import * as THREE from "three/webgpu";
import { RecordingCamera } from "./RecordingCamera";
import { VideoExportConfig, getFileExtension } from './video-config';
import { RecordingManager, RecordingOptions } from "./RecordingManager";
import { ITimelineController } from "./ITimelineController";
import { GaussianThreeJSRenderer } from "../app/GaussianThreeJSRenderer";

/**
 * 使用录制相机导出视频（向后兼容接口）
 * 内部使用 RecordingManager 实现
 * 
 * @param mainRenderer 主渲染器
 * @param scene Three.js 场景
 * @param recordingCamera 录制相机
 * @param duration 录制时长（秒）- 仅真实时间模式使用
 * @param fps 帧率 - 仅真实时间模式使用
 * @param gaussianRenderer 高斯渲染器（可选）
 * @param showPreview 是否显示预览（传递给 RecordingCamera）
 * @param config 视频导出配置
 * @param timelineController 时间轴控制器（可选）- 如果提供则使用时间轴模式
 * @param viewName 视窗名称（可选）- 用于文件命名，如 'left', 'right'
 */
export interface RecordingEnhancementOptions {
    captureCanvas?: HTMLCanvasElement;
    // 接收 RecordCamera.renderToCanvas 传入的 inputCanvas 参数
    frameProcessor?: (inputCanvas: HTMLCanvasElement) => Promise<void>; 
}

export async function exportVideoWithRecordingCamera(
    mainRenderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    recordingCamera: RecordingCamera,
    duration: number = 15,
    fps: number = 30,
    resolution: { width: number, height: number } = { width: 1920, height: 1080 },
    gaussianRenderer?: GaussianThreeJSRenderer,
    showPreview: boolean = true,
    config: VideoExportConfig = {},
    timelineController?: ITimelineController,
    viewName?: string,
    enhancements?: RecordingEnhancementOptions
): Promise<void> {
    console.log("🎬 [exportVideo] 初始化导出流程");
    console.log('[exportVideo] 分辨率:', resolution);
    const manager = new RecordingManager();
    
    // 决定使用哪种模式
    const mode: 'timeline' | 'realtime' = timelineController ? 'timeline' : 'realtime';
    console.log(`[exportVideo] 导出模式: ${mode}, timelineController: ${timelineController ? '存在' : '不存在'}`);
    
    // 从 gaussianRenderer 中提取 gaussianModels
    const gaussianModels = gaussianRenderer ? gaussianRenderer.getGaussianModels() : undefined;
    console.log('[exportVideo] 提取gaussianModels:', gaussianModels ? `${gaussianModels.length}个` : '无');
    if (gaussianModels && gaussianModels.length > 0) {
        gaussianModels.forEach((model, index) => {
            console.log(`[exportVideo] 模型${index}: ${model.name}, visible: ${model.visible}, pointCloud: ${model.getPointCloud() ? '有' : '无'}`);
        });
    }
    
    const options: RecordingOptions = {
        mode, // timeline | realtime
        mainRenderer,
        scene,
        recordingCamera,
        gaussianModels,  // 传递模型数组而不是整个renderer
        config,
        resolution, // 传递分辨率参数
        ...(mode === 'timeline' ? {
            timelineController: timelineController!
        } : {
            duration,
            fps
        }),
        ...(enhancements?.captureCanvas ? { captureCanvas: enhancements.captureCanvas } : {}),
        ...(enhancements?.frameProcessor ? { frameProcessor: enhancements.frameProcessor } : {}),
        enableSSAA: false, // 是否启用超分辨率
    };
    
    try {
        // 开始录制
        console.log("[exportVideo] -> startRecording()");
        await manager.startRecording(options);
        console.log("[exportVideo] -> RecordingManager 已进入录制状态");
        
        // 如果是时间轴模式，需要手动触发帧索引更新来驱动录制
        if (mode === 'timeline' && timelineController) {
            // 从第0帧开始，逐帧更新直到总帧数的最后一帧
            // 每次调用 setFrameIndex 都会触发回调，回调中会自动渲染帧
            const totalFrames = timelineController.getTotalFrames();
            const lastKeyframeIndex = timelineController.getLastKeyframeIndex();
            
            // 确定结束帧：始终录制到总帧数的最后一帧（0 到 totalFrames-1）
            const endFrame = totalFrames;
            
            console.log(`[VideoExport] 时间轴模式：总帧数=${totalFrames}, 最后一个关键帧=${lastKeyframeIndex}, 导出帧数=${endFrame} (0到${endFrame - 1})`);
            
            // ✅ 根据帧率计算每帧的时间间隔
            const frameRate = timelineController.getFrameRate();
            const frameTimeMs = 1000 / frameRate; // 每帧的毫秒数（例如 30fps = 33.3ms）
            
            // ✅ 计算等待时间：使用帧时间的 30-50%，确保帧完整渲染但不过度等待
            // 因为渲染本身需要时间，我们只需要等待一小部分来确保异步操作完成
            const waitTimeMs = Math.max(5, Math.min(20, frameTimeMs * 0.4)); // 至少 5ms，最多 20ms，或帧时间的 40%
            
            console.log(`[VideoExport] 帧率同步：帧率=${frameRate} FPS, 每帧时间=${frameTimeMs.toFixed(2)}ms, 等待时间=${waitTimeMs.toFixed(2)}ms`);
            
            for (let frameIndex = 0; frameIndex < endFrame; frameIndex++) {
                // 检查是否还在录制中（回调可能已经停止了录制）
                if (!manager.isRecordingActive()) {
                    console.log(`[VideoExport] 录制已经停止，提前终止帧循环；当前帧=${frameIndex}`);
                    break;
                }
                
                try {
                    // ✅ 等待 setFrameIndex 完成（包括所有回调）
                    // 这会触发场景更新和帧渲染
                    await timelineController.setFrameIndex(frameIndex);
                    console.log('frameIndex done', frameIndex);
                    // ✅ 根据帧率动态等待，确保场景更新和渲染回调完全完成
                    // 这对于确保帧完整性和流畅度非常重要
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (error) {
                    console.error(`时间轴模式：设置帧索引 ${frameIndex} 失败:`, error);
                    // 继续下一帧，不中断整个导出过程
                }
                
                // 再次检查（回调可能在 setFrameIndex 后立即停止了录制）
                if (!manager.isRecordingActive()) {
                    break;
                }
            }
            
            // 如果还没有停止，等待一下确保最后的帧已渲染
            // 然后检查是否还需要手动停止
            if (manager.isRecordingActive()) {
                console.log("[VideoExport] 帧循环结束，但 RecordingManager 仍在运行，等待补帧");
                const frameTime = 1000 / timelineController.getFrameRate();
                // await new Promise(resolve => setTimeout(resolve, frameTime * 2)); // 等待2帧的时间
            }
        } else if (mode === 'realtime') {
            // 真实时间模式：等待录制完成
            // realtimeLoop 会在达到 duration 时自动调用 stopRecording()
            // 我们需要等待直到录制真正完成
            const waitDuration = duration * 1000; // 转换为毫秒
            const maxWaitTime = waitDuration + 2000; // 最多等待 duration + 2秒
            const pollInterval = 100; // 每100ms检查一次
            const startWaitTime = Date.now();
            
            // 轮询等待录制完成
            console.log(`[VideoExport] 进入实时模式等待循环，duration=${duration}s`);
            while (manager.isRecordingActive() && (Date.now() - startWaitTime < maxWaitTime)) {
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
            
            // 如果超时仍在录制，记录警告但继续处理
            if (manager.isRecordingActive()) {
                console.warn('真实时间模式：等待超时，但录制仍在进行中，继续处理...');
            }
            
            // 再等待一小段时间，确保最后的帧已渲染和 MediaRecorder 已收集所有数据
            // await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // 停止录制并获取 Blob
        // 注意：真实时间模式会自动停止，时间轴模式在回调中可能已自动停止
        // 如果已经在停止中或已停止，需要处理不同的情况
        console.log("[exportVideo] 停止录制并收集 Blob");
        let blob: Blob;
        if (manager.isRecordingActive()) {
            // 如果还在录制中，手动停止
            console.log("[exportVideo] -> stopRecording()");
            blob = await manager.stopRecording();
            console.log("[exportVideo] <- stopRecording() 完成");
        } else {
            // 如果已经停止，尝试获取停止 Promise 或已完成的 blob
            const stopPromise = manager.getStopPromise();
            if (stopPromise) {
                // 如果正在停止中，等待停止完成
                console.log("[exportVideo] 等待 stopPromise 完成");
                blob = await stopPromise;
            } else {
                // 检查是否有已完成的 blob（录制已完成但 Promise 已清理）
                const completedBlob = manager.getCompletedBlob();
                if (completedBlob) {
                    console.log("[exportVideo] 使用 completedBlob");
                    blob = completedBlob;
                } else {
                    // 如果已经停止但没有 Promise 也没有已完成的 blob，说明录制异常结束
                    throw new Error('录制已停止，无法获取视频文件。可能的原因：录制过程中出现异常或已提前结束。');
                }
            }
        }
        
        // 触发下载
        console.log("[exportVideo] 开始触发下载");
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        // 根据 MIME 类型获取正确的文件扩展名
        const mimeType = blob.type || 'video/webm';
        const extension = getFileExtension(mimeType);
        const fileName = viewName 
            ? `Video-${viewName}-${timestamp}${extension}`
            : `Video-${timestamp}${extension}`;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
    } catch (error) {
        // 确保清理资源
        console.error("[exportVideo] 导出失败，准备取消录制");
        manager.cancelRecording();
        throw error;
    }
}
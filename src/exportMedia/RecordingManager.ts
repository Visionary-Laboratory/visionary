import * as THREE from "three/webgpu";
import { RecordingCamera } from "./RecordingCamera";
import { VideoExportConfig, VideoQuality } from './video-config';
import { ITimelineController } from "./ITimelineController";
import * as Mp4Muxer from 'mp4-muxer'; // 引入 mp4-muxer

export interface RecordingOptions {
    mode: 'timeline' | 'realtime';
    mainRenderer: THREE.WebGPURenderer;
    scene: THREE.Scene;
    recordingCamera: RecordingCamera;
    gaussianModels?: any[];
    config: VideoExportConfig;
    captureCanvas?: HTMLCanvasElement;
    frameProcessor?: (inputCanvas: HTMLCanvasElement) => Promise<void>;
    timelineController?: ITimelineController;
    duration?: number;
    fps?: number;
    enableSSAA?: boolean; // 是否开启超分采样 (Super Sampling Anti-Aliasing)
    resolution?: { width: number; height: number }; // 输出分辨率
}

export class RecordingManager {
    private isRecording: boolean = false;
    private muxer: Mp4Muxer.Muxer<Mp4Muxer.ArrayBufferTarget> | null = null;
    private videoEncoder: VideoEncoder | null = null;
    private recordingCamera: RecordingCamera | null = null;
    private scene: THREE.Scene | null = null;
    private captureCanvas: HTMLCanvasElement | null = null;
    private frameProcessor?: (inputCanvas: HTMLCanvasElement) => Promise<void>;
    
    // 关键：手动控制时间戳
    private currentFrameIndex: number = 0;
    private fps: number = 30;

    private useSSAA: boolean = false;
    // 存储缩放用的画布和上下文
    private downscaleCanvas: OffscreenCanvas | null = null;
    private downscaleCtx: OffscreenCanvasRenderingContext2D | null = null;

    async startRecording(options: RecordingOptions): Promise<void> {
        if (this.isRecording) throw new Error('录制已在进行中');
        
        // 1. 记录开关状态
        this.useSSAA = !!options.enableSSAA;

        this.recordingCamera = options.recordingCamera;
        this.scene = options.scene;
        this.captureCanvas = options.captureCanvas || options.recordingCamera.canvas;
        this.frameProcessor = options.frameProcessor;
        this.fps = options.mode === 'timeline' 
            ? (options.timelineController?.getFrameRate() || 30)
            : (options.fps || 30);

        // =========================================================
        // 2. 动态决定分辨率逻辑
        // =========================================================
        // 基础输出分辨率：使用传入的分辨率参数，如果没有则使用默认值 1080p
        const targetOutputWidth = options.resolution?.width || 1920;
        const targetOutputHeight = options.resolution?.height || 1080;

        let renderWidth, renderHeight;

        if (this.useSSAA) {
            // 【模式 A: 开启超采样】
            // 渲染分辨率翻倍 (4K)，输出保持 1080p
            renderWidth = targetOutputWidth * 2;  // 3840
            renderHeight = targetOutputHeight * 2; // 2160
        } else {
            // 【模式 B: 普通模式】
            // 渲染分辨率 = 输出分辨率 (1080p)
            renderWidth = targetOutputWidth;
            renderHeight = targetOutputHeight;
        }

        // 设置 Canvas 大小 (控制渲染分辨率)
        this.captureCanvas!.width = renderWidth;
        this.captureCanvas!.height = renderHeight;

        // 更新录制相机的宽高比以匹配输出分辨率
        const camera = options.recordingCamera.camera;
        camera.aspect = targetOutputWidth / targetOutputHeight;
        camera.updateProjectionMatrix();

        // 通知渲染器同步尺寸，重建深度缓冲区
        const renderer = options.mainRenderer;
        renderer.setSize(renderWidth, renderHeight, false); 

        // 初始化渲染器
        await options.recordingCamera.initializeRenderer(
            options.mainRenderer,
            options.scene,
            options.gaussianModels
        );
        
        // ✅ 关键修复：在初始化完成后，确保录制渲染器的尺寸正确设置
        // 并强制更新高斯渲染器的深度纹理，使用正确的分辨率
        if (options.recordingCamera.renderer) {
            options.recordingCamera.renderer.setSize(renderWidth, renderHeight, false);
        }
        
        // ✅ 强制更新高斯渲染器的深度纹理，使用canvas的实际像素尺寸
        // 通过调用 onResize 方法，传入 isRecording=true 来触发深度纹理更新
        if (options.recordingCamera.canvas) {
            console.log(`[RecordingManager] 强制更新深度纹理: ${options.recordingCamera.canvas.width}x${options.recordingCamera.canvas.height}`);
            // 调用 onResize 并传入 isRecording=true 和 resolution，确保使用实际像素尺寸
            options.recordingCamera.onResize(true, { width: renderWidth, height: renderHeight });
        }

        // =========================================================
        // 3. 按需初始化降采样画布
        // =========================================================
        if (this.useSSAA) {
            // 只有开启 SSAA 时才需要这个中间层
            this.downscaleCanvas = new OffscreenCanvas(targetOutputWidth, targetOutputHeight);
            this.downscaleCtx = this.downscaleCanvas.getContext('2d', {
                alpha: false,
                desynchronized: true
            }) as OffscreenCanvasRenderingContext2D;
            
            if (this.downscaleCtx) {
                this.downscaleCtx.imageSmoothingEnabled = true;
                this.downscaleCtx.imageSmoothingQuality = 'high';
            }
        } else {
            // 释放可能存在的旧引用
            this.downscaleCanvas = null;
            this.downscaleCtx = null;
        }

        // =========================================================
        // 4. Muxer 使用输出分辨率
        // =========================================================
        this.muxer = new Mp4Muxer.Muxer({
            target: new Mp4Muxer.ArrayBufferTarget(),
            video: {
                codec: 'avc',
                width: targetOutputWidth,
                height: targetOutputHeight
            },
            fastStart: 'in-memory'
        });

        
        // 初始化 Encoder
        this.videoEncoder = new VideoEncoder({
            output: (chunk, meta) => this.muxer!.addVideoChunk(chunk, meta),
            error: (e) => console.error('VideoEncoder 错误:', e)
        });

        // =========================================================
        // 5. 动态计算码率
        // =========================================================
        // 如果是 SSAA (1080p输出)，给 25Mbps 足够
        // 如果是普通 1080p，给 15Mbps 也够了，这里统一给高一点保证画质
        const bitrate = 25_000_000; 

        this.videoEncoder.configure({
            codec: 'avc1.640033',
            width: targetOutputWidth,
            height: targetOutputHeight,
            bitrate: bitrate,
            framerate: this.fps,
        });

        this.currentFrameIndex = 0;
        this.isRecording = true;
        
        console.log(`[RecordingManager] 录制开始. 
            模式: ${this.useSSAA ? `🔥 超采样开启 (${renderWidth}x${renderHeight}渲染 -> ${targetOutputWidth}x${targetOutputHeight}输出)` : `⚡ 普通模式 (${targetOutputWidth}x${targetOutputHeight}直出)`}
            渲染分辨率: ${renderWidth}x${renderHeight}
            输出分辨率: ${targetOutputWidth}x${targetOutputHeight}`);

        if (options.mode === 'timeline') {
            this.setupTimelineMode(options);
        }
    }

    private setupTimelineMode(options: RecordingOptions): void {
        if (!options.timelineController) throw new Error('TimelineController missing');
        
        options.timelineController.registerFrameUpdateCallback(async () => {
            await this.renderFrame();
        });
    }

    async renderFrame(): Promise<void> {
        const { scene, recordingCamera, videoEncoder, captureCanvas, isRecording } = this;
        if (!isRecording || !recordingCamera || !scene || !videoEncoder || !captureCanvas) return;

        try {
            // 1. 渲染 (此时分辨率取决于 startRecording 中的设定)
            const renderedRawCanvas = await recordingCamera.renderToCanvas(scene);

            // 2. 确定初始图像源
            let sourceImage: CanvasImageSource;

            if (this.frameProcessor) {
                await this.frameProcessor(renderedRawCanvas);
                sourceImage = captureCanvas;
            } else {
                sourceImage = renderedRawCanvas;
                // 可选：预览绘制 (略)
            }

            // 3. 准备 VideoFrame 的源
            let frameSource: CanvasImageSource | OffscreenCanvas;

            if (this.useSSAA && this.downscaleCtx && this.downscaleCanvas) {
                // 【路径 A: 开启 SSAA】执行缩放
                this.downscaleCtx.clearRect(0, 0, this.downscaleCanvas.width, this.downscaleCanvas.height);
                this.downscaleCtx.drawImage(
                    sourceImage, 
                    0, 0, 
                    this.downscaleCanvas.width, 
                    this.downscaleCanvas.height
                );
                frameSource = this.downscaleCanvas;
            } else {
                // 【路径 B: 普通模式】直接使用渲染结果
                // 注意：此时 sourceImage 的分辨率必须等于 Encoder 配置的 width/height
                // 在 startRecording 中我们已经保证了非 SSAA 模式下 renderWidth === targetOutputWidth
                frameSource = sourceImage;
            }

            // 4. 创建 VideoFrame
            const timestamp = (this.currentFrameIndex * 1000000) / this.fps;
            const duration = 1000000 / this.fps;

            const frame = new VideoFrame(frameSource, {
                timestamp: timestamp,
                duration: duration
            });

            // 5. 编码
            const keyFrame = this.currentFrameIndex % this.fps === 0;
            videoEncoder.encode(frame, { keyFrame });
            
            frame.close();
            this.currentFrameIndex++;

        } catch (error) {
            console.error('渲染/编码帧失败:', error);
        }
    }

    async stopRecording(): Promise<Blob> {
        if (!this.isRecording) throw new Error('未在录制');
        
        console.log('[RecordingManager] 停止录制，正在封装 MP4...');
        
        // 等待编码队列完成
        if (this.videoEncoder) {
            await this.videoEncoder.flush();
            this.videoEncoder.close();
        }

        // 完成 Muxer
        if (this.muxer) {
            this.muxer.finalize();
            const { buffer } = this.muxer.target;
            const blob = new Blob([buffer], { type: 'video/mp4' });
            
            this.isRecording = false;
            this.videoEncoder = null;
            this.muxer = null;
            
            console.log(`[RecordingManager] MP4 生成完毕: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
            return blob;
        }
        
        throw new Error('Muxer 未初始化');
    }

    // 兼容旧接口
    isRecordingActive(): boolean { return this.isRecording; }
    getStopPromise() { return null; }
    getCompletedBlob() { return null; }
    cancelRecording() { this.isRecording = false; }
}
// 视频编码格式枚举
export enum VideoCodec {
    VP9 = 'video/webm; codecs=vp9',
    VP8 = 'video/webm; codecs=vp8',
    H264 = 'video/webm; codecs=h264',
    AV1 = 'video/webm; codecs=av01',
    // MP4 格式支持（浏览器支持有限，主要用于检测）
    MP4_H264 = 'video/mp4; codecs=avc1.42E01E',
    MP4_H265 = 'video/mp4; codecs=hev1.1.6.L93.B0'
}

// 质量预设枚举
export enum VideoQuality {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    NEAR_LOSSLESS = 'near_lossless'
}

// 根据分辨率和质量预设获取比特率
export function getBitrate(width: number, height: number, quality: VideoQuality): number {
    const pixels = width * height;
    
    // 基准：1080p (1920x1080 = 2,073,600 像素)
    const base1080p = 1920 * 1080;
    const ratio = pixels / base1080p;
    
    const bitrateMap = {
        [VideoQuality.LOW]: 500_000,
        [VideoQuality.MEDIUM]: 2_000_000,
        [VideoQuality.HIGH]: 5_000_000,
        [VideoQuality.NEAR_LOSSLESS]: 20_000_000
    };
    
    return Math.round(bitrateMap[quality] * ratio);
}

// 检查编码器支持
export function getSupportedCodec(preferred: VideoCodec): string {
    // 优先使用指定的编码器
    if (MediaRecorder.isTypeSupported(preferred)) {
        return preferred;
    }
    
    // 降级策略：按优先级尝试其他编码器
    const fallbackCodecs = [
        VideoCodec.VP9,
        VideoCodec.AV1,
        VideoCodec.VP8,
        VideoCodec.H264,
        // MP4 格式（浏览器支持有限，通常不支持）
        VideoCodec.MP4_H264,
        VideoCodec.MP4_H265
    ];
    
    // 如果是 MP4 格式但不受支持，尝试 WebM 格式的相同编码器
    if (preferred === VideoCodec.MP4_H264 || preferred === VideoCodec.MP4_H265) {
        console.warn(`MP4 format not supported, falling back to WebM with H264`);
        // 尝试 WebM H264
        if (MediaRecorder.isTypeSupported(VideoCodec.H264)) {
            return VideoCodec.H264;
        }
    }
    
    // 降级到其他支持的编码器
    for (const codec of fallbackCodecs) {
        if (codec !== preferred && MediaRecorder.isTypeSupported(codec)) {
            console.warn(`Codec ${preferred} not supported, using ${codec}`);
            return codec;
        }
    }
    
    // 最后降级到默认 webm
    console.warn('No specific codec supported, using default webm');
    return 'video/webm';
}

// 质量预设配置接口
export interface VideoExportConfig {
    codec?: VideoCodec;
    quality?: VideoQuality;
    customBitrate?: number;  // 自定义比特率，覆盖质量预设
    mimeType?: string;       // 传递给 MediaRecorder 的 mimeType
    videoBitsPerSecond?: number; // 传递给 MediaRecorder 的比特率
}

/**
 * 根据 MIME 类型获取文件扩展名
 */
export function getFileExtension(mimeType: string): string {
    if (mimeType.includes('mp4')) {
        return '.mp4';
    }
    // 默认 WebM
    return '.webm';
}

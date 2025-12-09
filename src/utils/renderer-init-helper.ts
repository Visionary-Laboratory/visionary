import * as THREE from "three/webgpu";
import { EnvMapHelper } from "./env-map-helper";

/**
 * 渲染器初始化配置选项
 */
export interface RendererInitOptions {
    /** 源渲染器（可选，如果提供则从中同步配置） */
    sourceRenderer?: THREE.WebGPURenderer | null;
    /** 原始 HDR 纹理（可选，用于创建环境贴图） */
    originalTexture?: THREE.Texture | null;
    /** 渲染器宽度 */
    width?: number;
    /** 渲染器高度 */
    height?: number;
    /** 像素比率（默认 1） */
    pixelRatio?: number;
    /** 默认 HDR 纹理 URL（用于回退） */
    fallbackHdrUrl?: string;
}

/**
 * 渲染器初始化结果
 */
export interface RendererInitResult {
    /** 创建的环境贴图 */
    envMap: THREE.Texture | null;
    /** 背景纹理 */
    background: THREE.Texture | null;
}

/**
 * 渲染器初始化辅助类
 * 处理 WebGPU 渲染器的初始化、配置同步和资源管理
 * 
 * 关键原则：
 * 1. 渲染器配置：需要同步但不必复制（共享配置参数）
 * 2. GPU 资源：必须为每个 renderer 独立创建（不能共享）
 * 3. 后处理：EffectComposer、passes、shader uniforms 等需要分别创建
 */
export class RendererInitHelper {
    // ==================== 默认配置值 ====================
    
    /** 默认清除颜色 */
    private static readonly DEFAULT_CLEAR_COLOR = "#808080";
    
    /** 默认色调映射 */
    private static readonly DEFAULT_TONE_MAPPING = THREE.ACESFilmicToneMapping;
    
    /** 默认曝光值 */
    private static readonly DEFAULT_EXPOSURE = 0.8;
    
    /** 默认像素比率 */
    private static readonly DEFAULT_PIXEL_RATIO = 1;
    
    /** 默认 HDR 纹理 URL */
    private static readonly DEFAULT_FALLBACK_HDR_URL = '/public/textures/hdr/daytime.hdr';

    // ==================== 主要初始化函数 ====================

    /**
     * 初始化渲染器（一站式方法）
     * 如果提供了 sourceRenderer，则从源同步配置；否则使用默认配置
     * 
     * @param renderer 目标渲染器
     * @param scene 场景对象
     * @param options 初始化选项
     * @returns Promise<RendererInitResult> 初始化结果（环境贴图和背景）
     */
    public static async initializeRenderer(
        renderer: THREE.WebGPURenderer,
        scene: THREE.Scene,
        options: RendererInitOptions = {}
    ): Promise<RendererInitResult> {
        // 1. 应用渲染器配置（如果有源渲染器则同步，否则使用默认）
        if (options.sourceRenderer) {
            this.setupRendererConfig(renderer, options.sourceRenderer);
        } else {
            this.applyDefaultRendererConfig(renderer);
        }

        // 2. 设置渲染器尺寸和像素比率
        if (options.width && options.height) {
            renderer.setPixelRatio(options.pixelRatio ?? this.DEFAULT_PIXEL_RATIO);
            renderer.setSize(options.width, options.height, false);
        }

        // 3. 设置环境贴图
        let envMapResult: RendererInitResult;
        if (options.sourceRenderer && scene.environment) {
            // 从源渲染器场景同步环境贴图
            envMapResult = await this.setupEnvironmentFromSource(
                renderer,
                scene,
                options.originalTexture,
                options.fallbackHdrUrl
            );
        } else {
            // 使用默认环境流程
            envMapResult = await this.setupDefaultEnvironment(renderer, scene, options.fallbackHdrUrl);
        }

        // 4. 更新渲染器环境
        this.updateRendererEnvironment(renderer, scene);

        return envMapResult;
    }

    // ==================== 渲染器配置函数 ====================

    /**
     * 应用默认渲染器配置
     * @param renderer 目标渲染器
     */
    private static applyDefaultRendererConfig(renderer: THREE.WebGPURenderer): void {
        renderer.setClearColor(this.DEFAULT_CLEAR_COLOR, 1);
        renderer.toneMapping = this.DEFAULT_TONE_MAPPING;
        renderer.toneMappingExposure = this.DEFAULT_EXPOSURE;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        
        if (renderer.shadowMap) {
            const shadowMap = renderer.shadowMap as typeof renderer.shadowMap & { autoUpdate?: boolean };
            shadowMap.enabled = false;
            shadowMap.type = THREE.PCFShadowMap;
            shadowMap.autoUpdate = true;
        }
    }

    /**
     * 从源渲染器设置配置
     * @param targetRenderer 目标渲染器
     * @param sourceRenderer 源渲染器
     */
    private static setupRendererConfig(
        targetRenderer: THREE.WebGPURenderer,
        sourceRenderer: THREE.WebGPURenderer
    ): void {
        // 设置清除颜色
        this.setupClearColor(targetRenderer, sourceRenderer);
        
        // 设置色调映射
        this.setupToneMapping(targetRenderer, sourceRenderer);
        
        // 设置颜色空间
        this.setupColorSpace(targetRenderer, sourceRenderer);
        
        // 设置阴影
        this.setupShadowMap(targetRenderer, sourceRenderer);
        
        // 设置光照
        this.setupLightingSettings(targetRenderer, sourceRenderer);
        
        // 设置其他配置
        this.setupRendererSettings(targetRenderer, sourceRenderer);
    }

    /**
     * 设置清除颜色
     */
    private static setupClearColor(
        targetRenderer: THREE.WebGPURenderer,
        sourceRenderer: THREE.WebGPURenderer
    ): void {
        try {
            if (typeof (sourceRenderer as any).getClearColor === 'function') {
                const clearColor = new THREE.Color();
                (sourceRenderer as any).getClearColor(clearColor);
                const alpha = typeof (sourceRenderer as any).getClearAlpha === 'function' 
                    ? (sourceRenderer as any).getClearAlpha() 
                    : 1;
                targetRenderer.setClearColor(clearColor, alpha);
            } else {
                targetRenderer.setClearColor(this.DEFAULT_CLEAR_COLOR, 1);
            }
        } catch (e) {
            console.warn('[RendererInitHelper] 设置清除颜色失败，使用默认值:', e);
            targetRenderer.setClearColor(this.DEFAULT_CLEAR_COLOR, 1);
        }
    }

    /**
     * 设置色调映射
     */
    private static setupToneMapping(
        targetRenderer: THREE.WebGPURenderer,
        sourceRenderer: THREE.WebGPURenderer
    ): void {
        EnvMapHelper.setupRendererToneMapping(targetRenderer, sourceRenderer);
    }

    /**
     * 设置颜色空间
     */
    private static setupColorSpace(
        targetRenderer: THREE.WebGPURenderer,
        sourceRenderer: THREE.WebGPURenderer
    ): void {
        if ('outputColorSpace' in sourceRenderer) {
            const sourceColorSpace = (sourceRenderer as any).outputColorSpace;
            if (sourceColorSpace !== undefined) {
                targetRenderer.outputColorSpace = sourceColorSpace;
                return;
            }
        }
        targetRenderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    /**
     * 设置阴影
     */
    private static setupShadowMap(
        targetRenderer: THREE.WebGPURenderer,
        sourceRenderer: THREE.WebGPURenderer
    ): void {
        if (targetRenderer.shadowMap && sourceRenderer.shadowMap) {
            targetRenderer.shadowMap.enabled = sourceRenderer.shadowMap.enabled;
            targetRenderer.shadowMap.type = sourceRenderer.shadowMap.type;
            if ('autoUpdate' in sourceRenderer.shadowMap) {
                (targetRenderer.shadowMap as any).autoUpdate = (sourceRenderer.shadowMap as any).autoUpdate;
            }
        }
    }

    /**
     * 设置光照
     */
    private static setupLightingSettings(
        targetRenderer: THREE.WebGPURenderer,
        sourceRenderer: THREE.WebGPURenderer
    ): void {
        if ('physicallyCorrectLights' in sourceRenderer) {
            (targetRenderer as any).physicallyCorrectLights = (sourceRenderer as any).physicallyCorrectLights;
        }
        if ('useLegacyLights' in sourceRenderer) {
            (targetRenderer as any).useLegacyLights = (sourceRenderer as any).useLegacyLights;
        }
    }

    /**
     * 设置其他配置
     */
    private static setupRendererSettings(
        targetRenderer: THREE.WebGPURenderer,
        sourceRenderer: THREE.WebGPURenderer
    ): void {
        if ('sortObjects' in sourceRenderer) {
            (targetRenderer as any).sortObjects = (sourceRenderer as any).sortObjects;
        }
    }

    // ==================== 环境贴图函数 ====================

    /**
     * 设置默认环境（当没有源渲染器时）
     * @param renderer 渲染器
     * @param scene 场景
     * @param fallbackHdrUrl 回退 HDR URL
     * @returns 环境贴图结果
     */
    private static async setupDefaultEnvironment(
        renderer: THREE.WebGPURenderer,
        scene: THREE.Scene,
        fallbackHdrUrl?: string
    ): Promise<RendererInitResult> {
        // 如果场景没有环境贴图，尝试加载默认的
        if (!scene.environment) {
            const defaultUrl = fallbackHdrUrl || this.DEFAULT_FALLBACK_HDR_URL;
            console.log('[RendererInitHelper] 场景无环境贴图，加载默认 HDR:', defaultUrl);
            
            try {
                const defaultTexture = await EnvMapHelper.loadHDRTexture(defaultUrl);
                if (defaultTexture) {
                    const envMap = await this.createEnvironmentMap(renderer, defaultTexture);
                    if (envMap) {
                        return { envMap, background: defaultTexture };
                    }
                }
            } catch (e) {
                console.warn('[RendererInitHelper] 加载默认 HDR 失败:', e);
            }
        } else {
            // 场景有环境贴图，尝试获取原始纹理并创建
            const originalTexture = this.getOriginalTextureFromScene(scene);
            if (originalTexture) {
                const envMap = await this.createEnvironmentMap(renderer, originalTexture);
                if (envMap) {
                    return { envMap, background: originalTexture };
                }
            }
        }
        
        return { envMap: null, background: null };
    }

    /**
     * 从源渲染器场景设置环境（当有源渲染器时）
     * @param renderer 渲染器
     * @param scene 场景
     * @param originalTexture 原始纹理（可选）
     * @param fallbackHdrUrl 回退 HDR URL
     * @returns 环境贴图结果
     */
    private static async setupEnvironmentFromSource(
        renderer: THREE.WebGPURenderer,
        scene: THREE.Scene,
        originalTexture?: THREE.Texture | null,
        fallbackHdrUrl?: string
    ): Promise<RendererInitResult> {
        if (!scene.environment) {
            return { envMap: null, background: null };
        }

        // 尝试获取原始纹理
        // const textureToUse = originalTexture || this.getOriginalTextureFromScene(scene); // this.getOriginalTextureFromScene(scene)，build环境会非空导致录制预览背景无法正常显示
        const textureToUse = originalTexture;
        if (textureToUse) {
            const envMap = await this.createEnvironmentMap(renderer, textureToUse);
            if (envMap) {
                return { envMap, background: textureToUse };
            }
        }

        // 回退到加载默认 HDR
        const fallbackUrl = fallbackHdrUrl || this.DEFAULT_FALLBACK_HDR_URL;
        console.warn('[RendererInitHelper] 无法获取原始纹理，回退到加载默认 HDR:', fallbackUrl);
        
        try {
            const fallbackTexture = await EnvMapHelper.loadHDRTexture(fallbackUrl);
            if (fallbackTexture) {
                const envMap = await this.createEnvironmentMap(renderer, fallbackTexture);
                if (envMap) {
                    return { envMap, background: fallbackTexture };
                }
            }
        } catch (e) {
            console.error('[RendererInitHelper] 回退 HDR 加载失败:', e);
        }

        return { envMap: null, background: null };
    }

    /**
     * 从场景获取原始纹理
     */
    private static getOriginalTextureFromScene(scene: THREE.Scene): THREE.Texture | null {
        // 优先级：scene.background 中的纹理
        if (scene.background instanceof THREE.Texture) {
            return scene.background;
        }
        return null;
    }

    /**
     * 为渲染器创建独立的环境贴图资源
     */
    private static async createEnvironmentMap(
        renderer: THREE.WebGPURenderer,
        originalTexture: THREE.Texture
    ): Promise<THREE.Texture | null> {
        if (!renderer || !originalTexture) {
            return null;
        }
        return await EnvMapHelper.createPMREMEnvironmentMap(renderer, originalTexture);
    }

    /**
     * 更新渲染器环境设置
     */
    private static updateRendererEnvironment(
        renderer: THREE.WebGPURenderer,
        scene: THREE.Scene
    ): void {
        EnvMapHelper.updateRendererEnvironment(renderer, scene);
    }

    // ==================== 工具函数 ====================

    /**
     * 验证渲染器是否已正确初始化
     */
    public static isRendererInitialized(renderer: THREE.WebGPURenderer | null): boolean {
        if (!renderer) return false;
        const backend = (renderer as any).backend;
        return !!(backend?.device);
    }
}


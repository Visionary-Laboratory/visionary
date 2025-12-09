import * as THREE from "three/webgpu";
import { PMREMGenerator } from "three/webgpu";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

/**
 * 环境贴图辅助类
 * 提供加载和处理 HDR 环境贴图的工具方法
 */
export class EnvMapHelper {
    /**
     * 加载 HDR 纹理
     * @param url HDR 文件路径
     * @returns Promise<THREE.Texture> 加载的纹理对象
     */
    public static async loadHDRTexture(url: string): Promise<THREE.Texture> {
        const loader = new RGBELoader();
        const texture = await loader.loadAsync(url);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        return texture;
    }

    /**
     * 为渲染器创建 PMREM 环境贴图
     * @param renderer WebGPU 渲染器
     * @param texture 原始 HDR 纹理
     * @returns Promise<THREE.Texture | null> PMREM 处理后的环境贴图，失败时返回 null
     */
    public static async createPMREMEnvironmentMap(
        renderer: THREE.WebGPURenderer,
        texture: THREE.Texture
    ): Promise<THREE.Texture | null> {
        // 检查渲染器是否已初始化
        if (!renderer) {
            console.warn('[EnvMapHelper] 渲染器未初始化，无法创建 PMREM 环境贴图');
            return null;
        }

        // 检查渲染器的 backend 是否已初始化（构建后可能未完全初始化）
        const backend = (renderer as any).backend;
        if (!backend) {
            console.warn('[EnvMapHelper] 渲染器 backend 未初始化，无法创建 PMREM 环境贴图');
            return null;
        }

        // 检查渲染器的 device 是否存在
        const device = backend?.device;
        if (!device) {
            console.warn('[EnvMapHelper] 渲染器 device 不存在，无法创建 PMREM 环境贴图');
            return null;
        }

        // 检查纹理是否有效
        if (!texture || !texture.image) {
            console.warn('[EnvMapHelper] 纹理无效，无法创建 PMREM 环境贴图');
            return null;
        }

        // 在构建后的环境中，可能需要等待一小段时间确保渲染器完全准备好
        // 这可以避免在渲染器内部状态未完全初始化时调用 PMREMGenerator
        await new Promise(resolve => setTimeout(resolve, 0));

        let pmremGenerator: PMREMGenerator | null = null;
        try {
            pmremGenerator = new PMREMGenerator(renderer);
            
            // 检查 PMREMGenerator 是否创建成功
            if (!pmremGenerator) {
                console.warn('[EnvMapHelper] PMREMGenerator 创建失败');
                return null;
            }
            
            // 检查 PMREMGenerator 是否有 fromEquirectangular 方法
            if ('fromEquirectangular' in pmremGenerator && 
                typeof (pmremGenerator as any).fromEquirectangular === 'function') {
                const pmremTexture = (pmremGenerator as any).fromEquirectangular(texture);
                
                // 严格检查 pmremTexture 和其 texture 属性
                if (!pmremTexture) {
                    console.warn('[EnvMapHelper] PMREMGenerator.fromEquirectangular 返回 null');
                    if (pmremGenerator) {
                        pmremGenerator.dispose();
                    }
                    return null;
                }
                
                if (!pmremTexture.texture) {
                    console.warn('[EnvMapHelper] PMREMGenerator 返回的对象没有 texture 属性');
                    if (pmremGenerator) {
                        pmremGenerator.dispose();
                    }
                    return null;
                }
                
                const envMap = pmremTexture.texture;
                
                // 确保环境贴图有效
                if (!envMap) {
                    console.warn('[EnvMapHelper] PMREM 环境贴图为 null');
                    if (pmremGenerator) {
                        pmremGenerator.dispose();
                    }
                    return null;
                }
                
                if (pmremGenerator) {
                    pmremGenerator.dispose();
                }
                return envMap;
            } else {
                console.warn('[EnvMapHelper] PMREMGenerator.fromEquirectangular 方法不存在');
                if (pmremGenerator) {
                    pmremGenerator.dispose();
                }
                return null;
            }
        } catch (e) {
            // 详细记录错误信息以便调试
            const errorMessage = e instanceof Error ? e.message : String(e);
            const errorStack = e instanceof Error ? e.stack : undefined;
            console.warn('[EnvMapHelper] PMREMGenerator 处理失败:', errorMessage);
            if (errorStack) {
                console.warn('[EnvMapHelper] 错误堆栈:', errorStack);
            }
            if (pmremGenerator) {
                try {
                    pmremGenerator.dispose();
                } catch (disposeError) {
                    console.warn('[EnvMapHelper] 清理 PMREMGenerator 失败:', disposeError);
                }
            }
            return null;
        }
    }

    /**
     * 设置渲染器的色调映射
     * @param renderer WebGPU 渲染器
     * @param toneMapping 色调映射类型，默认为 ACESFilmicToneMapping
     * @param exposure 曝光值，默认为 0.8
     */
    public static setupRendererToneMapping(
        renderer: THREE.WebGPURenderer,
        refRenderer: THREE.WebGPURenderer | null = null,
        toneMapping: THREE.ToneMapping = THREE.ACESFilmicToneMapping,
        exposure: number = 0.8
    ): void {
        if (refRenderer && 'toneMapping' in refRenderer && typeof (refRenderer as any).toneMapping !== 'undefined') {
            renderer.toneMapping = (refRenderer as any).toneMapping;
            renderer.toneMappingExposure = (refRenderer as any).toneMappingExposure ?? exposure;
        }else {
            renderer.toneMapping = toneMapping;
            renderer.toneMappingExposure = exposure;
        }
    }

    /**
     * 更新渲染器的环境贴图
     * @param renderer WebGPU 渲染器
     * @param scene 场景对象
     */
    public static updateRendererEnvironment(
        renderer: THREE.WebGPURenderer,
        scene: THREE.Scene
    ): void {
        if ('updateEnvironment' in renderer && typeof (renderer as any).updateEnvironment === 'function') {
            (renderer as any).updateEnvironment(scene);
        }
        else {
            console.log('[EnvMapHelper] renderer.updateEnvironment 方法不存在，跳过');
        }
    }

    /**
     * 设置场景的环境贴图和背景
     * @param scene 场景对象
     * @param envMap 环境贴图（用于材质反射）
     * @param background 背景纹理或颜色（用于天空盒显示）
     */
    public static setupSceneEnvironment(
        scene: THREE.Scene,
        envMap: THREE.Texture | null,
        background: THREE.Texture | THREE.Color | null
    ): void {
        if (envMap) {
            scene.environment = envMap;
        }
        if (background) {
            scene.background = background;
        }
    }
}


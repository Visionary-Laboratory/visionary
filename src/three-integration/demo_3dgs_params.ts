import * as THREE from "three/webgpu";
import {initThreeContext} from "../app/three-context.ts";
import {loadGaussianModels} from "../app";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";

// 全局参数状态
interface ModelParams {
    id: string;
    name: string;
    visible: boolean;
    gaussianScale: number;
    maxShDeg: number;
    kernelSize: number;
    opacityScale: number;
    cutoffScale: number;
    timeScale: number;
    timeOffset: number;
    timeUpdateMode: string;
    rendermode: number;
    animationSpeed: number;
    isAnimationRunning: boolean;
    isAnimationPaused: boolean;
}

// 全局状态管理
let globalParams = {
    models: new Map<string, ModelParams>()
};

async function main() {
    const canvasElement = document.querySelector("#canvas") as HTMLCanvasElement;
    if (canvasElement == null) {
        throw new Error("Can't find the canvas element!");
    }

    // 初始化 Three.js 上下文
    const renderer = await initThreeContext(canvasElement);
    if (renderer == null) {
        throw new Error("Failed to initialize the three context!");
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, canvasElement.clientWidth / canvasElement.clientHeight, 0.1, 1000);
    camera.position.z = 5;

    const controls = new OrbitControls(camera, renderer.domElement);

    // 添加测试立方体
    const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    // scene.add(cube);

    // 添加光照
    const light = new THREE.DirectionalLight(0xffffff, 1)
    light.position.set(-1, 2, 4)
    scene.add(light)

    // 更新相机矩阵
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    // 加载高斯模型
    const gaussianThreeJSRenderer = await loadGaussianModels(renderer, scene,
        [
            "/models/gaussians3d_lhm_split.onnx",
            // "/models/gaussians3d_gauhuman.onnx",
            // "/models/gaussians3d_explode_house.onnx",
            // "/models/gaussians4d_correct.onnx",
            "/models/point_cloud2.ply",
            "/models/gaussians3d_car.onnx",

            // "/models/test.ply"
        ],
        {
            camMat: new Float32Array(camera.matrixWorldInverse.elements),
            projMat: new Float32Array(camera.projectionMatrix.elements)
        }
    );

    if (!gaussianThreeJSRenderer) {
        throw new Error("Failed to load Gaussian models!");
    }

    // 初始化模型参数
    initializeModelParams(gaussianThreeJSRenderer);

    // 设置窗口大小调整处理
    window.addEventListener("resize", () => {
        const width = canvasElement.clientWidth;
        const height = canvasElement.clientHeight;

        renderer.setSize(width, height, false);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        camera.aspect = width / height;
        camera.updateProjectionMatrix();

        gaussianThreeJSRenderer?.onResize(width, height);
    });

    // 跟踪时间用于动态更新
    const startTime = Date.now();

    // 渲染循环
    renderer.setAnimationLoop(async () => {
        // 更新立方体旋转
        cube.rotation.x += 0.01;
        cube.rotation.y += 0.01;

        // 更新控制器
        controls.update();

        // 更新相机矩阵
        camera.updateMatrixWorld();

        // 更新动态模型
        if (gaussianThreeJSRenderer) {
            const currentTime = (Date.now() - startTime) / 1000.0;
            await gaussianThreeJSRenderer.updateDynamicModels(camera, currentTime);
        }

        // 渲染场景
        if (gaussianThreeJSRenderer) {
            gaussianThreeJSRenderer.renderThreeScene(camera);
            gaussianThreeJSRenderer.drawSplats(renderer, scene, camera);
        } else {
            renderer.render(scene, camera);
        }
    });

    // 暴露全局控制接口
    setupGlobalControls(gaussianThreeJSRenderer);
    
    // 触发 UI 更新事件
    window.dispatchEvent(new CustomEvent('demoReady'));
    
    console.log("3DGS Parameters Demo initialized successfully!");
    console.log("Available controls:");
    console.log("- window.setModelGaussianScale(modelId, scale)");
    console.log("- window.setModelMaxShDeg(modelId, deg)");
    console.log("- window.setModelKernelSize(modelId, size)");
    console.log("- window.setModelOpacityScale(modelId, scale)");
    console.log("- window.setModelCutoffScale(modelId, scale)");
    console.log("- window.setModelTimeScale(modelId, scale)");
    console.log("- window.setModelTimeOffset(modelId, offset)");
    console.log("- window.setModelTimeUpdateMode(modelId, mode)");
    console.log("- window.startModelAnimation(modelId, speed)");
    console.log("- window.pauseModelAnimation(modelId)");
    console.log("- window.resumeModelAnimation(modelId)");
    console.log("- window.stopModelAnimation(modelId)");
    console.log("- window.setModelAnimationTime(modelId, time)");
    console.log("- window.setModelAnimationSpeed(modelId, speed)");
    console.log("- window.getModelParams()");
}

/**
 * 初始化模型参数
 */
function initializeModelParams(gaussianRenderer: any) {
    // 获取加载的模型信息
    const models = gaussianRenderer.gaussianModels || [];
    
    models.forEach((model: any, index: number) => {
        const modelId = `model_${index}`;
        const modelParams: ModelParams = {
            id: modelId,
            name: model.name || `Model ${index + 1}`,
            visible: true,
            gaussianScale: 1.0,
            maxShDeg: 3,
            kernelSize: 0.1,
            opacityScale: 1.0,
            cutoffScale: 1.0,
            timeScale: 1.0,
            timeOffset: 0.0,
            timeUpdateMode: 'fixed_delta',
            rendermode: 0,
            animationSpeed: 1.0,
            isAnimationRunning: false,
            isAnimationPaused: false
        };
        
        globalParams.models.set(modelId, modelParams);
        console.log(`Initialized model: ${modelParams.name} (ID: ${modelId})`);
    });
}

/**
 * 设置特定模型的高斯缩放
 */
function setModelGaussianScale(modelId: string, scale: number) {
    const modelParams = globalParams.models.get(modelId);
    if (modelParams) {
        modelParams.gaussianScale = scale;
        console.log(`Model ${modelParams.name} Gaussian scale set to: ${scale}`);
    } else {
        console.warn(`Model with ID ${modelId} not found`);
    }
    
    // 调用 GaussianThreeJSRenderer 的方法
    if ((window as any).gaussianRenderer) {
        (window as any).gaussianRenderer.setModelGaussianScale(modelId, scale);
    }
}

/**
 * 设置特定模型的可视状态
 */
function setModelVisible(modelId: string, visible: boolean) {
    const modelParams = globalParams.models.get(modelId);
    if (modelParams) {
        modelParams.visible = visible;
        console.log(`Model ${modelParams.name} Visible set to: ${visible}`);
    } else {
        console.warn(`Model with ID ${modelId} not found`);
    }
    if ((window as any).gaussianRenderer) {
        (window as any).gaussianRenderer.setModelVisible(modelId, visible);
    }
}

/**
 * 设置特定模型的球谐等级
 */
function setModelMaxShDeg(modelId: string, deg: number) {
    const modelParams = globalParams.models.get(modelId);
    if (modelParams) {
        modelParams.maxShDeg = deg;
        console.log(`Model ${modelParams.name} Max SH degree set to: ${deg}`);
    } else {
        console.warn(`Model with ID ${modelId} not found`);
    }
    
    // 调用 GaussianThreeJSRenderer 的方法
    if ((window as any).gaussianRenderer) {
        (window as any).gaussianRenderer.setModelMaxShDeg(modelId, deg);
    }
}

/**
 * 设置特定模型的核大小
 */
function setModelKernelSize(modelId: string, size: number) {
    const modelParams = globalParams.models.get(modelId);
    if (modelParams) {
        modelParams.kernelSize = size;
        console.log(`Model ${modelParams.name} Kernel size set to: ${size}`);
    } else {
        console.warn(`Model with ID ${modelId} not found`);
    }
    
    // 调用 GaussianThreeJSRenderer 的方法
    if ((window as any).gaussianRenderer) {
        (window as any).gaussianRenderer.setModelKernelSize(modelId, size);
    }
}

/**
 * 设置特定模型的透明度倍数
 */
function setModelOpacityScale(modelId: string, scale: number) {
    const modelParams = globalParams.models.get(modelId);
    if (modelParams) {
        modelParams.opacityScale = scale;
        console.log(`Model ${modelParams.name} Opacity scale set to: ${scale}`);
    } else {
        console.warn(`Model with ID ${modelId} not found`);
    }
    
    // 调用 GaussianThreeJSRenderer 的方法
    if ((window as any).gaussianRenderer) {
        (window as any).gaussianRenderer.setModelOpacityScale(modelId, scale);
    }
}

/**
 * 设置特定模型的像素比例倍数
 */
function setModelCutoffScale(modelId: string, scale: number) {
    const modelParams = globalParams.models.get(modelId);
    if (modelParams) {
        modelParams.cutoffScale = scale;
        console.log(`Model ${modelParams.name} Cutoff scale set to: ${scale}`);
    } else {
        console.warn(`Model with ID ${modelId} not found`);
    }
    
    // 调用 GaussianThreeJSRenderer 的方法
    if ((window as any).gaussianRenderer) {
        (window as any).gaussianRenderer.setModelCutoffScale(modelId, scale);
    }
}

/**
 * 设置特定模型的时间缩放倍数
 */
function setModelTimeScale(modelId: string, scale: number) {
    const modelParams = globalParams.models.get(modelId);
    if (modelParams) {
        modelParams.timeScale = scale;
        console.log(`Model ${modelParams.name} Time scale set to: ${scale}`);
    } else {
        console.warn(`Model with ID ${modelId} not found`);
    }
    
    // 调用 GaussianThreeJSRenderer 的方法
    if ((window as any).gaussianRenderer) {
        (window as any).gaussianRenderer.setModelTimeScale(modelId, scale);
    }
}

/**
 * 设置特定模型的时间偏移
 */
function setModelTimeOffset(modelId: string, offset: number) {
    const modelParams = globalParams.models.get(modelId);
    if (modelParams) {
        modelParams.timeOffset = offset;
        console.log(`Model ${modelParams.name} Time offset set to: ${offset}`);
    } else {
        console.warn(`Model with ID ${modelId} not found`);
    }
    
    // 调用 GaussianThreeJSRenderer 的方法
    if ((window as any).gaussianRenderer) {
        (window as any).gaussianRenderer.setModelTimeOffset(modelId, offset);
    }
}

/**
 * 设置特定模型的时间更新模式
 */
function setModelTimeUpdateMode(modelId: string, mode: string) {
    const modelParams = globalParams.models.get(modelId);
    if (modelParams) {
        modelParams.timeUpdateMode = mode;
        console.log(`Model ${modelParams.name} Time update mode set to: ${mode}`);
    } else {
        console.warn(`Model with ID ${modelId} not found`);
    }
    
    // 调用 GaussianThreeJSRenderer 的方法
    if ((window as any).gaussianRenderer) {
        (window as any).gaussianRenderer.setModelTimeUpdateMode(modelId, mode);
    }
}

/**
 * 设置特定模型的渲染模式
 */
function setModelRenderMode(modelId: string, mode: number) {
    const modelParams = globalParams.models.get(modelId);
    if (modelParams) {
        modelParams.rendermode = mode;
        console.log(`Model ${modelParams.name} Render mode set to: ${mode}`);
    } else {
        console.warn(`Model with ID ${modelId} not found`);
    }
    
    // 调用 GaussianThreeJSRenderer 的方法
    if ((window as any).gaussianRenderer) {
        (window as any).gaussianRenderer.setModelRenderMode(modelId, mode);
    }
}

/**
 * 开始模型动画
 */
function startModelAnimation(modelId: string, speed: number = 1.0) {
    const modelParams = globalParams.models.get(modelId);
    if (modelParams) {
        modelParams.isAnimationRunning = true;
        modelParams.isAnimationPaused = false;
        modelParams.animationSpeed = speed;
        console.log(`Model ${modelParams.name} Animation started at ${speed}x speed`);
    } else {
        console.warn(`Model with ID ${modelId} not found`);
    }
    
    if ((window as any).gaussianRenderer) {
        (window as any).gaussianRenderer.startModelAnimation(modelId, speed);
    }
}

/**
 * 暂停模型动画
 */
function pauseModelAnimation(modelId: string) {
    const modelParams = globalParams.models.get(modelId);
    if (modelParams) {
        modelParams.isAnimationPaused = true;
        console.log(`Model ${modelParams.name} Animation paused`);
    } else {
        console.warn(`Model with ID ${modelId} not found`);
    }
    
    if ((window as any).gaussianRenderer) {
        (window as any).gaussianRenderer.pauseModelAnimation(modelId);
    }
}

/**
 * 恢复模型动画
 */
function resumeModelAnimation(modelId: string) {
    const modelParams = globalParams.models.get(modelId);
    if (modelParams) {
        modelParams.isAnimationPaused = false;
        console.log(`Model ${modelParams.name} Animation resumed`);
    } else {
        console.warn(`Model with ID ${modelId} not found`);
    }
    
    if ((window as any).gaussianRenderer) {
        (window as any).gaussianRenderer.resumeModelAnimation(modelId);
    }
}

/**
 * 停止模型动画
 */
function stopModelAnimation(modelId: string) {
    const modelParams = globalParams.models.get(modelId);
    if (modelParams) {
        modelParams.isAnimationRunning = false;
        modelParams.isAnimationPaused = false;
        console.log(`Model ${modelParams.name} Animation stopped`);
    } else {
        console.warn(`Model with ID ${modelId} not found`);
    }
    
    if ((window as any).gaussianRenderer) {
        (window as any).gaussianRenderer.stopModelAnimation(modelId);
    }
}

/**
 * 设置模型动画时间
 */
function setModelAnimationTime(modelId: string, time: number) {
    const modelParams = globalParams.models.get(modelId);
    if (modelParams) {
        console.log(`Model ${modelParams.name} Animation time set to: ${time.toFixed(3)}s`);
    } else {
        console.warn(`Model with ID ${modelId} not found`);
    }
    
    if ((window as any).gaussianRenderer) {
        (window as any).gaussianRenderer.setModelAnimationTime(modelId, time);
    }
}

/**
 * 设置模型动画速度
 */
function setModelAnimationSpeed(modelId: string, speed: number) {
    const modelParams = globalParams.models.get(modelId);
    if (modelParams) {
        modelParams.animationSpeed = speed;
        console.log(`Model ${modelParams.name} Animation speed set to: ${speed}x`);
    } else {
        console.warn(`Model with ID ${modelId} not found`);
    }
    
    if ((window as any).gaussianRenderer) {
        (window as any).gaussianRenderer.setModelAnimationSpeed(modelId, speed);
    }
}


/**
 * 获取所有模型参数
 */
function getModelParams() {
    // 优先从 GaussianThreeJSRenderer 获取实际参数
    if ((window as any).gaussianRenderer) {
        const rendererParams = (window as any).gaussianRenderer.getModelParams();
        return rendererParams;
    }
    
    // 回退到本地参数
    const result: any = {
        models: {}
    };
    
    globalParams.models.forEach((modelParams, id) => {
        result.models[id] = { ...modelParams };
    });
    
    return result;
}

/**
 * 设置全局控制接口
 */
function setupGlobalControls(gaussianRenderer: any) {
    // 暴露全局控制函数
    (window as any).setModelGaussianScale = setModelGaussianScale;
    (window as any).setModelVisible = setModelVisible;
    (window as any).setModelMaxShDeg = setModelMaxShDeg;
    (window as any).setModelKernelSize = setModelKernelSize;
    (window as any).setModelOpacityScale = setModelOpacityScale;
    (window as any).setModelCutoffScale = setModelCutoffScale;
    (window as any).setModelTimeScale = setModelTimeScale;
    (window as any).setModelTimeOffset = setModelTimeOffset;
    (window as any).setModelTimeUpdateMode = setModelTimeUpdateMode;
    (window as any).setModelRenderMode = setModelRenderMode;
    (window as any).startModelAnimation = startModelAnimation;
    (window as any).pauseModelAnimation = pauseModelAnimation;
    (window as any).resumeModelAnimation = resumeModelAnimation;
    (window as any).stopModelAnimation = stopModelAnimation;
    (window as any).setModelAnimationTime = setModelAnimationTime;
    (window as any).setModelAnimationSpeed = setModelAnimationSpeed;
    (window as any).getModelParams = getModelParams;

    // 全局动画控制（影响所有动态模型）
    (window as any).setGlobalTimeScale = (scale: number) => gaussianRenderer?.setGlobalTimeScale(scale);
    (window as any).setGlobalTimeOffset = (offset: number) => gaussianRenderer?.setGlobalTimeOffset(offset);
    (window as any).setGlobalTimeUpdateMode = (mode: string) => gaussianRenderer?.setGlobalTimeUpdateMode(mode);
    (window as any).startAllAnimations = (speed: number = 1.0) => gaussianRenderer?.startAllAnimations(speed);
    (window as any).pauseAllAnimations = () => gaussianRenderer?.pauseAllAnimations();
    (window as any).resumeAllAnimations = () => gaussianRenderer?.resumeAllAnimations();
    (window as any).stopAllAnimations = () => gaussianRenderer?.stopAllAnimations();
    (window as any).setAllAnimationTime = (time: number) => gaussianRenderer?.setAllAnimationTime(time);
    (window as any).setAllAnimationSpeed = (speed: number) => gaussianRenderer?.setAllAnimationSpeed(speed);
    
    // 暴露 gaussianRenderer 用于调试
    (window as any).gaussianRenderer = gaussianRenderer;
    
    // 添加键盘快捷键
    document.addEventListener('keydown', (event) => {
        switch(event.key) {
            case '1':
                // 设置所有模型的缩放为 0.5
                globalParams.models.forEach((modelParams, modelId) => {
                    setModelGaussianScale(modelId, 0.5);
                });
                break;
            case '2':
                // 设置所有模型的缩放为 1.0
                globalParams.models.forEach((modelParams, modelId) => {
                    setModelGaussianScale(modelId, 1.0);
                });
                break;
            case '3':
                // 设置所有模型的缩放为 2.0
                globalParams.models.forEach((modelParams, modelId) => {
                    setModelGaussianScale(modelId, 2.0);
                });
                break;
            case '4':
                // 设置所有模型的缩放为 5.0
                globalParams.models.forEach((modelParams, modelId) => {
                    setModelGaussianScale(modelId, 5.0);
                });
                break;
            case 'i':
                // 显示信息
                console.log("Current parameters:", getModelParams());
                break;
        }
    });
    
    console.log("Keyboard shortcuts:");
    console.log("- 1, 2, 3, 4: Set all models Gaussian scale (0.5, 1.0, 2.0, 5.0)");
    console.log("- I: Show current parameters");

    console.log("Global animation controls:");
    console.log("- window.setGlobalTimeScale(scale)");
    console.log("- window.setGlobalTimeOffset(offset)");
    console.log("- window.setGlobalTimeUpdateMode(mode)");
    console.log("- window.startAllAnimations(speed?)");
    console.log("- window.pauseAllAnimations(), window.resumeAllAnimations(), window.stopAllAnimations()");
    console.log("- window.setAllAnimationTime(time), window.setAllAnimationSpeed(speed)");
}

main().catch(console.error);

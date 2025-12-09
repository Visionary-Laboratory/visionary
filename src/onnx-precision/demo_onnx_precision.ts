import * as THREE from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { initThreeContext } from "../app";
import { ONNXManager } from "../app/managers/onnx-manager";
import { PrecisionConverter } from "./precision_converter";
import { DynamicPointCloud } from "../point_cloud/dynamic_point_cloud";
import { PrecisionDetector } from "../ONNX/precision-detector";
import { GaussianModel } from "../app/GaussianModel";
import { GaussianThreeJSRenderer } from "../app/GaussianThreeJSRenderer";

type PrecisionType = 'float32' | 'float16' | 'int8';

// 获取 UI 元素
const precisionSelect = document.getElementById('precisionSelect') as HTMLSelectElement;
const reloadButton = document.getElementById('reloadButton') as HTMLButtonElement;
const convertToFP16Button = document.getElementById('convertToFP16Button') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const currentPrecisionEl = document.getElementById('currentPrecision') as HTMLSpanElement;
const bufferSizeEl = document.getElementById('bufferSize') as HTMLSpanElement;
const pointCountEl = document.getElementById('pointCount') as HTMLSpanElement;
const fpsEl = document.getElementById('fps') as HTMLSpanElement;

// 全局变量
let renderer: THREE.WebGPURenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let gaussianRenderer: GaussianThreeJSRenderer | null = null;
let currentModels: GaussianModel[] = [];
let frameCount = 0;
let lastFPSUpdate = 0;
let precisionConverter: PrecisionConverter | null = null;
let runtimeConvertActive = false;
let currentGenerator: any = null;
let runtimeConvertInfo: { n: number; colorDim: number } | null = null;

// 性能监控
function updatePerformanceInfo() {
    frameCount++;
    const now = performance.now();
    if (now - lastFPSUpdate > 1000) {
        const fps = Math.round((frameCount * 1000) / (now - lastFPSUpdate));
        fpsEl.textContent = `${fps} FPS`;
        frameCount = 0;
        lastFPSUpdate = now;
    }
}

// 更新信息面板
function updateInfoPanel(selected: PrecisionType, generator?: any) {
    let detectedText = '-';
    let mismatch = false;
    
    if (generator) {
        const gaussPrec = generator.getGaussianPrecision?.();
        const colorPrec = generator.getColorPrecision?.();
        const actualPoints = generator.getActualMaxPoints?.() ?? 0;

        const detectedGauss = gaussPrec?.dataType || 'float16';
        detectedText = String(detectedGauss);
        mismatch = (selected !== detectedGauss);

        // 计算缓冲区大小（按检测到的精度）
        const bytesPerPointGauss = (gaussPrec?.bytesPerElement ?? 2) * 10; // 10 fields per gaussian
        const bytesPerPointColor = (colorPrec?.bytesPerElement ?? 2) * 48; // 48 channels default
        const totalBytesPerPoint = bytesPerPointGauss + bytesPerPointColor;
        const totalBufferSize = totalBytesPerPoint * actualPoints;

        bufferSizeEl.textContent = `${(totalBufferSize / 1024 / 1024).toFixed(2)} MB`;
        pointCountEl.textContent = `${actualPoints.toLocaleString()}`;
    }

    // 只显示检测到的精度
    currentPrecisionEl.textContent = `${detectedText.toUpperCase()} (自动检测)`;
    // 启用/禁用转换按钮
    const canConvert = detectedText === 'float32';
    if (convertToFP16Button) {
        convertToFP16Button.disabled = !canConvert;
    }
    statusEl.className = 'info-label';
}

// 加载模型
async function loadModel(precision: PrecisionType) {
    if (!renderer || !scene || !camera) {
        throw new Error('Renderer not initialized');
    }

    try {
        statusEl.textContent = '加载中...';
        statusEl.className = '';
        reloadButton.disabled = true;

        // 清理现有模型
        if (gaussianRenderer) {
            scene.remove(gaussianRenderer as any);
            (gaussianRenderer as any)?.dispose?.();
            gaussianRenderer = null;
        }
        
        for (const model of currentModels) {
            scene.remove(model);
            model.dispose();
        }
        currentModels = [];

        const device = (renderer.backend as any).device as GPUDevice;
        const modelManager = new (await import('../app/managers/model-manager')).ModelManager();
        const onnxManager = new ONNXManager(modelManager);
        // Expose for console debugging
        (window as any)._onnxManager = onnxManager;
        (window as any).__PrecisionDetector = PrecisionDetector;

        // 准备相机矩阵
        camera.updateMatrixWorld();
        camera.updateProjectionMatrix();
        const cameraMatrix = new Float32Array(camera.matrixWorldInverse.elements);
        const projectionMatrix = new Float32Array(camera.projectionMatrix.elements);

        // 构造精度配置（强制使用指定精度，禁用自动检测）
        const precisionConfig = {
            gaussian: { dataType: precision },
            color: { dataType: precision },
            autoDetect: false
        };

        // 加载 ONNX 模型
        const modelPath = '/models/gaussians4d_f32.onnx';
        // const modelPath = '/models/gaussians4d.onnx';

        const entry = await onnxManager.loadONNXModel(
            device,
            modelPath,
            cameraMatrix,
            projectionMatrix,
            `Model`,
            {
                staticInference: false,
                debugLogging: true,
                precisionConfig
            }
        );

        const gaussianModel = new GaussianModel(entry);
        currentModels.push(gaussianModel);
        scene.add(gaussianModel);
        // 默认播放动画（若模型为动态）
        try { gaussianModel.startAnimation(1.0); } catch {}

        // 创建渲染器
        gaussianRenderer = new GaussianThreeJSRenderer(renderer, scene, currentModels);
        await gaussianRenderer.init();
        scene.add(gaussianRenderer);

        // 获取生成器以显示信息
        // Try to get generator by name, otherwise pick first value
        let generator = (onnxManager as any).generators?.get(entry.name);
        if (!generator) {
            const it = (onnxManager as any).generators?.values?.();
            const first = it && it.next && it.next();
            generator = first && !first.done ? first.value : undefined;
        }
        currentGenerator = generator;
        updateInfoPanel(precision, generator);

        statusEl.textContent = '加载成功';
        statusEl.className = 'info-label';
        reloadButton.disabled = false;

        try {
            const det = {
                gaussian: generator?.getGaussianPrecision?.(),
                color: generator?.getColorPrecision?.(),
            };
            console.log('Detected precision:', det);
            // Print outputNames and outputMetadata
            const session = (generator as any)?.io?.session;
            const names = session?.outputNames || [];
            console.log('[ONNX][Debug] outputNames =', names);
            const meta = session && (session as any).outputMetadata;
            if (meta) {
                for (const k in meta) {
                    const m = meta[k];
                    const shape = m?.shape ? `[${m.shape.join(', ')}]` : 'unknown';
                    console.log(`[ONNX][Meta] idx=${k} name='${m?.name}' type='${m?.type ?? m?.dataType}' shape=${shape}`);
                }
            }
            // Update dropdown to match detected precision
            const detectedType = det.gaussian?.dataType;
            if (detectedType && precisionSelect) {
                const optionMap: Record<string, string> = {
                    'float32': 'float32',
                    'float16': 'float16',
                    'int8': 'int8'
                };
                const selectValue = optionMap[detectedType] || 'float16';
                precisionSelect.value = selectValue;
            }
        } catch {}
    } catch (error) {
        statusEl.textContent = `加载失败: ${error}`;
        statusEl.className = 'error';
        reloadButton.disabled = false;
        console.error('Failed to load model:', error);
    }
}

// 初始化
async function main() {
    const canvasElement = document.querySelector("#canvas") as HTMLCanvasElement;
    if (!canvasElement) {
        throw new Error("Canvas element not found");
    }

    // 初始化 Three.js
    renderer = await initThreeContext(canvasElement);
    if (!renderer) {
        throw new Error("Failed to initialize Three.js");
    }

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, canvasElement.clientWidth / canvasElement.clientHeight, 0.1, 1000);
    camera.position.set(2, 2, 2);
    camera.lookAt(0, 0, 0);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.update();

    // 添加环境光
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    // 默认加载 FP16 精度
    await loadModel('float16');

    // 注册事件监听
    reloadButton.addEventListener('click', () => {
        const precision = precisionSelect.value as PrecisionType;
        loadModel(precision);
    });

    // 运行时转换为 FP16
    convertToFP16Button.addEventListener('click', async () => {
        try {
            if (!renderer || !gaussianRenderer || currentModels.length === 0) return;
            const device = (renderer.backend as any).device as GPUDevice;
            if (!precisionConverter) {
                precisionConverter = new PrecisionConverter();
                await precisionConverter.initialize(device);
            }
            // 仅取第一个高斯模型（演示）
            const model = currentModels[0];
            const pc = model.getPointCloud();
            if (!(pc instanceof DynamicPointCloud)) {
                console.warn('当前模型不是 DynamicPointCloud，无法转换');
                return;
            }
            const splat = pc.getSplatBuffer();
            const N = pc.numPoints;
            const colorDim = pc.colorChannels;

            const { gaussOutFP16, colorOutFP16, encoder } = precisionConverter.convert({
                gaussIn: splat.gaussianBuffer,
                colorIn: splat.shBuffer,
                n: N,
                colorDim,
            });
            device.queue.submit([encoder.finish()]);

            // 用新缓冲替换并将精度标记为 FP16（统一入口）
            pc.applyFP16(device, gaussOutFP16, colorOutFP16);

            // 启用逐帧转换：保持动画（ORT 仍输出 FP32，我们每帧将其打包写入当前 FP16 缓冲）
            runtimeConvertActive = true;
            runtimeConvertInfo = { n: N, colorDim };

            // 更新信息面板
            currentPrecisionEl.textContent = `FLOAT16 (运行时转换)`;
            // 重新估算缓冲大小
            const bytesPerPointGauss = 2 * 10;
            const bytesPerPointColor = 2 * colorDim;
            const totalBytesPerPoint = bytesPerPointGauss + bytesPerPointColor;
            bufferSizeEl.textContent = `${(totalBytesPerPoint * N / 1024 / 1024).toFixed(2)} MB`;
            statusEl.textContent = '已转换为 FP16';
            convertToFP16Button.disabled = true;
        } catch (e) {
            console.error(e);
            statusEl.textContent = `转换失败: ${e}`;
            statusEl.className = 'error';
        }
    });

    // 窗口大小调整
    window.addEventListener("resize", () => {
        if (!canvasElement || !renderer || !camera) return;
        
        const width = canvasElement.clientWidth;
        const height = canvasElement.clientHeight;

        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();

        gaussianRenderer?.onResize(width, height);
    });

    // 跟踪时间用于动态更新
    const startTime = Date.now();

    // 渲染循环
    renderer.setAnimationLoop(async () => {
        updatePerformanceInfo();
        
        if (!controls || !renderer || !scene || !camera || !gaussianRenderer) return;

        controls.update();

        // 更新相机矩阵（用于动态 ONNX 模型）
        camera.updateMatrixWorld();

        // 更新动态 ONNX 模型
        const currentTime = (Date.now() - startTime) / 1000.0;
        await gaussianRenderer.updateDynamicModels(camera, currentTime);

        // 若已启用运行时转换：每帧把 ORT 的 FP32 输出打包写入当前 FP16 缓冲
        if (runtimeConvertActive && precisionConverter && currentGenerator && currentModels.length > 0) {
            try {
                const device = (renderer.backend as any).device as GPUDevice;
                const pc = currentModels[0].getPointCloud();
                if (pc instanceof DynamicPointCloud && runtimeConvertInfo) {
                    const inGauss = currentGenerator.getGaussianBuffer?.();
                    const inColor = currentGenerator.getSHBuffer?.();
                    const outSplat = pc.getSplatBuffer();
                    if (inGauss && inColor) {
                        const enc = precisionConverter.convertInto({
                            gaussIn: inGauss,
                            colorIn: inColor,
                            gaussOut: outSplat.gaussianBuffer,
                            colorOut: outSplat.shBuffer,
                            n: runtimeConvertInfo.n,
                            colorDim: runtimeConvertInfo.colorDim,
                        });
                        device.queue.submit([enc.finish()]);
                    }
                }
            } catch {}
        }

        // 渲染场景
        gaussianRenderer.renderThreeScene(camera);
        gaussianRenderer.drawSplats(renderer!, scene!, camera);
    });
}

// 启动应用
main().catch(console.error);


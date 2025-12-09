import * as THREE from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { TimelineController } from "../timeline";
import { FBXLoaderManager } from "../app/managers/fbx-loader";
import { ModelManager } from "../app/managers/model-manager";
import { FBXModelWrapper } from "../models/fbx-model-wrapper";

// 全局变量
let renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls;
let timelineController: TimelineController;
let fbxLoaderManager: FBXLoaderManager;
let modelManager: ModelManager;
let currentFBXModel: any = null;
let animationSelect: HTMLSelectElement, timeSlider: HTMLInputElement, speedSlider: HTMLInputElement, timeScaleSlider: HTMLInputElement;
let playBtn: HTMLButtonElement, pauseBtn: HTMLButtonElement, stopBtn: HTMLButtonElement;
let statusDiv: HTMLDivElement;

// 初始化
async function init() {
    // 获取 DOM 元素
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    animationSelect = document.getElementById('animationSelect') as HTMLSelectElement;
    timeSlider = document.getElementById('timeSlider') as HTMLInputElement;
    speedSlider = document.getElementById('speedSlider') as HTMLInputElement;
    timeScaleSlider = document.getElementById('timeScaleSlider') as HTMLInputElement;
    playBtn = document.getElementById('playBtn') as HTMLButtonElement;
    pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
    stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
    statusDiv = document.getElementById('status') as HTMLDivElement;

    // 初始化 Three.js WebGPU 渲染器
    renderer = new THREE.WebGPURenderer({ canvas });
    await renderer.init();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 10000);
    camera.position.set(5, 5, 5);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // 添加光照
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    scene.add(directionalLight);

    // 添加一个测试立方体来验证渲染系统
    const testGeometry = new THREE.BoxGeometry(1, 1, 1);
    const testMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const testCube = new THREE.Mesh(testGeometry, testMaterial);
    testCube.position.set(0, 0, 0);
    scene.add(testCube);
    console.log("添加了测试立方体");

    // 初始化管理器
    modelManager = new ModelManager();
    fbxLoaderManager = new FBXLoaderManager(modelManager, {
        onProgress: (progress: number, message: string) => {
            statusDiv.textContent = `${message} (${progress.toFixed(1)}%)`;
        },
        onError: (error: string) => {
            statusDiv.textContent = `错误: ${error}`;
        },
        onSuccess: (model: any) => {
            statusDiv.textContent = `成功加载: ${model.name}`;
            setupFBXModel(model);
        }
    });

    // 初始化时间轴控制器
    timelineController = new TimelineController({
        timeScale: 1.0,
        animationSpeed: 1.0,
        timeUpdateMode: 'variable_delta'
    });

    // 设置文件输入监听
    document.getElementById('fbxFile')?.addEventListener('change', handleFileSelect);

    // 开始渲染循环
    animate().catch(console.error);

    statusDiv.textContent = "初始化完成，请加载 FBX 文件";
}

// 处理文件选择
async function handleFileSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
        try {
            statusDiv.textContent = "正在加载 FBX 文件...";
            const modelEntry = await fbxLoaderManager.loadFromFile(file);
            // 手动添加到场景
            const fbxWrapper = modelEntry.pointCloud;
            
            // 类型检查：确保这是 FBX 模型
            if (!(fbxWrapper instanceof FBXModelWrapper)) {
                throw new Error("Expected FBXModelWrapper but got different type");
            }
            
            // 调试信息
            console.log("FBX 模型信息:", {
                name: modelEntry.name,
                pointCount: modelEntry.pointCount,
                isDynamic: modelEntry.isDynamic,
                modelType: modelEntry.modelType
            });
            
            console.log("FBX 对象信息:", {
                object3D: fbxWrapper.object3D,
                position: fbxWrapper.object3D.position,
                scale: fbxWrapper.object3D.scale,
                visible: fbxWrapper.object3D.visible,
                children: fbxWrapper.object3D.children.length
            });
            
            // 计算边界框来调整相机位置
            const box = new THREE.Box3().setFromObject(fbxWrapper.object3D);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            
            console.log("模型边界框:", {
                size: size,
                center: center,
                min: box.min,
                max: box.max
            });
            
            // 如果模型很小或位置不对，调整相机
            if (size.length() < 0.1) {
                console.warn("模型很小，可能需要调整缩放");
                fbxWrapper.object3D.scale.setScalar(10);
            }
            
            // 将模型居中
            fbxWrapper.object3D.position.sub(center);
            
            scene.add(fbxWrapper.object3D);
            setupFBXModel(modelEntry);
            
            // 调整相机位置以查看模型
            const maxDim = Math.max(size.x, size.y, size.z);
            const distance = maxDim * 2;
            camera.position.set(distance, distance, distance);
            camera.lookAt(0, 0, 0);
            controls.target.set(0, 0, 0);
            controls.update();
            
            statusDiv.textContent = `模型加载成功: ${modelEntry.name}`;
        } catch (error: any) {
            statusDiv.textContent = `加载失败: ${error.message}`;
        }
    }
}

// 加载示例 FBX（这里可以添加一个示例 URL）
async function loadSampleFBX() {
    // 这里可以添加一个示例 FBX 文件的 URL
    statusDiv.textContent = "暂无示例 FBX 文件";
}

// 设置 FBX 模型
function setupFBXModel(model: any) {
    currentFBXModel = model;
    const fbxWrapper = model.pointCloud;

    // 更新动画选择器
    animationSelect.innerHTML = '<option value="">选择动画...</option>';
    const clips = fbxWrapper.getClipInfo();
    clips.forEach((clip: any, index: number) => {
        const option = document.createElement('option');
        option.value = index.toString();
        option.textContent = `${clip.name} (${clip.duration.toFixed(2)}s)`;
        animationSelect.appendChild(option);
    });

    // 设置时间滑块范围
    if (clips.length > 0) {
        const maxDuration = Math.max(...clips.map((c: any) => c.duration));
        timeSlider.max = maxDuration.toString();
        timeSlider.step = (maxDuration / 1000).toString();
    }

    // 启用控件
    enableControls(true);

    // 自动播放第一个动画
    if (clips.length > 0) {
        animationSelect.value = "0";
        switchAnimation();
        playAnimation();
    }
}

// 启用/禁用控件
function enableControls(enabled: boolean) {
    animationSelect.disabled = !enabled;
    timeSlider.disabled = !enabled;
    speedSlider.disabled = !enabled;
    timeScaleSlider.disabled = !enabled;
    playBtn.disabled = !enabled;
    pauseBtn.disabled = !enabled;
    stopBtn.disabled = !enabled;
}

// 播放动画
function playAnimation() {
    if (currentFBXModel) {
        const fbxWrapper = currentFBXModel.pointCloud;
        fbxWrapper.startAnimation();
        timelineController.start();
        playBtn.disabled = true;
        pauseBtn.disabled = false;
        stopBtn.disabled = false;
    }
}

// 暂停动画
function pauseAnimation() {
    if (currentFBXModel) {
        const fbxWrapper = currentFBXModel.pointCloud;
        fbxWrapper.pauseAnimation();
        timelineController.pause();
        playBtn.disabled = false;
        pauseBtn.disabled = true;
    }
}

// 停止动画
function stopAnimation() {
    if (currentFBXModel) {
        const fbxWrapper = currentFBXModel.pointCloud;
        fbxWrapper.stopAnimation();
        timelineController.stop();
        playBtn.disabled = false;
        pauseBtn.disabled = true;
        stopBtn.disabled = true;
        timeSlider.value = "0";
        updateTimeDisplay(0);
    }
}

// 切换动画
function switchAnimation() {
    if (currentFBXModel) {
        const fbxWrapper = currentFBXModel.pointCloud;
        const clipIndex = parseInt(animationSelect.value);
        if (clipIndex >= 0) {
            fbxWrapper.switchToClip(clipIndex);
            const clips = fbxWrapper.getClipInfo();
            if (clips[clipIndex]) {
                timeSlider.max = clips[clipIndex].duration.toString();
                timeSlider.step = (clips[clipIndex].duration / 1000).toString();
            }
        }
    }
}

// 更新速度
function updateSpeed() {
    const speed = parseFloat(speedSlider.value);
    if (currentFBXModel) {
        const fbxWrapper = currentFBXModel.pointCloud;
        fbxWrapper.setAnimationSpeed(speed);
        timelineController.setSpeed(speed);
    }
    document.getElementById('speedValue')!.textContent = speed.toFixed(1) + 'x';
}

// 设置时间
function setTime() {
    const time = parseFloat(timeSlider.value);
    if (currentFBXModel) {
        const fbxWrapper = currentFBXModel.pointCloud;
        fbxWrapper.setAnimationTime(time);
    }
    updateTimeDisplay(time);
}

// 更新时间显示
function updateTimeDisplay(time: number) {
    document.getElementById('timeValue')!.textContent = time.toFixed(2) + 's';
}

// 更新时间缩放
function updateTimeScale() {
    const timeScale = parseFloat(timeScaleSlider.value);
    if (currentFBXModel) {
        const fbxWrapper = currentFBXModel.pointCloud;
        fbxWrapper.setTimeScale(timeScale);
        timelineController.setTimeScale(timeScale);
    }
    document.getElementById('timeScaleValue')!.textContent = timeScale.toFixed(1) + 'x';
}

// 渲染循环
async function animate() {
    requestAnimationFrame(animate);

    // 更新控制器
    controls.update();

    // 更新时间轴
    const currentTime = timelineController.update();
    
    // 更新 FBX 模型
    if (currentFBXModel) {
        const fbxWrapper = currentFBXModel.pointCloud;
        const deltaTime = 0.016; // 假设 60 FPS
        fbxWrapper.update(deltaTime);
        
        // 更新时间滑块
        const currentAnimationTime = fbxWrapper.getCurrentTime();
        timeSlider.value = currentAnimationTime.toString();
        updateTimeDisplay(currentAnimationTime);
    }

    // 渲染场景（使用异步渲染）
    await renderer.renderAsync(scene, camera);
}

// 窗口大小调整
window.addEventListener('resize', () => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
});

// 将函数绑定到 window 对象，以便 HTML 中的 onclick 可以调用
(window as any).loadSampleFBX = loadSampleFBX;
(window as any).playAnimation = playAnimation;
(window as any).pauseAnimation = pauseAnimation;
(window as any).stopAnimation = stopAnimation;
(window as any).switchAnimation = switchAnimation;
(window as any).updateSpeed = updateSpeed;
(window as any).setTime = setTime;
(window as any).updateTimeScale = updateTimeScale;

// 启动应用
init().catch(console.error);

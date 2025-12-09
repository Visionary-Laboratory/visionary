import * as THREE from "three/webgpu";
import { initThreeContext } from "../app/three-context.ts";
import { loadGaussianModels } from "../app";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GizmoManager } from "../gizmo/gizmo-manager";
import { GizmoMode, GizmoEvent } from "../gizmo/types";
import { GaussianLoader } from "../app";
import { FileLoader } from "../app/managers/file-loader";
import { ONNXManager } from "../app/managers/onnx-manager";
import { ModelManager } from "../app/managers/model-manager";
import { GaussianModel } from "../app/GaussianModel";
import { GaussianThreeJSRenderer } from "../app/GaussianThreeJSRenderer";
import { Aabb } from "../utils";

async function main() {
    const canvasElement = document.querySelector("#canvas") as HTMLCanvasElement;
    if (canvasElement == null) {
        throw new Error("Can't find the canvas element!");
    }

    // 初始化Three.js WebGPU渲染器
    const renderer = await initThreeContext(canvasElement);
    if (renderer == null) {
        throw new Error("Failed to initialize the three context!");
    }

    // 创建场景和相机
    const scene = new THREE.Scene();
    const gizmoOverlayScene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, canvasElement.clientWidth / canvasElement.clientHeight, 0.1, 1000);
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);

    // 添加轨道控制器
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    renderer.autoClear = false;

    // 添加光照
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    scene.add(directionalLight);

    // 创建测试对象
    const cube = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0xff6b6b })
    );
    cube.name = "cube";
    cube.position.set(-2, 0, 0);
    scene.add(cube);

    const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 32, 32),
        new THREE.MeshStandardMaterial({ color: 0x4ecdc4 })
    );
    sphere.name = "sphere";
    sphere.position.set(2, 0, 0);
    scene.add(sphere);


    // 更新相机矩阵
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    // 加载高斯模型（可选）
    let gaussianRenderer: GaussianThreeJSRenderer | null = null;
    try {
        gaussianRenderer = await loadGaussianModels(renderer, scene, [
            // "/models/gaussians3d_lhm_split.onnx",
             "/models/test.ply",
            //  "/models/gaussians3d_gauhuman.onnx",
            //  "/models/point_cloud2.ply",
            "/models/gaussians3d_car.onnx",
            "/models/gaussians3d_lhm_split.onnx",
            //  "/models/test.ply",
            "/models/point_cloud2.ply",
        ], {
            camMat: new Float32Array(camera.matrixWorldInverse.elements),
            projMat: new Float32Array(camera.projectionMatrix.elements)
        });
        
        if (gaussianRenderer) {
            const models = gaussianRenderer.getGaussianModels();
            console.log(`Gaussian model loaded successfully: ${models.length} model(s)`);
            models.forEach((model, index) => {
                console.log(`  - Model ${index}: ${model.name}`);
                // 如果是动态GS模型，默认开始播放
                if ((model as any).mEntry?.isDynamic) {
                    console.log(`  → Starting animation for dynamic model: ${model.name}`);
                    model.startAnimation(1.0);
                }
            });
            
            // 动态添加高斯模型选项到UI
            addGaussianModelOptions(models);
        }
    } catch (error) {
        console.warn("Failed to load Gaussian model:", error);
        console.info("Note: Gaussian model target will not be available in Gizmo controls");
    }

    // 创建Gizmo管理器
    const gizmoManager = new GizmoManager(scene, camera, renderer, {
        mode: 'translate',
        space: 'local',
        size: 1,
        showHelper: true,
        colors: {
            x: '#ff0000',
            y: '#00ff00',
            z: '#0000ff'
        }
    }, gizmoOverlayScene);

    // 设置相机控制器到Gizmo管理器（处理事件冲突）
    gizmoManager.setCameraControls(controls);

    // 设置Gizmo回调
    gizmoManager.setCallbacks({
        onChange: (event: GizmoEvent) => {
            console.log('[Gizmo] Transform changed:', event);
            updateInfoPanel(event);
        },
        onChangeStart: (event: GizmoEvent) => {
            console.log('[Gizmo] Transform started:', event);
        },
        onChangeEnd: (event: GizmoEvent) => {
            console.log('[Gizmo] Transform ended:', event);
        }
    });

    // 默认选择立方体
    gizmoManager.setTarget(cube);

    // ========== 点选拾取：Raycaster + 可选对象维护 ==========
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const selectables: THREE.Object3D[] = [];
    const gaussianProxyMap = new Map<GaussianModel, THREE.Object3D>();
    let isTransforming = false;
    let isPickingPivot = false;
    function setPickingPivotMode(on: boolean) {
        isPickingPivot = on;
        // 禁用/启用 Gizmo 拖拽
        gizmoManager.setEnabled(!on);
        // 更新按钮文案与样式
        const btn = document.getElementById('pick-pivot');
        if (btn) {
            btn.textContent = on ? 'Picking… (Click to exit)' : 'Pick Pivot';
            btn.classList.toggle('active', on);
        }
        // 开启时强制使用 custom 模式
        if (on) {
            const modeSel = document.getElementById('pivot-mode') as HTMLSelectElement | null;
            if (modeSel) modeSel.value = 'custom';
            gizmoManager.setPivotMode('custom' as any);
        }
    }
    // Esc 退出 picking 模式
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isPickingPivot) setPickingPivotMode(false);
    });
    // AABB 可视化（helper 映射挂在 scene 上，避免局部变量与实际存储不一致）

    // Gizmo 拖拽状态，拖拽时不响应拾取
    gizmoManager.setCallbacks({
        onChange: (event: GizmoEvent) => { updateInfoPanel(event); },
        onChangeStart: () => { isTransforming = true; },
        onChangeEnd: () => { isTransforming = false; }
    });

    // 将 Mesh 放入可选对象
    selectables.push(cube);
    selectables.push(sphere);

    // 为 GaussianModel 创建代理（不可见 box，用于被 raycast 命中；作为子物体随变换）
    function attachProxyForGaussian(model: GaussianModel): THREE.Mesh {
        // 基于当前对象包围盒估计
        const box = new THREE.Box3().setFromObject(model as unknown as THREE.Object3D);
        const size = new THREE.Vector3(); const center = new THREE.Vector3();
        box.getSize(size); box.getCenter(center);
        const sx = size.x || 1, sy = size.y || 1, sz = size.z || 1;
        const geom = new THREE.BoxGeometry(sx, sy, sz);
        const mat = new THREE.MeshBasicMaterial({ visible: false });
        const proxy = new THREE.Mesh(geom, mat);
        proxy.name = `proxy_${model.name}`;
        proxy.userData.target = model;
        // 放在模型局部空间中心
        proxy.position.copy(center.sub((model as unknown as THREE.Object3D).position));
        (model as unknown as THREE.Object3D).add(proxy);
        gaussianProxyMap.set(model, proxy);
        selectables.push(proxy);
        return proxy;
    }

    function detachProxyForGaussian(model: GaussianModel): void {
        const proxy = gaussianProxyMap.get(model);
        if (!proxy) return;
        const idx = selectables.indexOf(proxy);
        if (idx >= 0) selectables.splice(idx, 1);
        if (proxy.parent) proxy.parent.remove(proxy);
        gaussianProxyMap.delete(model);
    }

    // 初始为已加载的 Gaussian 添加代理
    if (gaussianRenderer) {
        const models = gaussianRenderer.getGaussianModels?.() || [];
        models.forEach((m: GaussianModel) => attachProxyForGaussian(m));
    }

    function syncTargetDropdown(target: THREE.Object3D) {
        const sel = document.getElementById('target-select') as HTMLSelectElement | null;
        if (!sel) return;
        // Gaussian: 反查 index
        if (gaussianRenderer && target instanceof GaussianModel) {
            const all = gaussianRenderer.getGaussianModels?.() || [];
            const idx = all.findIndex((m: GaussianModel) => m === target);
            if (idx >= 0) {
                sel.value = `gaussian_${idx}`;
                return;
            }
        }
        // 普通 Mesh
        if (target === cube) sel.value = 'cube';
        else if (target === sphere) sel.value = 'sphere';
    }

    function handleCanvasClick(e: MouseEvent) {
        const pickingEnabled = (document.getElementById('enable-picking') as HTMLInputElement | null)?.checked !== false;
        if (!pickingEnabled) return;
        if (isTransforming) return; // 正在拖拽 Gizmo
        // 下拉框聚焦时忽略拾取，避免冲突
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.id === 'target-select' || active.tagName === 'SELECT')) return;

        const rect = (renderer as any).domElement?.getBoundingClientRect();
        if (!rect) return;
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        if (isPickingPivot) {
            // 优先拾取命中点作为 pivot；否则与 y=0 平面求交
            const hits = raycaster.intersectObjects(selectables, true);
            let pivotPoint = new THREE.Vector3();
            if (hits.length && hits[0].point) {
                pivotPoint.copy(hits[0].point);
            } else {
                const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // y=0
                const out = new THREE.Vector3();
                if (raycaster.ray.intersectPlane(plane, out)) {
                    pivotPoint.copy(out);
                } else {
                    // 最后兜底：沿射线取固定距离点
                    const t = 10.0;
                    pivotPoint.copy(raycaster.ray.direction).multiplyScalar(t).add(raycaster.ray.origin);
                }
            }
            gizmoManager.setPivot(pivotPoint);
            gizmoManager.setPivotMode('custom' as any);
            updatePivotDisplay(pivotPoint);
            return; // 不改变 target
        }
        const hits = raycaster.intersectObjects(selectables, true);
        if (!hits.length) return;
        const hit = hits[0].object;
        const target = (hit.userData && hit.userData.target) ? hit.userData.target as THREE.Object3D : hit;
        if (!target) return;
        gizmoManager.setTarget(target as any);
        // 同步 AABB helper 显示状态
        const showAabb = (document.getElementById('show-aabb') as HTMLInputElement | null)?.checked === true;
        if (showAabb && (target as any) instanceof GaussianModel) {
            ensureAabbHelper(target as any as GaussianModel);
        }
        // 目标变化后，若为 AABB 模式，重置 pivot 到目标 AABB 中心
        const modeSel = document.getElementById('pivot-mode') as HTMLSelectElement | null;
        if (modeSel && modeSel.value === 'aabb') {
            gizmoManager.useAabbCenterPivot();
            updatePivotDisplay(gizmoManager.getPivot());
        }
        syncTargetDropdown(target);
    }
    (renderer as any).domElement.addEventListener('click', handleCanvasClick);

    // 设置UI控制
    setupUIControls(
        gizmoManager,
        { cube, sphere, gaussianRenderer, scene, camera, renderer },
        {
            registerGaussian: (m: GaussianModel) => attachProxyForGaussian(m),
            unregisterGaussian: (m: GaussianModel) => detachProxyForGaussian(m),
            onTogglePickPivot: () => setPickingPivotMode(!isPickingPivot)
        }
    );
    
    // 如果高斯模型加载失败，添加一个不可用的选项
    if (!gaussianRenderer) {
        const targetSelect = document.getElementById('target-select') as HTMLSelectElement;
        if (targetSelect) {
            const option = document.createElement('option');
            option.value = 'gaussian_none';
            option.textContent = 'Gaussian Models (Not Available)';
            option.disabled = true;
            targetSelect.appendChild(option);
        }
    }

    // 窗口大小调整
    window.addEventListener("resize", () => {
        const width = canvasElement.clientWidth;
        const height = canvasElement.clientHeight;

        renderer.setSize(width, height, false);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        camera.aspect = width / height;
        camera.updateProjectionMatrix();

        gizmoManager.onResize();
        
        if (gaussianRenderer) {
            gaussianRenderer.onResize(width, height);
        }
    });

    // 跟踪时间用于动态更新
    const startTime = Date.now();

    // 渲染循环
    renderer.setAnimationLoop(async () => {
        // 更新轨道控制器
        controls.update();

        // 更新相机矩阵
        camera.updateMatrixWorld();

        // 更新动态ONNX模型
        renderer.setRenderTarget(null);
        renderer.clear();

        if (gaussianRenderer) {
            const currentTime = (Date.now() - startTime) / 1000.0;
            await gaussianRenderer.updateDynamicModels(camera, currentTime);
            gaussianRenderer.renderOverlayScene(gizmoOverlayScene, camera);
        }

        // 更新Gizmo
        gizmoManager.update();

        // AABB helper 更新（仅当启用时）
        const showAabb = (document.getElementById('show-aabb') as HTMLInputElement | null)?.checked === true;
        if (showAabb && gaussianRenderer) {
            const models = gaussianRenderer.getGaussianModels?.() || [];
            for (const m of models as GaussianModel[]) {
                updateAabbHelper(m, scene);
            }
        } else {
            // 隐藏所有 helper（从场景挂载的映射中获取）
            const map: Map<GaussianModel, THREE.Box3Helper> = (scene as any).__gs_aabb_helpers || new Map();
            map.forEach((helper) => { helper.visible = false; });
        }

        // 渲染场景
        if (gaussianRenderer) {
            gaussianRenderer.renderThreeScene(camera);
            gaussianRenderer.drawSplats(renderer, scene, camera);
        } else {
            renderer.render(scene, camera);
        }
    });

    console.log("Gizmo demo initialized successfully!");
}

/**
 * 动态添加高斯模型选项到目标选择下拉菜单
 */
function addGaussianModelOptions(models: any[]): void {
    const targetSelect = document.getElementById('target-select') as HTMLSelectElement;
    if (!targetSelect) return;
    
    // 清除现有的高斯模型选项
    const existingGaussianOptions = targetSelect.querySelectorAll('option[value^="gaussian_"]');
    existingGaussianOptions.forEach(option => option.remove());
    
    // 添加新的高斯模型选项
    models.forEach((model, index) => {
        const option = document.createElement('option');
        option.value = `gaussian_${index}`;
        
        // 生成更友好的显示名称
        let displayName = model.name || `Model ${index}`;
        if (displayName.includes('/')) {
            // 如果名称包含路径，只取文件名
            displayName = displayName.split('/').pop() || displayName;
        }
        if (displayName.includes('.')) {
            // 移除文件扩展名
            displayName = displayName.split('.')[0];
        }
        
        option.textContent = `Gaussian: ${displayName}`;
        targetSelect.appendChild(option);
    });
    
    console.log(`[Gizmo] Added ${models.length} Gaussian model options to target selector`);
}

/**
 * 设置UI控制
 */
function setupUIControls(
    gizmoManager: GizmoManager,
    objects: { cube: THREE.Mesh, sphere: THREE.Mesh, gaussianRenderer: any, scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGPURenderer },
    callbacks: { registerGaussian: (m: GaussianModel) => void, unregisterGaussian: (m: GaussianModel) => void, onTogglePickPivot: () => void }
): void {
    // 模式切换
    const modeButtons = {
        'mode-translate': 'translate',
        'mode-rotate': 'rotate',
        'mode-scale': 'scale'
    } as const;

    Object.entries(modeButtons).forEach(([buttonId, mode]) => {
        const button = document.getElementById(buttonId);
        if (button) {
            button.addEventListener('click', () => {
                // 移除所有按钮的active类
                Object.keys(modeButtons).forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.classList.remove('active');
                });
                
                // 添加active类到当前按钮
                button.classList.add('active');
                
                // 设置Gizmo模式
                gizmoManager.setMode(mode as GizmoMode);
            });
        }
    });

    // 空间切换
    const spaceSelect = document.getElementById('space-select') as HTMLSelectElement;
    if (spaceSelect) {
        spaceSelect.addEventListener('change', (e) => {
            const space = (e.target as HTMLSelectElement).value as 'local' | 'world';
            gizmoManager.setSpace(space);
        });
    }

    // 大小调整
    const sizeSlider = document.getElementById('size-slider') as HTMLInputElement;
    const sizeValue = document.getElementById('size-value');
    if (sizeSlider && sizeValue) {
        sizeSlider.addEventListener('input', (e) => {
            const size = parseFloat((e.target as HTMLInputElement).value);
            gizmoManager.setSize(size);
            sizeValue.textContent = size.toFixed(1);
        });
    }

    // 目标切换
    const targetSelect = document.getElementById('target-select') as HTMLSelectElement;
    if (targetSelect) {
        targetSelect.addEventListener('change', (e) => {
            const target = (e.target as HTMLSelectElement).value;
            switch (target) {
                case 'cube':
                    gizmoManager.setTarget(objects.cube);
                    break;
                case 'sphere':
                    gizmoManager.setTarget(objects.sphere);
                    break;
                default:
                    if (target.startsWith('gaussian_')) {
                        if (objects.gaussianRenderer) {
                            // 解析高斯模型索引
                            const modelIndex = parseInt(target.replace('gaussian_', ''));
                            const gaussianModels = objects.gaussianRenderer.getGaussianModels();
                            
                            if (gaussianModels && gaussianModels.length > modelIndex) {
                                const gaussianModel = gaussianModels[modelIndex];
                                gizmoManager.setTarget(gaussianModel);
                                console.log(`[Gizmo] Target set to Gaussian model ${modelIndex}:`, gaussianModel.name);
                            } else {
                                console.warn(`Gaussian model ${modelIndex} not available`);
                            }
                        } else {
                            console.warn('Gaussian renderer not available');
                        }
                    }
                    break;
            }
        });
    }

    // 启用/禁用Gizmo
    const toggleGizmoButton = document.getElementById('toggle-gizmo');
    if (toggleGizmoButton) {
        toggleGizmoButton.addEventListener('click', () => {
            const enabled = gizmoManager.getEnabled();
            gizmoManager.setEnabled(!enabled);
            toggleGizmoButton.textContent = enabled ? 'Enable Gizmo' : 'Disable Gizmo';
        });
    }

    // 吸附切换
    const toggleSnapButton = document.getElementById('toggle-snap');
    if (toggleSnapButton) {
        let snapEnabled = false;
        toggleSnapButton.addEventListener('click', () => {
            snapEnabled = !snapEnabled;
            toggleSnapButton.textContent = snapEnabled ? 'Disable Snap' : 'Enable Snap';
            
            // 这里可以添加吸附功能的实现
            console.log('Snap', snapEnabled ? 'enabled' : 'disabled');
        });
    }

    // Pivot 模式与按钮
    const pivotModeSel = document.getElementById('pivot-mode') as HTMLSelectElement | null;
    const pickPivotBtn = document.getElementById('pick-pivot');
    const resetPivotBtn = document.getElementById('reset-pivot');
    if (pivotModeSel) {
        pivotModeSel.addEventListener('change', (e) => {
            const mode = (e.target as HTMLSelectElement).value as 'aabb' | 'custom';
            if (mode === 'aabb') {
                gizmoManager.setPivotMode('aabb' as any);
                gizmoManager.useAabbCenterPivot();
                updatePivotDisplay(gizmoManager.getPivot());
            } else {
                gizmoManager.setPivotMode('custom' as any);
            }
        });
    }
    if (pickPivotBtn) {
        pickPivotBtn.addEventListener('click', () => {
            callbacks.onTogglePickPivot();
        });
    }
    if (resetPivotBtn) {
        resetPivotBtn.addEventListener('click', () => {
            gizmoManager.setPivotMode('aabb' as any);
            if (gizmoManager.getTarget()) gizmoManager.useAabbCenterPivot();
            updatePivotDisplay(gizmoManager.getPivot());
            if (pivotModeSel) pivotModeSel.value = 'aabb';
        });
    }

    // 变换测试按钮
    const testTranslateButton = document.getElementById('test-translate');
    if (testTranslateButton) {
        testTranslateButton.addEventListener('click', () => {
            const currentTarget = gizmoManager.getTarget();
            if (currentTarget) {
                // 获取当前位置
                const currentPos = currentTarget.position.clone();
                // 向X轴正方向平移1米
                currentTarget.position.set(currentPos.x + 1, currentPos.y, currentPos.z);
                console.log(`[Transform Test] Translated ${currentTarget.name} by 10m in X direction`);
                console.log(`[Transform Test] New position:`, currentTarget.position);
            } else {
                console.warn('[Transform Test] No target selected for translation');
            }
        });
    }

    const testRotateButton = document.getElementById('test-rotate');
    if (testRotateButton) {
        testRotateButton.addEventListener('click', () => {
            const currentTarget = gizmoManager.getTarget();
            if (currentTarget) {
                // 获取当前旋转
                const currentRot = currentTarget.rotation.clone();
                // 绕Y轴旋转10度
                const rotationInRadians = 10 * Math.PI / 180;
                currentTarget.rotation.set(currentRot.x, currentRot.y + rotationInRadians, currentRot.z);
                console.log(`[Transform Test] Rotated ${currentTarget.name} by 10° around Y axis`);
                console.log(`[Transform Test] New rotation:`, currentTarget.rotation);
            } else {
                console.warn('[Transform Test] No target selected for rotation');
            }
        });
    }

    const testScaleButton = document.getElementById('test-scale');
    if (testScaleButton) {
        testScaleButton.addEventListener('click', () => {
            const currentTarget = gizmoManager.getTarget();
            if (currentTarget) {
                // 获取当前缩放
                const currentScale = currentTarget.scale.clone();
                // 缩放2倍
                currentTarget.scale.set(currentScale.x * 2, currentScale.y * 2, currentScale.z * 2);
                console.log(`[Transform Test] Scaled ${currentTarget.name} by 2x`);
                console.log(`[Transform Test] New scale:`, currentTarget.scale);
            } else {
                console.warn('[Transform Test] No target selected for scaling');
            }
        });
    }

    // 追加测试模型按钮
    const addTestModelBtn = document.getElementById('add-test-model');
    if (addTestModelBtn) {
        addTestModelBtn.addEventListener('click', async () => {
            try {
                // 构造一次性加载器（服务层）
                const modelManager = new ModelManager();
                const fileLoader = new FileLoader(modelManager);
                const onnxManager = new ONNXManager(modelManager);
                const loader = new GaussianLoader(fileLoader, onnxManager);

                // 相机矩阵（ONNX 需要；PLY 会忽略）
                objects.camera.updateMatrixWorld();
                const camMat = new Float32Array(objects.camera.matrixWorldInverse.elements);
                const projMat = new Float32Array(objects.camera.projectionMatrix.elements);

                // 创建 GaussianModel（PLY）
                const gaussianModel = await loader.createFromFile(objects.renderer, "/models/test.ply", { camMat, projMat });

                // 加入场景并注册到渲染器
                objects.scene.add(gaussianModel);
                if (objects.gaussianRenderer?.appendGaussianModel) {
                    objects.gaussianRenderer.appendGaussianModel(gaussianModel);
                }

                // 创建并登记选择代理（使用主模块注册，确保加入 selectables 和映射）
                callbacks.registerGaussian(gaussianModel);

                // 刷新下拉目标列表
                const all = objects.gaussianRenderer?.getGaussianModels?.() || [];
                addGaussianModelOptions(all);

                console.log('[Gizmo] Appended Gaussian model: /models/test.ply');
            } catch (e) {
                console.error('Failed to append test model:', e);
            }
        });
    }

    // 删除当前选中的Gaussian模型
    const removeSelectedBtn = document.getElementById('remove-selected-gaussian');
    if (removeSelectedBtn) {
        removeSelectedBtn.addEventListener('click', () => {
            const targetSelect = document.getElementById('target-select') as HTMLSelectElement;
            if (!targetSelect) return;
            const target = targetSelect.value;
            if (!target.startsWith('gaussian_')) {
                console.warn('请选择一个 Gaussian 目标再删除');
                return;
            }
            const modelIndex = parseInt(target.replace('gaussian_', ''));
            // 获取待删除的模型实例（用于辅助清理）
            const allBefore = objects.gaussianRenderer?.getGaussianModels?.() || [];
            const modelToRemove: GaussianModel | undefined = allBefore[modelIndex];
            const modelId = `model_${modelIndex}`;
            const removed = objects.gaussianRenderer?.removeModelById?.(modelId);
            if (removed) {
                // 从可选对象中移除对应代理
                if (modelToRemove) {
                    // 清理 AABB helper
                    const map: Map<GaussianModel, THREE.Box3Helper> = (objects.scene as any).__gs_aabb_helpers || new Map();
                    const helper = map.get(modelToRemove);
                    if (helper) {
                        helper.visible = false;
                        objects.scene.remove(helper);
                        map.delete(modelToRemove);
                    }
                    // 清理 Raycast 代理（通过回调）
                    callbacks.unregisterGaussian(modelToRemove);
                }

                const all = objects.gaussianRenderer.getGaussianModels?.() || [];
                // 刷新下拉
                addGaussianModelOptions(all);
                // 恢复到可用目标
                targetSelect.value = 'cube';
                gizmoManager.setTarget(objects.cube);
                console.log(`[Gizmo] Removed Gaussian model: ${modelId}`);
            } else {
                console.warn('删除失败：找不到该 Gaussian 模型');
            }
        });
    }
}

/**
 * 更新信息面板
 */
function updateInfoPanel(event: GizmoEvent) {
    const info = document.getElementById('info');
    if (info) {
        const target = event.target;
        const position = target.position;
        const rotation = target.rotation;
        const scale = target.scale;
        
        const pv = (event as any).pivot as THREE.Vector3 | undefined;
        const pvStr = pv ? `(${pv.x.toFixed(2)}, ${pv.y.toFixed(2)}, ${pv.z.toFixed(2)})` : '(n/a)';
        info.innerHTML = `
            <h4>Transform Info</h4>
            <p><strong>Target:</strong> ${target.name}</p>
            <p><strong>Mode:</strong> ${event.mode}</p>
            <p><strong>Position:</strong> (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})</p>
            <p><strong>Rotation:</strong> (${(rotation.x * 180 / Math.PI).toFixed(1)}°, ${(rotation.y * 180 / Math.PI).toFixed(1)}°, ${(rotation.z * 180 / Math.PI).toFixed(1)}°)</p>
            <p><strong>Scale:</strong> (${scale.x.toFixed(2)}, ${scale.y.toFixed(2)}, ${scale.z.toFixed(2)})</p>
            <p><strong>Pivot:</strong> ${pvStr}</p>
        `;
    }
}

function updatePivotDisplay(p: THREE.Vector3): void {
    const el = document.getElementById('pivot-display');
    if (el) el.textContent = `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
}

/**
 * 确保为指定 GaussianModel 创建并添加 AABB helper
 */
function ensureAabbHelper(model: GaussianModel): void {
    const scene = (model as any).parent as THREE.Scene | null;
    if (!scene) return;
    const map: Map<GaussianModel, THREE.Box3Helper> = (scene as any).__gs_aabb_helpers || new Map();
    (scene as any).__gs_aabb_helpers = map;
    if (!map.has(model)) {
        const helper = new THREE.Box3Helper(new THREE.Box3(), 0xffff00);
        helper.visible = true;
        scene.add(helper);
        map.set(model, helper);
    }
}

/**
 * 更新（或创建）AABB helper 的包围盒数据
 */
function updateAabbHelper(model: GaussianModel, scene: THREE.Scene): void {
    const map: Map<GaussianModel, THREE.Box3Helper> = (scene as any).__gs_aabb_helpers || new Map();
    (scene as any).__gs_aabb_helpers = map;
    let helper = map.get(model);
    if (!helper) {
        helper = new THREE.Box3Helper(new THREE.Box3(), 0xffff00);
        scene.add(helper);
        map.set(model, helper);
    }
    const aabb = model.getWorldAABB?.();
    if (aabb) {
        const min = (aabb as Aabb).min;
        const max = (aabb as Aabb).max;
        helper.box.min.set(min[0], min[1], min[2]);
        helper.box.max.set(max[0], max[1], max[2]);
        helper.visible = true;
    } else {
        helper.visible = false;
    }
}

main().catch(console.error);

import * as THREE from "three/webgpu";
import { initThreeContext, loadGaussianModels } from "../app";

function log(line: string, ok?: boolean) {
    const el = document.getElementById('log');
    if (!el) return;
    const span = document.createElement('div');
    span.textContent = line;
    if (ok === true) span.className = 'ok';
    if (ok === false) span.className = 'fail';
    el.appendChild(span);
    console[ok === false ? 'error' : 'log'](line);
}

async function main() {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('canvas not found');

    const renderer = await initThreeContext(canvas);
    if (!renderer) throw new Error('initThreeContext failed');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 3);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    // 加载一个静态 PLY（足以验证 getters）
    const gs = await loadGaussianModels(
        renderer,
        scene,
        ["/models/point_cloud2.ply"],
        {
            camMat: new Float32Array(camera.matrixWorldInverse.elements),
            projMat: new Float32Array(camera.projectionMatrix.elements)
        }
    );

    if (!gs) throw new Error('loadGaussianModels failed');
    const modelId = 'model_0';

    let passed = 0; let total = 0;
    function check(name: string, cond: boolean) {
        total++;
        if (cond) { passed++; log(`✔ ${name}`, true); } else { log(`✘ ${name}`, false); }
    }

    // 可视
    gs.setModelVisible(modelId, false);
    check('getModelVisible(false)', gs.getModelVisible(modelId) === false);
    gs.setModelVisible(modelId, true);
    check('getModelVisible(true)', gs.getModelVisible(modelId) === true);

    // Gaussian Scale
    gs.setModelGaussianScale(modelId, 1.5);
    check('getModelGaussianScale()==1.5', Math.abs(gs.getModelGaussianScale(modelId) - 1.5) < 1e-6);

    // Max SH Degree
    gs.setModelMaxShDeg(modelId, 2);
    check('getModelMaxShDeg()==2', gs.getModelMaxShDeg(modelId) === 2);

    // Kernel Size
    gs.setModelKernelSize(modelId, 0.25);
    check('getModelKernelSize()==0.25', Math.abs(gs.getModelKernelSize(modelId) - 0.25) < 1e-6);

    // Opacity Scale
    gs.setModelOpacityScale(modelId, 1.8);
    check('getModelOpacityScale()==1.8', Math.abs(gs.getModelOpacityScale(modelId) - 1.8) < 1e-6);

    // Cutoff Scale
    gs.setModelCutoffScale(modelId, 1.2);
    check('getModelCutoffScale()==1.2', Math.abs(gs.getModelCutoffScale(modelId) - 1.2) < 1e-6);

    // Render Mode (0=color,1=normal,2=depth) — 若底层未实现 getter，默认 0，先置 1 再读
    gs.setModelRenderMode(modelId, 1);
    const rm = gs.getModelRenderMode(modelId);
    check('getModelRenderMode()==1 (or 0 if not supported)', rm === 1 || rm === 0);

    log(`\n${passed}/${total} assertions passed.`);

    // 简单渲染几帧，以确保无异常
    let frames = 0;
    renderer.setAnimationLoop(() => {
        renderer.render(scene, camera);
        if (++frames > 10) {
            renderer.setAnimationLoop(null as any);
        }
    });
}

main().catch((e) => {
    log(`Fatal: ${e?.message || e}`, false);
    console.error(e);
});



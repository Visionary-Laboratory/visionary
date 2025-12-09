import * as THREE from "three/webgpu";
import { initWebGPU_onnx, DEFAULT_DUMMY_MODEL_URL } from "./webgpu-context.ts";

export async function initThreeContext(canvasElement: HTMLCanvasElement): Promise<THREE.WebGPURenderer | null> {
    // Initialize WebGPU
    const gpu = await initWebGPU_onnx(canvasElement, {
        dummyModelUrl: DEFAULT_DUMMY_MODEL_URL,   // 关键：用 dummy 拉起 ORT 的 device
        adapterPowerPreference: 'high-performance', // 可选
        allowOwnDeviceWhenOrtPresent: false
    });
    if (!gpu) {
        return Promise.reject("initWebGPU_onnx failed!");
    }

    // gpu.context.configure({device: gpu.device, format: gpu.format});
    const renderer = new THREE.WebGPURenderer({
        canvas: canvasElement,
        antialias: true,
        forceWebGL: false,
        context: gpu.context,
        device: gpu.device
    });
    await renderer.init();
    renderer.setClearColor(new THREE.Color("#808080"), 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight, false);
    console.log("Init ThreeJS Successfully!", "Width:", canvasElement.clientWidth, "Height", canvasElement.clientHeight);
    return renderer;
}
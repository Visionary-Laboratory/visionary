/**
 * App module exports
 */
import * as THREE from "three/webgpu";
import { GaussianModel } from "./GaussianModel";
import { GaussianThreeJSRenderer } from "./GaussianThreeJSRenderer";
import { GaussianLoader, GaussianLoadOptions } from "./managers/gaussian-loader";
import { FileLoader } from "./managers/file-loader";
import { ONNXManager } from "./managers/onnx-manager";
import { ModelManager } from "./managers/model-manager";

export { App } from './app';
export { DOMElements, setHidden, clamp, hexToRgb } from './dom-elements';
export { initThreeContext } from './three-context'
export { UIController } from './ui-controller';
export { initWebGPU, type WebGPUContext } from './webgpu-context';
export { GaussianModel } from './GaussianModel';
export { GaussianLoader, type GaussianLoadOptions } from './managers/gaussian-loader';
export type { ModelEntry, ModelInfo } from '../models/model-entry';

// Gizmo exports
export { GizmoManager, GizmoController } from '../gizmo';
export type { GizmoOptions, GizmoMode, GizmoEvent, GizmoCallbacks } from '../gizmo';

/**
 * Convenient high-level API for loading multiple Gaussian models
 * @param renderer - Three.js WebGPU renderer
 * @param scene - Three.js scene
 * @param frameOrModelPaths - Either a THREE.Group frame or array of model file paths (for backward compatibility)
 * @param modelPathsOrCamMat - Array of model file paths or camera matrices (depending on previous parameter)
 * @param camMat - Camera matrices (required for ONNX files)
 * @returns GaussianThreeJSRenderer instance or null
 */
export async function loadGaussianModels(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    frame: THREE.Group,
    modelPaths: string[],
    camMat?: {camMat: Float32Array, projMat: Float32Array}
): Promise<GaussianThreeJSRenderer | null>;
export async function loadGaussianModels(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    modelPaths: string[],
    camMat?: {camMat: Float32Array, projMat: Float32Array}
): Promise<GaussianThreeJSRenderer | null>;
export async function loadGaussianModels(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    frameOrModelPaths: THREE.Group | string[],
    modelPathsOrCamMat?: string[] | {camMat: Float32Array, projMat: Float32Array},
    camMat?: {camMat: Float32Array, projMat: Float32Array}
): Promise<GaussianThreeJSRenderer | null> {
    // Determine which overload was called
    let frame: THREE.Object3D;
    let modelPaths: string[];
    let camMatFinal: {camMat: Float32Array, projMat: Float32Array} | undefined;

    if (frameOrModelPaths instanceof THREE.Group) {
        // New signature: (renderer, scene, frame, modelPaths, camMat?)
        frame = frameOrModelPaths;
        modelPaths = modelPathsOrCamMat as string[];
        camMatFinal = camMat;
    } else {
        // Old signature: (renderer, scene, modelPaths, camMat?)
        frame = scene; // Use scene as default frame for backward compatibility
        modelPaths = frameOrModelPaths;
        camMatFinal = modelPathsOrCamMat as {camMat: Float32Array, projMat: Float32Array} | undefined;
    }

    if (modelPaths.length === 0) {
        console.warn("No model paths found!");
        return null;
    }

    // Create service layer instances
    const modelManager = new ModelManager();
    const fileLoader = new FileLoader(modelManager);
    const onnxManager = new ONNXManager(modelManager);
    const gaussianLoader = new GaussianLoader(fileLoader, onnxManager);

    const gaussianModels: GaussianModel[] = [];

    for (let modelPath of modelPaths) {
        if (modelPath.length === 0) continue;

        try {
            console.log(`Loading model: ${modelPath}`);
            const gaussianModel = await gaussianLoader.createFromFile(renderer, modelPath, camMatFinal);
            
            gaussianModels.push(gaussianModel);
            frame.add(gaussianModel);
            console.log(`Successfully loaded: ${modelPath}`);
        } catch (error) {
            console.error(`Error loading ${modelPath}:`, error);
            // Continue with other models rather than failing completely
        }
    }

    if (gaussianModels.length === 0) {
        console.warn("No GaussianModel loaded!");
        return null;
    }

    console.log(`Loaded ${gaussianModels.length} models successfully`);
    const gaussianRenderer = new GaussianThreeJSRenderer(renderer, scene, gaussianModels);
    await gaussianRenderer.init();
    scene.add(gaussianRenderer);

    return gaussianRenderer;
}

/**
 * Convenient high-level API for creating Gizmo manager
 * @param scene - Three.js scene
 * @param camera - Three.js camera
 * @param renderer - Three.js WebGPU renderer
 * @param options - Gizmo options
 * @returns GizmoManager instance
 */
export async function createGizmoManager(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGPURenderer,
    options?: import('../gizmo').GizmoOptions,
    overlayScene?: THREE.Scene
): Promise<import('../gizmo').GizmoManager> {
    const { GizmoManager } = await import('../gizmo');
    return new GizmoManager(scene, camera, renderer, options, overlayScene);
}

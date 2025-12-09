1/**
 * Gaussian Splatting integration for Three.js WebGPU
 * Renders Gaussian Splats and Three.js objects on the same WebGPU canvas
 */

import * as THREE from "three/webgpu";
import { GaussianRenderer } from '../renderer/gaussian_renderer';
import { PointCloud } from '../point_cloud';
import { defaultLoader, GaussianDataSource } from '../io';
import { mat4 } from 'gl-matrix';

/**
 * Camera adapter that extracts matrices directly from Three.js camera
 */
export class DirectCameraAdapter {
    private viewMat: mat4 = mat4.create();
    private projMat: mat4 = mat4.create();
    private _position: Float32Array = new Float32Array(3);
    private _focal: [number, number] = [0, 0];
    private _viewport: [number, number] = [1, 1];
    public transposeRotation: boolean = true; // Flag to control rotation transposition
    public flipProjY: boolean = false; // Flip projection Y axis
    public flipProjX: boolean = false; // Flip projection X axis
    private compensatePreprocessYFlip: boolean = true; // counter the single Y-flip done during preprocess packing
    
    // Projection object to match the expected interface
    public projection = {
        focal: (viewport?: [number, number]) => {
            return this._focal;
        }
    };
    
    update(camera: THREE.PerspectiveCamera, viewport: [number, number]): void {
        // Ensure Three.js matrices are up to date
        camera.updateMatrixWorld();
        camera.updateProjectionMatrix();

        // 1) View matrix conversion: make camera space +Z forward
        //    Start from Three's world->camera view matrix, then flip the output Z row.
        const V = camera.matrixWorldInverse.elements;
        for (let i = 0; i < 16; i++) this.viewMat[i] = V[i];
        // Apply R_y(pi) = diag(-1,1,-1,1): flip row 0 and row 2 to keep right-handedness
        // Row 0 indices: 0,4,8,12; Row 2 indices: 2,6,10,14
        this.viewMat[0]  = -this.viewMat[0];
        this.viewMat[4]  = -this.viewMat[4];
        this.viewMat[8]  = -this.viewMat[8];
        this.viewMat[12] = -this.viewMat[12];
        this.viewMat[2]  = -this.viewMat[2];
        this.viewMat[6]  = -this.viewMat[6];
        this.viewMat[10] = -this.viewMat[10];
        this.viewMat[14] = -this.viewMat[14];

        // 2) Projection matrix: adapt to Three's projection while compensating the R_y(pi) on view
        // Goal: keep final VP identical to Three's (P_three * V_three), without altering helpers.
        // We currently apply R = R_y(pi) on view: V' = R * V_three.
        // To preserve VP, use P' = P_three * R^{-1} = P_three * R (since R*R = I).
        // This way: P' * V' = (P_three * R) * (R * V_three) = P_three * V_three.
        // Fetch Three's projection (already in WebGPU NDC when camera.coordinateSystem = THREE.WebGPUCoordinateSystem)
        const Pthree = camera.projectionMatrix.elements as unknown as number[];
        // Build R = diag(-1, 1, -1, 1) in column-major
        const R = new Float32Array(16);
        // identity first
        R[0] = 1; R[5] = 1; R[10] = 1; R[15] = 1;
        // apply Y-axis pi rotation: flip X and Z
        R[0] = -1; // (0,0)
        R[10] = -1; // (2,2)
        // Compute P' = P_three * R (column-major matmul)
        const Pprime = new Float32Array(16);
        for (let c = 0; c < 4; c++) {
            for (let r = 0; r < 4; r++) {
                let sum = 0;
                for (let k = 0; k < 4; k++) {
                    const a = Pthree[k * 4 + r];   // A[r,k]
                    const b = R[c * 4 + k];        // B[k,c]
                    sum += a * b;
                }
                Pprime[c * 4 + r] = sum;           // C[r,c]
            }
        }
        // Optionally pre-compensate a known single viewport Y-flip that happens in preprocess packing
        if (this.compensatePreprocessYFlip) {
            // Negate the second row (indices 1,5,9,13) in column-major storage
            Pprime[1]  = -Pprime[1];
            Pprime[5]  = -Pprime[5];
            Pprime[9]  = -Pprime[9];
            Pprime[13] = -Pprime[13];
        }

        for (let i = 0; i < 16; i++) this.projMat[i] = Pprime[i];
        // After compensation, the effective projection used in shaders matches Three's.

        // 3) Camera position
        camera.getWorldPosition(new THREE.Vector3()).toArray(this._position);

        // 4) Focal length (pixels), consistent with Three's fov/aspect
        const fovy = (camera.fov ?? 60) * Math.PI / 180;
        const aspect = (camera.aspect && isFinite(camera.aspect) && camera.aspect > 0)
            ? camera.aspect
            : (viewport[0] / Math.max(1, viewport[1]));
        const fovx = 2 * Math.atan(Math.tan(fovy * 0.5) * aspect);
        this._viewport = viewport;
        this._focal[0] = viewport[0] / (2 * Math.tan(fovx * 0.5));
        this._focal[1] = viewport[1] / (2 * Math.tan(fovy * 0.5));
    }
    
    viewMatrix(): mat4 {
        return this.viewMat;
    }
    
    projMatrix(): mat4 {
        return this.projMat;
    }
    
    position(): Float32Array {
        return this._position;
    }
    
    frustumPlanes(): Float32Array {
        // Simple frustum for now - could be improved
        const planes = new Float32Array(24);
        for (let i = 0; i < 24; i++) {
            planes[i] = i < 12 ? 1000 : -1000;
        }
        return planes;
    }
}

/**
 * Main integration class for Three.js WebGPU and Gaussian Splatting
 */
export class GaussianSplattingThreeWebGPU {
    private device: GPUDevice | null = null;
    protected gaussianRenderer: GaussianRenderer | null = null;
    protected pointCloud: PointCloud | null = null;
    public cameraAdapter: DirectCameraAdapter;
    protected initialized = false;
    private visible = true;
    private depthEnabled = false;
    
    constructor() {
        this.cameraAdapter = new DirectCameraAdapter();
    }
    
    /**
     * Initialize with WebGPU device
     * @param device - The GPUDevice from Three.js WebGPURenderer
     */
    async initialize(device: GPUDevice): Promise<void> {
        if (this.initialized) return;
        
        this.device = device;
        
        // Initialize Gaussian renderer with the shared device
        this.gaussianRenderer = new GaussianRenderer(
            device,
            'bgra8unorm', // Standard WebGPU format
            3 // Max SH degree
        );
        
        await this.gaussianRenderer.ensureSorter();
        
        this.initialized = true;
        console.log('GaussianSplattingThreeWebGPU initialized');
    }
    
    /**
     * Load PLY file
     */
    async loadPLY(url: string, onProgress?: (progress: number) => void): Promise<void> {
        if (!this.device) {
            throw new Error('Not initialized. Call initialize() first.');
        }
        
        const plyData = await defaultLoader.loadUrl(url, {
            onProgress: (progress) => {
                onProgress?.(progress.progress);
            }
        });
        
        // 确保是 GaussianDataSource 类型
        if (!('gaussianBuffer' in plyData)) {
            throw new Error('Expected GaussianDataSource but got different data type');
        }
        
        this.pointCloud = new PointCloud(this.device, plyData as GaussianDataSource);
    }
    
    /**
     * Load PLY from file
     */
    async loadFile(file: File, onProgress?: (progress: number) => void): Promise<void> {
        if (!this.device) {
            throw new Error('Not initialized. Call initialize() first.');
        }
        
        const plyData = await defaultLoader.loadFile(file, {
            onProgress: (progress) => {
                onProgress?.(progress.progress);
            }
        });
        
        // 确保是 GaussianDataSource 类型
        if (!('gaussianBuffer' in plyData)) {
            throw new Error('Expected GaussianDataSource but got different data type');
        }
        
        this.pointCloud = new PointCloud(this.device, plyData as GaussianDataSource);
    }
    
    /**
     * Render Gaussian splats into the current WebGPU context
     * Should be called within Three.js render loop
     */
    /** Enable/disable depth testing for GS pass */
    setDepthEnabled(enabled: boolean) { this.depthEnabled = !!enabled; }

    render(
        commandEncoder: GPUCommandEncoder,
        textureView: GPUTextureView,
        camera: THREE.PerspectiveCamera,
        viewport: [number, number],
        depthView?: GPUTextureView
    ): void {
        if (!this.initialized || !this.gaussianRenderer || !this.pointCloud || !this.visible || !this.device) {
            return;
        }
        
        // Update camera matrices
        this.cameraAdapter.update(camera, viewport);
        
        // Prepare (preprocess and sort)
        this.gaussianRenderer.prepareMulti(
            commandEncoder,
            this.device.queue,
            [this.pointCloud],  // Pass as array for multi-model API
            {
                camera: this.cameraAdapter as any,
                viewport: viewport,
                maxSHDegree: this.pointCloud.shDeg,
            }
        );
        
        // Configure renderer depth toggle
        if (this.gaussianRenderer) this.gaussianRenderer.setDepthEnabled(this.depthEnabled);

        // Render pass - optionally with depth attachment
        const passDesc: GPURenderPassDescriptor = {
            colorAttachments: [{
                view: textureView,
                loadOp: 'load',
                storeOp: 'store',
            }]
        } as GPURenderPassDescriptor;
        if (this.depthEnabled && depthView) {
            (passDesc as any).depthStencilAttachment = {
                view: depthView,
                depthLoadOp: 'load',
                depthStoreOp: 'store',
            };
        }
        const renderPass = commandEncoder.beginRenderPass(passDesc);
        this.gaussianRenderer.renderMulti(renderPass, [this.pointCloud]);
        renderPass.end();
    }
    
    /**
     * Set visibility
     */
    setVisible(visible: boolean): void {
        this.visible = visible;
    }
    
    /**
     * Get point count
     */
    get numPoints(): number {
        return this.pointCloud?.numPoints || 0;
    }
    
    /**
     * Clean up resources
     */
    dispose(): void {
        this.pointCloud = null;
        this.gaussianRenderer = null;
        this.device = null;
    }
}
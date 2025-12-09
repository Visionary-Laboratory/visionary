/**
 * Camera adapter that bridges Three.js camera to 3DGS internal camera interface
 */

import { mat4, vec3, quat } from 'gl-matrix';
import { Camera, PerspectiveCamera, PerspectiveProjection } from '../camera';

/**
 * Options for matrix conversion between Three.js and WebGPU
 */
export interface MatrixAdapterOptions {
    /** Convert row-major (Three.js) to column-major (WebGPU) */
    convertRowMajorToColumnMajor: boolean;
    /** Apply Y-axis flip for WebGPU viewport coordinate system */  
    applyViewportYFlip: boolean;
}

/**
 * Camera adapter that wraps pre-computed matrices from Three.js
 */
export class ThreeJsCameraAdapter implements PerspectiveCamera {
    private _viewMatrix: mat4;
    private _projMatrix: mat4;
    private _position: vec3;
    private _viewport: [number, number];
    private _focal: [number, number];
    
    // These are required by PerspectiveCamera interface but not used in direct matrix mode
    public positionV: vec3;
    public rotationQ: quat;
    public projection: PerspectiveProjection;
    
    constructor(
        viewMatrix: Float32Array,
        projMatrix: Float32Array,
        position: vec3,
        viewport: [number, number],
        focal: [number, number]
    ) {
        this._viewMatrix = mat4.fromValues(
            viewMatrix[0], viewMatrix[1], viewMatrix[2], viewMatrix[3],
            viewMatrix[4], viewMatrix[5], viewMatrix[6], viewMatrix[7],
            viewMatrix[8], viewMatrix[9], viewMatrix[10], viewMatrix[11],
            viewMatrix[12], viewMatrix[13], viewMatrix[14], viewMatrix[15]
        );
        this._projMatrix = mat4.fromValues(
            projMatrix[0], projMatrix[1], projMatrix[2], projMatrix[3],
            projMatrix[4], projMatrix[5], projMatrix[6], projMatrix[7],
            projMatrix[8], projMatrix[9], projMatrix[10], projMatrix[11],
            projMatrix[12], projMatrix[13], projMatrix[14], projMatrix[15]
        );
        this._position = vec3.clone(position);
        this._viewport = viewport;
        this._focal = focal;
        
        // Store position for interface compatibility
        this.positionV = vec3.clone(position);
        this.rotationQ = quat.create(); // Default identity quaternion
        
        // Create minimal projection object for interface compatibility
        this.projection = {
            focal: () => this._focal,
            fovx: 0,
            fovy: 0,
            znear: 0.1,
            zfar: 1000,
            resize: () => {},
            projectionMatrix: () => this._projMatrix,
            lerp: () => this.projection,
            clone: () => this.projection
        } as unknown as PerspectiveProjection;
    }
    
    viewMatrix(): mat4 {
        return this._viewMatrix;
    }
    
    projMatrix(): mat4 {
        return this._projMatrix;
    }
    
    position(): vec3 {
        return vec3.clone(this._position);
    }
    
    fitNearFar(aabb: any): void {
        // Not needed in direct matrix mode - Three.js handles this
    }
    
    frustumPlanes() {
        // Calculate frustum planes from view-projection matrix
        const PV = mat4.create();
        mat4.multiply(PV, this._projMatrix, this._viewMatrix);
        
        // Extract planes using row combinations (for column-major)
        const r0 = [PV[0], PV[4], PV[8], PV[12]];
        const r1 = [PV[1], PV[5], PV[9], PV[13]];
        const r2 = [PV[2], PV[6], PV[10], PV[14]];
        const r3 = [PV[3], PV[7], PV[11], PV[15]];
        
        const add = (a: number[], b: number[]) => 
            new Float32Array([a[0]+b[0], a[1]+b[1], a[2]+b[2], a[3]+b[3]]);
        const sub = (a: number[], b: number[]) => 
            new Float32Array([a[0]-b[0], a[1]-b[1], a[2]-b[2], a[3]-b[3]]);
        const norm = (p: Float32Array) => {
            const n = Math.hypot(p[0], p[1], p[2]);
            return n > 0 ? new Float32Array([p[0]/n, p[1]/n, p[2]/n, p[3]/n]) : p;
        };
        
        return {
            left:   norm(add(r3, r0)),
            right:  norm(sub(r3, r0)),
            bottom: norm(add(r3, r1)),
            top:    norm(sub(r3, r1)),
            near:   norm(add(r3, r2)),
            far:    norm(sub(r3, r2)),
        };
    }
}

/**
 * Helper functions for matrix conversion
 */
export class MatrixConverter {
    /**
     * Convert row-major to column-major matrix (transpose)
     */
    static rowMajorToColumnMajor(rowMajor: ArrayLike<number>): Float32Array {
        const colMajor = new Float32Array(16);
        // Transpose: colMajor[col*4 + row] = rowMajor[row*4 + col]
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                colMajor[col * 4 + row] = rowMajor[row * 4 + col];
            }
        }
        return colMajor;
    }
    
    /**
     * Apply Y-axis flip for WebGPU viewport
     * This negates the second column (not row) in column-major format
     */
    static applyViewportYFlip(matrix: ArrayLike<number>): Float32Array {
        const flipped = new Float32Array(matrix);
        // In column-major, columns are stored contiguously
        // Second column is indices 4-7
        flipped[4] *= -1;  // m01
        flipped[5] *= -1;  // m11  
        flipped[6] *= -1;  // m21
        flipped[7] *= -1;  // m31
        return flipped;
    }
    
    /**
     * Convert Three.js view matrix to WebGPU format
     * Three.js: row-major, right-handed, Y-up
     * WebGPU: column-major, right-handed, Y-up (but flipped viewport)
     */
    static convertThreeViewToWebGPU(threeViewMatrix: ArrayLike<number>): Float32Array {
        // First transpose from row-major to column-major
        return this.rowMajorToColumnMajor(threeViewMatrix);
    }
    
    /**
     * Fix inverted rotation issue
     * When only negating translation works, but rotation is inverted,
     * we need to handle rotation and translation separately
     */
    static fixInvertedViewMatrix(viewMatrix: ArrayLike<number>): Float32Array {
        const result = new Float32Array(viewMatrix);
        
        // Only negate translation - this was the working fix from experiments
        // DO NOT modify rotation columns as it causes inverted mouse controls
        result[12] *= -1;
        result[13] *= -1;
        result[14] *= -1;
        
        return result;
    }
    
    /**
     * Alternative fix: Use inverse of world matrix with proper conversion
     */
    static convertWorldToView(worldMatrix: ArrayLike<number>): Float32Array {
        // Extract rotation (transpose of world rotation)
        const result = new Float32Array(16);
        
        // Transpose the 3x3 rotation part (inverse of rotation matrix)
        result[0] = worldMatrix[0];
        result[1] = worldMatrix[4];
        result[2] = worldMatrix[8];
        result[3] = 0;
        
        result[4] = worldMatrix[1];
        result[5] = worldMatrix[5];
        result[6] = worldMatrix[9];
        result[7] = 0;
        
        result[8] = worldMatrix[2];
        result[9] = worldMatrix[6];
        result[10] = worldMatrix[10];
        result[11] = 0;
        
        // Translation: -R^T * t
        const tx = worldMatrix[12];
        const ty = worldMatrix[13];
        const tz = worldMatrix[14];
        
        result[12] = -(result[0] * tx + result[4] * ty + result[8] * tz);
        result[13] = -(result[1] * tx + result[5] * ty + result[9] * tz);
        result[14] = -(result[2] * tx + result[6] * ty + result[10] * tz);
        result[15] = 1;
        
        return result;
    }
    
    /**
     * Convert Three.js projection matrix to WebGPU format
     * Handles NDC differences: Three.js [-1,1] vs WebGPU [0,1] for Z
     */
    static convertThreeProjToWebGPU(threeProjMatrix: ArrayLike<number>, applyYFlip: boolean = true): Float32Array {
        // Transpose from row-major to column-major
        let result = this.rowMajorToColumnMajor(threeProjMatrix);
        
        // Apply Y flip if needed (for WebGPU viewport)
        if (applyYFlip) {
            result = this.applyViewportYFlip(result);
        }
        
        return result;
    }
    
    /**
     * Fix depth inversion issues
     * This inverts the Z axis in the projection matrix
     */
    static invertDepth(projMatrix: ArrayLike<number>): Float32Array {
        const result = new Float32Array(projMatrix);
        // Invert Z row (third row in column-major)
        result[8] *= -1;   // m20
        result[9] *= -1;   // m21
        result[10] *= -1;  // m22
        result[11] *= -1;  // m23
        return result;
    }
    
    /**
     * Convert OpenGL/Three.js NDC z:[-1,1] to Vulkan/WebGPU NDC z:[0,1]
     * This is often needed for WebGPU compatibility
     */
    static adjustNDCDepth(projMatrix: ArrayLike<number>): Float32Array {
        const result = new Float32Array(projMatrix);
        // Transform: z' = (z + 1) / 2
        // This modifies the projection matrix to output [0,1] instead of [-1,1]
        result[10] = result[10] * 0.5 + 0.5;  // m22
        result[14] = result[14] * 0.5;        // m32
        return result;
    }
}
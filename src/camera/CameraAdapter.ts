import * as THREE from "three/webgpu";
import { mat4 } from 'gl-matrix';

/**
 * CameraAdapter: mirrors the behavior of DirectCameraAdapter used in
 * src/three-integration/GaussianSplattingThreeWebGPU.ts so it can be reused
 * across the app and examples.
 */
export class CameraAdapter {
  private viewMat: mat4 = mat4.create();
  private projMat: mat4 = mat4.create();
  private _position: Float32Array = new Float32Array(3);
  private _focal: [number, number] = [0, 0];
  private _viewport: [number, number] = [1, 1];
  // Flags kept for compatibility; current update() follows DirectCameraAdapter
  public transposeRotation: boolean = true;
  public flipProjY: boolean = false;
  public flipProjX: boolean = false;
  private compensatePreprocessYFlip: boolean = true; // counter the single Y-flip in preprocess packing

  // Minimal projection object with focal() method as expected by preprocess
  public projection = {
    focal: (_viewport?: [number, number]) => {
      return this._focal;
    }
  };

  /** Update from a Three.js PerspectiveCamera and viewport in pixels */
  update(camera: THREE.PerspectiveCamera, viewport: [number, number]): void {
    // Ensure Three.js matrices are up to date
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    // 1) View matrix conversion: make camera space +Z forward
    const V = camera.matrixWorldInverse.elements;
    for (let i = 0; i < 16; i++) this.viewMat[i] = V[i];
    // Apply R_y(pi) = diag(-1,1,-1,1): flip row 0 and row 2 to keep right-handedness
    this.viewMat[0]  = -this.viewMat[0];
    this.viewMat[4]  = -this.viewMat[4];
    this.viewMat[8]  = -this.viewMat[8];
    this.viewMat[12] = -this.viewMat[12];
    this.viewMat[2]  = -this.viewMat[2];
    this.viewMat[6]  = -this.viewMat[6];
    this.viewMat[10] = -this.viewMat[10];
    this.viewMat[14] = -this.viewMat[14];

    // 2) Projection matrix: adapt to Three's projection while compensating the R_y(pi) on view
    // We applied V' = R * V_three (R is pi-rotation around Y: diag(-1,1,-1,1)).
    // Use P' = P_three * R so that P' * V' == P_three * V_three.
    const Pthree = camera.projectionMatrix.elements as unknown as number[];
    // Build R = diag(-1,1,-1,1) (column-major)
    const R = new Float32Array(16);
    R[0] = -1; R[5] = 1; R[10] = -1; R[15] = 1;
    const Pprime = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          const a = Pthree[k * 4 + r]; // A[r,k]
          const b = R[c * 4 + k];      // B[k,c]
          sum += a * b;
        }
        Pprime[c * 4 + r] = sum;       // C[r,c]
      }
    }
    if (this.compensatePreprocessYFlip) {
      // Negate second row to counter a single Y-flip done later during preprocess packing
      Pprime[1]  = -Pprime[1];
      Pprime[5]  = -Pprime[5];
      Pprime[9]  = -Pprime[9];
      Pprime[13] = -Pprime[13];
    }
    for (let i = 0; i < 16; i++) this.projMat[i] = Pprime[i];

    // 3) Camera position
    camera.getWorldPosition(new (THREE as any).Vector3()).toArray(this._position);

    // 4) Focal length (pixels), consistent with Three camera fov/aspect
    const fovy = (camera.fov ?? 60) * Math.PI / 180;
    const aspect = (camera.aspect && isFinite(camera.aspect) && camera.aspect > 0)
      ? camera.aspect
      : (viewport[0] / Math.max(1, viewport[1]));
    const fovx = 2 * Math.atan(Math.tan(fovy * 0.5) * aspect);
    this._viewport = viewport;
    this._focal[0] = viewport[0] / (2 * Math.tan(fovx * 0.5));
    this._focal[1] = viewport[1] / (2 * Math.tan(fovy * 0.5));
  }

  viewMatrix(): mat4 { return this.viewMat; }
  projMatrix(): mat4 { return this.projMat; }
  position(): Float32Array { return this._position; }

  frustumPlanes(): Float32Array {
    // Simple frustum for now - could be improved
    const planes = new Float32Array(24);
    for (let i = 0; i < 24; i++) {
      planes[i] = i < 12 ? 1000 : -1000;
    }
    return planes;
  }
}

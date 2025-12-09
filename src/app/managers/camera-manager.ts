/**
 * Camera Manager
 * Handles camera initialization, positioning, and viewport management
 */

import { vec3,vec2, quat, mat4 } from "gl-matrix";
import { PerspectiveCamera, PerspectiveProjection } from "../../camera/perspective";
import { IController, ControllerType } from "../../controls/base-controller";
import { FPSController } from "../../controls/fps-controller";
import { CameraController } from "../../controls/controller";
import { PointCloud } from "../../point_cloud";
import { deg2rad } from "../../utils";

export class CameraManager {
  private camera: PerspectiveCamera | null = null;
  private controller: IController;
  private controllerType: ControllerType = 'fps';
  private canvasElement: HTMLCanvasElement | null = null;

  constructor(defaultController: ControllerType = 'orbit') {
    this.controllerType = defaultController;
    this.controller = this.createController(defaultController);
  }

  private createController(type: ControllerType): IController {
    switch (type) {
      case 'orbit':
        return new CameraController();
      case 'fps':
      default:
        return new FPSController();
    }
  }

  /**
   * Initialize camera with default settings
   */
  initCamera(canvas: HTMLCanvasElement): void {
    this.canvasElement = canvas;

    const useFov = 45;

    const fov = deg2rad(useFov);
    const width = canvas.width || 1;
    const height = canvas.height || 1;
    const aspect = width / height;
    
    // Calculate proper Y FOV based on aspect ratio
    const fovY = deg2rad(useFov / aspect);
    
    this.camera = new PerspectiveCamera(
      vec3.fromValues(0, 0, 3),
      quat.fromValues(0, 0, 0, 1),
      new PerspectiveProjection(
        [width, height],
        [fov, fovY], // Use aspect-corrected Y FOV
        0.01,
        2000
      )
    );

    console.log(`📷 Camera initialized: ${width}x${height}, aspect: ${aspect.toFixed(2)}, FOV: [${(fov * 180 / Math.PI).toFixed(1)}°, ${(fovY * 180 / Math.PI).toFixed(1)}°]`);
  }

  /**
   * Reset camera to default position
   */
  resetCamera(): void {
    if (!this.camera || !this.canvasElement) {
      console.warn('⚠️ Camera or canvas not available for reset');
      return;
    }
    
    this.camera = new PerspectiveCamera(
      vec3.fromValues(0, 0, 3),
      quat.fromValues(0, 0, 0, 1),
      this.camera.projection.clone()
    );
    this.controller = this.createController(this.controllerType);
    if (this.controller.resetOrientation) {
      this.controller.resetOrientation();
    }
    
    console.log('📷 Camera reset to default position');
  }

  /**
   * Position camera based on point cloud bounds
   */
  setupCameraForPointCloud(pc: PointCloud): void {
    if (!this.camera || !this.canvasElement) {
      console.warn('⚠️ Camera or canvas not available for point cloud setup');
      return;
    }
    
    const aabb = pc.bbox;
    const center = aabb.center();
    const radius = aabb.radius();
    
    // Position camera at a distance from the center
    const pos = vec3.fromValues(
      center[0] - radius * 0.5,
      center[1] - radius * 0.5,
      center[2] - radius * 0.5
    );
    
    // Default rotation
    const rot = quat.fromValues(0, 0, 0, 1);
    
    // Update projection for the scene
    const aspect = this.canvasElement.width / this.canvasElement.height;
    const proj = new PerspectiveProjection(
      [this.canvasElement.width, this.canvasElement.height],
      [deg2rad(45), deg2rad(45 / aspect)],
      0.01,
      1000.0
    );
    
    this.camera = new PerspectiveCamera(pos, rot, proj);
    
    // Ensure orbit controller pivots around the loaded model by default
    if (this.controllerType === 'orbit' && this.controller instanceof CameraController) {
      vec3.copy(this.controller.center, center);
      vec3.set(this.controller.rotation, 0, 0, 0);
      vec2.set(this.controller.shift, 0, 0);
      this.controller.scroll = 0;
    }
    
    console.log(`📷 Camera positioned for point cloud: radius=${radius.toFixed(2)}, center=[${center[0].toFixed(2)}, ${center[1].toFixed(2)}, ${center[2].toFixed(2)}]`);
  }

  /**
   * Handle canvas resize
   */
  resize(canvas: HTMLCanvasElement): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    
    let resized = false;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      resized = true;
    }
    
    // Update camera projection
    if (this.camera && resized) {
      this.camera.projection.resize([w, h] as any);
      console.log(`📷 Camera resized: ${w}x${h} (dpr: ${dpr.toFixed(2)})`);
    }

    this.canvasElement = canvas;
  }

  /**
   * Update camera with controller input
   */
  update(deltaTime: number): void {
    if (this.camera) {
      this.controller.update(this.camera, deltaTime);
    }
  }

  /**
   * Get current camera matrix for ONNX input
   */
  getCameraMatrix(): mat4 {
    if (!this.camera) {
      console.warn('⚠️ Camera not available, returning identity matrix');
      return mat4.create();
    }
    
    return this.camera.viewMatrix();
  }

  /**
   * Get current projection matrix for ONNX input
   */
  getProjectionMatrix(): mat4 {
    if (!this.camera) {
      console.warn('⚠️ Camera not available, returning default projection matrix');
      const projMatrix = mat4.create();
      mat4.perspective(projMatrix, Math.PI / 4, 16/9, 0.1, 1000);
      return projMatrix;
    }
    
    return this.camera.projMatrix();
  }

  /**
   * Get the camera instance
   */
  getCamera(): PerspectiveCamera | null {
    return this.camera;
  }

  /**
   * Get the camera controller
   */
  getController(): IController {
    return this.controller;
  }

  /**
   * Switch between controller types
   */
  switchController(type: ControllerType): void {
    if (type === this.controllerType) return;
    
    console.log(`🎮 Switching from ${this.controllerType} to ${type} controller`);
    
    // Save current camera state
    const currentPos = this.camera ? vec3.clone(this.camera.positionV) : vec3.fromValues(0, 0, 3);
    const currentRot = this.camera ? quat.clone(this.camera.rotationQ) : quat.fromValues(0, 0, 0, 1);
    
    // Create new controller
    const oldType = this.controllerType;
    this.controllerType = type;
    this.controller = this.createController(type);
    
    // Handle state conversion between controller types
    if (this.camera) {
      if (oldType === 'fps' && type === 'orbit') {
        // Switching from FPS to Orbit
        // Get camera forward direction (where the camera is looking)
        const c2w = quat.invert(quat.create(), currentRot);
        const forward = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), c2w);
        
        // Calculate orbit center at a reasonable distance in front of camera
        // Try to estimate a good distance based on camera position
        let distance = 5; // Default distance
        
        // If camera is far from origin, use a proportional distance
        const distFromOrigin = vec3.length(currentPos);
        if (distFromOrigin > 10) {
          distance = distFromOrigin * 0.5;
        }
        
        const center = vec3.create();
        vec3.scaleAndAdd(center, currentPos, forward, distance);
        
        // Set orbit controller state
        if (this.controller instanceof CameraController) {
          vec3.copy(this.controller.center, center);
          // Clear any residual motion to prevent unwanted movement
          vec3.set(this.controller.rotation, 0, 0, 0);
          vec2.set(this.controller.shift, 0, 0);
          this.controller.scroll = 0;
        }
        
        // Keep camera position and rotation as is
        vec3.copy(this.camera.positionV, currentPos);
        quat.copy(this.camera.rotationQ, currentRot);
        
      } else if (oldType === 'orbit' && type === 'fps') {
        // Switching from Orbit to FPS
        // Get the camera's forward vector to calculate yaw and pitch
        const c2w = quat.invert(quat.create(), currentRot);
        const forward = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), c2w);
        
        // Calculate yaw (rotation around Y axis)
        // Note: atan2 gives us the angle in the XZ plane
        const yaw = Math.atan2(forward[0], forward[2]);
        
        // Calculate pitch (rotation around X axis)
        // Note: We use the Y component and the horizontal distance
        const horizontalLength = Math.sqrt(forward[0] * forward[0] + forward[2] * forward[2]);
        const pitch = Math.atan2(-forward[1], horizontalLength);
        
        // Initialize FPS controller with calculated orientation
        if (this.controller instanceof FPSController) {
          // Set the calculated orientation
          this.controller.setOrientation(yaw, pitch);
          // Ensure no residual movement
          this.controller.leftMousePressed = false;
          this.controller.rightMousePressed = false;
        }
        
        // Keep camera position and rotation as is
        vec3.copy(this.camera.positionV, currentPos);
        quat.copy(this.camera.rotationQ, currentRot);
        
      } else {
        // Default case or same controller type family
        vec3.copy(this.camera.positionV, currentPos);
        quat.copy(this.camera.rotationQ, currentRot);
      }
    }
    
    console.log(`✅ Controller switched to ${type}`);
  }

  /**
   * Get current controller type
   */
  getControllerType(): ControllerType {
    return this.controllerType;
  }

  /**
   * Check if camera is initialized
   */
  isInitialized(): boolean {
    return this.camera !== null;
  }

  /**
   * Get camera position
   */
  getCameraPosition(): vec3 | null {
    if (!this.camera) return null;
    return vec3.clone(this.camera.positionV);
  }

  /**
   * Get camera rotation
   */
  getCameraRotation(): quat | null {
    if (!this.camera) return null;
    return quat.clone(this.camera.rotationQ);
  }

  /**
   * Set camera position
   */
  setCameraPosition(position: vec3): void {
    if (this.camera) {
      vec3.copy(this.camera.positionV, position);
      console.log(`📷 Camera position set: [${position[0].toFixed(2)}, ${position[1].toFixed(2)}, ${position[2].toFixed(2)}]`);
    }
  }

  /**
   * Set camera rotation
   */
  setCameraRotation(rotation: quat): void {
    if (this.camera) {
      quat.copy(this.camera.rotationQ, rotation);
      console.log(`📷 Camera rotation set`);
    }
  }

  /**
   * Get camera viewport information
   */
  getViewportInfo(): { width: number; height: number; aspect: number } | null {
    if (!this.canvasElement) {
      return null;
    }

    const width = this.canvasElement.width;
    const height = this.canvasElement.height;
    const aspect = width / height;

    return { width, height, aspect };
  }

  /**
   * Get camera frustum information
   */
  getFrustumInfo(): { fov: number; near: number; far: number } | null {
    if (!this.camera) return null;

    // Extract FOV from projection (assuming perspective projection)
    const fov = this.camera.projection.fovy || deg2rad(45);
    const near = 0.01; // Default near plane
    const far = 2000;  // Default far plane

    return { fov, near, far };
  }

  /**
   * Set orbit controller center point
   */
  setOrbitCenter(center: vec3): void {
    if (this.controllerType === 'orbit' && this.controller instanceof CameraController) {
      vec3.copy(this.controller.center, center);
      console.log(`📷 Orbit center set to: [${center[0].toFixed(2)}, ${center[1].toFixed(2)}, ${center[2].toFixed(2)}]`);
    }
  }

  /**
   * Get orbit controller center point
   */
  getOrbitCenter(): vec3 | null {
    if (this.controllerType === 'orbit' && this.controller instanceof CameraController) {
      return vec3.clone(this.controller.center);
    }
    return null;
  }

  /**
   * Get camera debug info
   */
  getDebugInfo(): any {
    if (!this.camera) return null;

    const pos = this.getCameraPosition();
    const rot = this.getCameraRotation();
    const viewport = this.getViewportInfo();
    const frustum = this.getFrustumInfo();

    return {
      position: pos ? [pos[0], pos[1], pos[2]] : null,
      rotation: rot ? [rot[0], rot[1], rot[2], rot[3]] : null,
      viewport,
      frustum,
      initialized: this.isInitialized(),
      controllerType: this.controllerType,
      orbitCenter: this.getOrbitCenter()
    };
  }
}
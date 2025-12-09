// FPS-style camera controller with WASD movement and mouse drag rotation
// Compatible with the existing WebGaussianJS architecture

import { vec2, vec3, quat } from "gl-matrix";
import { PerspectiveCamera } from '../camera';
import { IController } from './base-controller';

// ---- Constants ----
const DEFAULT_MOVEMENT_SPEED = 1.0;
const DEFAULT_ROTATE_SPEED = 0.002;
const DEFAULT_SCROLL_SPEED = 0.5;
const DEFAULT_ROTATE_INERTIA = 0.85;
const DEFAULT_MOVE_INERTIA = 0.85;

// ---- Helper functions ----
function clamp(x: number, lo: number, hi: number) { 
  return Math.min(hi, Math.max(lo, x)); 
}

// Main FPS Controller class
export class FPSController implements IController {
  // Movement settings
  moveSpeed: number;
  rotateSpeed: number;
  scrollSpeed: number;
  moveInertia: number;
  rotateInertia: number;
  
  // Speed multipliers
  capsMultiplier = 10.0;
  shiftMultiplier = 50.0;
  ctrlMultiplier = 0.2;
  
  // Input state
  private keycode: { [key: string]: boolean } = {};
  private keydown: { [key: string]: boolean } = {};
  
  // Mouse state
  leftMousePressed = false;
  rightMousePressed = false;
  private mouseDelta = vec3.fromValues(0, 0, 0);
  
  // Scroll state
  private scrollDelta = 0;
  
  // Velocity for inertia
  private moveVelocity = vec3.fromValues(0, 0, 0);
  private rotateVelocity = vec3.fromValues(0, 0, 0);
  
  // Store yaw and pitch separately to avoid gimbal lock
  private yaw = 0;
  private pitch = 0;
  
  // User input flag
  userInput = false;
  
  // Enable/disable controller
  enable = true;
  
  // Fly mode - true: 6DoF movement along view direction, false: restrict to XZ plane (ground)
  flyMode = true;

  constructor(
    moveSpeed = DEFAULT_MOVEMENT_SPEED,
    rotateSpeed = DEFAULT_ROTATE_SPEED,
    scrollSpeed = DEFAULT_SCROLL_SPEED,
    moveInertia = DEFAULT_MOVE_INERTIA,
    rotateInertia = DEFAULT_ROTATE_INERTIA
  ) {
    this.moveSpeed = moveSpeed;
    this.rotateSpeed = rotateSpeed;
    this.scrollSpeed = scrollSpeed;
    this.moveInertia = moveInertia;
    this.rotateInertia = rotateInertia;
    
    // Setup keyboard event listeners
    document.addEventListener("keydown", (event) => {
      this.keydown[event.key] = true;
      this.keycode[event.code] = true;
      this.userInput = true;
    });
    
    document.addEventListener("keyup", (event) => {
      this.keydown[event.key] = false;
      this.keycode[event.code] = false;
    });
    
    window.addEventListener("blur", () => {
      this.keydown = {};
      this.keycode = {};
      this.leftMousePressed = false;
      this.rightMousePressed = false;
    });
  }
  
  processKeyboard(code: string, pressed: boolean): boolean {
    this.keycode[code] = pressed;
    this.userInput = true;
    return true;
  }
  
  processMouse(dx: number, dy: number): void {
    if (this.leftMousePressed) {
      // Accumulate mouse delta for rotation
      this.mouseDelta[0] += dx;
      this.mouseDelta[1] += dy;
      this.userInput = true;
    }
    if (this.rightMousePressed) {
      // Right mouse for panning (optional)
      // Currently not implemented, but could be added
    }
  }
  
  processScroll(delta: number): void {
    this.scrollDelta += delta;
    this.userInput = true;
  }
  
  update(camera: PerspectiveCamera, deltaTime: number): void {
    if (!this.enable) return;
    
    // Calculate rotation deltas from mouse
    let deltaYaw = 0;
    let deltaPitch = 0;
    
    if (this.leftMousePressed && (Math.abs(this.mouseDelta[0]) > 0 || Math.abs(this.mouseDelta[1]) > 0)) {
      // Direct rotation from mouse input
      deltaYaw = this.mouseDelta[0] * this.rotateSpeed;
      deltaPitch = -this.mouseDelta[1] * this.rotateSpeed;
      
      // Update velocities for inertia
      this.rotateVelocity[0] = deltaYaw / deltaTime;
      this.rotateVelocity[1] = deltaPitch / deltaTime;
    } else {
      // Apply inertia when not dragging
      deltaYaw = this.rotateVelocity[0] * deltaTime;
      deltaPitch = this.rotateVelocity[1] * deltaTime;
      
      // Decay velocities (exponential decay with tau)
      const decay = Math.exp(-deltaTime / (1 - this.rotateInertia + 1e-6));
      this.rotateVelocity[0] *= decay;
      this.rotateVelocity[1] *= decay;
      
      // Stop if velocity is very small
      if (Math.abs(this.rotateVelocity[0]) < 0.001) this.rotateVelocity[0] = 0;
      if (Math.abs(this.rotateVelocity[1]) < 0.001) this.rotateVelocity[1] = 0;
    }
    
    // Update accumulated angles
    this.yaw += deltaYaw;
    this.pitch += deltaPitch;
    this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    
    // Build camera rotation with intrinsic YXZ order
    // First build C2W (camera to world), then invert to get W2C
    const c2w = quat.identity(quat.create());
    quat.rotateY(c2w, c2w, this.yaw);   // yaw about world Y  
    quat.rotateX(c2w, c2w, this.pitch); // pitch about local X
    
    // Camera needs W2C (world to camera) quaternion
    const w2c = quat.invert(quat.create(), c2w);
    quat.copy(camera.rotationQ, w2c); // Use copy to preserve Float32Array reference
    
    // Calculate movement input
    const inputVector = vec3.fromValues(0, 0, 0);
    
    // Check keyboard input for movement
    if (this.keycode["KeyW"] || this.keycode["ArrowUp"]) inputVector[2] -= 1;
    if (this.keycode["KeyS"] || this.keycode["ArrowDown"]) inputVector[2] += 1;
    if (this.keycode["KeyA"] || this.keycode["ArrowLeft"]) inputVector[0] -= 1;
    if (this.keycode["KeyD"] || this.keycode["ArrowRight"]) inputVector[0] += 1;
    if (this.keycode["KeyR"] || this.keycode["PageUp"]) inputVector[1] += 1;
    if (this.keycode["KeyF"] || this.keycode["PageDown"]) inputVector[1] -= 1;
    
    // Q/E for additional strafing
    if (this.keycode["KeyQ"]) inputVector[0] -= 1;
    if (this.keycode["KeyE"]) inputVector[0] += 1;
    
    // Add scroll for forward/backward movement
    if (Math.abs(this.scrollDelta) > 0) {
      inputVector[2] -= this.scrollDelta * this.scrollSpeed;
    }
    
    // Apply speed multipliers
    let speedMultiplier = 1.0;
    if (this.keydown["CapsLock"]) {
      speedMultiplier *= this.capsMultiplier;
    }
    if (this.keycode["ShiftLeft"] || this.keycode["ShiftRight"]) {
      speedMultiplier *= this.shiftMultiplier;
    }
    if (this.keycode["ControlLeft"] || this.keycode["ControlRight"]) {
      speedMultiplier *= this.ctrlMultiplier;
    }
    
    // Calculate movement in world space
    if (vec3.length(inputVector) > 0) {
      // Normalize to prevent faster diagonal movement
      vec3.normalize(inputVector, inputVector);
      vec3.scale(inputVector, inputVector, this.moveSpeed * speedMultiplier);
      
      // Movement base vectors using C2W transformation
      // Get C2W quaternion (camera.rotationQ is W2C, so invert it)
      const c2w = quat.invert(quat.create(), camera.rotationQ);
      
      // Transform standard basis vectors to world space
      const forward = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), c2w);
      const right   = vec3.transformQuat(vec3.create(), vec3.fromValues(1, 0,  0), c2w);
      const upLocal = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 1,  0), c2w);
      
      // Ground mode: only move on XZ plane; Fly mode: 6DoF
      const forwardXZ = vec3.fromValues(forward[0], 0, forward[2]);
      const rightXZ   = vec3.fromValues(right[0],   0, right[2]);
      
      const fLen = vec3.length(forwardXZ);
      const rLen = vec3.length(rightXZ);
      if (fLen > 1e-6) vec3.scale(forwardXZ, forwardXZ, 1 / fLen);
      if (rLen > 1e-6) vec3.scale(rightXZ,   rightXZ,   1 / rLen);
      
      // Build final movement vector
      const movement = vec3.create();
      vec3.scaleAndAdd(movement, movement, (this.flyMode ? right : rightXZ), inputVector[0]); // A/D strafe
      vec3.scaleAndAdd(movement, movement, (this.flyMode ? upLocal : vec3.fromValues(0,1,0)), inputVector[1]); // R/F or PgUp/Down
      vec3.scaleAndAdd(movement, movement, (this.flyMode ? forward : (fLen>1e-6 ? forwardXZ : forward)), inputVector[2]); // W/S
      
      // Update velocity
      vec3.copy(this.moveVelocity, movement);
    } else {
      // Apply movement inertia decay (exponential with tau)
      const decay = Math.exp(-deltaTime / (1 - this.moveInertia + 1e-6));
      vec3.scale(this.moveVelocity, this.moveVelocity, decay);
      if (vec3.length(this.moveVelocity) < 0.001) {
        vec3.set(this.moveVelocity, 0, 0, 0);
      }
    }
    
    // Apply movement
    if (vec3.length(this.moveVelocity) > 0.001) {
      const movement = vec3.clone(this.moveVelocity);
      vec3.scale(movement, movement, deltaTime);
      vec3.add(camera.positionV, camera.positionV, movement);
    }
    
    // Reset mouse delta and scroll
    vec3.set(this.mouseDelta, 0, 0, 0);
    this.scrollDelta = 0;
    
    // Clear user input flag
    this.userInput = false;
  }
  
  // Reset camera orientation
  resetOrientation(): void {
    this.yaw = 0;
    this.pitch = 0;
    this.rotateVelocity = vec3.fromValues(0, 0, 0);
    this.moveVelocity = vec3.fromValues(0, 0, 0);
  }
  
  // Get current orientation for debugging
  getOrientation(): { yaw: number; pitch: number } {
    return {
      yaw: this.yaw * 180 / Math.PI,
      pitch: this.pitch * 180 / Math.PI
    };
  }
  
  // Set orientation (useful for initialization)
  setOrientation(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  }
  
  // Toggle fly mode
  setFlyMode(enabled: boolean): void {
    this.flyMode = enabled;
    console.log(`FPS Controller: Fly mode ${enabled ? 'enabled' : 'disabled (ground movement only)'}`);
  }

  // Implement interface method
  getControllerType(): 'orbit' | 'fps' {
    return 'fps';
  }
}
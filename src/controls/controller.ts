// Camera controller extracted from controller.ts

import { vec2, vec3, quat } from "gl-matrix";
import { PerspectiveCamera } from '../camera';
import { IController } from './base-controller';
import { processKeyboardInput, processMouseInput, processScrollInput } from './input';
import { 
  lookAtW2C, 
  calculateOrbitBasis, 
  applyDistanceScaling, 
  applyPanning, 
  applyRotation, 
  applyDecay,
  WORLD_UP 
} from './orbit';

type CamDebug = {
  pos: [number, number, number];
  center: [number, number, number];
  dist: number;
  forward_to_center: [number, number, number];
  forward_from_rot: [number, number, number];
  dot: number;
};

export class CameraController implements IController {
  center = vec3.fromValues(0, 0, 0);
  /** If provided, use as "global up reference"; otherwise use internal orbit up state */
  up: vec3 | null = null;

  amount = vec3.fromValues(0, 0, 0);   // Placeholder (consistent with Rust, not used in this update)
  shift  = vec2.fromValues(0, 0);      // Right-click pan (x=dy, y=-dx)
  rotation = vec3.fromValues(0, 0, 0); // yaw(x), pitch(y), roll(z)
  scroll = 0;
  speed: number;
  sensitivity: number;

  leftMousePressed = false;
  rightMousePressed = false;
  altPressed = false;
  userInput = false;

  // --- Key: stable orbit up state ---
  private orbitUp = vec3.clone(WORLD_UP);

  // Debug
  private debug = false;
  private debugEvery = 1 / 30;
  private _acc = 0;

  constructor(speed = 0.2, sensitivity = 0.1) {
    this.speed = speed; 
    this.sensitivity = sensitivity;
  }

  // Allow external reset of orbit up (e.g., when switching views)
  resetUp(u?: vec3) {
    this.orbitUp = vec3.normalize(vec3.create(), u ?? WORLD_UP);
  }

  processKeyboard(code: string, pressed: boolean): boolean {
    const handled = processKeyboardInput(
      code,
      pressed,
      this.amount as unknown as Float32Array,
      this.rotation as unknown as Float32Array,
      this.sensitivity
    );
    this.userInput = handled;
    return handled;
  }

  processMouse(dx: number, dy: number) {
    const handled = processMouseInput(
      dx,
      dy,
      this.leftMousePressed,
      this.rightMousePressed,
      this.rotation as unknown as Float32Array,
      this.shift as unknown as Float32Array
    );
    this.userInput = handled;
  }

  processScroll(delta: number) { 
    this.scroll += processScrollInput(delta); 
    this.userInput = true; 
  }

  /** Equivalent to Rust's update_camera, but with stable orbitUp maintenance and pole/twist protection */
  update(cam: PerspectiveCamera, dt: number) {
    const dtSec = dt;

    // === 1) Orbit basis (from pos/center), and stabilize orbitUp ===
    const upRef = this.up ? vec3.normalize(vec3.create(), this.up) : WORLD_UP; // 固定全局up
    let { forward, right, yawAxis } = calculateOrbitBasis(cam.positionV, this.center, upRef);

    // === 2) Logarithmic scaling (along view line) ===
    const dist1 = applyDistanceScaling(cam.positionV, this.center, this.scroll, dtSec, this.speed);

    // === 3) Right-click panning ===
    const dist0 = Math.max(vec3.distance(cam.positionV, this.center), 1e-6);
    applyPanning(this.center, this.shift, right, yawAxis, dtSec, this.speed, dist0);
    
    // Update position along forward to new radius
    const pos = vec3.scale(vec3.create(), forward, -dist1); // pos = center - forward * dist
    vec3.add(cam.positionV, this.center, pos);

    // === 4) Rotation (yaw around yawAxis, pitch around right; Alt enables roll around forward) ===
    let yaw   =  this.rotation[0] * dtSec * this.sensitivity;
    let pitch = -this.rotation[1] * dtSec * this.sensitivity;
    let roll  = 0;
    if (this.altPressed) { 
      roll = -this.rotation[1] * dtSec * this.sensitivity; 
      yaw = 0; 
      pitch = 0; 
    }

    const rotationResult = applyRotation(forward, right, yawAxis, yaw, pitch, roll);
    forward = rotationResult.forward;
    right = rotationResult.right;
    yawAxis = rotationResult.yawAxis;

    // Update position: pos = center - forward * dist1
    vec3.add(cam.positionV, this.center, vec3.scale(vec3.create(), forward, -dist1));

    // === 5) Use stable lookAt to rebuild world->camera; and update stable orbitUp state ===
    
    cam.rotationQ = lookAtW2C(forward, upRef);
    // Record new orbitUp (orthogonalized yawAxis), use directly next frame, avoid back-and-forth switching
    vec3.copy(this.orbitUp, yawAxis);

    // === 6) Decay (consistent with Rust) ===
    const decayResult = applyDecay(this.rotation, this.shift, this.scroll, dtSec);
    vec3.copy(this.rotation, decayResult.rotation);
    vec2.copy(this.shift, decayResult.shift);
    this.scroll = decayResult.scroll;
    this.userInput = false;

    // === 7) Debug (should be close to 1) ===
    this._acc += dtSec;
    if (this.debug && this._acc >= this.debugEvery) {
      this._acc = 0;
      // Use rotationQ to derive +Z as forward_from_rot
      const cw = quat.invert(quat.create(), cam.rotationQ);
      const fFromRot = vec3.transformQuat(vec3.create(), vec3.fromValues(0,0,1), cw);
      console.log("[CameraDebug]", <CamDebug>{
        pos: [cam.positionV[0], cam.positionV[1], cam.positionV[2]],
        center: [this.center[0], this.center[1], this.center[2]],
        dist: vec3.distance(cam.positionV, this.center),
        forward_to_center: [forward[0], forward[1], forward[2]],
        forward_from_rot: [fFromRot[0], fFromRot[1], fFromRot[2]],
        dot: vec3.dot(fFromRot, forward),
      });
    }
  }

  // Implement interface methods
  getControllerType(): 'orbit' | 'fps' {
    return 'orbit';
  }

  // Optional: Add resetOrientation for compatibility
  resetOrientation(): void {
    // Reset to default view for orbit controller
    this.center = vec3.fromValues(0, 0, 0);
    this.rotation = vec3.fromValues(0, 0, 0);
    this.shift = vec2.fromValues(0, 0);
    this.scroll = 0;
    this.orbitUp = vec3.clone(WORLD_UP);
  }
}
// Orbit camera mechanics and mathematical calculations

import { vec2, vec3, quat } from "gl-matrix";

const EPS = 1e-6;
const WORLD_UP = vec3.fromValues(0, 1, 0);
const MIN_POLE_ANGLE = 5 * Math.PI / 180; // Minimum angle from poles (5°)
const MIN_DISTANCE = 0.1; // Minimum distance from center to prevent pass-through
const MAX_DISTANCE = 1000; // Maximum zoom out distance

function angleShort(a: vec3, b: vec3): number {
  const an = vec3.normalize(vec3.create(), a);
  const bn = vec3.normalize(vec3.create(), b);
  const c = Math.max(-1, Math.min(1, vec3.dot(an, bn)));
  let ang = Math.acos(c);
  if (ang > Math.PI * 0.5) ang = Math.PI - ang;
  return ang;
}

/**
 * Stable lookAt: derives world->camera quaternion from forward (+Z direction) and up (world)
 */
export function lookAtW2C(forwardWorld: vec3, upWorld: vec3): quat {
  const f = vec3.normalize(vec3.create(), forwardWorld);

  // Project up onto f's normal plane
  let uDes = vec3.sub(vec3.create(), upWorld, vec3.scale(vec3.create(), f, vec3.dot(upWorld, f)));
  if (vec3.sqrLen(uDes) < EPS) {
    const tmp = Math.abs(f[1]) < 0.99 ? WORLD_UP : vec3.fromValues(1, 0, 0);
    uDes = vec3.sub(vec3.create(), tmp, vec3.scale(vec3.create(), f, vec3.dot(tmp, f)));
  }
  vec3.normalize(uDes, uDes);

  // Step 1: Rotate local +Z to f
  const q1 = quat.rotationTo(quat.create(), vec3.fromValues(0, 0, 1), f);

  // Local +Y direction in world after q1
  const up1 = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 1, 0), q1);
  // Project both to normal plane, calculate twist angle around f
  const up1p = vec3.sub(vec3.create(), up1, vec3.scale(vec3.create(), f, vec3.dot(up1, f)));
  vec3.normalize(up1p, up1p);
  const c = Math.max(-1, Math.min(1, vec3.dot(up1p, uDes)));
  let ang = Math.acos(c);
  const cross = vec3.cross(vec3.create(), up1p, uDes);
  const sgn = vec3.dot(cross, f) >= 0 ? 1 : -1;
  ang *= sgn;

  const q2 = quat.setAxisAngle(quat.create(), f, ang);
  const qCW = quat.multiply(quat.create(), q2, q1);    // camera->world
  return quat.invert(quat.create(), qCW);              // world->camera
}

/**
 * Project vector v onto plane with normal n (returns normalized vector; uses fallback if degenerate)
 */
export function projectOntoPlaneNormed(v: vec3, n: vec3, fallback: vec3): vec3 {
  const out = vec3.sub(vec3.create(), v, vec3.scale(vec3.create(), n, vec3.dot(v, n)));
  let l2 = vec3.sqrLen(out);
  if (l2 < EPS) return vec3.normalize(vec3.create(), fallback);
  return vec3.scale(out, out, 1 / Math.sqrt(l2));
}

/**
 * Calculate orbit basis vectors from camera position and center
 */
export function calculateOrbitBasis(
  cameraPos: vec3,
  center: vec3,
  orbitUp: vec3
): { forward: vec3, right: vec3, yawAxis: vec3 } {
  // Forward points toward center
  const forward = vec3.normalize(vec3.create(),
    vec3.subtract(vec3.create(), center, cameraPos));

  // Project orbitUp to forward's normal plane to get yaw axis
  const yawAxis = projectOntoPlaneNormed(orbitUp, forward,
    (Math.abs(forward[1]) < 0.99 ? WORLD_UP : vec3.fromValues(1, 0, 0)));

  // Right = forward × yawAxis (right-handed)
  const right = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), forward, yawAxis));
  
  // Re-orthogonalize yawAxis (avoid numerical error)
  const orthoYawAxis = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), right, forward));

  return { forward, right, yawAxis: orthoYawAxis };
}

/**
 * Apply distance scaling (zoom) along view line
 */
export function applyDistanceScaling(
  cameraPos: vec3,
  center: vec3,
  scroll: number,
  deltaTime: number,
  speed: number
): number {
  const dist0 = Math.max(vec3.distance(cameraPos, center), EPS);
  const dist1 = Math.exp(Math.log(dist0) + scroll * deltaTime * 10 * speed);
  return Math.max(MIN_DISTANCE, Math.min(dist1, MAX_DISTANCE));
}

/**
 * Apply panning (right-click translation) 
 */
export function applyPanning(
  center: vec3,
  shift: vec2,
  right: vec3,
  yawAxis: vec3,
  deltaTime: number,
  speed: number,
  distance: number
): void {
  const k = deltaTime * speed * 0.1 * distance;
  const offset = vec3.create();
  vec3.scaleAndAdd(offset, offset, right,   shift[1] * k);
  vec3.scaleAndAdd(offset, offset, yawAxis, -shift[0] * k);
  vec3.add(center, center, offset);
}

/**
 * Apply rotation with pole protection
 */
export function applyRotation(
  forward: vec3,
  right: vec3,
  yawAxis: vec3,
  yaw: number,
  pitch: number,
  roll: number
): { forward: vec3, right: vec3, yawAxis: vec3 } {
  let newForward = vec3.clone(forward);
  let newRight = vec3.clone(right);
  let newYawAxis = vec3.clone(yawAxis);

  // Apply yaw: rotate forward and right around yawAxis
  if (Math.abs(yaw) > 0) {
    const qYaw = quat.setAxisAngle(quat.create(), newYawAxis, yaw);
    newForward = vec3.transformQuat(vec3.create(), newForward, qYaw);
    newRight = vec3.transformQuat(vec3.create(), newRight, qYaw);
    // Re-orthogonalize yawAxis
    newYawAxis = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), newRight, newForward));
  }

  // Apply pitch with pole limit
  if (Math.abs(pitch) > 0) {
    // Limit forward's angle with yawAxis to avoid getting too close to poles
    const cosMin = Math.cos(MIN_POLE_ANGLE);
    const dotFU = Math.max(-1, Math.min(1, vec3.dot(newForward, newYawAxis)));
    
    // Predict new forward after pitch rotation
    const qPitchTest = quat.setAxisAngle(quat.create(), newRight, pitch);
    const fwdTest = vec3.transformQuat(vec3.create(), newForward, qPitchTest);
    const dotTest = Math.max(-1, Math.min(1, vec3.dot(fwdTest, newYawAxis)));
    
    if (Math.abs(dotTest) > cosMin) {
      // Clamp to boundary (shrink toward safe direction)
      const sign = dotTest > 0 ? 1 : -1;
      const targetDot = sign * cosMin;
      // Simplification: scale pitch proportionally (avoid complex inverse solving)
      const scale = Math.min(1, Math.abs((targetDot - dotFU) / (dotTest - dotFU + 1e-9)));
      pitch *= scale;
    }
    
    const qPitch = quat.setAxisAngle(quat.create(), newRight, pitch);
    newForward = vec3.transformQuat(vec3.create(), newForward, qPitch);
    newYawAxis = projectOntoPlaneNormed(newYawAxis, newForward, newYawAxis); // Re-project to maintain orthogonality
    newRight = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), newForward, newYawAxis));
  }

  // Optional roll (rarely used)
  if (Math.abs(roll) > 0) {
    const qRoll = quat.setAxisAngle(quat.create(), newForward, roll);
    newYawAxis = vec3.transformQuat(vec3.create(), newYawAxis, qRoll);
    newRight = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), newForward, newYawAxis));
  }

  return { forward: newForward, right: newRight, yawAxis: newYawAxis };
}

/**
 * Apply exponential decay to control values
 */
export function applyDecay(
  rotation: vec3,
  shift: vec2,
  scroll: number,
  deltaTime: number
): { rotation: vec3, shift: vec2, scroll: number } {
  let decay = Math.pow(0.8, deltaTime * 60);
  if (decay < 1e-4) decay = 0;
  
  const newRotation = vec3.scale(vec3.create(), rotation, decay);
  if (vec3.len(newRotation) < 1e-4) vec3.set(newRotation, 0, 0, 0);
  
  const newShift = vec2.scale(vec2.create(), shift, decay);
  if (vec2.len(newShift) < 1e-4) vec2.set(newShift, 0, 0);
  
  const newScroll = scroll * decay;
  const finalScroll = Math.abs(newScroll) < 1e-4 ? 0 : newScroll;
  
  return { rotation: newRotation, shift: newShift, scroll: finalScroll };
}

export { WORLD_UP, MIN_POLE_ANGLE, EPS, MIN_DISTANCE, MAX_DISTANCE };
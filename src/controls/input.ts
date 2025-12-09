// Input event handling utilities for camera controls

export function processKeyboardInput(
  code: string, 
  pressed: boolean,
  amount: Float32Array, // vec3-like [x, y, z]
  rotation: Float32Array, // vec3-like [yaw, pitch, roll] 
  sensitivity: number
): boolean {
  const step = pressed ? 1 : -1;
  let handled = true;
  
  switch (code) {
    case "KeyW": amount[2] += +step; break;
    case "KeyS": amount[2] += -step; break;
    case "KeyA": amount[0] += -step; break;
    case "KeyD": amount[0] += +step; break;
    case "KeyQ": rotation[2] +=  step / sensitivity; break;
    case "KeyE": rotation[2] += -step / sensitivity; break;
    case "Space":     amount[1] +=  step; break;
    case "ShiftLeft": amount[1] += -step; break;
    default: handled = false;
  }
  
  return handled;
}

export function processMouseInput(
  dx: number, 
  dy: number,
  leftPressed: boolean,
  rightPressed: boolean,
  rotation: Float32Array, // vec3-like [yaw, pitch, roll]
  shift: Float32Array // vec2-like [x, y]
): boolean {
  let handled = false;
  
  if (leftPressed) {
    rotation[0] += dx; // yaw
    rotation[1] += -dy; // pitch (negated in update)
    handled = true;
  }
  
  if (rightPressed) {
    shift[0] += dy;    // x = dy
    shift[1] += dx;    // y = -dx  
    handled = true;
  }
  
  return handled;
}

export function processScrollInput(delta: number): number {
  return delta * 3.0;
}
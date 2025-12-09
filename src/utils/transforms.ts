// Transform utilities extracted from camera.ts

import { mat4 } from "gl-matrix";

export const VIEWPORT_Y_FLIP = mat4.fromValues(
  1, 0, 0, 0,
  0,-1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
);
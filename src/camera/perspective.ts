// Perspective camera and projection classes extracted from camera.ts

import { mat3, mat4, vec2, vec3, quat } from "gl-matrix";
import { deg2rad, fov2focal, Aabb } from '../utils';

export interface Camera {
  viewMatrix(): mat4;
  projMatrix(): mat4;
  position(): vec3;
  frustumPlanes(): {
    near: Float32Array; far: Float32Array;
    left: Float32Array; right: Float32Array;
    top: Float32Array; bottom: Float32Array;
  };
}

export class PerspectiveProjection {
  fovx: number; // radians
  fovy: number; // radians
  znear: number;
  zfar: number;
  /** fov ratio to viewport ratio (used to preserve FOV on resize) */
  private fov2viewRatio: number;

  constructor(viewport: vec2 | [number, number], fov: vec2 | [number, number], znear: number, zfar: number) {
    const vw = typeof viewport[0] === "number" ? viewport[0] as number : (viewport as any)[0];
    const vh = typeof viewport[1] === "number" ? viewport[1] as number : (viewport as any)[1];
    const fx = typeof fov[0] === "number" ? fov[0] as number : (fov as any)[0];
    const fy = typeof fov[1] === "number" ? fov[1] as number : (fov as any)[1];
    const vr = vw / vh;
    const fr = fx / fy;
    this.fovx = fx; this.fovy = fy;
    this.znear = znear; this.zfar = zfar;
    this.fov2viewRatio = vr / fr;
  }

  clone(): PerspectiveProjection {
    const p = new PerspectiveProjection([1,1], [this.fovx, this.fovy], this.znear, this.zfar);
    (p as any).fov2viewRatio = this.fov2viewRatio;
    return p;
  }

  /** Maintain FOV consistency when viewport changes. */
  resize(viewport: vec2 | [number, number]) {
    const vw = typeof viewport[0] === "number" ? viewport[0] as number : (viewport as any)[0];
    const vh = typeof viewport[1] === "number" ? viewport[1] as number : (viewport as any)[1];
    const vr = vw / vh;
    const fr = vr / this.fov2viewRatio;
    // Adjust whichever fov differs from the preserved ratio
    const newFovy = 2 * Math.atan(Math.tan(this.fovy * 0.5) * (fr / (this.fovx / this.fovy)));
    // Keep relationship but prefer changing the dimension that deviated most
    if (Math.abs((this.fovx / this.fovy) - fr) < 1e-6) return; // already matching
    // Recompute fovx from fovy and ratio
    this.fovy = newFovy;
    this.fovx = this.fovy * fr;
  }

  projectionMatrix(): mat4 {
    return buildProj(this.znear, this.zfar, this.fovx, this.fovy);
  }

  focal(viewport: vec2 | [number, number]): [number, number] {
    const vw = typeof viewport[0] === "number" ? viewport[0] as number : (viewport as any)[0];
    const vh = typeof viewport[1] === "number" ? viewport[1] as number : (viewport as any)[1];
    return [fov2focal(this.fovx, vw), fov2focal(this.fovy, vh)];
  }

  lerp(other: PerspectiveProjection, t: number): PerspectiveProjection {
    const out = this.clone();
    out.fovx = this.fovx * (1 - t) + other.fovx * t;
    out.fovy = this.fovy * (1 - t) + other.fovy * t;
    out.znear = this.znear * (1 - t) + other.znear * t;
    out.zfar = this.zfar * (1 - t) + other.zfar * t;
    (out as any).fov2viewRatio = (this as any).fov2viewRatio * (1 - t) + (other as any).fov2viewRatio * t;
    return out;
  }
}

export class PerspectiveCamera implements Camera {
  positionV: vec3;
  rotationQ: quat;
  projection: PerspectiveProjection;

  constructor(position: vec3, rotation: quat, projection: PerspectiveProjection) {
    this.positionV = vec3.clone(position);
    this.rotationQ = quat.clone(rotation);
    this.projection = projection;
  }

  static default(): PerspectiveCamera {
    return new PerspectiveCamera(
      vec3.fromValues(0, 0, -1),
      quat.fromValues(0, 0, 0, 1),
      new PerspectiveProjection([1,1], [deg2rad(45), deg2rad(45)], 0.1, 100)
    );
  }

  fitNearFar(aabb: Aabb): void {
    const center = aabb.center();
    const radius = aabb.radius();
    const d = vec3.distance(this.positionV, center);
    const zfar = d + radius;
    const znear = Math.max(d - radius, zfar / 1000);
    this.projection.zfar = zfar*1.5;
    this.projection.znear = znear;
  }

  viewMatrix(): mat4 {
    const R_wc = mat3.create();
    mat3.fromQuat(R_wc, this.rotationQ); // rotationQ 被当作 world->camera
    return world2view(R_wc, this.positionV);
  }

  projMatrix(): mat4 { return this.projection.projectionMatrix(); }

  position(): vec3 { return vec3.clone(this.positionV); }

  frustumPlanes() {
    const P = this.projMatrix();
    const V = this.viewMatrix();
    const PV = mat4.create();
    mat4.multiply(PV, P, V);
    // Extract planes using row-combinations; for column-major arrays, rows are (m0,m4,m8,m12) etc
    const r0 = [PV[0], PV[4], PV[8], PV[12]]; // row 0
    const r1 = [PV[1], PV[5], PV[9], PV[13]]; // row 1
    const r2 = [PV[2], PV[6], PV[10], PV[14]]; // row 2
    const r3 = [PV[3], PV[7], PV[11], PV[15]]; // row 3

    const add = (a:number[], b:number[]) => new Float32Array([a[0]+b[0], a[1]+b[1], a[2]+b[2], a[3]+b[3]]);
    const sub = (a:number[], b:number[]) => new Float32Array([a[0]-b[0], a[1]-b[1], a[2]-b[2], a[3]-b[3]]);
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

export function world2view(R_wc: mat3, C: vec3): mat4 {
  // R_wc: world->camera 旋转；C: 摄像机位置（world）
  const V = mat4.create();

  // 上三行三列：旋转（列主序）
  V[0] = R_wc[0]; V[1] = R_wc[1]; V[2]  = R_wc[2];  V[3]  = 0;
  V[4] = R_wc[3]; V[5] = R_wc[4]; V[6]  = R_wc[5];  V[7]  = 0;
  V[8] = R_wc[6]; V[9] = R_wc[7]; V[10] = R_wc[8]; V[11] = 0;

  // 平移列：t_view = -R_wc * C
  const t = vec3.create();
  vec3.transformMat3(t, C, R_wc); // t = R_wc * C
  V[12] = -t[0];
  V[13] = -t[1];
  V[14] = -t[2];
  V[15] = 1;

  return V;
}

export function buildProj(znear: number, zfar: number, fovx: number, fovy: number): mat4 {
  const tanHalfY = Math.tan(fovy * 0.5);
  const tanHalfX = Math.tan(fovx * 0.5);
  const top = tanHalfY * znear;
  const bottom = -top;
  const right = tanHalfX * znear;
  const left = -right;

  // Column-major mat4
  const out = mat4.create();
  out[0] = 2 * znear / (right - left);
  out[5] = 2 * znear / (top - bottom);
  out[8] = (right + left) / (right - left);
  out[9] = (top + bottom) / (top - bottom);
  out[11] = 1;
  out[10] = zfar / (zfar - znear);
  out[14] = -(zfar * znear) / (zfar - znear);
  out[15] = 0;
  return out;
}
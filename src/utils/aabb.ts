// AABB utilities extracted from camera.ts

import { vec3 } from "gl-matrix";

export class Aabb {
  min: vec3; 
  max: vec3;
  
  constructor(min: vec3, max: vec3) { 
    this.min = vec3.clone(min); 
    this.max = vec3.clone(max); 
  }
  
  center(): vec3 { 
    const c = vec3.create(); 
    vec3.add(c, this.min, this.max); 
    vec3.scale(c, c, 0.5); 
    return c; 
  }
  
  radius(): number { 
    return 0.5 * vec3.distance(this.min, this.max); 
  }
}
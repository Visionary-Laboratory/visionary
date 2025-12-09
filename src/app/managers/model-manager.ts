/**
 * Model Manager
 * Handles storage, tracking, and querying of loaded 3D models
 */

import { mat4, vec3, quat } from "gl-matrix";
import { ModelEntry, ModelInfo } from "../../models/model-entry";

export class ModelManager {
  private models: ModelEntry[] = [];
  private maxModels: number;

  constructor(maxModels: number = 10000) {
    this.maxModels = maxModels;
  }

  /**
   * Add a new model to the collection
   */
  addModel(model: Omit<ModelEntry, 'id'>): ModelEntry {
    // Check model limit
    if (this.models.length >= this.maxModels) {
      throw new Error(`Reached model limit (${this.maxModels}). Remove models before adding more.`);
    }

    // Generate unique ID
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    
    const entry: ModelEntry = {
      id,
      ...model
    };

    this.models.push(entry);
    
    console.log(`Model added: ${entry.name} (${entry.pointCount.toLocaleString()} points, ${entry.modelType})`);
    return entry;
  }

  /**
   * Remove a model by ID
   */
  removeModel(id: string): boolean {
    const index = this.models.findIndex(m => m.id === id);
    if (index >= 0) {
      const model = this.models[index];
      this.models.splice(index, 1);
      console.log(`Model removed: ${model.name}`);
      return true;
    }
    return false;
  }

  /**
   * Get all models as simplified info (public API)
   */
  getModels(): ModelInfo[] {
    return this.models.map(m => ({
      id: m.id,
      name: m.name,
      visible: m.visible,
      pointCount: m.pointCount || 0,
      isDynamic: m.isDynamic,
      modelType: m.modelType,
      colorMode: m.colorMode,
      colorChannels: m.colorChannels
    }));
  }

  /**
   * Get a model with full pointCloud reference for debugging/testing
   */
  getModelWithPointCloud(modelType: 'ply' | 'onnx' | 'fbx', id?: string): ModelEntry | null {
    if (id) {
      return this.models.find(m => m.id === id) || null;
    } else {
      return this.models.find(m => m.modelType === modelType) || null;
    }
  }

  /**
   * Get all model entries with full pointCloud references (for debugging/testing)
   */
  getFullModels(): ModelEntry[] {
    return [...this.models];
  }

  /**
   * Get models by type
   */
  getModelsByType(modelType: 'ply' | 'onnx' | 'fbx'): ModelEntry[] {
    return this.models.filter(m => m.modelType === modelType);
  }

  /**
   * Get visible models only
   */
  getVisibleModels(): ModelEntry[] {
    return this.models.filter(m => m.visible);
  }

  /**
   * Get dynamic models only
   */
  getDynamicModels(): ModelEntry[] {
    return this.models.filter(m => m.isDynamic);
  }

  /**
   * Update model visibility
   */
  setModelVisibility(id: string, visible: boolean): boolean {
    const model = this.models.find(m => m.id === id);
    if (model) {
      model.visible = visible;
      console.log(`Model ${model.name}: ${visible ? 'shown' : 'hidden'}`);
      return true;
    }
    return false;
  }

  /**
   * Get total point count for visible models
   */
  getTotalVisiblePoints(): number {
    return this.models
      .filter(m => m.visible)
      .reduce((sum, m) => sum + m.pointCount, 0);
  }

  /**
   * Get total point count for all models
   */
  getTotalPoints(): number {
    return this.models.reduce((sum, m) => sum + m.pointCount, 0);
  }

  /**
   * Check if at model limit
   */
  isAtCapacity(): boolean {
    return this.models.length >= this.maxModels;
  }

  /**
   * Get model count
   */
  getModelCount(): number {
    return this.models.length;
  }

  /**
   * Get remaining capacity
   */
  getRemainingCapacity(): number {
    return Math.max(0, this.maxModels - this.models.length);
  }

  /**
   * Clear all models
   */
  clearAllModels(): void {
    const count = this.models.length;
    this.models = [];
    console.log(`Cleared ${count} models`);
  }

  /**
   * Find model by name (first match)
   */
  findModelByName(name: string): ModelEntry | null {
    return this.models.find(m => m.name === name) || null;
  }
  
  /**
   * Set model position (legacy method - creates transform matrix from TRS)
   */
  setModelPosition(id: string, x: number, y: number, z: number): boolean {
    return this.updateModelTransform(id, { translation: vec3.fromValues(x, y, z) });
  }

  /**
   * Set model rotation (radians, XYZ)
   */
  setModelRotation(id: string, x: number, y: number, z: number): boolean {
    return this.updateModelTransform(id, { rotationEuler: vec3.fromValues(x, y, z) });
  }

  /**
   * Set model scale (uniform or non-uniform). Clamp each axis to epsilon to avoid collapse.
   */
  setModelScale(id: string, scale: number | [number, number, number]): boolean {
    const eps = 1e-4;
    const s = Array.isArray(scale)
      ? vec3.fromValues(Math.max(eps, scale[0]), Math.max(eps, scale[1]), Math.max(eps, scale[2]))
      : vec3.fromValues(Math.max(eps, scale), Math.max(eps, scale), Math.max(eps, scale));
    return this.updateModelTransform(id, { scale: s });
  }

  /**
   * Set model transform matrix directly
   */
  setModelTransform(id: string, transform: Float32Array | number[]): boolean {
    const model = this.models.find(m => m.id === id);
    if (model) {
      model.pointCloud.setTransform(transform);
      console.log(`Model ${model.name} transform updated`);
      return true;
    }
    return false;
  }

  /**
   * Get model position
   */
  getModelPosition(id: string): [number, number, number] | null {
    const model = this.models.find(m => m.id === id);
    if (model) {
      const t = model.pointCloud.transform;
      return [t[12], t[13], t[14]]; // Extract translation from matrix
    }
    return null;
  }

  /**
   * Get model rotation (in radians) - legacy method, limited functionality
   */
  getModelRotation(id: string): [number, number, number] | null {
    const model = this.models.find(m => m.id === id);
    if (!model) return null;

    const m = mat4.clone(model.pointCloud.transform);
    const q = quat.create();
    if (!mat4.getRotation) return [0, 0, 0];
    mat4.getRotation(q, m);

    // Quaternion -> Euler XYZ (radians)
    const sx = 2 * (q[3] * q[0] + q[1] * q[2]);
    const cx = 1 - 2 * (q[0] * q[0] + q[1] * q[1]);
    const rx = Math.atan2(sx, cx);

    const sy = 2 * (q[3] * q[1] - q[2] * q[0]);
    const ry = Math.abs(sy) >= 1 ? Math.sign(sy) * Math.PI / 2 : Math.asin(sy);

    const sz = 2 * (q[3] * q[2] + q[0] * q[1]);
    const cz = 1 - 2 * (q[1] * q[1] + q[2] * q[2]);
    const rz = Math.atan2(sz, cz);

    return [rx, ry, rz];
  }

  /**
   * Get model scale - legacy method, limited functionality
   */
  getModelScale(id: string): [number, number, number] | null {
    const model = this.models.find(m => m.id === id);
    if (!model) return null;

    const m = mat4.clone(model.pointCloud.transform);
    const s = vec3.create();
    if (mat4.getScaling) {
      mat4.getScaling(s, m);
      return [s[0], s[1], s[2]];
    }
    return [1, 1, 1];
  }
  
  /**
   * Get model transform matrix
   */
  getModelTransform(id: string): Float32Array | null {
    const model = this.models.find(m => m.id === id);
    return model ? model.pointCloud.transform : null;
  }

  /**
   * Internal helper: compose TRS and write back to point cloud
   */
  private updateModelTransform(
    id: string,
    opts: { translation?: vec3; rotationEuler?: vec3; scale?: vec3 }
  ): boolean {
    const model = this.models.find(m => m.id === id);
    if (!model) {
      console.log(`Model with ID ${id} not found for transform update`);
      return false;
    }

    const current = mat4.clone(model.pointCloud.transform);

    const translation = vec3.create();
    mat4.getTranslation?.(translation, current);

    const scale = vec3.create();
    if (mat4.getScaling) {
      mat4.getScaling(scale, current);
    } else {
      vec3.set(scale, 1, 1, 1);
    }

    const rotationQ = quat.create();
    if (mat4.getRotation) {
      mat4.getRotation(rotationQ, current);
    } else {
      quat.identity(rotationQ);
    }

    if (opts.translation) {
      vec3.copy(translation, opts.translation);
    }
    if (opts.scale) {
      vec3.copy(scale, opts.scale);
      // 不再耦合 gaussianScaling，避免与全局/管线缩放重复叠加
    }
    if (opts.rotationEuler) {
      const deg = vec3.fromValues(
        opts.rotationEuler[0] * 180 / Math.PI,
        opts.rotationEuler[1] * 180 / Math.PI,
        opts.rotationEuler[2] * 180 / Math.PI
      );
      quat.fromEuler(rotationQ, deg[0], deg[1], deg[2]);
    }

    const out = mat4.create();
    mat4.fromRotationTranslationScale(out, rotationQ, translation, scale);
    model.pointCloud.setTransform(out);
    console.log(`Model ${model.name} transform updated (pos=${translation.join(',')}, scale=${scale.join(',')})`);
    return true;
  }

  /**
   * Check if model name exists
   */
  hasModelWithName(name: string): boolean {
    return this.models.some(m => m.name === name);
  }

  /**
   * Generate unique name based on base name
   */
  generateUniqueName(baseName: string): string {
    if (!this.hasModelWithName(baseName)) {
      return baseName;
    }

    let counter = 1;
    let uniqueName: string;
    do {
      uniqueName = `${baseName} (${counter})`;
      counter++;
    } while (this.hasModelWithName(uniqueName));

    return uniqueName;
  }
}
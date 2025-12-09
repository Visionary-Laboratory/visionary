/**
 * Three.js Model Loader Adapters
 * 为 Three.js 模型加载器创建 ILoader 适配器，使其能够与 UniversalLoader 集成
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { ThreeJSDataSource, ILoader, LoadingOptions } from './index';

/**
 * Three.js 模型数据源
 * 将 Three.js Object3D 包装为 ThreeJSDataSource 格式
 */
export class ThreeJSModelData implements ThreeJSDataSource {
  private _object3D: THREE.Object3D;
  private _bbox: { min: [number, number, number]; max: [number, number, number] };
  private _modelType: string;

  constructor(object3D: THREE.Object3D, modelType: string = 'unknown') {
    this._object3D = object3D;
    this._modelType = modelType;
    this._bbox = this.calculateBoundingBox(object3D);
  }

  // 实现 ThreeJSDataSource 接口
  object3D(): THREE.Object3D {
    return this._object3D;
  }

  modelType(): string {
    return this._modelType;
  }

  bbox(): { min: [number, number, number]; max: [number, number, number] } {
    return this._bbox;
  }

  private calculateBoundingBox(object3D: THREE.Object3D): { min: [number, number, number]; max: [number, number, number] } {
    const box = new THREE.Box3().setFromObject(object3D);
    return {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z]
    };
  }
}

/**
 * Three.js 加载器基类
 */
abstract class ThreeJSLoaderAdapter<T extends THREE.Object3D> implements ILoader<ThreeJSModelData> {
  protected loader: any;

  constructor(loader: any) {
    this.loader = loader;
  }

  /**
   * 公共处理：保留自带材质，如无材质则使用回退材质，并开启阴影
   */
  protected applyShadowsAndMaterial(object: THREE.Object3D, fallbackMaterial?: THREE.Material) {
    object.traverse((child: any) => {
      if (child && child.isMesh) {
        if (!child.material && fallbackMaterial) {
          child.material = fallbackMaterial;
        }
        if ('castShadow' in child) child.castShadow = true;
        if ('receiveShadow' in child) child.receiveShadow = true;
      }
    });
  }

  async loadFile(file: File, options?: LoadingOptions): Promise<ThreeJSModelData> {
    const url = URL.createObjectURL(file);
    try {
      const object3D = await this.loadFromUrl(url, options);
      return new ThreeJSModelData(object3D, this.getModelType());
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async loadUrl(url: string, options?: LoadingOptions): Promise<ThreeJSModelData> {
    const object3D = await this.loadFromUrl(url, options);
    return new ThreeJSModelData(object3D, this.getModelType());
  }

  async loadBuffer(buffer: ArrayBuffer, options?: LoadingOptions): Promise<ThreeJSModelData> {
    throw new Error('Buffer loading not supported for Three.js models');
  }

  canHandle(filename: string, mimeType?: string): boolean {
    return this.getSupportedExtensions().some(ext => 
      filename.toLowerCase().endsWith(ext)
    );
  }

  abstract getSupportedExtensions(): string[];
  protected abstract loadFromUrl(url: string, options?: LoadingOptions): Promise<T>;
  protected abstract getModelType(): string;
}

/**
 * GLTF/GLB 加载器适配器
 */
export class GLTFLoaderAdapter extends ThreeJSLoaderAdapter<THREE.Group> {
  constructor() {
    super(new GLTFLoader());
  }

  getSupportedExtensions(): string[] {
    return ['.gltf', '.glb'];
  }

  protected getModelType(): string {
    return 'gltf';
  }

  protected async loadFromUrl(url: string, options?: LoadingOptions): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf: any) => {
          // 保留 GLTF 自带材质，仅补充阴影配置
          this.applyShadowsAndMaterial(gltf.scene);
          resolve(gltf.scene);
        },
        (progress: any) => {
          if (options?.onProgress) {
            options.onProgress({
              progress: progress.loaded / progress.total,
              stage: 'Loading GLTF/GLB...'
            });
          }
        },
        reject
      );
    });
  }
}

/**
 * OBJ 加载器适配器
 */
export class OBJLoaderAdapter extends ThreeJSLoaderAdapter<THREE.Group> {
  constructor() {
    super(new OBJLoader());
  }

  getSupportedExtensions(): string[] {
    return ['.obj'];
  }

  protected getModelType(): string {
    return 'obj';
  }

  protected async loadFromUrl(url: string, options?: LoadingOptions): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (object3D: THREE.Group) => {
          // OBJ 可能带 MTL，优先保留自带材质
          this.applyShadowsAndMaterial(object3D);
          resolve(object3D);
        },
        (progress: any) => {
          if (options?.onProgress) {
            options.onProgress({
              progress: progress.loaded / progress.total,
              stage: 'Loading OBJ...'
            });
          }
        },
        reject
      );
    });
  }
}

/**
 * FBX 加载器适配器
 */
export class FBXLoaderAdapter extends ThreeJSLoaderAdapter<THREE.Group> {
  constructor() {
    super(new FBXLoader());
  }

  getSupportedExtensions(): string[] {
    return ['.fbx'];
  }

  protected getModelType(): string {
    return 'fbx';
  }

  protected async loadFromUrl(url: string, options?: LoadingOptions): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (object3D: THREE.Group) => {
          // FBX 自带材质保持不动，只补充阴影属性
          this.applyShadowsAndMaterial(object3D);
          resolve(object3D);
        },
        (progress: any) => {
          if (options?.onProgress) {
            options.onProgress({
              progress: progress.loaded / progress.total,
              stage: 'Loading FBX...'
            });
          }
        },
        reject
      );
    });
  }
}

/**
 * STL 加载器适配器
 */
export class STLLoaderAdapter extends ThreeJSLoaderAdapter<THREE.Mesh> {
  constructor() {
    super(new STLLoader());
  }

  getSupportedExtensions(): string[] {
    return ['.stl'];
  }

  protected getModelType(): string {
    return 'stl';
  }

  protected async loadFromUrl(url: string, options?: LoadingOptions): Promise<THREE.Mesh> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (geometry: THREE.BufferGeometry) => {
          // 将 BufferGeometry 包装为 Mesh
          const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
          const mesh = new THREE.Mesh(geometry, material);
          // STL 本身无材质，使用默认材质；如有材质则保留
          this.applyShadowsAndMaterial(mesh, material);
          resolve(mesh);
        },
        (progress: any) => {
          if (options?.onProgress) {
            options.onProgress({
              progress: progress.loaded / progress.total,
              stage: 'Loading STL...'
            });
          }
        },
        reject
      );
    });
  }
}

/**
 * Three.js PLY 加载器适配器（用于非高斯 PLY 文件）
 */
export class ThreeJSPLYLoaderAdapter extends ThreeJSLoaderAdapter<THREE.Mesh> {
  constructor() {
    super(new PLYLoader());
  }

  getSupportedExtensions(): string[] {
    return ['.ply'];
  }

  protected getModelType(): string {
    return 'ply';
  }

  protected async loadFromUrl(url: string, options?: LoadingOptions): Promise<THREE.Mesh> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (geometry: THREE.BufferGeometry) => {
          // 将 BufferGeometry 包装为 Mesh
          const material = new THREE.MeshStandardMaterial({ vertexColors: true });
          const mesh = new THREE.Mesh(geometry, material);
          // PLY 若有自带材质则保留，否则用默认 vertexColors 材质
          this.applyShadowsAndMaterial(mesh, material);
          resolve(mesh);
        },
        (progress: any) => {
          if (options?.onProgress) {
            options.onProgress({
              progress: progress.loaded / progress.total,
              stage: 'Loading PLY...'
            });
          }
        },
        reject
      );
    });
  }
}

/**
 * 创建所有 Three.js 加载器适配器
 */
export function createThreeJSAdapters(): ThreeJSLoaderAdapter<any>[] {
  return [
    new GLTFLoaderAdapter(),
    new OBJLoaderAdapter(),
    new FBXLoaderAdapter(),
    new STLLoaderAdapter(),
    new ThreeJSPLYLoaderAdapter()
  ];
}

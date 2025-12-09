/**
 * FBX Loader Manager
 * 负责加载 FBX 文件并创建 ModelEntry
 */

import * as THREE from "three/webgpu";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { ModelManager } from "./model-manager";
import { ModelEntry } from "../../models/model-entry";
import { FBXModelWrapper, FBXLoadOptions } from "../../models/fbx-model-wrapper";

export interface FBXLoaderCallbacks {
  onProgress?: (progress: number, message: string) => void;
  onError?: (error: string) => void;
  onSuccess?: (model: ModelEntry) => void;
}

/**
 * FBX 加载器管理器
 * 参考 GaussianLoader 的模式，负责加载 FBX 文件
 */
export class FBXLoaderManager {
  private loader: FBXLoader;
  private modelManager: ModelManager;
  private callbacks: FBXLoaderCallbacks;

  constructor(modelManager: ModelManager, callbacks: FBXLoaderCallbacks = {}) {
    this.modelManager = modelManager;
    this.callbacks = callbacks;
    this.loader = new FBXLoader();
    
    // WebGPU 兼容性警告
    console.warn("⚠️ FBXLoader 与 WebGPU 渲染器可能存在兼容性问题。如果加载失败，建议：");
    console.warn("1. 将 FBX 模型转换为 GLTF/GLB 格式");
    console.warn("2. 使用 GLTFLoader 替代 FBXLoader");
    console.warn("3. 或暂时切换到 WebGLRenderer");
  }

  /**
   * 从文件加载 FBX 模型
   */
  async loadFromFile(
    file: File, 
    options: FBXLoadOptions = {}
  ): Promise<ModelEntry> {
    try {
      this.showProgress(true, "Loading FBX file...", 10);
      
      // 检查模型限制
      if (this.modelManager.isAtCapacity()) {
        this.showProgress(false);
        this.showError(`Reached model limit (${this.modelManager.getRemainingCapacity()}). Remove models before adding more.`);
        throw new Error("Model limit reached");
      }

      // 加载 FBX 文件
      const object3D = await this.loadFBXFromFile(file);
      this.showProgress(true, "Processing animations...", 30);

      // 提取动画剪辑
      const clips = this.extractAnimationClips(object3D);
      this.showProgress(true, "Creating model wrapper...", 60);

      // 创建 FBX 模型包装器
      const fbxWrapper = new FBXModelWrapper(object3D, clips, options);
      this.showProgress(true, "Registering model...", 80);

      // 生成唯一名称
      const baseName = file.name.replace(/\.[^/.]+$/, ""); // 移除扩展名
      const uniqueName = this.modelManager.generateUniqueName(baseName);

      // 创建 ModelEntry
      const modelEntry = this.modelManager.addModel({
        name: uniqueName,
        visible: true,
        pointCloud: fbxWrapper,
        pointCount: fbxWrapper.getVertexCount(),
        isDynamic: clips.length > 0,
        modelType: 'fbx'
      });

      this.showProgress(false);
      this.callbacks.onSuccess?.(modelEntry);
      
      console.log(`FBX model loaded: ${modelEntry.name} (${modelEntry.pointCount} vertices, ${clips.length} animations)`);
      return modelEntry;

    } catch (error) {
      this.showProgress(false);
      const errorMessage = `Failed to load FBX file: ${(error as Error).message}`;
      this.showError(errorMessage);
      throw error;
    }
  }

  /**
   * 从 URL 加载 FBX 模型
   */
  async loadFromURL(
    url: string, 
    options: FBXLoadOptions = {}
  ): Promise<ModelEntry> {
    try {
      this.showProgress(true, "Loading FBX from URL...", 10);
      
      // 检查模型限制
      if (this.modelManager.isAtCapacity()) {
        this.showProgress(false);
        this.showError(`Reached model limit (${this.modelManager.getRemainingCapacity()}). Remove models before adding more.`);
        throw new Error("Model limit reached");
      }

      // 加载 FBX 文件
      const object3D = await this.loadFBXFromURL(url);
      this.showProgress(true, "Processing animations...", 30);

      // 提取动画剪辑
      const clips = this.extractAnimationClips(object3D);
      this.showProgress(true, "Creating model wrapper...", 60);

      // 创建 FBX 模型包装器
      const fbxWrapper = new FBXModelWrapper(object3D, clips, options);
      this.showProgress(true, "Registering model...", 80);

      // 生成唯一名称
      const fileName = url.split('/').pop()?.replace(/\.[^/.]+$/, "") || "FBX Model";
      const uniqueName = this.modelManager.generateUniqueName(fileName);

      // 创建 ModelEntry
      const modelEntry = this.modelManager.addModel({
        name: uniqueName,
        visible: true,
        pointCloud: fbxWrapper,
        pointCount: fbxWrapper.getVertexCount(),
        isDynamic: clips.length > 0,
        modelType: 'fbx'
      });

      this.showProgress(false);
      this.callbacks.onSuccess?.(modelEntry);
      
      console.log(`FBX model loaded from URL: ${modelEntry.name} (${modelEntry.pointCount} vertices, ${clips.length} animations)`);
      return modelEntry;

    } catch (error) {
      this.showProgress(false);
      const errorMessage = `Failed to load FBX from URL: ${(error as Error).message}`;
      this.showError(errorMessage);
      throw error;
    }
  }

  /**
   * 从文件加载 FBX
   */
  private async loadFBXFromFile(file: File): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      // 添加超时保护（30秒）
      const timeout = setTimeout(() => {
        reject(new Error("FBX loading timeout after 30 seconds. This might be due to WebGPU compatibility issues with FBXLoader."));
      }, 30000);

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const arrayBuffer = event.target?.result as ArrayBuffer;
          if (!arrayBuffer) {
            throw new Error("Failed to read file");
          }
          
          console.log(`FBX file read successfully, size: ${arrayBuffer.byteLength} bytes`);
          console.log(`Starting FBX parsing...`);
          
          // FBXLoader.parse 方法：parse(data, onLoad)
          // 注意：FBXLoader 可能与 WebGPU 存在兼容性问题
          try {
            const result = this.loader.parse(arrayBuffer, "");
            clearTimeout(timeout);
            console.log(`FBX parsing completed successfully`);
            resolve(result);
          } catch (error) {
            clearTimeout(timeout);
            console.error(`FBX parsing failed:`, error);
            reject(new Error(`FBX parsing error: ${(error as Error).message || error}`));
          }
        } catch (error) {
          clearTimeout(timeout);
          console.error(`Error in file read handler:`, error);
          reject(error);
        }
      };
      reader.onerror = () => {
        clearTimeout(timeout);
        const error = new Error("Failed to read file");
        console.error(error);
        reject(error);
      };
      
      console.log(`Reading FBX file: ${file.name}, size: ${file.size} bytes`);
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * 从 URL 加载 FBX
   */
  private async loadFBXFromURL(url: string): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (object) => resolve(object),
        (progress) => {
          const percent = (progress.loaded / progress.total) * 100;
          this.showProgress(true, `Loading... ${percent.toFixed(1)}%`, percent);
        },
        (error) => reject(error)
      );
    });
  }

  /**
   * 从对象中提取动画剪辑
   */
  private extractAnimationClips(object3D: THREE.Group): THREE.AnimationClip[] {
    const clips: THREE.AnimationClip[] = [];
    
    // 遍历所有子对象，查找动画
    object3D.traverse((child) => {
      if (child.animations && child.animations.length > 0) {
        clips.push(...child.animations);
      }
    });

    // 去重（基于名称）
    const uniqueClips = clips.filter((clip, index, self) => 
      index === self.findIndex(c => c.name === clip.name)
    );

    return uniqueClips;
  }

  /**
   * 显示进度
   */
  private showProgress(show: boolean, message?: string, progress?: number): void {
    if (show && message && progress !== undefined) {
      this.callbacks.onProgress?.(progress, message);
    } else if (!show) {
      this.callbacks.onProgress?.(0, "");
    }
  }

  /**
   * 显示错误
   */
  private showError(message: string): void {
    console.error(message);
    this.callbacks.onError?.(message);
  }
}
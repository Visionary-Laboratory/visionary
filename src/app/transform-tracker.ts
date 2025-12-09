/**
 * TransformTracker - Non-invasive Model Transform and Source Tracking
 * 
 * Tracks model sources (relative paths vs URLs) and transform states
 * for scene save/load functionality. Uses method wrapping to avoid
 * modifying existing code.
 */

import type { App } from './app';

// Source tracking data
export interface ModelSource {
  kind: 'relative' | 'url';
  path?: string;      // For relative sources
  url?: string;       // For URL sources
  originalName?: string;
}

// Transform state data
export interface ModelTransform {
  position?: [number, number, number];
  rotationEulerRad?: [number, number, number];  // Always in radians
  scale?: [number, number, number];
}

/**
 * Transform and Source Tracker
 * 
 * Provides non-invasive tracking of model loading sources and transforms
 * by wrapping existing App and ModelManager methods.
 */
export class TransformTracker {
  private app: App | null = null;
  private sources = new Map<string, ModelSource>();
  private transforms = new Map<string, ModelTransform>();
  
  // Original method references for restoration
  private originalMethods: Map<string, Function> = new Map();
  private isInstalled = false;
  
  // Loading context for tracking source information through the pipeline
  private currentLoadingContext: { source: ModelSource } | null = null;

  constructor() {}

  /**
   * Install tracking on an App instance
   */
  install(app: App): void {
    if (this.isInstalled) {
      console.warn('TransformTracker: Already installed, skipping');
      return;
    }

    this.app = app;
    this.setupManagerTracking();
    
    // Attach tracker to app for access by SceneFS
    (app as any).__transformTracker = this;
    
    this.isInstalled = true;
    console.log('TransformTracker: Installed successfully');
  }

  /**
   * Uninstall tracking (restore original methods)
   */
  uninstall(): void {
    if (!this.isInstalled || !this.app) {
      return;
    }

    // Restore original methods
    this.originalMethods.forEach((originalMethod, key) => {
      const [target, methodName] = key.split('.');
      if (target === 'app') {
        (this.app as any)[methodName] = originalMethod;
      } else if (target === 'modelManager') {
        const modelManager = this.app!.getModelManager();
        (modelManager as any)[methodName] = originalMethod;
      }
    });

    // Clean up app reference
    delete (this.app as any).__transformTracker;
    
    this.app = null;
    this.sources.clear();
    this.transforms.clear();
    this.originalMethods.clear();
    this.isInstalled = false;
    
    console.log('TransformTracker: Uninstalled successfully');
  }

  /**
   * Get transform data for a model
   */
  getTransform(modelId: string): ModelTransform | null {
    return this.transforms.get(modelId) || null;
  }

  /**
   * Get source data for a model
   */
  getSource(modelId: string): ModelSource | null {
    return this.sources.get(modelId) || null;
  }

  /**
   * Update source data for a model (used for file-to-relative conversion)
   */
  updateSource(modelId: string, newSource: ModelSource): void {
    if (this.sources.has(modelId)) {
      this.sources.set(modelId, newSource);
      console.log(`TransformTracker: Updated source for ${modelId.slice(0, 8)}... to ${newSource.kind}:${newSource.path || newSource.url}`);
    } else {
      console.warn(`TransformTracker: Attempted to update source for unknown model ${modelId.slice(0, 8)}...`);
    }
  }

  /**
   * Get all tracked models with their data
   */
  getAllTrackedModels(): Array<{ modelId: string; source: ModelSource; transform: ModelTransform }> {
    const results: Array<{ modelId: string; source: ModelSource; transform: ModelTransform }> = [];
    
    this.sources.forEach((source, modelId) => {
      const transform = this.transforms.get(modelId) || {};
      results.push({ modelId, source, transform });
    });
    
    return results;
  }

  /**
   * Setup tracking for Manager methods (where ModelEntry objects are actually created)
   */
  private setupManagerTracking(): void {
    if (!this.app) return;
    
    // Wrap ModelManager.addModel to catch all model additions
    const modelManager = this.app.getModelManager();
    const originalAddModel = modelManager.addModel.bind(modelManager);
    this.originalMethods.set('modelManager.addModel', originalAddModel);

    (modelManager as any).addModel = (model: any) => {
      // Call original method first
      const result = originalAddModel(model);
      
      // Track the new model with current loading context or default source
      const source: ModelSource = this.currentLoadingContext?.source || {
        kind: 'url',
        originalName: result.name,
        url: '<unknown>'
      };
      
      this.sources.set(result.id, source);
      
      // Initialize default transform
      this.transforms.set(result.id, {
        position: [0, 0, 0],
        rotationEulerRad: [0, 0, 0],
        scale: [1, 1, 1]
      });
      
      console.log(`TransformTracker: Tracked model ${result.name} (${result.id.slice(0, 8)}...) from ${source.kind}:${source.path || source.url}`);
      
      return result;
    };

    // Set up context-passing wrappers for loading methods
    this.setupContextPassing();
    this.setupModelManagerTransformTracking();
  }

  /**
   * Set up context passing through the loading pipeline
   */
  private setupContextPassing(): void {
    if (!this.app) return;

    // Wrap App-level methods to set loading context
    const originalLoadONNXModel = this.app.loadONNXModel.bind(this.app);
    this.originalMethods.set('app.loadONNXModel', originalLoadONNXModel);

    (this.app as any).loadONNXModel = async (modelPath: string, name?: string, staticInference: boolean = true) => {
      // Don't override context if it's already set (e.g., from File upload)
      const contextWasAlreadySet = !!this.currentLoadingContext;
      
      if (!contextWasAlreadySet) {
        const isRelativePath = !modelPath.startsWith('http') && !modelPath.startsWith('blob:') && !modelPath.startsWith('file:');
        
        this.currentLoadingContext = {
          source: {
            kind: isRelativePath ? 'relative' : 'url',
            originalName: name || 'ONNX model',
            ...(isRelativePath ? { path: modelPath } : { url: modelPath })
          }
        };
      }
      
      try {
        const result = await originalLoadONNXModel(modelPath, name, staticInference);
        return result;
      } finally {
        // Only clear context if we set it (not if it was already set by file upload)
        if (!contextWasAlreadySet) {
          this.currentLoadingContext = null;
        }
      }
    };

    const originalLoadPLY = this.app.loadPLY.bind(this.app);
    this.originalMethods.set('app.loadPLY', originalLoadPLY);

    (this.app as any).loadPLY = async (input: File | string, options: any = {}) => {
      let source: ModelSource;
      
      if (typeof input === 'string') {
        const isRelativePath = !input.startsWith('http') && !input.startsWith('blob:') && !input.startsWith('file:');
        source = {
          kind: isRelativePath ? 'relative' : 'url',
          originalName: 'PLY model',
          ...(isRelativePath ? { path: input } : { url: input })
        };
      } else {
        source = {
          kind: 'url',
          originalName: input.name || 'PLY model',
          url: '<file-input>'
        };
      }
      
      this.currentLoadingContext = { source };
      
      try {
        const result = await originalLoadPLY(input, options);
        return result;
      } finally {
        this.currentLoadingContext = null;
      }
    };

    const originalLoadSample = this.app.loadSample.bind(this.app);
    this.originalMethods.set('app.loadSample', originalLoadSample);

    (this.app as any).loadSample = async (filename: string) => {
      const isRelativePath = !filename.startsWith('http') && !filename.startsWith('blob:');
      
      this.currentLoadingContext = {
        source: {
          kind: isRelativePath ? 'relative' : 'url',
          originalName: 'Sample model',
          ...(isRelativePath ? { path: filename } : { url: filename })
        }
      };
      
      try {
        const result = await originalLoadSample(filename);
        return result;
      } finally {
        this.currentLoadingContext = null;
      }
    };

    // Wrap loadFile to track file uploads
    const originalLoadFile = (this.app as any).loadFile?.bind(this.app);
    if (originalLoadFile) {
      this.originalMethods.set('app.loadFile', originalLoadFile);

      (this.app as any).loadFile = async (file: File) => {
        // Set context for file uploads
        this.currentLoadingContext = {
          source: {
            kind: 'url',  // Cannot be saved as relative path (initially)
            originalName: file.name,
            url: '<file-input>'  // Special marker for uploaded files
          }
        };
        
        try {
          const result = await originalLoadFile(file);
          return result;
        } finally {
          this.currentLoadingContext = null;
        }
      };
    }
  }

  /**
   * Setup tracking for ModelManager transform methods
   */
  private setupModelManagerTransformTracking(): void {
    if (!this.app) return;

    const modelManager = this.app.getModelManager();

    // Wrap setModelPosition
    const originalSetPosition = modelManager.setModelPosition.bind(modelManager);
    this.originalMethods.set('modelManager.setModelPosition', originalSetPosition);

    (modelManager as any).setModelPosition = (id: string, x: number, y: number, z: number): boolean => {
      const result = originalSetPosition(id, x, y, z);
      
      if (result) {
        // Update tracked transform
        const current = this.transforms.get(id) || { position: [0, 0, 0], rotationEulerRad: [0, 0, 0], scale: [1, 1, 1] };
        current.position = [x, y, z];
        this.transforms.set(id, current);
        
        console.log(`TransformTracker: Updated position for ${id.slice(0, 8)}... to (${x}, ${y}, ${z})`);
      }
      
      return result;
    };

    // Wrap setModelRotation  
    const originalSetRotation = modelManager.setModelRotation.bind(modelManager);
    this.originalMethods.set('modelManager.setModelRotation', originalSetRotation);

    (modelManager as any).setModelRotation = (id: string, x: number, y: number, z: number): boolean => {
      const result = originalSetRotation(id, x, y, z);
      
      if (result) {
        // Update tracked transform (input is already in radians)
        const current = this.transforms.get(id) || { position: [0, 0, 0], rotationEulerRad: [0, 0, 0], scale: [1, 1, 1] };
        current.rotationEulerRad = [x, y, z];
        this.transforms.set(id, current);
        
        console.log(`TransformTracker: Updated rotation for ${id.slice(0, 8)}... to (${x}, ${y}, ${z}) rad`);
      }
      
      return result;
    };

    // Wrap setModelScale
    const originalSetScale = modelManager.setModelScale.bind(modelManager);
    this.originalMethods.set('modelManager.setModelScale', originalSetScale);

    (modelManager as any).setModelScale = (id: string, scale: number | [number, number, number]): boolean => {
      const result = originalSetScale(id, scale);
      
      if (result) {
        // Update tracked transform
        const current = this.transforms.get(id) || { position: [0, 0, 0], rotationEulerRad: [0, 0, 0], scale: [1, 1, 1] };
        
        if (typeof scale === 'number') {
          current.scale = [scale, scale, scale];
        } else {
          current.scale = [...scale];
        }
        
        this.transforms.set(id, current);
        
        const scaleStr = typeof scale === 'number' ? scale.toString() : `(${scale.join(', ')})`;
        console.log(`TransformTracker: Updated scale for ${id.slice(0, 8)}... to ${scaleStr}`);
      }
      
      return result;
    };

    // Wrap setModelTransform
    const originalSetTransform = modelManager.setModelTransform.bind(modelManager);
    this.originalMethods.set('modelManager.setModelTransform', originalSetTransform);

    (modelManager as any).setModelTransform = (id: string, transform: Float32Array | number[]): boolean => {
      const result = originalSetTransform(id, transform);
      
      if (result) {
        // Extract transform components from matrix (simplified - just position for now)
        const current = this.transforms.get(id) || { position: [0, 0, 0], rotationEulerRad: [0, 0, 0], scale: [1, 1, 1] };
        
        // Extract position from transform matrix (indices 12, 13, 14)
        if (transform.length >= 16) {
          current.position = [transform[12], transform[13], transform[14]];
        }
        
        this.transforms.set(id, current);
        
        console.log(`TransformTracker: Updated transform matrix for ${id.slice(0, 8)}...`);
      }
      
      return result;
    };
  }

  /**
   * Debug: Print all tracked data
   */
  debugPrintAll(): void {
    console.group('TransformTracker Debug Info');
    console.log(`Installed: ${this.isInstalled}`);
    console.log(`Tracking ${this.sources.size} sources and ${this.transforms.size} transforms`);
    
    if (this.sources.size > 0) {
      console.group('Sources:');
      this.sources.forEach((source, id) => {
        console.log(`${id.slice(0, 8)}...: ${source.kind} = ${source.path || source.url}`);
      });
      console.groupEnd();
      
      console.group('Transforms:');
      this.transforms.forEach((transform, id) => {
        console.log(`${id.slice(0, 8)}...:`, transform);
      });
      console.groupEnd();
    }
    
    console.groupEnd();
  }

  /**
   * Clean up tracking for removed models
   */
  cleanupRemovedModels(currentModelIds: string[]): void {
    const currentIds = new Set(currentModelIds);
    const toRemove: string[] = [];
    
    // Find models that no longer exist
    this.sources.forEach((_, trackedId) => {
      if (!currentIds.has(trackedId)) {
        toRemove.push(trackedId);
      }
    });
    
    // Remove tracking data for models that no longer exist
    toRemove.forEach(trackedId => {
      this.sources.delete(trackedId);
      this.transforms.delete(trackedId);
      console.log(`TransformTracker: Cleaned up removed model ${trackedId.slice(0, 8)}...`);
    });
  }
}

// Global instance for easy access
export const transformTracker = new TransformTracker();
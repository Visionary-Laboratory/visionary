/**
 * VisionaryCore Library Entry Point
 * 导出所有主要的类和功能供外部使用
 */

// 核心应用类
export { App } from './app/app';
export { initThreeContext } from './app/three-context';

// 渲染器
export { GaussianRenderer } from './renderer/gaussian_renderer';

// 统一模型加载器
export { 
  loadUnifiedModel, 
  UnifiedModelLoader,
  type ModelType,
  type UnifiedLoadOptions,
  type LoadResult
} from './app/unified-model-loader';

// 相机相关
export { PerspectiveCamera } from './camera/perspective';
export { CameraAdapter } from './camera/CameraAdapter';

// 文件加载器
export { defaultLoader } from './io';

// 管理器
export {
  ModelManager,
  FileLoader,
  ONNXManager,
  CameraManager,
  AnimationManager,
  RenderLoop
} from './app/managers';

// ONNX 功能
export { ONNXModelTester } from './ONNX/test_loader';

// 工具函数
export { clamp } from './app/dom-elements';

// 配置函数
export { 
  initOrtEnvironment, 
  setOrtWasmPaths, 
  getOrtWasmPaths, 
  isOrtConfigured,
  getDefaultOrtWasmPaths
} from './config/ort-config';

// 类型定义
export type { ModelEntry, ModelInfo, LoadingCallbacks, ONNXLoadOptions } from './app/managers';

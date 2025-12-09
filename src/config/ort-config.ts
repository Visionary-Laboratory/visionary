/**
 * ONNX Runtime 配置模块
 * 提供灵活的路径配置，避免硬编码
 */

let ortWasmPaths: string = '/src/ort/';

/**
 * 设置 ONNX Runtime WASM 文件路径
 * @param paths WASM 文件路径，可以是字符串或字符串数组
 */
export function setOrtWasmPaths(paths: string | string[]): void {
  if (typeof paths === 'string') {
    ortWasmPaths = paths;
  } else {
    ortWasmPaths = paths.join(',');
  }
}

/**
 * 获取当前配置的 ONNX Runtime WASM 文件路径
 * @returns 当前配置的路径
 */
export function getOrtWasmPaths(): string {
  return ortWasmPaths;
}

/**
 * 初始化 ONNX Runtime 环境配置
 * 应该在应用启动时调用，在加载任何 ONNX 模型之前
 * @param wasmPaths WASM 文件路径，可选，如果不提供则使用默认路径
 */
export function initOrtEnvironment(wasmPaths?: string | string[]): void {
  if (wasmPaths) {
    setOrtWasmPaths(wasmPaths);
  }
  
  // 设置 ort 环境变量
  if (typeof window !== 'undefined' && (window as any).ort) {
    const ort = (window as any).ort;
    ort.env.wasm.wasmPaths = getOrtWasmPaths();
    console.log(`[VisionaryCore] ONNX Runtime WASM paths configured: ${getOrtWasmPaths()}`);
  } else {
    console.warn('[VisionaryCore] ONNX Runtime not available, configuration will be applied when ort is loaded');
    
    // 如果 ort 还没有加载，设置一个监听器来在 ort 加载后应用配置
    if (typeof window !== 'undefined') {
      const applyConfigWhenReady = () => {
        if ((window as any).ort) {
          const ort = (window as any).ort;
          ort.env.wasm.wasmPaths = getOrtWasmPaths();
          console.log(`[VisionaryCore] ONNX Runtime WASM paths configured (delayed): ${getOrtWasmPaths()}`);
        } else {
          // 如果 ort 还没有加载，继续等待
          setTimeout(applyConfigWhenReady, 50);
        }
      };
      
      // 延迟应用配置
      setTimeout(applyConfigWhenReady, 50);
    }
  }
}

/**
 * 获取默认的 WASM 路径
 */
export function getDefaultOrtWasmPaths(): string {
  return '/src/ort/';
}

/**
 * 检查 ONNX Runtime 是否已正确配置
 * @returns 是否已配置
 */
export function isOrtConfigured(): boolean {
  return typeof window !== 'undefined' && 
         (window as any).ort && 
         (window as any).ort.env && 
         (window as any).ort.env.wasm && 
         (window as any).ort.env.wasm.wasmPaths;
}

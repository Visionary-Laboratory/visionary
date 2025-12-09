/**
 * Application entry point
 * 3D Gaussian Splatting WebGPU Viewer
 */

import { App } from './app/app';
import { setHidden } from './app/dom-elements';
import { testONNXModel, runONNXIntegrationTest, runONNXPerformanceTest } from './ONNX';
import { initOrtEnvironment, getDefaultOrtWasmPaths } from './config/ort-config';

// Bootstrap the application when DOM is ready
window.addEventListener("DOMContentLoaded", () => {
  // 在应用启动前配置ORT环境
  const wasmPaths = getDefaultOrtWasmPaths();
  initOrtEnvironment(wasmPaths);
  console.log(`[Main] Pre-configured ORT environment with paths: ${wasmPaths}`);
  
  const app = new App();
  
  app.init()
    .then(() => {
      // Set global app instance
      appInstance = app;
      window.gaussianApp = app;
      
      // Setup global ONNX functions
      window.loadONNXModel = async (modelPath?: string, name?: string) => {
        if (appInstance) {
          return appInstance.loadONNXModelPublic(modelPath, name);
        }
        throw new Error('App not initialized');
      };
      
      window.controlAnimation = (action: 'start' | 'pause' | 'resume' | 'stop', speed?: number) => {
        if (appInstance) {
          appInstance.controlDynamicAnimation(action, speed);
        }
      };
      
      window.setAnimationTime = (time: number) => {
        if (appInstance) {
          appInstance.setDynamicAnimationTime(time);
        }
      };
      
      window.getAppStats = () => {
        if (appInstance) {
          return {
            models: appInstance.getModels(),
            performance: appInstance.getDynamicPerformanceStats()
          };
        }
        return null;
      };
      
      console.log('🌟 WebGaussianJS initialized with ONNX support');
      console.log('💡 Try: loadONNXModel(), controlAnimation("start"), setAnimationTime(0.5)');
    })
    .catch((err: Error) => {
      // Show error to user
      console.error("Failed to initialize application:", err);
      alert(`Initialization error: ${err.message}`);
      
      // Show WebGPU fallback message if present
      const noWebGPU = document.getElementById("noWebGPU");
      if (noWebGPU) {
        setHidden(noWebGPU, false);
      }
    });
});

// Make ONNX testing and app functionality available globally for development
declare global {
  interface Window {
    testONNXModel: () => Promise<void>;
    runONNXIntegrationTest: () => Promise<boolean>;
    runONNXPerformanceTest: () => Promise<void>;
    gaussianApp?: App;
    loadONNXModel: (modelPath?: string, name?: string) => Promise<void>;
    controlAnimation: (action: 'start' | 'pause' | 'resume' | 'stop', speed?: number) => void;
    setAnimationTime: (time: number) => void;
    getAppStats: () => any;
  }
}

let appInstance: App | null = null;

window.testONNXModel = testONNXModel;
window.runONNXIntegrationTest = runONNXIntegrationTest;
window.runONNXPerformanceTest = runONNXPerformanceTest;
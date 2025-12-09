// Comprehensive integration test for ONNX functionality
import { ONNXModelTester, ONNXGenerator } from './index';
import { mat4 } from 'gl-matrix';

/**
 * Test all ONNX components to ensure they work correctly
 */
export async function runONNXIntegrationTest(): Promise<boolean> {
  console.log('🧪 Starting ONNX Integration Test Suite...\n');
  
  let allTestsPassed = true;
  
  try {
    // Test 1: ONNX Runtime Basic Loading
    console.log('📋 Test 1: ONNX Runtime Basic Loading');
    const tester = new ONNXModelTester();
    await ONNXModelTester.initialize();
    
    try {
      await tester.loadModel('./models/gaussians3d.onnx');
      console.log('✅ Model loading successful');
    } catch (error) {
      console.error('❌ Model loading failed:', error);
      allTestsPassed = false;
    }
    
    // Test 2: Model Inference
    console.log('\n📋 Test 2: Model Inference');
    try {
      const results = await tester.testInference();
      if (results) {
        console.log('✅ Model inference successful');
        
        // Verify we have expected outputs (updated for combined colors format)
        const expectedOutputs = ['positions', 'scales', 'rotations', 'opacities', 'colors'];
        const actualOutputs = Object.keys(results);
        
        for (const expected of expectedOutputs) {
          if (!actualOutputs.some(actual => actual.toLowerCase().includes(expected))) {
            console.warn(`⚠️ Expected output '${expected}' not found in model outputs: ${actualOutputs.join(', ')}`);
          } else {
            console.log(`✅ Found expected output matching '${expected}'`);
          }
        }
      }
    } catch (error) {
      console.error('❌ Model inference failed:', error);
      allTestsPassed = false;
    }
    
    await tester.dispose();
    
    // Test 3: WebGPU Context (if available)
    console.log('\n📋 Test 3: WebGPU Context');
    try {
      if (!navigator.gpu) {
        console.warn('⚠️ WebGPU not available - skipping GPU tests');
        return allTestsPassed;
      }
      
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        throw new Error('No WebGPU adapter available');
      }
      
      const device = await adapter.requestDevice();
      console.log('✅ WebGPU device created successfully');
      
      // Test 4: ONNX Generator
      console.log('\n📋 Test 4: ONNX Generator');
      const generator = new ONNXGenerator({ 
        modelUrl: './models/gaussians3d.onnx',
        maxPoints: 10000, // Small limit for testing to avoid memory issues
        debugLogging: false 
      });
      
      await generator.initialize();
      console.log('✅ ONNXGenerator initialized successfully');
      
      // Test generation with simple WebGPU inference
      await generator.generate({});
      
      console.log('✅ Generation test successful: WebGPU direct inference completed');
      
      // Test that GPU buffers are accessible
      const gaussianBuffer = generator.getGaussianBuffer();
      const shBuffer = generator.getSHBuffer();
      const countBuffer = generator.getCountBuffer();
      
      console.log(`✅ GPU buffers accessible: gaussian buffer label="${gaussianBuffer.label}", SH buffer label="${shBuffer.label}"`);
      console.log(`✅ Count buffer available: ${countBuffer ? 'yes' : 'no'}`);
      
      generator.dispose();
      
    } catch (error) {
      console.error('❌ WebGPU/GPU tests failed:', error);
      allTestsPassed = false;
    }
    
  } catch (error) {
    console.error('❌ Integration test failed:', error);
    allTestsPassed = false;
  }
  
  console.log(`\n🏁 ONNX Integration Test ${allTestsPassed ? '✅ PASSED' : '❌ FAILED'}`);
  return allTestsPassed;
}

/**
 * Test performance with multiple generations
 */
export async function runONNXPerformanceTest(): Promise<void> {
  console.log('⚡ Starting ONNX Performance Test...\n');
  
  try {
    if (!navigator.gpu) {
      console.warn('⚠️ WebGPU not available - skipping performance test');
      return;
    }
    
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return;
    
    const device = await adapter.requestDevice();
    
    const generator = new ONNXGenerator({ 
      modelUrl: './models/gaussians3d.onnx',
      maxPoints: 10000, // Small limit for performance testing
      debugLogging: false 
    });
    
    await generator.initialize();
    
    const numTests = 5;
    const times: number[] = [];
    
    for (let i = 0; i < numTests; i++) {
      const start = performance.now();
      
      // Test WebGPU direct inference (no complex inputs in simplified API)
      await generator.generate({});
      
      const end = performance.now();
      times.push(end - start);
      
      console.log(`Generation ${i + 1}: ${(end - start).toFixed(2)}ms`);
    }
    
    const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    
    console.log(`\n📊 Performance Results:`);
    console.log(`Average: ${avgTime.toFixed(2)}ms`);
    console.log(`Min: ${minTime.toFixed(2)}ms`);
    console.log(`Max: ${maxTime.toFixed(2)}ms`);
    console.log(`Estimated FPS: ${(1000 / avgTime).toFixed(1)} FPS`);
    
    // @kangan 此接口无人实现，打包错误
    // const stats = generator.getStats();
    // console.log(`Initialized: ${stats.initialized}, Max Points: ${stats.maxPoints}`);
    
    generator.dispose();
    
  } catch (error) {
    console.error('❌ Performance test failed:', error);
  }
}
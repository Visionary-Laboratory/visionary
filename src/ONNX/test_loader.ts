// Test ONNX model loading and inspection
import * as ort from 'onnxruntime-web';
import { mat4 } from 'gl-matrix';

// Configure ONNX Runtime paths and settings
// ort.env.wasm.wasmPaths = '/ort/';
// ort.env.wasm.numThreads = 1;
// ort.env.logLevel = 'warning';

/**
 * Test the existing ONNX model to understand its input/output format
 */
export class ONNXModelTester {
  private session: ort.InferenceSession | null = null;

  /**
   * Initialize ONNX Runtime and set WebAssembly paths
   */
  static async initialize(): Promise<void> {
    // Set WASM file paths - they're already in public/ort/
    // ort.env.wasm.wasmPaths = '/ort/';
    
    // Enable logging for debugging
    ort.env.logLevel = 'verbose'
    
    console.log('ONNX Runtime initialized with WASM paths');
  }

  /**
   * Load the test ONNX model
   */
  async loadModel(modelPath: string = './models/gaussians3d.onnx'): Promise<void> {
    try {
      console.log(`Loading ONNX model from: ${modelPath}`);
      
      this.session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['wasm'], // Start with WASM provider
      });
      
      console.log('✅ ONNX model loaded successfully');
      
      // Log model metadata
      this.logModelInfo();
      
    } catch (error) {
      console.error('❌ Failed to load ONNX model:', error);
      throw error;
    }
  }

  /**
   * Log detailed model information
   */
  private logModelInfo(): void {
    if (!this.session) return;

    console.log('\n📊 Model Information:');
    
    // Input information
    console.log('\n🔵 Inputs:');
    const inputNames = this.session.inputNames;
    for (const inputName of inputNames) {
      try {
        const inputMeta = (this.session.inputMetadata as any)[inputName] as any;
        console.log(`  - ${inputName}:`, {
          type: inputMeta?.type || 'unknown',
          dims: inputMeta?.dims || [],
        });
      } catch (e) {
        console.log(`  - ${inputName}: metadata unavailable`);
      }
    }

    // Output information  
    console.log('\n🟢 Outputs:');
    const outputNames = this.session.outputNames;
    for (const outputName of outputNames) {
      try {
        const outputMeta = (this.session.outputMetadata as any)[outputName] as any;
        console.log(`  - ${outputName}:`, {
          type: outputMeta?.type || 'unknown',
          dims: outputMeta?.dims || [],
        });
      } catch (e) {
        console.log(`  - ${outputName}: metadata unavailable`);
      }
    }
  }

  /**
   * Test inference with sample data
   */
  async testInference(): Promise<ort.InferenceSession.OnnxValueMapType | void> {
    if (!this.session) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    console.log('\n🧪 Testing inference with sample data...');

    try {
      // Prepare test inputs based on model expectations
      const feeds = this.createTestInputs();
      
      console.log('Input tensors prepared:');
      for (const [key, tensor] of Object.entries(feeds)) {
        console.log(`  - ${key}: shape=${tensor.dims}, type=${tensor.type}`);
      }

      // Run inference
      const startTime = performance.now();
      const results = await this.session.run(feeds);
      const inferenceTime = performance.now() - startTime;
      
      console.log(`✅ Inference completed in ${inferenceTime.toFixed(2)}ms`);
      
      // Log output information
      console.log('\n📤 Output tensors:');
      for (const [key, tensor] of Object.entries(results)) {
        console.log(`  - ${key}: shape=${tensor.dims}, type=${tensor.type}, size=${tensor.size}`);
        
        // Log first few values for inspection
        if (tensor.data.length > 0) {
          const data = tensor.data instanceof Float32Array ? 
            tensor.data : new Float32Array(tensor.data as ArrayLike<number>);
          const preview = Array.from(data.slice(0, 10));
          console.log(`    First 10 values: [${preview.join(', ')}${tensor.data.length > 10 ? ', ...' : ''}]`);
        }
      }

      return results;
      
    } catch (error) {
      console.error('❌ Inference failed:', error);
      throw error;
    }
  }

  /**
   * Create test input tensors based on expected model inputs
   */
  private createTestInputs(): Record<string, ort.Tensor> {
    const feeds: Record<string, ort.Tensor> = {};
    
    if (!this.session) throw new Error('Session not initialized');

    // Iterate through expected inputs and create appropriate test data
    for (const inputName of this.session.inputNames) {
      const inputMeta = (this.session.inputMetadata as any)[inputName] as any;
      
      if (inputName.toLowerCase().includes('camera') || inputName.toLowerCase().includes('view') || inputName.toLowerCase().includes('matrix')) {
        // Camera/view matrix - create identity matrix
        const cameraMatrix = mat4.create();
        mat4.identity(cameraMatrix);
        
        feeds[inputName] = new ort.Tensor('float32', cameraMatrix, [4, 4]);
        console.log(`  📷 Created camera matrix for '${inputName}'`);
        
      } else if (inputName.toLowerCase().includes('time') || inputName.toLowerCase().includes('t')) {
        // Time input - use middle value
        const timeValue = new Float32Array([0.5]);
        feeds[inputName] = new ort.Tensor('float32', timeValue, [1]);
        console.log(`  ⏰ Created time input for '${inputName}': ${timeValue[0]}`);
        
      } else if (inputName.toLowerCase().includes('projection') || inputName.toLowerCase().includes('proj')) {
        // Projection matrix - create perspective projection
        const projMatrix = mat4.create();
        mat4.perspective(projMatrix, Math.PI / 4, 16/9, 0.1, 1000);
        
        feeds[inputName] = new ort.Tensor('float32', projMatrix, [4, 4]);
        console.log(`  📐 Created projection matrix for '${inputName}'`);
        
      } else {
        // Generic input - create based on shape
        const dims = inputMeta.dims as number[];
        const size = dims.reduce((a, b) => a * b, 1);
        const data = new Float32Array(size).fill(0.5); // Default to 0.5
        
        feeds[inputName] = new ort.Tensor('float32', data, dims);
        console.log(`  🔢 Created generic input for '${inputName}': shape=${dims}, filled with 0.5`);
      }
    }

    return feeds;
  }

  /**
   * Run comprehensive model analysis
   */
  async analyzeModel(): Promise<void> {
    console.log('\n🔍 Starting comprehensive model analysis...\n');

    // Test with different time values
    console.log('Testing temporal variation:');
    for (const timeValue of [0.0, 0.25, 0.5, 0.75, 1.0]) {
      console.log(`\n⏰ Testing with time = ${timeValue}`);
      await this.testInferenceWithTime(timeValue);
    }

    // Test with different camera positions
    console.log('\n📷 Testing camera position variation:');
    const cameraPositions = [
      [0, 0, 5],   // Front
      [5, 0, 0],   // Right  
      [0, 5, 0],   // Top
      [-5, 0, 0],  // Left
    ];

    for (const [x, y, z] of cameraPositions) {
      console.log(`\n📍 Testing with camera at [${x}, ${y}, ${z}]`);
      await this.testInferenceWithCamera([x, y, z]);
    }
  }

  /**
   * Test inference with specific time value
   */
  private async testInferenceWithTime(timeValue: number): Promise<any> {
    if (!this.session) return;

    const feeds = this.createTestInputs();
    
    // Update time input
    const timeInputName = this.session.inputNames.find(name => 
      name.toLowerCase().includes('time') || name.toLowerCase().includes('t')
    );
    
    if (timeInputName) {
      feeds[timeInputName] = new ort.Tensor('float32', new Float32Array([timeValue]), [1]);
    }

    const results = await this.session.run(feeds);
    
    // Log summary of outputs
    for (const [key, tensor] of Object.entries(results)) {
      const data = tensor.data as Float32Array;
      const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
      const min = Math.min(...data);
      const max = Math.max(...data);
      
      console.log(`    ${key}: mean=${mean.toFixed(4)}, range=[${min.toFixed(4)}, ${max.toFixed(4)}]`);
    }

    return results;
  }

  /**
   * Test inference with specific camera position
   */
  private async testInferenceWithCamera(position: number[]): Promise<any> {
    if (!this.session) return;

    const feeds = this.createTestInputs();
    
    // Create view matrix looking at origin from position
    const viewMatrix = mat4.create();
    const eye = new Float32Array(position) as any;
    const center = new Float32Array([0, 0, 0]) as any;
    const up = new Float32Array([0, 1, 0]) as any;
    mat4.lookAt(viewMatrix, eye, center, up);

    // Update camera matrix input
    const cameraInputName = this.session.inputNames.find(name => 
      name.toLowerCase().includes('camera') || name.toLowerCase().includes('view') || name.toLowerCase().includes('matrix')
    );
    
    if (cameraInputName) {
      feeds[cameraInputName] = new ort.Tensor('float32', viewMatrix, [4, 4]);
    }

    const results = await this.session.run(feeds);
    
    // Log summary of outputs  
    for (const [key, tensor] of Object.entries(results)) {
      const data = tensor.data as Float32Array;
      const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
      
      console.log(`    ${key}: mean=${mean.toFixed(4)}, size=${data.length}`);
    }

    return results;
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    if (this.session) {
      this.session = null;
      console.log('🧹 ONNX session disposed');
    }
  }
}

// Standalone test function for easy execution
export async function testONNXModel(): Promise<void> {
  try {
    // Initialize ONNX Runtime
    await ONNXModelTester.initialize();
    
    // Create tester instance
    const tester = new ONNXModelTester();
    
    // Load and test model
    await tester.loadModel();
    await tester.testInference();
    
    // Run comprehensive analysis
    // await tester.analyzeModel(); // Uncomment for detailed analysis
    
    // Clean up
    await tester.dispose();
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}
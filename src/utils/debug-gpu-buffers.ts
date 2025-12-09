// GPU Buffer debugging utilities
// These functions help trace values through the GPU pipeline

/**
 * Read a GPU buffer back to CPU for debugging
 * @param device - WebGPU device
 * @param buffer - GPU buffer to read
 * @param offset - Byte offset to start reading
 * @param size - Number of bytes to read
 * @returns Promise with the buffer data
 */
export async function readGPUBuffer(
  device: GPUDevice,
  buffer: GPUBuffer,
  offset: number = 0,
  size: number = 4
): Promise<ArrayBuffer> {
  // Create staging buffer for readback
  const staging = device.createBuffer({
    size,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    label: 'debug-staging-buffer'
  });
  
  // Copy from GPU buffer to staging
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, offset, staging, 0, size);
  device.queue.submit([encoder.finish()]);
  
  // Wait for GPU to complete
  await device.queue.onSubmittedWorkDone();
  
  // Map and read the data
  await staging.mapAsync(GPUMapMode.READ);
  const copyArrayBuffer = staging.getMappedRange(0, size);
  const data = new ArrayBuffer(size);
  new Uint8Array(data).set(new Uint8Array(copyArrayBuffer));
  staging.unmap();
  staging.destroy();
  
  return data;
}

/**
 * Read a u32 value from a GPU buffer
 */
export async function readU32FromBuffer(
  device: GPUDevice,
  buffer: GPUBuffer,
  offset: number = 0
): Promise<number> {
  const data = await readGPUBuffer(device, buffer, offset, 4);
  return new Uint32Array(data)[0];
}

/**
 * Read the ONNX count buffer value
 */
export async function readONNXCountBuffer(
  device: GPUDevice,
  countBuffer: GPUBuffer
): Promise<number> {
  const count = await readU32FromBuffer(device, countBuffer, 0);
  // console.log(`🔍 DEBUG: ONNX count buffer value = ${count}`);
  return count;
}

/**
 * Read the ModelParams num_points field (at offset 68)
 */
export async function readModelParamsNumPoints(
  device: GPUDevice,
  modelParamsBuffer: GPUBuffer
): Promise<number> {
  const numPoints = await readU32FromBuffer(device, modelParamsBuffer, 68);
  console.log(`🔍 DEBUG: ModelParams.num_points (offset 68) = ${numPoints}`);
  return numPoints;
}

/**
 * Compare two buffer values and log the result
 */
export async function compareBufferValues(
  device: GPUDevice,
  buffer1: GPUBuffer,
  offset1: number,
  buffer2: GPUBuffer,
  offset2: number,
  label: string
): Promise<boolean> {
  const value1 = await readU32FromBuffer(device, buffer1, offset1);
  const value2 = await readU32FromBuffer(device, buffer2, offset2);
  
  const match = value1 === value2;
  const emoji = match ? '✅' : '❌';
  
  console.log(`${emoji} ${label}: Buffer1=${value1}, Buffer2=${value2}, Match=${match}`);
  
  return match;
}

/**
 * Debug trace for the entire count pipeline
 */
export async function debugCountPipeline(
  device: GPUDevice,
  countBuffer: GPUBuffer | undefined,
  modelParamsBuffer: GPUBuffer,
  maxPoints: number
): Promise<void> {
  console.log('🔍 === GPU COUNT DEBUG TRACE ===');
  console.log(`📊 Max points allocated: ${maxPoints}`);
  
  if (countBuffer) {
    const onnxCount = await readONNXCountBuffer(device, countBuffer);
    console.log(`📊 ONNX inference count: ${onnxCount}`);
    
    const modelCount = await readModelParamsNumPoints(device, modelParamsBuffer);
    console.log(`📊 ModelParams count: ${modelCount}`);
    
    if (onnxCount === modelCount) {
      console.log('✅ Count successfully propagated from ONNX to shader uniforms');
    } else {
      console.log(`❌ Count mismatch! ONNX=${onnxCount}, ModelParams=${modelCount}`);
      console.log('⚠️ The buffer copy may have failed or timing is wrong');
    }
    
    if (modelCount === maxPoints) {
      console.log('⚠️ WARNING: Using maxPoints instead of dynamic count!');
    }
  } else {
    console.log('ℹ️ No ONNX count buffer (static model)');
    const modelCount = await readModelParamsNumPoints(device, modelParamsBuffer);
    console.log(`📊 ModelParams count: ${modelCount}`);
  }
  
  console.log('🔍 === END DEBUG TRACE ===');
}

/**
 * Create a debug buffer to capture shader-side values
 */
export function createShaderDebugBuffer(device: GPUDevice, size: number = 256): GPUBuffer {
  return device.createBuffer({
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    label: 'shader-debug-buffer'
  });
}

/**
 * Read debug values written by shader
 */
export async function readShaderDebugBuffer(
  device: GPUDevice,
  debugBuffer: GPUBuffer,
  numValues: number = 4
): Promise<Uint32Array> {
  const size = numValues * 4;
  const data = await readGPUBuffer(device, debugBuffer, 0, size);
  const values = new Uint32Array(data);
  
  console.log('🔍 Shader debug values:', Array.from(values));
  return values;
}
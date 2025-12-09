// GPU Radix Sort implementation - extracted from rs_gpu.ts

import { radixSortShader } from '../shaders';
import { ISorter, SortedSplats } from './index';

// IMPORTANT: The following constants must be synced with the numbers in radix_sort.wgsl
export const HISTOGRAM_WG_SIZE = 256;
const RS_RADIX_LOG2 = 8; // 8-bit radices
const RS_RADIX_SIZE = 1 << RS_RADIX_LOG2; // 256 entries into the radix table
const RS_KEYVAL_SIZE = 32 / RS_RADIX_LOG2; // 4 passes for 32-bit keys
export const RS_HISTOGRAM_BLOCK_ROWS = 15;
const RS_SCATTER_BLOCK_ROWS = RS_HISTOGRAM_BLOCK_ROWS; // DO NOT CHANGE, shader assumes this
const PREFIX_WG_SIZE = 1 << 7; // 128, one thread operates on 2 prefixes at the same time
const SCATTER_WG_SIZE = 1 << 8; // 256

/**
 * Interface for the uniform buffer data.
 * The layout must match the `GeneralInfo` struct in the WGSL shader.
 */
interface GeneralInfo {
    keys_size: number;
    padded_size: number;
    passes: number;
    even_pass: number;
    odd_pass: number;
}

/**
 * Interface for the indirect dispatch buffer data.
 */
interface IndirectDispatch {
    dispatch_x: number;
    dispatch_y: number;
    dispatch_z: number;
}

/**
 * A container for all the GPU resources associated with sorting a particular point cloud.
 */
export interface PointCloudSortStuff extends SortedSplats {
    // Compatibility field for renderer - same as numPoints from SortedSplats
    num_points: number;
    // Uniform buffer holding general sorting info (key size, padding, etc.)
    sorter_uni: GPUBuffer;
    // Buffer for indirect dispatch commands
    sorter_dis: GPUBuffer;
    // Main bind group for the sorting compute passes
    sorter_bg: GPUBindGroup;
    // Bind group for rendering, with read-only access to sorted data
    sorter_render_bg: GPUBindGroup;
    // Bind group for the preprocessing step
    sorter_bg_pre: GPUBindGroup;
    // Internal memory buffer for histograms and partitions
    internal_mem: GPUBuffer;
    // Ping-pong buffers for keys
    key_a: GPUBuffer;
    key_b: GPUBuffer;
    // Ping-pong buffers for payloads (e.g., original indices)
    payload_a: GPUBuffer;
    payload_b: GPUBuffer;
}

function shuffleArray(array: any[]) {
  const arr = array.slice(); // 复制一份，不修改原数组
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); // 0 到 i 之间的随机下标
    [arr[i], arr[j]] = [arr[j], arr[i]]; // 交换元素
  }
  return arr;
}

export class GPURSSorter implements ISorter {
    private bindGroupLayout!: GPUBindGroupLayout;
    private renderBindGroupLayout!: GPUBindGroupLayout;
    private preprocessBindGroupLayout!: GPUBindGroupLayout;

    private zero_p!: GPUComputePipeline;
    private histogram_p!: GPUComputePipeline;
    private prefix_p!: GPUComputePipeline;
    private scatter_even_p!: GPUComputePipeline;
    private scatter_odd_p!: GPUComputePipeline;

    public subgroupSize!: number;

    // Private constructor to be called by the async factory method.
    private constructor() {}

    /**
     * Asynchronously creates and initializes a new GPURSSorter.
     * This factory pattern is used because the constructor needs to be async.
     * It determines the best subgroup size by testing various configurations.
     */
    public static async create(device: GPUDevice, queue: GPUQueue): Promise<GPURSSorter> {
        console.debug("Searching for the maximum subgroup size...");
        // WebGPU doesn't expose subgroup sizes directly, so we test common values.
        const potentialSubgroupSizes = [16, 32, 16, 8, 1];

        for (const size of potentialSubgroupSizes) {
            console.debug(`Testing sorting with subgroup size ${size}`);
            try {
                const sorter = new GPURSSorter();
                await sorter.initializeWithSubgroupSize(device, size);
                const sortSuccess = await sorter.testSort(device, queue);
                // return sorter;
                if (sortSuccess) {
                    console.log(`Subgroup size ${size} works.`);
                    return sorter;
                }
            } catch (e) {
                console.warn(`Subgroup size ${size} failed during pipeline creation or test run.`, e);
            }
        }

        throw new Error("GPURSSorter::create() No working subgroup size was found. Unable to use sorter.");
    }

    /**
     * Initializes the sorter's pipelines and layouts for a given subgroup size.
     */
    private async initializeWithSubgroupSize(device: GPUDevice, sgSize: number) {
        this.subgroupSize = sgSize;

        this.bindGroupLayout = this.createBindGroupLayout(device);
        this.renderBindGroupLayout = GPURSSorter.createRenderBindGroupLayout(device);
        this.preprocessBindGroupLayout = GPURSSorter.createPreprocessBindGroupLayout(device);

        const pipelineLayout = device.createPipelineLayout({
            label: "radix sort pipeline layout",
            bindGroupLayouts: [this.bindGroupLayout],
        });

        // Prepend constants to the shader code, similar to the Rust implementation
        const processedShaderCode = this.processShaderTemplate(radixSortShader);

        const shaderModule = device.createShaderModule({
            label: "Radix sort shader",
            code: processedShaderCode,
        });

        // Create all the necessary compute pipelines
        this.zero_p = await device.createComputePipelineAsync({
            label: "Zero the histograms",
            layout: pipelineLayout,
            compute: { module: shaderModule, entryPoint: "zero_histograms" },
        });
        this.histogram_p = await device.createComputePipelineAsync({
            label: "calculate_histogram",
            layout: pipelineLayout,
            compute: { module: shaderModule, entryPoint: "calculate_histogram" },
        });
        this.prefix_p = await device.createComputePipelineAsync({
            label: "prefix_histogram",
            layout: pipelineLayout,
            compute: { module: shaderModule, entryPoint: "prefix_histogram" },
        });
        this.scatter_even_p = await device.createComputePipelineAsync({
            label: "scatter_even",
            layout: pipelineLayout,
            compute: { module: shaderModule, entryPoint: "scatter_even" },
        });
        this.scatter_odd_p = await device.createComputePipelineAsync({
            label: "scatter_odd",
            layout: pipelineLayout,
            compute: { module: shaderModule, entryPoint: "scatter_odd" },
        });
    }
 
    private processShaderTemplate(shaderCode: string): string {
        // Calculate derived constants
        // const histogram_sg_size = 32; // Assuming subgroup size of 32 for web
        const histogram_sg_size = Math.max(1, this.subgroupSize | 0);

        const rs_sweep_0_size = Math.floor(RS_RADIX_SIZE / histogram_sg_size);
        const rs_sweep_1_size = Math.floor(rs_sweep_0_size / histogram_sg_size);
        const rs_sweep_2_size = Math.floor(rs_sweep_1_size / histogram_sg_size);

        const rs_smem_phase_2 = RS_RADIX_SIZE + RS_SCATTER_BLOCK_ROWS * SCATTER_WG_SIZE;
        const rs_mem_dwords = rs_smem_phase_2;
        const rs_mem_sweep_0_offset = 0;
        const rs_mem_sweep_1_offset = rs_mem_sweep_0_offset + rs_sweep_0_size;
        const rs_mem_sweep_2_offset = rs_mem_sweep_1_offset + rs_sweep_1_size;
        
        // Prepend constant definitions
        const constantDefinitions = `const histogram_sg_size: u32 = ${histogram_sg_size}u;
            const histogram_wg_size: u32 = ${HISTOGRAM_WG_SIZE}u;
            const rs_radix_log2: u32 = ${RS_RADIX_LOG2}u;
            const rs_radix_size: u32 = ${RS_RADIX_SIZE}u;
            const rs_keyval_size: u32 = ${RS_KEYVAL_SIZE}u;
            const rs_histogram_block_rows: u32 = ${RS_HISTOGRAM_BLOCK_ROWS}u;
            const rs_scatter_block_rows: u32 = ${RS_SCATTER_BLOCK_ROWS}u;
            const rs_mem_dwords: u32 = ${rs_mem_dwords}u;
            const rs_mem_sweep_0_offset: u32 = ${rs_mem_sweep_0_offset}u;
            const rs_mem_sweep_1_offset: u32 = ${rs_mem_sweep_1_offset}u;
            const rs_mem_sweep_2_offset: u32 = ${rs_mem_sweep_2_offset}u;
            `;

        // Replace template placeholders
        let processedCode = shaderCode
            .replace(/{histogram_wg_size}/g, HISTOGRAM_WG_SIZE.toString())
            .replace(/{prefix_wg_size}/g, PREFIX_WG_SIZE.toString())
            .replace(/{scatter_wg_size}/g, SCATTER_WG_SIZE.toString());
        
        // Prepend constants to the shader
        return constantDefinitions + processedCode;
    }

    /**
     * Runs a small test sort to verify the current configuration works.
     */
    private async testSort(device: GPUDevice, queue: GPUQueue): Promise<boolean> {
        const n = 8192; // Needs 2 workgroups, a good test case
        const scrambledData = new Float32Array(
            shuffleArray(Array.from({ length: n }, (_, i) => n - 1 - i))
        );
        const sortedData = new Float32Array(
            Array.from({ length: n }, (_, i) => i)
        ); 

        const sortStuff = this.createSortStuff(device, n);

        // Upload initial data
        queue.writeBuffer(sortStuff.key_a, 0, scrambledData.buffer);

        const commandEncoder = device.createCommandEncoder({ label: "GPURSSorter test_sort" });
        this.recordSort(sortStuff, n, commandEncoder);
        queue.submit([commandEncoder.finish()]);

        await device.queue.onSubmittedWorkDone();
        
        const result = await this.downloadBuffer(device, queue, sortStuff.key_a, 'f32');

        for (let i = 0; i < n; i++) {
            if (result[i] !== sortedData[i]) {
                console.error(`Sort failed at index ${i}. Expected ${sortedData[i]}, got ${result[i]}`);
                return false;
            }
        }

        return true;
    }

    /**
     * Creates all the necessary buffers and bind groups for sorting a given number of points.
     */
    public createSortStuff(device: GPUDevice, numPoints: number): PointCloudSortStuff {
        const { key_a, key_b, payload_a, payload_b } = this.createKeyvalBuffers(device, numPoints, 4);
        const internal_mem = this.createInternalMemBuffer(device, numPoints);
        
        const { sorter_uni, sorter_dis, sorter_bg } = this.createBindGroup(
            device, numPoints, internal_mem, key_a, key_b, payload_a, payload_b
        );

        const sorter_render_bg = this.createRenderBindGroup(device, sorter_uni, payload_a);
        const sorter_bg_pre = this.createPreprocessBindGroup(device, sorter_uni, sorter_dis, key_a, payload_a);

        return {
            numPoints,
            num_points: numPoints, // Compatibility field for renderer
            sortedIndices: payload_a, // payload_a contains the sorted indices
            indirectBuffer: sorter_dis,
            sorter_uni,
            sorter_dis,
            sorter_bg,
            sorter_render_bg,
            sorter_bg_pre,
            internal_mem,
            key_a,
            key_b,
            payload_a,
            payload_b
        };
    }

    public recordSort(sortStuff: SortedSplats, numPoints: number, encoder: GPUCommandEncoder): void {
        const radixStuff = sortStuff as PointCloudSortStuff;
        const passes = 4; // Hardcoded for 32-bit keys
        this.recordCalculateHistogram(radixStuff.sorter_bg, numPoints, encoder);
        this.recordPrefixHistogram(radixStuff.sorter_bg, passes, encoder);
        this.recordScatterKeys(radixStuff.sorter_bg, passes, numPoints, encoder);
    }
    
    public recordSortIndirect_one(sortStuff: SortedSplats, dispatchBuffer: GPUBuffer, encoder: GPUCommandEncoder): void {
        const radixStuff = sortStuff as PointCloudSortStuff;
        const passes = 4; // Hardcoded for 32-bit keys
        
        // Histogram (indirect)
        const histoPass = encoder.beginComputePass({ label: "Radix Sort :: Indirect Histogram Pass" });
        histoPass.setBindGroup(0, radixStuff.sorter_bg);
        histoPass.setPipeline(this.zero_p);
        histoPass.dispatchWorkgroupsIndirect(dispatchBuffer, 0);
        histoPass.setPipeline(this.histogram_p);
        histoPass.dispatchWorkgroupsIndirect(dispatchBuffer, 0);
        histoPass.end();

        // Prefix (direct)
        this.recordPrefixHistogram(radixStuff.sorter_bg, passes, encoder);

        // Scatter (indirect)
        const scatterPass = encoder.beginComputePass({ label: "Radix Sort :: Indirect Scatter Pass" });
        scatterPass.setBindGroup(0, radixStuff.sorter_bg);
        scatterPass.setPipeline(this.scatter_even_p);
        scatterPass.dispatchWorkgroupsIndirect(dispatchBuffer, 0);
        scatterPass.setPipeline(this.scatter_odd_p);
        scatterPass.dispatchWorkgroupsIndirect(dispatchBuffer, 0);
        scatterPass.setPipeline(this.scatter_even_p);
        scatterPass.dispatchWorkgroupsIndirect(dispatchBuffer, 0);
        scatterPass.setPipeline(this.scatter_odd_p);
        scatterPass.dispatchWorkgroupsIndirect(dispatchBuffer, 0);
        scatterPass.end();
    }


    public recordSortIndirect(sortStuff: SortedSplats, dispatchBuffer: GPUBuffer, encoder: GPUCommandEncoder): void {
    const radixStuff = sortStuff as PointCloudSortStuff;
    const passes = 4;

    // Zero (indirect)
    {
        const pass = encoder.beginComputePass({ label: "RS::Zero (Indirect)" });
        pass.setBindGroup(0, radixStuff.sorter_bg);
        pass.setPipeline(this.zero_p);
        pass.dispatchWorkgroupsIndirect(dispatchBuffer, 0);
        pass.end();
    }

    // Histogram (indirect)
    {
        const pass = encoder.beginComputePass({ label: "RS::Histogram (Indirect)" });
        pass.setBindGroup(0, radixStuff.sorter_bg);
        pass.setPipeline(this.histogram_p);
        pass.dispatchWorkgroupsIndirect(dispatchBuffer, 0);
        pass.end();
    }

    // Prefix（保持不变：单独一个 pass）
    this.recordPrefixHistogram(radixStuff.sorter_bg, passes, encoder);

    // Scatter (indirect) — 四个独立 pass
    const run = (pipe: GPUComputePipeline, label: string) => {
        const pass = encoder.beginComputePass({ label });
        pass.setBindGroup(0, radixStuff.sorter_bg);
        pass.setPipeline(pipe);
        pass.dispatchWorkgroupsIndirect(dispatchBuffer, 0);
        pass.end();
    };
    run(this.scatter_even_p, "RS::Scatter0_even (Indirect)");
    run(this.scatter_odd_p,  "RS::Scatter1_odd (Indirect)");
    run(this.scatter_even_p, "RS::Scatter2_even (Indirect)");
    run(this.scatter_odd_p,  "RS::Scatter3_odd (Indirect)");
    }


    // Static methods for bind group layouts
    public static createRenderBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
        return device.createBindGroupLayout({
            label: "Radix Sort Render Bind Group Layout",
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } }, // infos
                { binding: 4, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } }, // payload_a
            ],
        });
    }

    public static createPreprocessBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
        return device.createBindGroupLayout({
            label: "Radix Sort Preprocess Bind Group Layout",
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // infos
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // keyval_a
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // payload_a
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // dispatch_buffer
            ],
        });
    }

    public recordResetIndirectBuffer(indirectBuffer: GPUBuffer, uniformBuffer: GPUBuffer, queue: GPUQueue) {
        // This creates a 4-byte buffer containing a single 32-bit integer with a value of 0.
        const zeroBuffer = new Uint32Array([0]);

        // Nulling dispatch x: Writes 4 bytes of 0 to the start of the indirect buffer.
        queue.writeBuffer(indirectBuffer, 0, zeroBuffer);
        // Nulling keysize: Writes 4 bytes of 0 to the start of the uniform buffer.
        queue.writeBuffer(uniformBuffer, 0, zeroBuffer);
    }

    // Private implementation methods (remaining methods from original implementation)
    private createBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
        return device.createBindGroupLayout({
            label: "Radix Sort Bind Group Layout",
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // infos
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // histograms
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // keys
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // keys_b
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // payload_a
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // payload_b
            ],
        });
    }

    private getScatterHistogramSizes(keysize: number): { scatter_blocks_ru: number, count_ru_histo: number } {
        const scatter_block_kvs = HISTOGRAM_WG_SIZE * RS_SCATTER_BLOCK_ROWS;
        const scatter_blocks_ru = Math.ceil(keysize / scatter_block_kvs);
        const count_ru_scatter = scatter_blocks_ru * scatter_block_kvs;
        
        const histo_block_kvs = HISTOGRAM_WG_SIZE * RS_HISTOGRAM_BLOCK_ROWS;
        const histo_blocks_ru = Math.ceil(count_ru_scatter / histo_block_kvs);
        const count_ru_histo = histo_blocks_ru * histo_block_kvs;

        return { scatter_blocks_ru, count_ru_histo };
    }

    private createKeyvalBuffers(device: GPUDevice, keysize: number, bytesPerPayloadElem: number): { key_a: GPUBuffer, key_b: GPUBuffer, payload_a: GPUBuffer, payload_b: GPUBuffer } {
        const keys_per_workgroup = HISTOGRAM_WG_SIZE * RS_HISTOGRAM_BLOCK_ROWS;
        const count_ru_histo =
            (Math.floor((keysize + keys_per_workgroup) / keys_per_workgroup) + 1) * keys_per_workgroup;

        const paddedKeySize = count_ru_histo * Float32Array.BYTES_PER_ELEMENT;

        const buffer_a = device.createBuffer({
            label: "Radix data buffer a",
            size: paddedKeySize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        const buffer_b = device.createBuffer({
            label: "Radix data buffer b",
            size: paddedKeySize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });

        if (bytesPerPayloadElem !== 4) {
            console.warn("Currently only 4-byte payloads are fully supported, matching the original Rust implementation.");
        }
        const payloadSize = Math.max(1, keysize * bytesPerPayloadElem);
        const payload_a = device.createBuffer({
            label: "Radix payload buffer a",
            size: payloadSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        const payload_b = device.createBuffer({
            label: "Radix payload buffer b",
            size: payloadSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });

        return { key_a: buffer_a, key_b: buffer_b, payload_a, payload_b };
    }

    private createInternalMemBuffer(device: GPUDevice, keysize: number): GPUBuffer {
        const { scatter_blocks_ru } = this.getScatterHistogramSizes(keysize);
        const histo_size = RS_RADIX_SIZE * Uint32Array.BYTES_PER_ELEMENT;
        const internal_size = (RS_KEYVAL_SIZE + scatter_blocks_ru - 1 + 1) * histo_size;
  
        return device.createBuffer({
            label: "Internal radix sort buffer",
            size: internal_size,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
    }

    private createBindGroup(
        device: GPUDevice,
        keysize: number,
        internal_mem_buffer: GPUBuffer,
        keyval_a: GPUBuffer,
        keyval_b: GPUBuffer,
        payload_a: GPUBuffer,
        payload_b: GPUBuffer
    ): { sorter_uni: GPUBuffer, sorter_dis: GPUBuffer, sorter_bg: GPUBindGroup } {
        const { scatter_blocks_ru, count_ru_histo } = this.getScatterHistogramSizes(keysize);

        const uniform_infos: GeneralInfo = {
            keys_size: keysize,
            padded_size: count_ru_histo,
            passes: 4,
            even_pass: 0,
            odd_pass: 0,
        };
        const uniform_buffer = device.createBuffer({
            label: "Radix uniform buffer",
            size: 5 * Uint32Array.BYTES_PER_ELEMENT, // GeneralInfo has 5 u32 fields
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST| GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
        new Uint32Array(uniform_buffer.getMappedRange()).set([
            uniform_infos.keys_size,
            uniform_infos.padded_size,
            uniform_infos.passes,
            uniform_infos.even_pass,
            uniform_infos.odd_pass,
        ]);
        uniform_buffer.unmap();

        const dispatch_infos: IndirectDispatch = {
            dispatch_x: scatter_blocks_ru,
            dispatch_y: 1,
            dispatch_z: 1,
        };
        const dispatch_buffer = device.createBuffer({
            label: "Dispatch indirect buffer",
            size: 3 * Uint32Array.BYTES_PER_ELEMENT, // IndirectDispatch has 3 u32 fields
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.INDIRECT,
            mappedAtCreation: true,
        });
        new Uint32Array(dispatch_buffer.getMappedRange()).set([
            dispatch_infos.dispatch_x,
            dispatch_infos.dispatch_y,
            dispatch_infos.dispatch_z,
        ]);
        dispatch_buffer.unmap();

        const bind_group = device.createBindGroup({
            label: "Radix bind group",
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: uniform_buffer } },
                { binding: 1, resource: { buffer: internal_mem_buffer } },
                { binding: 2, resource: { buffer: keyval_a } },
                { binding: 3, resource: { buffer: keyval_b } },
                { binding: 4, resource: { buffer: payload_a } },
                { binding: 5, resource: { buffer: payload_b } },
            ],
        });

        return { sorter_uni: uniform_buffer, sorter_dis: dispatch_buffer, sorter_bg: bind_group };
    }

    private createRenderBindGroup(device: GPUDevice, general_infos: GPUBuffer, payload_a: GPUBuffer): GPUBindGroup {
        return device.createBindGroup({
            label: "Render bind group",
            layout: this.renderBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: general_infos } },
                { binding: 4, resource: { buffer: payload_a } },
            ],
        });
    }
    
    private createPreprocessBindGroup(
        device: GPUDevice,
        uniform_buffer: GPUBuffer,
        dispatch_buffer: GPUBuffer,
        keyval_a: GPUBuffer,
        payload_a: GPUBuffer
    ): GPUBindGroup {
        return device.createBindGroup({
            label: "Preprocess bind group",
            layout: this.preprocessBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: uniform_buffer } },
                { binding: 1, resource: { buffer: keyval_a } },
                { binding: 2, resource: { buffer: payload_a } },
                { binding: 3, resource: { buffer: dispatch_buffer } },
            ],
        });
    }

    // private recordCalculateHistogram(bind_group: GPUBindGroup, keysize: number, encoder: GPUCommandEncoder) {
    //     const { count_ru_histo } = this.getScatterHistogramSizes(keysize);
    //     const histo_block_kvs = HISTOGRAM_WG_SIZE * RS_HISTOGRAM_BLOCK_ROWS;
    //     const hist_blocks_ru = Math.ceil(count_ru_histo / histo_block_kvs);

    //     const pass = encoder.beginComputePass({ label: "Radix Sort :: Histogram Pass" });
    //     pass.setBindGroup(0, bind_group);

    //     // Zero histograms
    //     pass.setPipeline(this.zero_p);
    //     pass.dispatchWorkgroups(hist_blocks_ru, 1, 1);

    //     // Calculate histograms
    //     pass.setPipeline(this.histogram_p);
    //     pass.setBindGroup(0, bind_group);
    //     pass.dispatchWorkgroups(hist_blocks_ru, 1, 1);

    //     pass.end();
    // }
    
    private recordCalculateHistogram(bind_group: GPUBindGroup, keysize: number, encoder: GPUCommandEncoder) {
    const { count_ru_histo } = this.getScatterHistogramSizes(keysize);
    const histo_block_kvs = HISTOGRAM_WG_SIZE * RS_HISTOGRAM_BLOCK_ROWS;
    const hist_blocks_ru = Math.ceil(count_ru_histo / histo_block_kvs);

    // Pass A: Zero
    {
        const pass = encoder.beginComputePass({ label: "RS::Zero" });
        pass.setBindGroup(0, bind_group);
        pass.setPipeline(this.zero_p);
        pass.dispatchWorkgroups(hist_blocks_ru, 1, 1);
        pass.end();
    }

    // Pass B: Histogram
    {
        const pass = encoder.beginComputePass({ label: "RS::Histogram" });
        pass.setBindGroup(0, bind_group);
        pass.setPipeline(this.histogram_p);
        pass.dispatchWorkgroups(hist_blocks_ru, 1, 1);
        pass.end();
    }
    }



    private recordPrefixHistogram(bind_group: GPUBindGroup, passes: number, encoder: GPUCommandEncoder) {
        const pass = encoder.beginComputePass({ label: "Radix Sort :: Prefix Sum Pass" });
        pass.setPipeline(this.prefix_p);
        pass.setBindGroup(0, bind_group);
        pass.dispatchWorkgroups(passes, 1, 1);
        pass.end();
    }

    private recordScatterKeys(bind_group: GPUBindGroup, passes: number, keysize: number, encoder: GPUCommandEncoder) {
    if (passes !== 4) throw new Error("Only 4 passes are supported for 32-bit keys.");
    const { scatter_blocks_ru } = this.getScatterHistogramSizes(keysize);

    const run = (pipe: GPUComputePipeline, label: string) => {
        const pass = encoder.beginComputePass({ label });
        pass.setBindGroup(0, bind_group);
        pass.setPipeline(pipe);
        pass.dispatchWorkgroups(scatter_blocks_ru, 1, 1);
        pass.end();
    };

    run(this.scatter_even_p, "RS::Scatter0_even");
    run(this.scatter_odd_p,  "RS::Scatter1_odd");
    run(this.scatter_even_p, "RS::Scatter2_even");
    run(this.scatter_odd_p,  "RS::Scatter3_odd");
    }


    /**
     * Helper function to download buffer data from the GPU.
     */
    private async downloadBuffer(device: GPUDevice, queue: GPUQueue, buffer: GPUBuffer, type: 'f32' | 'u32'): Promise<Float32Array | Uint32Array> {
        const downloadBuffer = device.createBuffer({
            label: "Download buffer",
            size: buffer.size,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        const commandEncoder = device.createCommandEncoder({ label: "Copy encoder" });
        commandEncoder.copyBufferToBuffer(buffer, 0, downloadBuffer, 0, buffer.size);
        queue.submit([commandEncoder.finish()]);

        await downloadBuffer.mapAsync(GPUMapMode.READ);
        const data = downloadBuffer.getMappedRange();
        
        let result: Float32Array | Uint32Array;
        if (type === 'f32') {
            result = new Float32Array(data.slice(0));
        } else {
            result = new Uint32Array(data.slice(0));
        }

        downloadBuffer.unmap();
        downloadBuffer.destroy();

        return result;
    }
}
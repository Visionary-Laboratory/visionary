/**
 * Debug helpers for WebGPU rendering
 * Provides axes, grid, and basic geometry rendering
 */

import { mat4, vec3 } from 'gl-matrix';
import debugHelpersShader from '../shaders/debug-helpers.wgsl?raw';

export class DebugHelpers {
    private device: GPUDevice;
    private pipeline: GPURenderPipeline | null = null;
    private pipelineSolid: GPURenderPipeline | null = null;
    private uniformBuffer: GPUBuffer;
    private uniformBindGroup: GPUBindGroup | null = null;
    
    // Geometry buffers
    private axesVertexBuffer: GPUBuffer | null = null;
    private axesVertexCount = 0;
    private cubeVertexBuffer: GPUBuffer | null = null;
    private cubeVertexCount = 0;
    private cubeSolidVertexBuffer: GPUBuffer | null = null;
    private cubeSolidVertexCount = 0;
    private gridVertexBuffer: GPUBuffer | null = null;
    private gridVertexCount = 0;
    
    private visible = true;
    
    constructor(device: GPUDevice) {
        this.device = device;
        
        // Create uniform buffer (view, proj, model matrices)
        this.uniformBuffer = device.createBuffer({
            size: 64 * 3, // 3 mat4x4
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }
    
    async initialize(format: GPUTextureFormat): Promise<void> {
        // Create shader module
        const shaderModule = this.device.createShaderModule({
            label: 'Debug Helpers Shader',
            code: debugHelpersShader,
        });
        
        // Create pipeline layout
        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: 'uniform' }
            }]
        });
        
        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        });
        
        // Create render pipeline (line-list) for axes/grid/wireframe
        this.pipeline = this.device.createRenderPipeline({
            label: 'Debug Helpers Pipeline (Lines)',
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [{
                    arrayStride: 24, // 3 floats position + 3 floats color
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
                        { shaderLocation: 1, offset: 12, format: 'float32x3' }, // color
                    ]
                }]
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{
                    format: format,
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
                    }
                }]
            },
            primitive: {
                topology: 'line-list',
                cullMode: 'none'
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less'
            }
        });

        // Create render pipeline (triangle-list) for solid cube
        this.pipelineSolid = this.device.createRenderPipeline({
            label: 'Debug Helpers Pipeline (Solid)',
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [{
                    arrayStride: 24,
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x3' },
                        { shaderLocation: 1, offset: 12, format: 'float32x3' },
                    ]
                }]
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{
                    format: format,
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
                    }
                }]
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'back'
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less'
            }
        });
        
        // Create bind group
        this.uniformBindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [{
                binding: 0,
                resource: { buffer: this.uniformBuffer }
            }]
        });
        
        // Create geometry
        this.createAxesGeometry();
        this.createCubeGeometry();
        this.createCubeSolidGeometry();
        this.createGridGeometry();
    }
    
    private createAxesGeometry(): void {
        // Axes lines with colors (origin to axis ends)
        const axesData = new Float32Array([
            // X axis (red)
            0, 0, 0,  1, 0, 0,
            5, 0, 0,  1, 0, 0,
            
            // Y axis (green)
            0, 0, 0,  0, 1, 0,
            0, 5, 0,  0, 1, 0,
            
            // Z axis (blue)
            0, 0, 0,  0, 0, 1,
            0, 0, 5,  0, 0, 1,
        ]);
        
        this.axesVertexBuffer = this.device.createBuffer({
            label: 'Axes Vertex Buffer',
            size: axesData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        
        this.device.queue.writeBuffer(this.axesVertexBuffer, 0, axesData);
        this.axesVertexCount = 6;
    }
    
    private createCubeGeometry(): void {
        // Wireframe cube (line segments)
        const cubeData = new Float32Array([
            // Bottom face
            -1, -1, -1,  0.7, 0.7, 0.7,
             1, -1, -1,  0.7, 0.7, 0.7,
             1, -1, -1,  0.7, 0.7, 0.7,
             1, -1,  1,  0.7, 0.7, 0.7,
             1, -1,  1,  0.7, 0.7, 0.7,
            -1, -1,  1,  0.7, 0.7, 0.7,
            -1, -1,  1,  0.7, 0.7, 0.7,
            -1, -1, -1,  0.7, 0.7, 0.7,
            
            // Top face
            -1,  1, -1,  0.7, 0.7, 0.7,
             1,  1, -1,  0.7, 0.7, 0.7,
             1,  1, -1,  0.7, 0.7, 0.7,
             1,  1,  1,  0.7, 0.7, 0.7,
             1,  1,  1,  0.7, 0.7, 0.7,
            -1,  1,  1,  0.7, 0.7, 0.7,
            -1,  1,  1,  0.7, 0.7, 0.7,
            -1,  1, -1,  0.7, 0.7, 0.7,
            
            // Vertical edges
            -1, -1, -1,  0.7, 0.7, 0.7,
            -1,  1, -1,  0.7, 0.7, 0.7,
             1, -1, -1,  0.7, 0.7, 0.7,
             1,  1, -1,  0.7, 0.7, 0.7,
             1, -1,  1,  0.7, 0.7, 0.7,
             1,  1,  1,  0.7, 0.7, 0.7,
            -1, -1,  1,  0.7, 0.7, 0.7,
            -1,  1,  1,  0.7, 0.7, 0.7,
        ]);
        
        this.cubeVertexBuffer = this.device.createBuffer({
            label: 'Cube Vertex Buffer',
            size: cubeData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        
        this.device.queue.writeBuffer(this.cubeVertexBuffer, 0, cubeData);
        this.cubeVertexCount = 24;
    }

    private createCubeSolidGeometry(): void {
        // Solid cube (12 triangles, 36 vertices)
        const c = [0.7, 0.7, 0.7];
        const v = (
            x: number, y: number, z: number,
            r = c[0], g = c[1], b = c[2]
        ) => [x, y, z, r, g, b];

        const verts = [
            // Front (+Z)
            ...v(-1,-1, 1), ...v( 1,-1, 1), ...v( 1, 1, 1),
            ...v(-1,-1, 1), ...v( 1, 1, 1), ...v(-1, 1, 1),
            // Back (-Z)
            ...v( 1,-1,-1), ...v(-1,-1,-1), ...v(-1, 1,-1),
            ...v( 1,-1,-1), ...v(-1, 1,-1), ...v( 1, 1,-1),
            // Left (-X)
            ...v(-1,-1,-1), ...v(-1,-1, 1), ...v(-1, 1, 1),
            ...v(-1,-1,-1), ...v(-1, 1, 1), ...v(-1, 1,-1),
            // Right (+X)
            ...v( 1,-1, 1), ...v( 1,-1,-1), ...v( 1, 1,-1),
            ...v( 1,-1, 1), ...v( 1, 1,-1), ...v( 1, 1, 1),
            // Top (+Y)
            ...v(-1, 1, 1), ...v( 1, 1, 1), ...v( 1, 1,-1),
            ...v(-1, 1, 1), ...v( 1, 1,-1), ...v(-1, 1,-1),
            // Bottom (-Y)
            ...v(-1,-1,-1), ...v( 1,-1,-1), ...v( 1,-1, 1),
            ...v(-1,-1,-1), ...v( 1,-1, 1), ...v(-1,-1, 1),
        ];
        const data = new Float32Array(verts);
        this.cubeSolidVertexBuffer = this.device.createBuffer({
            label: 'Cube Solid Vertex Buffer',
            size: data.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.cubeSolidVertexBuffer, 0, data);
        this.cubeSolidVertexCount = 36;
    }
    
    private createGridGeometry(): void {
        const gridLines = [];
        const gridSize = 10;
        const gridStep = 1;
        const gridColor = [0.3, 0.3, 0.3];
        
        // Grid lines parallel to X axis
        for (let z = -gridSize; z <= gridSize; z += gridStep) {
            gridLines.push(
                -gridSize, 0, z, ...gridColor,
                gridSize, 0, z, ...gridColor
            );
        }
        
        // Grid lines parallel to Z axis
        for (let x = -gridSize; x <= gridSize; x += gridStep) {
            gridLines.push(
                x, 0, -gridSize, ...gridColor,
                x, 0, gridSize, ...gridColor
            );
        }
        
        const gridData = new Float32Array(gridLines);
        
        this.gridVertexBuffer = this.device.createBuffer({
            label: 'Grid Vertex Buffer',
            size: gridData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        
        this.device.queue.writeBuffer(this.gridVertexBuffer, 0, gridData);
        this.gridVertexCount = gridLines.length / 6;
    }
    
    updateMatrices(viewMatrix: mat4, projMatrix: mat4): void {
        // Create identity model matrix
        const modelMatrix = mat4.create();
        
        // Pack matrices into buffer
        const matrixData = new Float32Array(48);
        matrixData.set(viewMatrix, 0);
        matrixData.set(projMatrix, 16);
        matrixData.set(modelMatrix, 32);
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, matrixData);
    }
    
    render(passEncoder: GPURenderPassEncoder, options: {
        showAxes?: boolean;
        showCube?: boolean;
        showCubeSolid?: boolean;
        showGrid?: boolean;
    } = {}): void {
        if (!this.visible || !this.pipeline || !this.uniformBindGroup) return;
        
        const { showAxes = true, showCube = true, showCubeSolid = false, showGrid = true } = options;
        
        // Lines pipeline for grid/axes/wireframe
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.uniformBindGroup);
        
        if (showGrid && this.gridVertexBuffer) {
            passEncoder.setVertexBuffer(0, this.gridVertexBuffer);
            passEncoder.draw(this.gridVertexCount);
        }
        
        if (showAxes && this.axesVertexBuffer) {
            passEncoder.setVertexBuffer(0, this.axesVertexBuffer);
            passEncoder.draw(this.axesVertexCount);
        }
        
        if (showCube && this.cubeVertexBuffer) {
            passEncoder.setVertexBuffer(0, this.cubeVertexBuffer);
            passEncoder.draw(this.cubeVertexCount);
        }

        // Solid cube with triangle pipeline
        if (showCubeSolid && this.pipelineSolid && this.cubeSolidVertexBuffer) {
            passEncoder.setPipeline(this.pipelineSolid);
            passEncoder.setBindGroup(0, this.uniformBindGroup);
            passEncoder.setVertexBuffer(0, this.cubeSolidVertexBuffer);
            passEncoder.draw(this.cubeSolidVertexCount);
        }
    }
    
    setVisible(visible: boolean): void {
        this.visible = visible;
    }
    
    dispose(): void {
        this.uniformBuffer?.destroy();
        this.axesVertexBuffer?.destroy();
        this.cubeVertexBuffer?.destroy();
        this.gridVertexBuffer?.destroy();
    }
}
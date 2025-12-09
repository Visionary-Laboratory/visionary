export class PrecisionConverter {
  private device!: GPUDevice;
  private module!: GPUShaderModule;
  private pipelineGauss!: GPUComputePipeline;
  private pipelineColor!: GPUComputePipeline;
  private layout!: GPUBindGroupLayout;
  private pipeLayout!: GPUPipelineLayout;

  async initialize(device: GPUDevice): Promise<void> {
    this.device = device;
    // Load shader source via Vite import or direct string require
    const code = await (await fetch('/src/shaders/convert_precision.wgsl')).text();
    this.module = device.createShaderModule({ label: 'convert_precision.wgsl', code });

    this.layout = device.createBindGroupLayout({
      label: 'convert/bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ]
    });

    this.pipeLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });

    this.pipelineGauss = device.createComputePipeline({
      label: 'convert/gauss',
      layout: this.pipeLayout,
      compute: { module: this.module, entryPoint: 'convert_gauss' }
    });
    this.pipelineColor = device.createComputePipeline({
      label: 'convert/color',
      layout: this.pipeLayout,
      compute: { module: this.module, entryPoint: 'convert_color' }
    });
  }

  convert(args: {
    gaussIn: GPUBuffer,
    colorIn: GPUBuffer,
    n: number,
    colorDim: number,
  }): { gaussOutFP16: GPUBuffer, colorOutFP16: GPUBuffer, encoder: GPUCommandEncoder } {
    const { gaussIn, colorIn, n, colorDim } = args;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX;
    const align16 = (x: number) => Math.ceil(x / 16) * 16;

    const gaussOutBytes = align16(n * 5 * 4); // 5 u32 per point
    const colorWordsPerPoint = Math.floor((colorDim + 1) / 2);
    const colorOutBytes = align16(n * colorWordsPerPoint * 4);

    const gaussOutFP16 = this.device.createBuffer({ size: gaussOutBytes, usage, label: 'gauss_fp16_conv' });
    const colorOutFP16 = this.device.createBuffer({ size: colorOutBytes, usage, label: 'color_fp16_conv' });

    const paramsBuf = this.device.createBuffer({
      size: 8, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'convert/params'
    });
    const dv = new DataView(new ArrayBuffer(8));
    dv.setUint32(0, n, true);
    dv.setUint32(4, colorDim, true);
    this.device.queue.writeBuffer(paramsBuf, 0, dv.buffer);

    const bg = this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: gaussIn } },
        { binding: 1, resource: { buffer: gaussOutFP16 } },
        { binding: 2, resource: { buffer: colorIn } },
        { binding: 3, resource: { buffer: colorOutFP16 } },
        { binding: 4, resource: { buffer: paramsBuf } },
      ]
    });

    const encoder = this.device.createCommandEncoder({ label: 'convert f32->f16' });
    const pass1 = encoder.beginComputePass({ label: 'convert/gauss' });
    pass1.setPipeline(this.pipelineGauss);
    pass1.setBindGroup(0, bg);
    pass1.dispatchWorkgroups(Math.ceil(n / 256));
    pass1.end();

    const pass2 = encoder.beginComputePass({ label: 'convert/color' });
    pass2.setPipeline(this.pipelineColor);
    pass2.setBindGroup(0, bg);
    pass2.dispatchWorkgroups(Math.ceil(n / 256));
    pass2.end();

    return { gaussOutFP16, colorOutFP16, encoder };
  }

  convertInto(args: {
    gaussIn: GPUBuffer,
    colorIn: GPUBuffer,
    gaussOut: GPUBuffer,
    colorOut: GPUBuffer,
    n: number,
    colorDim: number,
  }): GPUCommandEncoder {
    const { gaussIn, colorIn, gaussOut, colorOut, n, colorDim } = args;
    const paramsBuf = this.device.createBuffer({
      size: 8, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'convert/params'
    });
    const dv = new DataView(new ArrayBuffer(8));
    dv.setUint32(0, n, true);
    dv.setUint32(4, colorDim, true);
    this.device.queue.writeBuffer(paramsBuf, 0, dv.buffer);

    const bg = this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: gaussIn } },
        { binding: 1, resource: { buffer: gaussOut } },
        { binding: 2, resource: { buffer: colorIn } },
        { binding: 3, resource: { buffer: colorOut } },
        { binding: 4, resource: { buffer: paramsBuf } },
      ]
    });

    const encoder = this.device.createCommandEncoder({ label: 'convert f32->f16 into' });
    const pass1 = encoder.beginComputePass({ label: 'convert/gauss' });
    pass1.setPipeline(this.pipelineGauss);
    pass1.setBindGroup(0, bg);
    pass1.dispatchWorkgroups(Math.ceil(n / 256));
    pass1.end();

    const pass2 = encoder.beginComputePass({ label: 'convert/color' });
    pass2.setPipeline(this.pipelineColor);
    pass2.setBindGroup(0, bg);
    pass2.dispatchWorkgroups(Math.ceil(n / 256));
    pass2.end();

    return encoder;
  }
}



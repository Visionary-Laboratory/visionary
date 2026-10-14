import assert from 'node:assert/strict';
import { onTestFinished, test } from 'vitest';
import type * as THREE from 'three/webgpu';
import { FileLoader } from '../src/app/managers/file-loader';
import { GaussianLoader } from '../src/app/managers/gaussian-loader';
import { ModelManager } from '../src/app/managers/model-manager';
import { ONNXManager } from '../src/app/managers/onnx-manager';
import { PointCloud } from '../src/point_cloud';

const streamThreshold = 1.5 * 1024 * 1024 * 1024;

function makePly(name = 'sample.ply', reportedSize?: number) {
  const properties = [
    'x', 'y', 'z', 'opacity', 'scale_0', 'scale_1', 'scale_2',
    'rot_0', 'rot_1', 'rot_2', 'rot_3', 'f_dc_0', 'f_dc_1', 'f_dc_2',
  ];
  const header = [
    'ply', 'format binary_little_endian 1.0', 'element vertex 1',
    ...properties.map(property => `property float ${property}`), 'end_header', '',
  ].join('\n');
  const body = new Float32Array([1, 2, 3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  return makeFile([header, body], name, reportedSize);
}

function makeFile(parts: BlobPart[], name: string, reportedSize?: number) {
  const reads: string[] = [];
  class TrackedFile extends File {
    // Exercise size-based routing without allocating a 1.5 GiB fixture.
    override get size() { return reportedSize ?? super.size; }
    override arrayBuffer() {
      reads.push('arrayBuffer');
      return super.arrayBuffer();
    }
    override slice(start?: number, end?: number, contentType?: string) {
      reads.push('slice');
      return super.slice(start, end, contentType);
    }
  }
  return { file: new TrackedFile(parts, name), reads };
}

function makeSplat() {
  const body = new ArrayBuffer(32);
  new Float32Array(body, 0, 6).set([1, 2, 3, 1, 1, 1]);
  new Uint8Array(body, 24).set([255, 0, 0, 255, 128, 128, 128, 255]);
  return makeFile([body], 'sample.splat');
}

function setup(capacity = 1) {
  for (const [name, value] of Object.entries({
    GPUBufferUsage: { STORAGE: 128, COPY_DST: 8, COPY_SRC: 4, UNIFORM: 64, INDIRECT: 256 },
    GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    onTestFinished(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  // Mock only WebGPU, the external boundary. Parsing and model registration are real.
  const buffers: GPUBufferDescriptor[] = [];
  const uploads: number[] = [];
  const device = {
    limits: { maxBufferSize: 1024, maxStorageBufferBindingSize: 1024 },
    createBuffer(descriptor: GPUBufferDescriptor) {
      buffers.push(descriptor);
      return { size: descriptor.size, destroy() {} };
    },
    createBindGroupLayout() { return {}; },
    createBindGroup() { return {}; },
    queue: {
      writeBuffer(_buffer: GPUBuffer, _offset: number, data: ArrayBuffer | ArrayBufferView) {
        uploads.push(data.byteLength);
      },
      async onSubmittedWorkDone() {},
    },
  } as unknown as GPUDevice;
  const renderer = { backend: { device } } as unknown as THREE.WebGPURenderer;
  const manager = new ModelManager(capacity);
  const errors: string[] = [];
  const progress: { show: boolean; stage?: string; pct?: number }[] = [];
  const fileLoader = new FileLoader(manager, {
    onError: message => errors.push(message),
    onProgress: (show, stage, pct) => progress.push({ show, stage, pct }),
  });
  const loader = new GaussianLoader(fileLoader, new ONNXManager(manager));
  return { renderer, device, manager, loader, fileLoader, errors, progress, buffers, uploads };
}

const rejectedFiles = [
  { label: 'small PLY', make: () => makePly() },
  { label: 'PLY just below the streaming threshold', make: () => makePly('sample.PLY', streamThreshold - 1) },
  { label: 'PLY at the streaming threshold', make: () => makePly('sample.PLY', streamThreshold) },
  { label: 'PLY above the streaming threshold', make: () => makePly('sample.ply', streamThreshold + 1) },
  ...['spz', 'ksplat', 'splat', 'sog', 'compressed.ply'].map(extension => ({
    label: extension,
    // Capacity rejection must not depend on a valid payload for these formats.
    make: () => makeFile([], `sample.${extension.toUpperCase()}`, streamThreshold),
  })),
];

for (const sample of rejectedFiles) {
  test(`full model capacity rejects local ${sample.label} before file reads or GPU work`, async () => {
    const { renderer, manager, loader, errors, buffers, uploads } = setup();
    await loader.createFromFile(renderer, makePly('existing.ply').file);
    const existing = manager.getModels();
    buffers.length = uploads.length = 0;
    const { file, reads } = sample.make();
    const fractions: number[] = [];

    await assert.rejects(loader.createFromFile(renderer, file, undefined, {
      onProgress: fraction => fractions.push(fraction),
    }), /Failed to load Gaussian file/);
    assert.deepEqual(errors, ['Reached model limit. Remove models before adding more.']);
    assert.deepEqual(reads, []);
    assert.deepEqual(buffers, []);
    assert.deepEqual(uploads, []);
    assert.deepEqual(fractions, []);
    assert.deepEqual(manager.getModels(), existing);
  });
}

for (const sample of [
  { label: 'small PLY', make: () => makePly(), streaming: false, type: 'ply' },
  { label: 'PLY just below the streaming threshold', make: () => makePly('sample.PLY', streamThreshold - 1), streaming: false, type: 'ply' },
  { label: 'PLY at the streaming threshold', make: () => makePly('sample.PLY', streamThreshold), streaming: true, type: 'ply' },
  { label: 'PLY above the streaming threshold', make: () => makePly('sample.ply', streamThreshold + 1), streaming: true, type: 'ply' },
  { label: 'SPLAT', make: makeSplat, streaming: false, type: 'splat' },
]) {
  test(`local ${sample.label} loads normally and can load again after removing a model`, async () => {
    const { renderer, manager, loader, errors, progress, buffers, uploads } = setup();
    const { file, reads } = sample.make();
    const fractions: number[] = [];
    const options = { onProgress: (fraction: number) => fractions.push(fraction) };
    const model = await loader.createFromFile(renderer, file, undefined, options);
    assert.equal(model.name, file.name);
    assert.equal(model.getEntry().modelType, sample.type);
    assert.equal(model.getEntry().pointCount, 1);
    const pointCloud = model.getPointCloud();
    assert.ok(pointCloud instanceof PointCloud);
    assert.deepEqual(Array.from(pointCloud.bbox.min), [1, 2, 3]);
    assert.ok(buffers.length > 0 && uploads.length > 0);
    assert.ok(progress.some(event => event.show && event.stage?.includes('Parsing')));
    assert.equal(progress.at(-1)?.show, false);
    if (sample.streaming) {
      assert.ok(reads.includes('slice'));
      assert.ok(!reads.includes('arrayBuffer'));
      assert.equal(fractions.at(-1), 1);
    } else {
      assert.ok(reads.includes('arrayBuffer'));
      assert.deepEqual(fractions, []);
    }

    await assert.rejects(loader.createFromFile(renderer, file), /Failed to load Gaussian file/);
    assert.deepEqual(errors, ['Reached model limit. Remove models before adding more.']);
    assert.equal(manager.removeModel(model.getEntry().id), true);
    assert.equal(manager.isAtCapacity(), false);
    const reloaded = await loader.createFromFile(renderer, file, undefined, { ...options, name: 'Reloaded' });
    assert.equal(reloaded.name, 'Reloaded');
    assert.equal(manager.getModelCount(), 1);
    assert.equal(manager.getModels()[0].name, 'Reloaded');
    assert.equal(reloaded.getEntry().modelType, sample.type);
    assert.equal(reloaded.getEntry().pointCount, 1);
  });
}

test('local Gaussian files retain unique default names', async () => {
  const { renderer, manager, loader } = setup(2);
  const { file } = makePly();
  const first = await loader.createFromFile(renderer, file);
  const second = await loader.createFromFile(renderer, file);
  assert.deepEqual([first.name, second.name], ['sample.ply', 'sample.ply (1)']);
  assert.equal(manager.getModelCount(), 2);
});

for (const entry of ['loadFile', 'loadGaussianFile', 'loadLocalPly'] as const) {
  test(`FileLoader.${entry} rejects full capacity before any local file or GPU work`, async () => {
    const { renderer, device, loader, fileLoader, manager, errors, buffers, uploads } = setup();
    await loader.createFromFile(renderer, makePly('existing.ply').file);
    const existing = manager.getModels();
    buffers.length = uploads.length = 0;
    const { file, reads } = makePly();
    assert.equal(await fileLoader[entry](file, device), null);
    assert.match(errors[0], /Reached model limit.*Remove models before adding more/);
    assert.deepEqual(reads, []);
    assert.deepEqual(buffers, []);
    assert.deepEqual(uploads, []);
    assert.deepEqual(manager.getModels(), existing);
  });
}

test('local ONNX still requires camera matrices before entering its dedicated loader', async () => {
  const { renderer, loader, manager, errors, buffers, uploads } = setup();
  await loader.createFromFile(renderer, makePly().file);
  buffers.length = uploads.length = 0;
  const { file, reads } = makeFile([], 'model.ONNX');
  await assert.rejects(loader.createFromFile(renderer, file), /requires camera matrices/);
  assert.deepEqual(errors, []);
  assert.deepEqual(reads, []);
  assert.deepEqual(buffers, []);
  assert.deepEqual(uploads, []);
  assert.equal(manager.getModelCount(), 1);
});

test('ModelManager still enforces its limit at registration', async () => {
  const { renderer, loader, manager } = setup();
  const model = await loader.createFromFile(renderer, makePly().file);
  const { id, ...entry } = model.getEntry();
  assert.throws(() => manager.addModel(entry), /Reached model limit \(1\).*Remove models before adding more/);
  assert.equal(manager.getModelCount(), 1);
});

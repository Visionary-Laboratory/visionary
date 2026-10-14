import assert from 'node:assert/strict';
import { onTestFinished, test, vi } from 'vitest';
import { PLYLoader } from '../src/io/ply_loader';
import type { LoadingOptions } from '../src/io';

const properties = [
  'x', 'y', 'z', 'opacity', 'scale_0', 'scale_1', 'scale_2',
  'rot_0', 'rot_1', 'rot_2', 'rot_3', 'f_dc_0', 'f_dc_1', 'f_dc_2',
];

function makePly({ weights = false, extraPca = false, points = 1 } = {}) {
  const props = [...properties];
  const row = [1, 2, 3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
  if (extraPca) {
    props.push('extra_pca_r', 'extra_pca_g', 'extra_pca_b');
    row.push(0.25, 0.5, 0.75);
  }
  if (weights) {
    for (let i = 0; i < 64; i++) {
      props.push(`weight_${i}`);
      row.push(i / 64);
    }
  }
  const header = new TextEncoder().encode([
    'ply', 'format binary_little_endian 1.0', `element vertex ${points}`,
    ...props.map(name => `property float ${name}`), 'end_header', '',
  ].join('\n'));
  const body = new ArrayBuffer(points * row.length * 4);
  const view = new DataView(body);
  for (let i = 0; i < points; i++) {
    row.forEach((value, p) => view.setFloat32((i * row.length + p) * 4, value, true));
  }
  const bodyReads: number[] = [];
  class TrackedFile extends File {
    override slice(start?: number, end?: number, contentType?: string): Blob {
      if (start !== undefined && start >= header.byteLength) bodyReads.push(start);
      return super.slice(start, end, contentType);
    }
  }
  return { file: new TrackedFile([header, body], 'sample.ply'), bodyReads };
}

function makeDevice(maxBufferSize: number, maxStorageBufferBindingSize: number) {
  // WebGPU is the external boundary; keep the real loader and PLY parser.
  const originalUsage = Object.getOwnPropertyDescriptor(globalThis, 'GPUBufferUsage');
  Object.defineProperty(globalThis, 'GPUBufferUsage', {
    configurable: true, value: { STORAGE: 128, COPY_DST: 8 },
  });
  onTestFinished(() => {
    if (originalUsage) Object.defineProperty(globalThis, 'GPUBufferUsage', originalUsage);
    else Reflect.deleteProperty(globalThis, 'GPUBufferUsage');
  });
  const buffers: { label: string; size: number; data: ArrayBuffer }[] = [];
  const uploads: { label: string; offset: number; size: number }[] = [];
  const device = {
    limits: { maxBufferSize, maxStorageBufferBindingSize },
    createBuffer(descriptor: GPUBufferDescriptor) {
      const buffer = {
        label: descriptor.label ?? '', size: descriptor.size,
        data: new ArrayBuffer(descriptor.size), destroy() {},
      };
      buffers.push(buffer);
      return buffer;
    },
    queue: {
      writeBuffer(buffer: typeof buffers[number], offset: number, data: Uint8Array) {
        new Uint8Array(buffer.data, offset, data.byteLength).set(data);
        uploads.push({ label: buffer.label, offset, size: data.byteLength });
      },
      async onSubmittedWorkDone() {},
    },
  } as unknown as GPUDevice;
  return { device, buffers, uploads };
}

for (const limit of ['maxBufferSize', 'maxStorageBufferBindingSize'] as const) {
  for (const sample of [
    { label: 'gaussians', bytes: 20, weights: false },
    { label: 'sh', bytes: 96, weights: false },
    { label: 'weights', bytes: 256, weights: true },
  ]) {
    test(`streaming PLY rejects ${sample.label} above ${limit} before any body or GPU work`, async () => {
      const { file, bodyReads } = makePly({ weights: sample.weights });
      const maximum = sample.bytes - 1;
      const { device, buffers, uploads } = makeDevice(
        limit === 'maxBufferSize' ? maximum : 1024,
        limit === 'maxStorageBufferBindingSize' ? maximum : 1024,
      );
      // The header probe can contain body bytes: no later body slice alone does
      // not prove they stayed unparsed. Observe native float reads as well.
      const bodyParser = vi.spyOn(DataView.prototype, 'getFloat32');
      onTestFinished(() => bodyParser.mockRestore());

      await assert.rejects(new PLYLoader().loadFileStreaming(file, device), error => {
        assert.match(String(error), new RegExp(`"${sample.label}".*${sample.bytes}.*${limit}.*${maximum}`));
        return true;
      });
      assert.equal(bodyParser.mock.calls.length, 0);
      assert.deepEqual(bodyReads, []);
      assert.deepEqual(buffers, []);
      assert.deepEqual(uploads, []);
    });
  }
}

for (const weights of [false, true]) {
  for (const atLimit of [false, true]) {
    test(`streaming PLY loads ${weights ? 'weighted' : 'unweighted'} data ${atLimit ? 'at both limits' : 'below both limits'}`, async () => {
      const { file } = makePly({ weights, extraPca: true, points: 2 });
      const maximum = atLimit ? (weights ? 512 : 192) : 1024;
      const { device, buffers } = makeDevice(maximum, maximum);
      const options: LoadingOptions & { chunkBytes: number } = { chunkBytes: 4 };
      const loaded = await new PLYLoader().loadFileStreaming(file, device, options);

      assert.equal(loaded.meta.numPoints(), 2);
      assert.equal(loaded.meta.shDegree(), 0);
      assert.deepEqual(loaded.meta.bbox(), { min: [1, 2, 3], max: [1, 2, 3] });
      assert.deepEqual(buffers.map(({ label, size }) => [label, size]), [
        ['gaussians/storage', 40], ['sh/storage', 192], ['extra_pca/storage', 32],
        ...(weights ? [['weights/storage', 512]] : []),
      ]);
      assert.deepEqual(Array.from(new Uint16Array(buffers[0].data)), [
        0x3c00, 0x4000, 0x4200, 0x3800, 0x3c00, 0, 0, 0x3c00, 0, 0x3c00,
        0x3c00, 0x4000, 0x4200, 0x3800, 0x3c00, 0, 0, 0x3c00, 0, 0x3c00,
      ]);
      assert.deepEqual(Array.from(new Float32Array(buffers[2].data)), [0.25, 0.5, 0.75, 0, 0.25, 0.5, 0.75, 0]);
      if (weights) {
        assert.equal(loaded.weightBuffer, buffers[3]);
        assert.equal(new Float32Array(buffers[3].data)[63], 0.984375);
        assert.equal(new Float32Array(buffers[3].data)[127], 0.984375);
      } else {
        assert.equal(loaded.weightBuffer, null);
      }
    });
  }
}

test('streaming PLY allocates a zeroed extra PCA buffer even without PCA properties', async () => {
  const { file } = makePly();
  const { device, buffers, uploads } = makeDevice(96, 96);
  const loaded = await new PLYLoader().loadFileStreaming(file, device);

  assert.equal(loaded.extraPcaBuffer, buffers[2]);
  assert.equal(buffers[2].size, 16);
  assert.deepEqual(Array.from(new Uint8Array(buffers[2].data)), Array(16).fill(0));
  assert.deepEqual(uploads.map(({ label, size }) => [label, size]), [
    ['gaussians/storage', 20], ['sh/storage', 96],
  ]);
  assert.equal(loaded.weightBuffer, null);
});

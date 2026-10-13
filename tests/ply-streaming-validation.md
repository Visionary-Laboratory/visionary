# Streaming PLY GPU limits: validation

Spec: `tmp/review-fixes/issues/02-streaming-ply-gpu-limits.md`.

Validated on 2026-10-13 using Node.js 24.15.0.

- Red/green: the initial public-entry regression with `maxBufferSize=1024`
  and `maxStorageBufferBindingSize=95` failed with “Missing expected rejection”
  for a valid one-point PLY requiring a 96-byte SH buffer. It passed after
  adding the storage binding limit check.
- `node --import tsx --test --test-isolation=none tests/ply-streaming.test.ts`:
  all 11 cases passed. The cases cover both limits, Gaussian/SH/weight
  overflow, exact equality, sufficient limits, absent weights, PCA payloads,
  the 16-byte zeroed PCA allocation without PCA properties, and chunked uploads.
  Every overflow case checks that no vertex float was parsed, no body slice
  was requested after the header probe, and no GPU buffer was created or uploaded.
  The header probe may include body bytes; this is necessary header reading,
  and those bytes are not parsed as vertices before the limit check.
- `npx tsc --noEmit`: passed.
- The test file also passed a standalone strict TypeScript check with Node,
  Vite, and WebGPU types.
- Final `npm test`: passed (one Node test file containing the 11 cases).
- `npm run build`: passed, including `build:types` declaration generation.
  Vite emitted existing warnings about library formats and external globals.
- Real-device rendering smoke: **not executed**. A headless Chrome WebGPU
  probe returned only the software adapter with vendor `google`, architecture
  `swiftshader`, and `isFallbackAdapter=true`. No real WebGPU device was available
  to this run. A second probe using the Vulkan backend and high-performance
  adapter preference returned no adapter. Mock-device tests do not establish
  rendering correctness.

Run the automated suite with `npm test`. The existing ONNX and Three.js demo
checks require browser/model assets and are not Node test-runner suites.

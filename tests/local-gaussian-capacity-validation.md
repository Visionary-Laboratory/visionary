# Local Gaussian capacity: validation

Spec: `tmp/review-fixes/issues/03-local-gaussian-capacity.md`.

Validated on 2026-10-13 using Node.js 24.15.0.

- Test seam: `GaussianLoader.createFromFile(renderer, File, ...)`, with real
  `FileLoader`, format parsers, `PointCloud`, and `ModelManager`. Only the
  external File/WebGPU boundaries are instrumented. No test-only business API
  or internal collaborator mock was added.
- Red/green: a valid small PLY loaded into a full manager originally reached
  the registration error after parsing and GPU allocation/upload. The initial
  regression failed because it received the registration error instead of
  the existing local loading failure and capacity callback. It passed after
  moving local Gaussian routing behind the shared capacity precheck.
- `node --import tsx --test --test-isolation=none tests/local-gaussian-capacity.test.ts`:
  all 20 cases passed. Full-capacity rejection covers small PLY, PLY just below,
  exactly at, and above the 1.5GiB threshold, SPZ, KSplat, SPLAT, SOG, and
  compressed PLY, including uppercase extensions. Each rejection checks zero
  file reads, zero GPU allocations/uploads, no fractional progress callback,
  the existing removal prompt, and unchanged registered models.
- Successful loading and removal/reload cover small PLY, threshold boundary
  PLY, streamed PLY, and SPLAT with real one-point payloads. Checks include
  point count/coordinates, detected format, original/custom/unique names,
  loading UI progress completion, and the existing streaming-only fractional
  progress callback. Reported File size is overridden for threshold tests;
  they exercise routing and real streamed parsing without a 1.5GiB allocation.
- Direct public `FileLoader.loadFile`, `loadGaussianFile`, and `loadLocalPly`
  entries also reject full capacity without any file/GPU work. The debug read
  in `loadFile` now occurs after its existing capacity check.
- The ONNX camera-matrix requirement still takes precedence at full capacity;
  the dedicated ONNX branch, its blob URL lifecycle, and ONNXManager are unchanged.
  The registration-stage limit is tested independently and remains unchanged.
- `npx tsc --noEmit`: passed. The new test file also passed a standalone strict
  TypeScript check with Node, Vite, and WebGPU types.
- Final `npm test`: passed (both Node test files, including the existing
  streaming GPU-limit regressions).
- `npm run build`: passed, including `build:types` declaration generation.
  Vite emitted existing library-format and external-global warnings.

Not executed: real-device browser rendering, a genuinely multi-gigabyte file,
full ONNX inference, or successful SPZ/KSplat/SOG/compressed-PLY decoding. The
capacity cases for those formats intentionally use unread payloads, so they
verify early rejection without claiming decoder coverage. Concurrent slot
reservation and broader GPU resource lifecycle changes remain outside the spec.

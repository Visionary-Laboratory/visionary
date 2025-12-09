struct Params {
  n: u32,
  colorDim: u32,
}

@group(0) @binding(0)
var<storage, read> gauss_f32 : array<f32>;

@group(0) @binding(1)
var<storage, read_write> gauss_f16_packed : array<u32>;

@group(0) @binding(2)
var<storage, read> color_f32 : array<f32>;

@group(0) @binding(3)
var<storage, read_write> color_f16_packed : array<u32>;

@group(0) @binding(4)
var<uniform> params : Params;

// Pack two f32 values to one u32 containing two f16
fn pack2(a: f32, b: f32) -> u32 {
  return pack2x16float(vec2<f32>(a, b));
}

// Gaussians: per point 10 f32 -> 5 u32
@compute @workgroup_size(256,1,1)
fn convert_gauss(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.n) { return; }

  let baseIn  = idx * 10u;
  let baseOut = idx * 5u;

  gauss_f16_packed[baseOut + 0u] = pack2(gauss_f32[baseIn + 0u], gauss_f32[baseIn + 1u]);
  gauss_f16_packed[baseOut + 1u] = pack2(gauss_f32[baseIn + 2u], gauss_f32[baseIn + 3u]);
  gauss_f16_packed[baseOut + 2u] = pack2(gauss_f32[baseIn + 4u], gauss_f32[baseIn + 5u]);
  gauss_f16_packed[baseOut + 3u] = pack2(gauss_f32[baseIn + 6u], gauss_f32[baseIn + 7u]);
  gauss_f16_packed[baseOut + 4u] = pack2(gauss_f32[baseIn + 8u], gauss_f32[baseIn + 9u]);
}

// Color: per point colorDim f32 -> ceil(colorDim/2) u32
@compute @workgroup_size(256,1,1)
fn convert_color(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.n) { return; }

  let dim = params.colorDim;
  let inBase  = idx * dim;
  let outBase = idx * ((dim + 1u) / 2u);

  var i: u32 = 0u;
  loop {
    if (i >= dim) { break; }
    let a = color_f32[inBase + i];
    let hasB: bool = (i + 1u) < dim;
    let b = select(0.0, color_f32[inBase + i + 1u], hasB);
    let w = pack2(a, b);
    color_f16_packed[outBase + (i >> 1u)] = w;
    i += 2u;
  }
}



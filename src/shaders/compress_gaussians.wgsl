// Compute shader to compress uncompressed ONNX Gaussian data to the format expected by renderer
// Converts from separate position, scale, rotation, opacity arrays to packed f16 format

struct CameraUniforms {
    view: mat4x4<f32>,
    view_inv: mat4x4<f32>,
    proj: mat4x4<f32>,
    proj_inv: mat4x4<f32>,
    viewport: vec2<f32>,
    focal: vec2<f32>
};

// Compressed format matching renderer expectations
struct Gaussian {
    pos_opacity: array<u32,2>,  // packed f16: [x, y, z, opacity]
    cov: array<u32,3>           // packed f16: covariance matrix upper triangle [m00, m01, m02, m11, m12, m22]
}

struct CompressionUniforms {
    num_points: u32,
    sh_degree: u32,
    _pad0: u32,
    _pad1: u32,
}

// Input buffers (uncompressed ONNX output)
@group(0) @binding(0) var<storage, read> uncompressed_positions: array<vec3<f32>>;
@group(0) @binding(1) var<storage, read> uncompressed_scales: array<vec3<f32>>;
@group(0) @binding(2) var<storage, read> uncompressed_rotations: array<vec4<f32>>;  // quaternions
@group(0) @binding(3) var<storage, read> uncompressed_opacities: array<f32>;
@group(0) @binding(4) var<storage, read> uncompressed_sh_dc: array<vec3<f32>>;     // RGB DC coefficients
@group(0) @binding(5) var<storage, read> uncompressed_sh_rest: array<f32>;        // Higher order SH (optional)

// Output buffers (compressed format)
@group(1) @binding(0) var<storage, read_write> compressed_gaussians: array<Gaussian>;
@group(1) @binding(1) var<storage, read_write> compressed_sh: array<array<u32,24>>;

// Uniforms
@group(2) @binding(0) var<uniform> compression_uniforms: CompressionUniforms;

/**
 * Convert quaternion to 3x3 rotation matrix
 * Input: quaternion [w, x, y, z] (normalized)
 * Output: 3x3 rotation matrix
 */
fn quaternion_to_rotation_matrix(q: vec4<f32>) -> mat3x3<f32> {
    let w = q.x;  // w component
    let x = q.y;  // x component  
    let y = q.z;  // y component
    let z = q.w;  // z component
    
    // Normalize quaternion
    let norm = sqrt(w*w + x*x + y*y + z*z);
    let nq = q / norm;
    let nw = nq.x;
    let nx = nq.y;
    let ny = nq.z;
    let nz = nq.w;
    
    // Convert to rotation matrix
    return mat3x3<f32>(
        // Column 0
        vec3<f32>(
            1.0 - 2.0 * (ny*ny + nz*nz),
            2.0 * (nx*ny + nw*nz),
            2.0 * (nx*nz - nw*ny)
        ),
        // Column 1
        vec3<f32>(
            2.0 * (nx*ny - nw*nz),
            1.0 - 2.0 * (nx*nx + nz*nz),
            2.0 * (ny*nz + nw*nx)
        ),
        // Column 2
        vec3<f32>(
            2.0 * (nx*nz + nw*ny),
            2.0 * (ny*nz - nw*nx),
            1.0 - 2.0 * (nx*nx + ny*ny)
        )
    );
}

/**
 * Convert scale and rotation to covariance matrix
 * Scale: 3D scale factors [sx, sy, sz]
 * Rotation: quaternion [w, x, y, z]
 * Output: 3x3 covariance matrix
 */
fn compute_covariance_matrix(scale: vec3<f32>, rotation: vec4<f32>) -> mat3x3<f32> {
    // Create scale matrix
    let S = mat3x3<f32>(
        vec3<f32>(scale.x, 0.0, 0.0),
        vec3<f32>(0.0, scale.y, 0.0),
        vec3<f32>(0.0, 0.0, scale.z)
    );
    
    // Get rotation matrix
    let R = quaternion_to_rotation_matrix(rotation);
    
    // Compute covariance: C = R * S * S^T * R^T
    let RS = R * S;
    return RS * transpose(RS);
}

/**
 * Convert f32 to f16 bits (simplified)
 */
fn f32_to_f16_bits(value: f32) -> u32 {
    let f32_bits = bitcast<u32>(value);
    let sign = (f32_bits >> 31u) & 1u;
    let exponent = ((f32_bits >> 23u) & 0xFFu);
    let mantissa = f32_bits & 0x7FFFFFu;
    
    // Handle special cases
    if (exponent == 0u) {
        return sign << 15u; // Zero or denormalized -> zero
    }
    if (exponent == 0xFFu) {
        return (sign << 15u) | 0x7C00u | (mantissa >> 13u); // Infinity or NaN
    }
    
    // Convert exponent from f32 to f16 range
    let new_exp = i32(exponent) - 127 + 15;
    if (new_exp <= 0) {
        return sign << 15u; // Underflow -> zero
    }
    if (new_exp >= 31) {
        return (sign << 15u) | 0x7C00u; // Overflow -> infinity
    }
    
    // Pack f16: sign(1) + exponent(5) + mantissa(10)
    return (sign << 15u) | (u32(new_exp) << 10u) | (mantissa >> 13u);
}

/**
 * Pack two f32 values into a single u32 as f16
 */
fn pack_f16_pair(a: f32, b: f32) -> u32 {
    let a_f16 = f32_to_f16_bits(a);
    let b_f16 = f32_to_f16_bits(b);
    return (b_f16 << 16u) | (a_f16 & 0xFFFFu);
}

/**
 * Pack spherical harmonics DC coefficients
 */
fn pack_sh_dc(sh_dc: vec3<f32>, sh_idx: u32) -> array<u32, 2> {
    return array<u32, 2>(
        pack_f16_pair(sh_dc.x, sh_dc.y),
        pack_f16_pair(sh_dc.z, 0.0)  // Pack with padding
    );
}

/**
 * Pack higher order spherical harmonics coefficients
 * This handles SH coefficients beyond DC (degree > 0)
 */
fn pack_sh_rest(base_idx: u32, point_idx: u32) -> array<u32, 22> {
    var packed: array<u32, 22>;
    
    // Calculate how many higher-order coefficients we have per point
    let sh_deg = compression_uniforms.sh_degree;
    let coeffs_per_point = (sh_deg + 1) * (sh_deg + 1) - 1;  // Exclude DC (first 3)
    
    // Pack remaining coefficients in pairs
    for (var i = 0u; i < 22u; i += 1u) {
        let coeff_idx = base_idx + point_idx * coeffs_per_point + i * 2u;
        
        var a = 0.0;
        var b = 0.0;
        
        if (coeff_idx < arrayLength(&uncompressed_sh_rest)) {
            a = uncompressed_sh_rest[coeff_idx];
        }
        if (coeff_idx + 1u < arrayLength(&uncompressed_sh_rest)) {
            b = uncompressed_sh_rest[coeff_idx + 1u];
        }
        
        packed[i] = pack_f16_pair(a, b);
    }
    
    return packed;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let point_idx = gid.x;
    
    // Bounds check
    if (point_idx >= compression_uniforms.num_points) {
        return;
    }
    
    // Ensure we don't exceed buffer bounds
    if (point_idx >= arrayLength(&uncompressed_positions) ||
        point_idx >= arrayLength(&uncompressed_scales) ||
        point_idx >= arrayLength(&uncompressed_rotations) ||
        point_idx >= arrayLength(&uncompressed_opacities) ||
        point_idx >= arrayLength(&uncompressed_sh_dc)) {
        return;
    }
    
    // Read uncompressed data
    let position = uncompressed_positions[point_idx];
    let scale = uncompressed_scales[point_idx];
    let rotation = uncompressed_rotations[point_idx];  // quaternion
    let opacity = uncompressed_opacities[point_idx];
    let sh_dc = uncompressed_sh_dc[point_idx];
    
    // Convert quaternion + scale to covariance matrix
    let cov_matrix = compute_covariance_matrix(scale, rotation);
    
    // Pack position and opacity
    compressed_gaussians[point_idx].pos_opacity[0] = pack_f16_pair(position.x, position.y);
    compressed_gaussians[point_idx].pos_opacity[1] = pack_f16_pair(position.z, opacity);
    
    // Pack covariance matrix (upper triangle: m00, m01, m02, m11, m12, m22)
    compressed_gaussians[point_idx].cov[0] = pack_f16_pair(cov_matrix[0][0], cov_matrix[0][1]);
    compressed_gaussians[point_idx].cov[1] = pack_f16_pair(cov_matrix[0][2], cov_matrix[1][1]);
    compressed_gaussians[point_idx].cov[2] = pack_f16_pair(cov_matrix[1][2], cov_matrix[2][2]);
    
    // Pack spherical harmonics
    if (point_idx < arrayLength(&compressed_sh)) {
        // Pack DC coefficients (first 2 u32s)
        let sh_dc_packed = pack_sh_dc(sh_dc, point_idx);
        compressed_sh[point_idx][0] = sh_dc_packed[0];
        compressed_sh[point_idx][1] = sh_dc_packed[1];
        
        // Pack higher order coefficients (remaining 22 u32s)
        if (compression_uniforms.sh_degree > 0u && arrayLength(&uncompressed_sh_rest) > 0u) {
            let sh_rest_packed = pack_sh_rest(0u, point_idx);
            for (var i = 0u; i < 22u; i += 1u) {
                compressed_sh[point_idx][i + 2u] = sh_rest_packed[i];
            }
        } else {
            // Fill remaining with zeros if no higher order coefficients
            for (var i = 2u; i < 24u; i += 1u) {
                compressed_sh[point_idx][i] = 0u;
            }
        }
    }
}
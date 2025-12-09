// Debug helper shaders for rendering axes and basic geometry

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec3<f32>,
}

struct Uniforms {
    view: mat4x4<f32>,
    proj: mat4x4<f32>,
    model: mat4x4<f32>,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

// Vertex shader
@vertex
fn vs_main(
    @location(0) position: vec3<f32>,
    @location(1) color: vec3<f32>
) -> VertexOutput {
    var output: VertexOutput;
    let world_pos = uniforms.model * vec4<f32>(position, 1.0);
    let view_pos = uniforms.view * world_pos;
    output.position = uniforms.proj * view_pos;
    output.color = color;
    return output;
}

// Fragment shader
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    return vec4<f32>(input.color, 1.0);
}
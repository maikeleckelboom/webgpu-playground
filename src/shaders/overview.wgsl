// =============================================================================
// Track Overview Shader
// Compact full-track waveform with playhead indicator
// =============================================================================

struct OverviewUniforms {
  viewWidth: f32,
  viewHeight: f32,
  totalSamples: f32,
  playheadSamples: f32,
  lodLengthInPixels: f32,
  loopActive: f32,
  loopInSample: f32,
  loopOutSample: f32,
};

@group(0) @binding(0) var<uniform> uniforms: OverviewUniforms;
@group(0) @binding(1) var amplitudeTex: texture_2d<f32>;
@group(0) @binding(2) var texSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0)
  );

  var uv = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0)
  );

  var output: VertexOutput;
  output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  output.uv = uv[vertexIndex];
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let normalizedX = input.uv.x;
  let normalizedY = input.uv.y;

  // Background
  var color = vec3<f32>(0.08, 0.08, 0.1);

  // Sample waveform at this position
  let texCoord = vec2<f32>(normalizedX, 0.5);
  let amplitude = textureSample(amplitudeTex, texSampler, texCoord);

  let minAmp = amplitude.r;
  let maxAmp = amplitude.g;

  // Draw waveform
  let centerY = 0.5;
  let waveformHeight = 0.8;

  let minY = centerY - minAmp * waveformHeight * 0.5;
  let maxY = centerY + maxAmp * waveformHeight * 0.5;

  if (normalizedY >= minY && normalizedY <= maxY) {
    // Color based on amplitude (brighter for louder)
    let intensity = (maxAmp + minAmp) * 0.5;
    color = mix(vec3<f32>(0.2, 0.4, 0.6), vec3<f32>(0.4, 0.8, 1.0), intensity);
  }

  // Loop region
  if (uniforms.loopActive > 0.5) {
    let loopInNorm = uniforms.loopInSample / uniforms.totalSamples;
    let loopOutNorm = uniforms.loopOutSample / uniforms.totalSamples;

    if (normalizedX >= loopInNorm && normalizedX <= loopOutNorm) {
      color = mix(color, vec3<f32>(0.2, 0.8, 0.2), 0.2);
    }
  }

  // Played portion (darken unplayed)
  let playheadNorm = uniforms.playheadSamples / uniforms.totalSamples;
  if (normalizedX > playheadNorm) {
    color = color * 0.6; // Darken unplayed section
  }

  // Playhead indicator
  let playheadScreenX = playheadNorm * uniforms.viewWidth;
  let currentScreenX = normalizedX * uniforms.viewWidth;
  let distFromPlayhead = abs(currentScreenX - playheadScreenX);

  if (distFromPlayhead < 2.0) {
    color = vec3<f32>(1.0, 1.0, 1.0);
  } else if (distFromPlayhead < 4.0) {
    let glow = 1.0 - (distFromPlayhead - 2.0) / 2.0;
    color = mix(color, vec3<f32>(1.0, 1.0, 1.0), glow * 0.5);
  }

  return vec4<f32>(color, 1.0);
}

// =============================================================================
// WebGPU Meter Rendering Shader
// Vertical bar meters with peak hold and spectral bands
// =============================================================================

struct MeterUniforms {
  viewWidth: f32,
  viewHeight: f32,
  channelCount: f32,
  _padding: f32,
};

struct ChannelData {
  rms: f32,
  peak: f32,
  peakHold: f32,
  lowEnergy: f32,
  midEnergy: f32,
  highEnergy: f32,
  _padding1: f32,
  _padding2: f32,
};

@group(0) @binding(0) var<uniform> uniforms: MeterUniforms;
@group(0) @binding(1) var<storage, read> channels: array<ChannelData>;

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

// Map level to color (green -> yellow -> red)
fn levelToColor(level: f32) -> vec3<f32> {
  if (level < 0.6) {
    return vec3<f32>(0.2, 0.8, 0.3); // Green
  } else if (level < 0.85) {
    let t = (level - 0.6) / 0.25;
    return mix(vec3<f32>(0.2, 0.8, 0.3), vec3<f32>(0.9, 0.8, 0.2), t); // Yellow
  } else {
    let t = (level - 0.85) / 0.15;
    return mix(vec3<f32>(0.9, 0.8, 0.2), vec3<f32>(1.0, 0.3, 0.2), t); // Red
  }
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let screenX = input.uv.x * uniforms.viewWidth;
  let screenY = input.uv.y * uniforms.viewHeight;
  let normalizedY = 1.0 - input.uv.y; // Flip so 0 is bottom, 1 is top

  var color = vec3<f32>(0.06, 0.06, 0.08);

  let meterWidth = 20.0;
  let meterSpacing = 30.0;
  let totalWidth = (uniforms.channelCount - 1.0) * meterSpacing + meterWidth;
  let startX = (uniforms.viewWidth - totalWidth) * 0.5;

  let channelCountInt = i32(uniforms.channelCount);
  for (var i = 0; i < channelCountInt; i = i + 1) {
    let channel = channels[i];
    let meterX = startX + f32(i) * meterSpacing;

    // Check if in meter column
    if (screenX >= meterX && screenX < meterX + meterWidth) {
      let meterPosX = (screenX - meterX) / meterWidth;

      // Background
      color = vec3<f32>(0.1, 0.1, 0.12);

      // RMS bar (main level)
      if (normalizedY < channel.rms) {
        let segmentHeight = 0.02;
        let segmentGap = 0.005;
        let segmentIndex = floor(normalizedY / (segmentHeight + segmentGap));
        let inSegment = fract(normalizedY / (segmentHeight + segmentGap)) < (segmentHeight / (segmentHeight + segmentGap));

        if (inSegment) {
          color = levelToColor(normalizedY);
        }
      }

      // Peak indicator
      let peakY = channel.peak;
      if (abs(normalizedY - peakY) < 0.01) {
        color = levelToColor(peakY) * 1.2;
      }

      // Peak hold indicator
      let peakHoldY = channel.peakHold;
      if (abs(normalizedY - peakHoldY) < 0.008) {
        color = vec3<f32>(1.0, 1.0, 1.0);
      }

      // Clipping indicator
      if (channel.peak > 0.95 && normalizedY > 0.95) {
        color = vec3<f32>(1.0, 0.2, 0.2);
      }
    }

    // Spectral bands (small bars next to main meter)
    let bandWidth = 6.0;
    let bandX = meterX + meterWidth + 4.0;

    if (screenX >= bandX && screenX < bandX + bandWidth * 3.0 + 4.0) {
      let bandIndex = i32((screenX - bandX) / (bandWidth + 2.0));
      let inBand = fract((screenX - bandX) / (bandWidth + 2.0)) < (bandWidth / (bandWidth + 2.0));

      if (inBand && bandIndex < 3) {
        var bandLevel = 0.0;
        var bandColor = vec3<f32>(0.0);

        if (bandIndex == 0) {
          bandLevel = channel.lowEnergy;
          bandColor = vec3<f32>(1.0, 0.4, 0.3); // Low - red/orange
        } else if (bandIndex == 1) {
          bandLevel = channel.midEnergy;
          bandColor = vec3<f32>(0.4, 1.0, 0.4); // Mid - green
        } else {
          bandLevel = channel.highEnergy;
          bandColor = vec3<f32>(0.4, 0.8, 1.0); // High - cyan
        }

        if (normalizedY < bandLevel) {
          color = bandColor * 0.8;
        } else {
          color = vec3<f32>(0.08, 0.08, 0.1);
        }
      }
    }
  }

  return vec4<f32>(color, 1.0);
}

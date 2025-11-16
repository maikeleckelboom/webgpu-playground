// =============================================================================
// WebGPU Deck Waveform Shader
// Renders frequency-colored waveform with center playhead
// =============================================================================

// Shared uniforms from runtime
struct SharedUniforms {
  time: f32,
  deltaTime: f32,
  resolutionX: f32,
  resolutionY: f32,
};

// Waveform-specific uniforms
struct WaveformUniforms {
  // Playhead position (split into high/low for precision)
  playheadSamplesHigh: f32,
  playheadSamplesLow: f32,
  sampleRate: f32,
  totalSamples: f32,

  // Zoom and view
  samplesPerPixel: f32,
  viewWidth: f32,
  viewHeight: f32,
  lodIndex: f32,

  // LOD info
  lodSamplesPerPixel: f32,
  lodLengthInPixels: f32,
  bandCount: f32,
  _padding1: f32,

  // Visual settings
  brightness: f32,
  contrast: f32,
  saturation: f32,
  _padding2: f32,

  // Band gains
  lowGain: f32,
  midGain: f32,
  highGain: f32,
  _padding3: f32,

  // Loop region
  loopActive: f32,
  loopInSample: f32,
  loopOutSample: f32,
  showBeatGrid: f32,

  // Beat grid
  bpm: f32,
  beatPhase: f32,
  _padding4: f32,
  _padding5: f32,
};

// Color scheme for frequency bands
struct BandColors {
  low: vec3<f32>,   // Warm red/orange
  mid: vec3<f32>,   // Green
  high: vec3<f32>,  // Cyan/blue
};

@group(0) @binding(0) var<uniform> shared: SharedUniforms;
@group(1) @binding(0) var<uniform> waveform: WaveformUniforms;
@group(1) @binding(1) var amplitudeTex: texture_2d<f32>;
@group(1) @binding(2) var bandsTex: texture_2d<f32>;
@group(1) @binding(3) var texSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

// Full-screen quad vertex shader
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  // Generate full-screen quad
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

// Reconstruct playhead position from high/low parts
fn getPlayheadSamples() -> f32 {
  return waveform.playheadSamplesHigh * 16777216.0 + waveform.playheadSamplesLow;
}

// Convert screen X position to sample position (playhead centered)
fn screenXToSample(screenX: f32) -> f32 {
  let centerX = waveform.viewWidth * 0.5;
  let offsetPixels = screenX - centerX;
  let offsetSamples = offsetPixels * waveform.samplesPerPixel;
  return getPlayheadSamples() + offsetSamples;
}

// Convert sample position to LOD texture coordinate
fn sampleToLODCoord(samplePos: f32) -> f32 {
  let lodPixel = samplePos / waveform.lodSamplesPerPixel;
  return lodPixel / waveform.lodLengthInPixels;
}

// Sample amplitude from texture (returns min, max)
fn sampleAmplitude(lodCoord: f32) -> vec2<f32> {
  if (lodCoord < 0.0 || lodCoord > 1.0) {
    return vec2<f32>(0.0, 0.0);
  }
  // Texture is 1D (height=1), so Y coordinate should be 0.5 (center of single row)
  let texCoord = vec2<f32>(lodCoord, 0.5);
  let sample = textureSample(amplitudeTex, texSampler, texCoord);
  return vec2<f32>(sample.r, sample.g); // min, max
}

// Sample band energies (low, mid, high)
fn sampleBands(lodCoord: f32) -> vec3<f32> {
  if (lodCoord < 0.0 || lodCoord > 1.0) {
    return vec3<f32>(0.33, 0.33, 0.34); // Return balanced bands for out-of-bounds
  }
  // Texture is 1D (height=1), so Y coordinate should be 0.5 (center of single row)
  let texCoord = vec2<f32>(lodCoord, 0.5);
  let sample = textureSample(bandsTex, texSampler, texCoord);
  return vec3<f32>(sample.r, sample.g, sample.b);
}

// Map band energies to color
fn bandsToColor(bands: vec3<f32>) -> vec3<f32> {
  // Apply gains
  let weightedBands = vec3<f32>(
    bands.x * waveform.lowGain,
    bands.y * waveform.midGain,
    bands.z * waveform.highGain
  );

  // Normalize
  let total = weightedBands.x + weightedBands.y + weightedBands.z + 0.001;
  let normalized = weightedBands / total;

  // Color mapping
  let lowColor = vec3<f32>(1.0, 0.4, 0.2);   // Warm orange-red
  let midColor = vec3<f32>(0.4, 1.0, 0.4);   // Green
  let highColor = vec3<f32>(0.4, 0.8, 1.0);  // Cyan

  var color = lowColor * normalized.x + midColor * normalized.y + highColor * normalized.z;

  // Apply brightness
  color = color * waveform.brightness;

  // Apply contrast
  color = (color - 0.5) * waveform.contrast + 0.5;

  // Apply saturation
  let gray = dot(color, vec3<f32>(0.299, 0.587, 0.114));
  color = mix(vec3<f32>(gray), color, waveform.saturation);

  return clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
}

// Draw beat grid line
fn drawBeatGrid(samplePos: f32) -> f32 {
  if (waveform.showBeatGrid < 0.5) {
    return 0.0;
  }

  let samplesPerBeat = waveform.sampleRate * 60.0 / waveform.bpm;
  let beatPos = samplePos / samplesPerBeat;
  let beatFrac = fract(beatPos);

  // Thin line at each beat
  let lineWidth = 0.01;
  if (beatFrac < lineWidth || beatFrac > (1.0 - lineWidth)) {
    // Check if it's a strong beat (bar line)
    let barPos = beatPos / 4.0;
    let barFrac = fract(barPos);
    if (barFrac < 0.01 || barFrac > 0.99) {
      return 0.8; // Strong line
    }
    return 0.3; // Weak line
  }

  return 0.0;
}

// Draw loop region
fn drawLoopRegion(samplePos: f32) -> f32 {
  if (waveform.loopActive < 0.5) {
    return 0.0;
  }

  if (samplePos >= waveform.loopInSample && samplePos <= waveform.loopOutSample) {
    return 0.15; // Loop region tint
  }

  return 0.0;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let screenX = input.uv.x * waveform.viewWidth;
  let screenY = input.uv.y * waveform.viewHeight;
  let normalizedY = input.uv.y; // 0 at top, 1 at bottom

  // Background gradient (dark blue at top → dark purple at bottom)
  // This is ALWAYS drawn to prove the pipeline is alive
  var color = vec3<f32>(0.05, 0.06, 0.12); // Dark blue
  color = mix(color, vec3<f32>(0.08, 0.04, 0.10), normalizedY); // Dark purple at bottom

  // Draw faint horizontal center line (debug)
  let centerYLine = abs(normalizedY - 0.5);
  if (centerYLine < 0.002) {
    color = mix(color, vec3<f32>(0.2, 0.2, 0.3), 0.5);
  }

  // Draw center playhead FIRST (always visible, even without data)
  let centerPixelX = waveform.viewWidth * 0.5;
  let distFromCenter = abs(screenX - centerPixelX);
  var hasPlayhead = false;
  if (distFromCenter < 2.0) {
    color = vec3<f32>(1.0, 1.0, 1.0);
    hasPlayhead = true;
  } else if (distFromCenter < 4.0) {
    let glowFactor = 1.0 - (distFromCenter - 2.0) / 2.0;
    color = mix(color, vec3<f32>(1.0, 1.0, 1.0), glowFactor * 0.6);
  }

  // Only render waveform if we have valid data
  if (waveform.totalSamples > 0.0 && waveform.lodLengthInPixels > 0.0 && !hasPlayhead) {
    // Get sample position for this screen X
    let samplePos = screenXToSample(screenX);
    let lodCoord = sampleToLODCoord(samplePos);

    // Sample waveform data
    let amplitude = sampleAmplitude(lodCoord);
    let bands = sampleBands(lodCoord);

    // Map amplitude to vertical position
    // Waveform is centered vertically
    let centerY = 0.5;
    let waveformHeight = 0.8; // Use 80% of vertical space

    // FIX: amplitude.x is min (negative extent), amplitude.y is max (positive extent)
    // Both should scale the full waveformHeight
    let minY = centerY - amplitude.y * waveformHeight; // max goes up
    let maxY = centerY + amplitude.x * waveformHeight; // min goes down (but it's stored as positive)

    // Actually, since our test data stores min/max as positive values representing extent:
    // amplitude.x = min extent (how far down from center, as positive number)
    // amplitude.y = max extent (how far up from center)
    // So we need: top of waveform at centerY - amplitude.y * height
    //             bottom of waveform at centerY + amplitude.x * height
    let waveformTopY = centerY - amplitude.y * waveformHeight;
    let waveformBottomY = centerY + amplitude.x * waveformHeight;

    // Check if current pixel is within waveform envelope
    let inWaveform = normalizedY >= waveformTopY && normalizedY <= waveformBottomY;

    if (inWaveform && (amplitude.x > 0.0 || amplitude.y > 0.0)) {
      // Color based on band energies
      let waveColor = bandsToColor(bands);

      // Add edge glow
      let distFromEdge = min(normalizedY - waveformTopY, waveformBottomY - normalizedY);
      let edgeFactor = smoothstep(0.0, 0.02, distFromEdge);

      color = mix(waveColor * 1.5, waveColor, edgeFactor);
    }

    // Draw beat grid
    let gridIntensity = drawBeatGrid(samplePos);
    if (gridIntensity > 0.0) {
      color = mix(color, vec3<f32>(0.5, 0.5, 0.6), gridIntensity);
    }

    // Draw loop region
    let loopIntensity = drawLoopRegion(samplePos);
    if (loopIntensity > 0.0) {
      color = mix(color, vec3<f32>(0.2, 0.8, 0.2), loopIntensity);
    }
  }

  return vec4<f32>(color, 1.0);
}

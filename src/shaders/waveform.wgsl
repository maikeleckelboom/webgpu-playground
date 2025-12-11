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

// DEBUG MODE FLAGS (set to 0u for normal rendering, 1u/2u/3u for debug modes)
// 0u = Normal rendering
// 1u = Show raw amplitude as grayscale
// 2u = Show band energies as RGB (low=R, mid=G, high=B)
// 3u = Show LOD texture coordinate as color gradient
const DEBUG_MODE: u32 = 0u;

@group(0) @binding(0) var<uniform> globalUniforms: SharedUniforms;
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
  let safeViewWidth = max(waveform.viewWidth, 1.0);
  let safeSamplesPerPixel = max(waveform.samplesPerPixel, 1.0);
  let centerX = safeViewWidth * 0.5;
  let offsetPixels = screenX - centerX;
  let offsetSamples = offsetPixels * safeSamplesPerPixel;
  return getPlayheadSamples() + offsetSamples;
}

// Convert sample position to LOD texture coordinate
fn sampleToLODCoord(samplePos: f32) -> f32 {
  let safeLodSamplesPerPixel = max(waveform.lodSamplesPerPixel, 1.0);
  let safeLodLength = max(waveform.lodLengthInPixels, 1.0);
  let lodPixel = samplePos / safeLodSamplesPerPixel;
  return lodPixel / safeLodLength;
}

// Sample amplitude from texture (returns min, max) - FIXED: No branching
fn sampleAmplitude(lodCoord: f32) -> vec2<f32> {
  // Clamp instead of branching - textureSample must be in uniform control flow
  let clamped = clamp(lodCoord, 0.0, 1.0);
  let texCoord = vec2<f32>(clamped, 0.5);
  let texSample = textureSample(amplitudeTex, texSampler, texCoord);
  return vec2<f32>(texSample.r, texSample.g); // min, max
}

// Sample band energies (low, mid, high) - FIXED: No branching
fn sampleBands(lodCoord: f32) -> vec3<f32> {
  // Clamp instead of branching - textureSample must be in uniform control flow
  let clamped = clamp(lodCoord, 0.0, 1.0);
  let texCoord = vec2<f32>(clamped, 0.5);
  let texSample = textureSample(bandsTex, texSampler, texCoord);
  return vec3<f32>(texSample.r, texSample.g, texSample.b);
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
  let normalizedY = input.uv.y; // 0 at top, 1 at bottom

  // =========================================================================
  // UNCONDITIONAL DEBUG RENDERING - ALWAYS VISIBLE
  // These render without ANY dependency on uniform values
  // =========================================================================

  // Background gradient (dark blue at top → dark purple at bottom)
  // This is ALWAYS drawn to prove the pipeline is alive
  var color = vec3<f32>(0.05, 0.06, 0.12); // Dark blue
  color = mix(color, vec3<f32>(0.08, 0.04, 0.10), normalizedY); // Dark purple at bottom

  // Draw faint horizontal center line (debug) - UNCONDITIONALLY
  let centerYLine = abs(normalizedY - 0.5);
  if (centerYLine < 0.003) {
    color = mix(color, vec3<f32>(0.3, 0.3, 0.4), 0.6);
  }

  // Draw bright white center playhead line at UV x = 0.5 - NO UNIFORM DEPENDENCY
  let uvCenterX = input.uv.x - 0.5;
  let playheadWidthUV = 0.003; // 0.3% of screen width
  var hasPlayhead = false;
  if (abs(uvCenterX) < playheadWidthUV) {
    color = vec3<f32>(1.0, 1.0, 1.0); // Bright white center line
    hasPlayhead = true;
  } else if (abs(uvCenterX) < playheadWidthUV * 3.0) {
    let glowFactor = 1.0 - (abs(uvCenterX) - playheadWidthUV) / (playheadWidthUV * 2.0);
    color = mix(color, vec3<f32>(1.0, 1.0, 1.0), glowFactor * 0.5);
  }

  // Safety checks for uniform values - prevent NaN propagation
  let safeViewWidth = max(waveform.viewWidth, 1.0);
  let safeViewHeight = max(waveform.viewHeight, 1.0);
  let screenX = input.uv.x * safeViewWidth;
  let screenY = input.uv.y * safeViewHeight;

  // Only render waveform if we have valid data and valid LOD dimensions
  let safeLodLength = max(waveform.lodLengthInPixels, 1.0);
  let safeSamplesPerPixel = max(waveform.lodSamplesPerPixel, 1.0);

  if (waveform.totalSamples > 0.0 && waveform.lodLengthInPixels > 0.0) {
    // Get sample position for this screen X
    let samplePos = screenXToSample(screenX);
    let lodCoord = sampleToLODCoord(samplePos);

    // Sample waveform data
    let amplitude = sampleAmplitude(lodCoord);
    let bands = sampleBands(lodCoord);

    // =========================================================================
    // DEBUG MODES - Enable by changing DEBUG_MODE constant above
    // =========================================================================
    if (DEBUG_MODE == 1u) {
      // Mode 1: Raw amplitude as grayscale (average of min/max)
      let avgAmp = (amplitude.x + amplitude.y) * 0.5;
      if (!hasPlayhead) {
        color = vec3<f32>(avgAmp, avgAmp, avgAmp);
      }
      return vec4<f32>(color, 1.0);
    } else if (DEBUG_MODE == 2u) {
      // Mode 2: Band energies as RGB (low=R, mid=G, high=B)
      if (!hasPlayhead) {
        color = bands;
      }
      return vec4<f32>(color, 1.0);
    } else if (DEBUG_MODE == 3u) {
      // Mode 3: LOD texture coordinate as color (shows sampling pattern)
      let clampedCoord = clamp(lodCoord, 0.0, 1.0);
      if (!hasPlayhead) {
        color = vec3<f32>(clampedCoord, fract(lodCoord * 10.0), 0.5);
      }
      return vec4<f32>(color, 1.0);
    }

    // Normal rendering mode
    // Map amplitude to vertical position
    // Waveform is centered vertically
    let centerY = 0.5;
    let waveformHeight = 0.4; // Use 40% of canvas height in each direction (80% total)

    // amplitude.x = min extent (how far down from center, as positive number)
    // amplitude.y = max extent (how far up from center)
    let waveformTopY = centerY - amplitude.y * waveformHeight;
    let waveformBottomY = centerY + amplitude.x * waveformHeight;

    // Check if current pixel is within waveform envelope
    let inWaveform = normalizedY >= waveformTopY && normalizedY <= waveformBottomY;

    if (inWaveform && (amplitude.x > 0.01 || amplitude.y > 0.01) && !hasPlayhead) {
      // Color based on band energies
      let waveColor = bandsToColor(bands);

      // Add edge glow
      let distFromEdge = min(normalizedY - waveformTopY, waveformBottomY - normalizedY);
      let edgeFactor = smoothstep(0.0, 0.02, distFromEdge);

      color = mix(waveColor * 1.3, waveColor, edgeFactor);
    }

    // Draw beat grid (behind playhead)
    if (!hasPlayhead) {
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
  }

  return vec4<f32>(color, 1.0);
}

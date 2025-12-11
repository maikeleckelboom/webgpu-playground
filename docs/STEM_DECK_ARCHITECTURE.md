# Stem-Aware Multi-Band Deck HUD Architecture

**Status**: Design Phase
**Target**: Serato-grade+ waveform visualization with stem separation
**Performance Goal**: 60-120 fps, 2-4 decks, zero GC pressure

---

## 1. Data Architecture

### 1.1 Core Types

```typescript
// src/stem-deck/types.ts

/**
 * Stem types following standard demucs/spleeter taxonomy
 */
type StemType = 'drums' | 'bass' | 'vocals' | 'other' | 'master';

/**
 * Extended band configuration - support up to 16 bands
 */
interface MultiBandConfig {
  readonly bandCount: number; // 8 or 16
  readonly sampleRate: number;
  readonly frequencyRanges: readonly FrequencyRange[];
  readonly filterType: 'fft' | 'iir' | 'fir'; // FFT preferred
}

/**
 * Frequency range definition
 */
interface FrequencyRange {
  readonly min: number; // Hz
  readonly max: number; // Hz
  readonly name: string; // "Sub-bass", "Bass", etc.
}

/**
 * Per-stem waveform pyramid
 * Each stem has its own multi-resolution, multi-band representation
 */
interface StemWaveformPyramid {
  readonly stemType: StemType;
  readonly totalSamples: number;
  readonly sampleRate: number;
  readonly bands: MultiBandConfig;
  readonly lods: readonly StemWaveformLOD[];
}

/**
 * Single LOD level for one stem
 */
interface StemWaveformLOD {
  readonly samplesPerPixel: number;
  readonly lengthInPixels: number;

  // Amplitude envelope (min/max pairs)
  readonly amplitude: Float32Array; // [min0, max0, min1, max1, ...]

  // Band energies (interleaved by band)
  // For 8 bands: [b0_0, b1_0, ..., b7_0, b0_1, b1_1, ..., b7_1, ...]
  readonly bandEnergies: Float32Array;

  // RMS energy per window
  readonly rms: Float32Array;

  // Optional: spectral centroid, zero-crossing rate
  readonly spectralCentroid?: Float32Array;
}

/**
 * Complete multi-stem track representation
 */
interface MultiStemTrack {
  readonly id: string;
  readonly totalSamples: number;
  readonly sampleRate: number;
  readonly duration: number; // seconds

  // Per-stem pyramids
  readonly stems: ReadonlyMap<StemType, StemWaveformPyramid>;

  // Master mix (fallback when stems not available)
  readonly master: StemWaveformPyramid;

  // Metadata
  readonly trackTitle: string;
  readonly trackArtist: string;
  readonly trackKey?: string;
  readonly bpm?: number;
}

/**
 * Stem playback state
 */
interface StemState {
  readonly stemType: StemType;
  readonly isSolo: boolean;
  readonly isMuted: boolean;
  readonly gain: number; // 0.0 - 2.0
  readonly visualOpacity: number; // 0.0 - 1.0
  readonly color: { r: number; g: number; b: number }; // Base tint
}

/**
 * Complete deck state with stem awareness
 */
interface StemDeckState extends DeckState {
  readonly stemTrack: MultiStemTrack;
  readonly stemStates: ReadonlyMap<StemType, StemState>;
  readonly activeStemLayout: StemLayoutMode;
  readonly bandCount: number; // 3, 8, or 16
}

/**
 * Stem layout modes
 */
type StemLayoutMode =
  | 'overlay'      // All stems blended in single view
  | 'stacked'      // Vertical lanes per stem
  | 'focus'        // One stem large, others as thin strips
  | 'compare';     // Two decks aligned for beatmatching

/**
 * Stem visual blend modes
 */
type StemBlendMode =
  | 'additive'     // Sum energies
  | 'screen'       // Brighten (like Photoshop screen)
  | 'overlay'      // Preserve highlights
  | 'max';         // Take maximum energy
```

### 1.2 Default Band Configurations

```typescript
// 3-band (existing, legacy)
const BANDS_3: MultiBandConfig = {
  bandCount: 3,
  sampleRate: 44100,
  filterType: 'fft',
  frequencyRanges: [
    { min: 20, max: 250, name: 'Low' },
    { min: 250, max: 4000, name: 'Mid' },
    { min: 4000, max: 20000, name: 'High' }
  ]
};

// 8-band (recommended for stem deck)
const BANDS_8: MultiBandConfig = {
  bandCount: 8,
  sampleRate: 44100,
  filterType: 'fft',
  frequencyRanges: [
    { min: 20, max: 60, name: 'Sub-bass' },
    { min: 60, max: 250, name: 'Bass' },
    { min: 250, max: 500, name: 'Low-mid' },
    { min: 500, max: 2000, name: 'Mid' },
    { min: 2000, max: 4000, name: 'Upper-mid' },
    { min: 4000, max: 6000, name: 'Presence' },
    { min: 6000, max: 12000, name: 'Brilliance' },
    { min: 12000, max: 20000, name: 'Air' }
  ]
};

// 16-band (for spectral detail)
const BANDS_16: MultiBandConfig = {
  bandCount: 16,
  sampleRate: 44100,
  filterType: 'fft',
  // ... logarithmically spaced 20Hz - 20kHz
};
```

---

## 2. GPU Pipeline Architecture

### 2.1 Overall Pipeline Flow

```
┌─────────────────────────────────────────────────────────────┐
│ CPU: Audio File Upload                                       │
│  ↓ Web Audio API decode → Float32 PCM                       │
│  ↓ Optional: External stem files or inline separation       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ CPU → GPU: Upload Raw PCM to Storage Buffers                │
│  - Per-stem PCM data                                         │
│  - Master mix PCM data                                       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ COMPUTE PASS 1: FFT Analysis                                 │
│  Input:  PCM storage buffer                                  │
│  Output: Frequency-domain bins (per window)                  │
│  Shader: fft-analyzer.wgsl                                   │
│  Notes:  - Radix-2 or Radix-4 Cooley-Tukey                  │
│          - Window size: 2048-8192 samples                    │
│          - Overlap: 50-75%                                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ COMPUTE PASS 2: Band Energy Extraction                       │
│  Input:  FFT bins                                            │
│  Output: Band energies per window (8 or 16 bands)           │
│  Shader: band-extractor.wgsl                                 │
│  Notes:  - Sum magnitude per frequency range                │
│          - Apply perceptual weighting (A-weighting)          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ COMPUTE PASS 3: LOD Pyramid Generation                       │
│  Input:  Full-resolution band energies + amplitude           │
│  Output: 7 LOD levels (64, 128, 256, 512, 1024, 2048, 4096) │
│  Shader: lod-pyramid.wgsl                                    │
│  Notes:  - Min/max decimation for amplitude                 │
│          - RMS decimation for bands                          │
│          - Write to texture mipmaps or separate textures     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ GPU Textures (Persistent)                                    │
│  - Per stem × per LOD:                                       │
│    • amplitude_tex (r16float, width × 1)                     │
│    • bands_tex (r16float, width × bandCount)                 │
│  - 4 stems × 7 LODs = 28 amplitude + 28 band textures       │
│  - Total: ~16-24 MB per track                                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ RENDER PASS: Multi-Stem Waveform Composite                  │
│  Input:  - Stem textures (amplitude + bands)                │
│          - Uniform: playhead, zoom, stem states              │
│  Output: Final RGBA framebuffer                              │
│  Shader: stem-waveform.wgsl                                  │
│  Features:                                                   │
│   - Sample from 2-4 stem textures simultaneously             │
│   - Per-stem color/opacity/blend mode                        │
│   - LOD selection + dual-LOD blending                        │
│   - Beat grid overlay                                        │
│   - Cue point markers                                        │
│   - Playhead cursor                                          │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Compute Shader Details

#### 2.2.1 FFT Analyzer (`src/compute/fft-analyzer.wgsl`)

```wgsl
// FFT Analyzer - Radix-2 Cooley-Tukey in-place
@group(0) @binding(0) var<storage, read> pcmInput: array<f32>;
@group(0) @binding(1) var<storage, read_write> fftOutput: array<vec2<f32>>; // Complex

struct FFTParams {
  windowSize: u32,      // 2048, 4096, 8192
  hopSize: u32,         // windowSize / 2 or / 4
  totalWindows: u32,
  sampleRate: f32
}

@group(0) @binding(2) var<uniform> params: FFTParams;

@compute @workgroup_size(256)
fn fft_main(@builtin(global_invocation_id) id: vec3<u32>) {
  let windowIndex = id.x;
  if (windowIndex >= params.totalWindows) { return; }

  let startSample = windowIndex * params.hopSize;

  // Load window with Hann window function
  var samples: array<f32, 8192>; // Max size
  for (var i = 0u; i < params.windowSize; i++) {
    let sample = pcmInput[startSample + i];
    let hannWeight = 0.5 * (1.0 - cos(2.0 * 3.14159 * f32(i) / f32(params.windowSize)));
    samples[i] = sample * hannWeight;
  }

  // In-place FFT (bit-reversal + butterfly stages)
  // ... (radix-2 FFT implementation)

  // Write magnitude spectrum
  let outputOffset = windowIndex * params.windowSize;
  for (var i = 0u; i < params.windowSize / 2u; i++) {
    let real = /* ... */;
    let imag = /* ... */;
    fftOutput[outputOffset + i] = vec2(real, imag);
  }
}
```

**Notes**:
- Use workgroup shared memory for FFT butterfly operations
- Implement as multiple dispatch calls for large tracks
- Consider using WebGPU's upcoming FFT extensions when available

#### 2.2.2 Band Extractor (`src/compute/band-extractor.wgsl`)

```wgsl
@group(0) @binding(0) var<storage, read> fftBins: array<vec2<f32>>;
@group(0) @binding(1) var<storage, write> bandEnergies: array<f32>;

struct BandConfig {
  bandCount: u32,
  windowSize: u32,
  sampleRate: f32,
  totalWindows: u32
}

// Frequency range per band (uploaded as uniform)
struct FreqRange {
  minHz: f32,
  maxHz: f32
}

@group(0) @binding(2) var<uniform> config: BandConfig;
@group(0) @binding(3) var<storage, read> ranges: array<FreqRange, 16>;

@compute @workgroup_size(64)
fn extract_bands(@builtin(global_invocation_id) id: vec3<u32>) {
  let windowIndex = id.x;
  if (windowIndex >= config.totalWindows) { return; }

  let binOffset = windowIndex * config.windowSize / 2u;
  let outputOffset = windowIndex * config.bandCount;

  for (var band = 0u; band < config.bandCount; band++) {
    let minHz = ranges[band].minHz;
    let maxHz = ranges[band].maxHz;

    // Convert Hz to bin indices
    let minBin = u32(minHz * f32(config.windowSize) / config.sampleRate);
    let maxBin = u32(maxHz * f32(config.windowSize) / config.sampleRate);

    // Sum magnitude in range
    var energy = 0.0;
    for (var bin = minBin; bin <= maxBin; bin++) {
      let complex = fftBins[binOffset + bin];
      let magnitude = length(complex);
      energy += magnitude * magnitude; // Power
    }

    // RMS and perceptual weighting
    let binCount = f32(maxBin - minBin + 1u);
    let rms = sqrt(energy / binCount);

    bandEnergies[outputOffset + band] = rms;
  }
}
```

#### 2.2.3 LOD Pyramid Generator (`src/compute/lod-pyramid.wgsl`)

```wgsl
// Generate next LOD level by downsampling 2:1
@group(0) @binding(0) var<storage, read> inputAmplitude: array<f32>;
@group(0) @binding(1) var<storage, write> outputAmplitude: array<f32>;
@group(0) @binding(2) var<storage, read> inputBands: array<f32>;
@group(0) @binding(3) var<storage, write> outputBands: array<f32>;

struct LODParams {
  inputLength: u32,
  outputLength: u32,
  bandCount: u32,
  downsampleFactor: u32  // 2 for each level
}

@group(0) @binding(4) var<uniform> params: LODParams;

@compute @workgroup_size(256)
fn generate_lod(@builtin(global_invocation_id) id: vec3<u32>) {
  let outputIndex = id.x;
  if (outputIndex >= params.outputLength) { return; }

  let startIndex = outputIndex * params.downsampleFactor;
  let endIndex = min(startIndex + params.downsampleFactor, params.inputLength);

  // Amplitude: min/max decimation
  var minVal = 1.0;
  var maxVal = -1.0;
  for (var i = startIndex; i < endIndex; i++) {
    let minSample = inputAmplitude[i * 2u + 0u];
    let maxSample = inputAmplitude[i * 2u + 1u];
    minVal = min(minVal, minSample);
    maxVal = max(maxVal, maxSample);
  }
  outputAmplitude[outputIndex * 2u + 0u] = minVal;
  outputAmplitude[outputIndex * 2u + 1u] = maxVal;

  // Bands: RMS decimation
  for (var band = 0u; band < params.bandCount; band++) {
    var sumSquares = 0.0;
    var count = 0.0;

    for (var i = startIndex; i < endIndex; i++) {
      let energy = inputBands[i * params.bandCount + band];
      sumSquares += energy * energy;
      count += 1.0;
    }

    let rms = sqrt(sumSquares / count);
    outputBands[outputIndex * params.bandCount + band] = rms;
  }
}
```

**Dispatch Pattern**:
```typescript
// Generate LOD1 from LOD0
encoder.dispatchWorkgroups(Math.ceil(lod1Length / 256));

// Generate LOD2 from LOD1
encoder.dispatchWorkgroups(Math.ceil(lod2Length / 256));

// ... repeat for all 7 levels
```

### 2.3 Render Shader Architecture

#### Multi-Stem Fragment Shader (`src/shaders/stem-waveform.wgsl`)

```wgsl
// Uniforms
struct StemWaveformUniforms {
  // Existing fields from deck-waveform-standalone.wgsl
  viewWidth: f32,
  viewHeight: f32,
  playheadSamplesHigh: f32,
  playheadSamplesLow: f32,
  totalSamples: f32,
  sampleRate: f32,
  samplesPerPixel: f32,
  lodBlendFactor: f32,

  // Beat grid
  bpm: f32,
  beatPhaseOffset: f32,
  showBeatGrid: u32,

  // New: Stem controls
  activeStemMask: u32,      // Bitmask: which stems are active
  stemOpacity: array<f32, 4>,    // Per-stem opacity
  stemGain: array<f32, 4>,       // Per-stem gain
  blendMode: u32,           // 0=additive, 1=screen, 2=overlay
  bandCount: u32,           // 3, 8, or 16

  // Layout
  layoutMode: u32,          // 0=overlay, 1=stacked, 2=focus
}

@group(1) @binding(0) var<uniform> uniforms: StemWaveformUniforms;

// Textures per stem (4 stems, 2 LODs each)
@group(1) @binding(1) var drumsAmplitudePrimary: texture_2d<f32>;
@group(1) @binding(2) var drumsAmplitudeSecondary: texture_2d<f32>;
@group(1) @binding(3) var drumsBandsPrimary: texture_2d<f32>;
@group(1) @binding(4) var drumsBandsSecondary: texture_2d<f32>;

@group(1) @binding(5) var bassAmplitudePrimary: texture_2d<f32>;
@group(1) @binding(6) var bassAmplitudeSecondary: texture_2d<f32>;
@group(1) @binding(7) var bassBandsPrimary: texture_2d<f32>;
@group(1) @binding(8) var bassBandsSecondary: texture_2d<f32>;

@group(1) @binding(9) var vocalsAmplitudePrimary: texture_2d<f32>;
@group(1) @binding(10) var vocalsAmplitudeSecondary: texture_2d<f32>;
@group(1) @binding(11) var vocalsBandsPrimary: texture_2d<f32>;
@group(1) @binding(12) var vocalsBandsSecondary: texture_2d<f32>;

@group(1) @binding(13) var otherAmplitudePrimary: texture_2d<f32>;
@group(1) @binding(14) var otherAmplitudeSecondary: texture_2d<f32>;
@group(1) @binding(15) var otherBandsPrimary: texture_2d<f32>;
@group(1) @binding(16) var otherBandsSecondary: texture_2d<f32>;

@group(1) @binding(17) var texSampler: sampler;

// Stem colors (configurable)
const DRUM_COLOR = vec3(1.0, 0.2, 0.2);   // Red
const BASS_COLOR = vec3(0.2, 0.5, 1.0);   // Blue
const VOCAL_COLOR = vec3(1.0, 0.8, 0.2);  // Yellow
const OTHER_COLOR = vec3(0.5, 1.0, 0.5);  // Green

struct StemSample {
  amplitude: vec2<f32>,  // min, max
  bands: array<f32, 16>,  // Up to 16 bands
  energy: f32
}

fn sample_stem(
  ampPrimary: texture_2d<f32>,
  ampSecondary: texture_2d<f32>,
  bandsPrimary: texture_2d<f32>,
  bandsSecondary: texture_2d<f32>,
  texCoord: vec2<f32>
) -> StemSample {
  var result: StemSample;

  // Amplitude (dual-LOD blending)
  let amp1 = textureSample(ampPrimary, texSampler, texCoord).rg;
  let amp2 = textureSample(ampSecondary, texSampler, texCoord).rg;
  result.amplitude = mix(amp1, amp2, uniforms.lodBlendFactor);

  // Bands (up to 16)
  for (var i = 0u; i < uniforms.bandCount; i++) {
    let y = (f32(i) + 0.5) / f32(uniforms.bandCount);
    let bandCoord = vec2(texCoord.x, y);

    let band1 = textureSample(bandsPrimary, texSampler, bandCoord).r;
    let band2 = textureSample(bandsSecondary, texSampler, bandCoord).r;
    result.bands[i] = mix(band1, band2, uniforms.lodBlendFactor);
  }

  // Total energy
  result.energy = max(abs(result.amplitude.x), abs(result.amplitude.y));

  return result;
}

fn blend_stems(
  drum: vec4<f32>,
  bass: vec4<f32>,
  vocal: vec4<f32>,
  other: vec4<f32>,
  mode: u32
) -> vec4<f32> {
  if (mode == 0u) { // Additive
    return drum + bass + vocal + other;
  } else if (mode == 1u) { // Screen
    let inv = (1.0 - drum.a) * (1.0 - bass.a) * (1.0 - vocal.a) * (1.0 - other.a);
    let color = drum.rgb * drum.a + bass.rgb * bass.a + vocal.rgb * vocal.a + other.rgb * other.a;
    return vec4(color, 1.0 - inv);
  } else if (mode == 2u) { // Overlay
    // ... overlay blend math
  } else { // Max
    return max(max(drum, bass), max(vocal, other));
  }
  return vec4(0.0);
}

@fragment
fn fs_main(@location(0) fragUV: vec2<f32>) -> @location(0) vec4<f32> {
  // Calculate sample position (centered playhead)
  let playheadSamples = uniforms.playheadSamplesHigh * 65536.0 + uniforms.playheadSamplesLow;
  let xFromCenter = fragUV.x - 0.5;
  let pixelsFromCenter = xFromCenter * uniforms.viewWidth;
  let sampleOffset = pixelsFromCenter * uniforms.samplesPerPixel;
  let samplePosition = playheadSamples + sampleOffset;

  // Out of bounds check
  if (samplePosition < 0.0 || samplePosition >= uniforms.totalSamples) {
    return vec4(0.0, 0.0, 0.0, 1.0);
  }

  // Texture coordinate
  let texX = samplePosition / uniforms.totalSamples;
  let texCoord = vec2(texX, 0.5);

  // Sample all active stems
  let drumMask = (uniforms.activeStemMask & 1u) != 0u;
  let bassMask = (uniforms.activeStemMask & 2u) != 0u;
  let vocalMask = (uniforms.activeStemMask & 4u) != 0u;
  let otherMask = (uniforms.activeStemMask & 8u) != 0u;

  var drumSample: StemSample;
  var bassSample: StemSample;
  var vocalSample: StemSample;
  var otherSample: StemSample;

  if (drumMask) {
    drumSample = sample_stem(drumsAmplitudePrimary, drumsAmplitudeSecondary,
                              drumsBandsPrimary, drumsBandsSecondary, texCoord);
  }
  if (bassMask) {
    bassSample = sample_stem(bassAmplitudePrimary, bassAmplitudeSecondary,
                              bassBandsPrimary, bassBandsSecondary, texCoord);
  }
  if (vocalMask) {
    vocalSample = sample_stem(vocalsAmplitudePrimary, vocalsAmplitudeSecondary,
                               vocalsBandsPrimary, vocalsBandsSecondary, texCoord);
  }
  if (otherMask) {
    otherSample = sample_stem(otherAmplitudePrimary, otherAmplitudeSecondary,
                               otherBandsPrimary, otherBandsSecondary, texCoord);
  }

  // Compute waveform shape for each stem
  let yCenter = 0.5;
  let waveformHeight = 0.4; // Total height for waveforms

  var drumColor = vec4(0.0);
  var bassColor = vec4(0.0);
  var vocalColor = vec4(0.0);
  var otherColor = vec4(0.0);

  if (drumMask) {
    let drumShape = compute_waveform_shape(drumSample, fragUV.y, yCenter, waveformHeight);
    let drumTint = color_from_bands(drumSample.bands, DRUM_COLOR);
    drumColor = vec4(drumTint, drumShape) * uniforms.stemOpacity[0];
  }

  if (bassMask) {
    let bassShape = compute_waveform_shape(bassSample, fragUV.y, yCenter, waveformHeight);
    let bassTint = color_from_bands(bassSample.bands, BASS_COLOR);
    bassColor = vec4(bassTint, bassShape) * uniforms.stemOpacity[1];
  }

  if (vocalMask) {
    let vocalShape = compute_waveform_shape(vocalSample, fragUV.y, yCenter, waveformHeight);
    let vocalTint = color_from_bands(vocalSample.bands, VOCAL_COLOR);
    vocalColor = vec4(vocalTint, vocalShape) * uniforms.stemOpacity[2];
  }

  if (otherMask) {
    let otherShape = compute_waveform_shape(otherSample, fragUV.y, yCenter, waveformHeight);
    let otherTint = color_from_bands(otherSample.bands, OTHER_COLOR);
    otherColor = vec4(otherTint, otherShape) * uniforms.stemOpacity[3];
  }

  // Blend stems
  var finalColor = blend_stems(drumColor, bassColor, vocalColor, otherColor, uniforms.blendMode);

  // Beat grid overlay
  if (uniforms.showBeatGrid != 0u) {
    let beatGrid = render_beat_grid(samplePosition);
    finalColor = mix(finalColor, vec4(1.0), beatGrid);
  }

  // Playhead cursor
  let playheadDist = abs(fragUV.x - 0.5);
  let playheadLine = smoothstep(0.002, 0.0, playheadDist);
  finalColor = mix(finalColor, vec4(1.0, 0.0, 0.0, 1.0), playheadLine * 0.8);

  return finalColor;
}

fn compute_waveform_shape(
  sample: StemSample,
  y: f32,
  yCenter: f32,
  height: f32
) -> f32 {
  let minY = yCenter + sample.amplitude.x * height;
  let maxY = yCenter + sample.amplitude.y * height;

  // Vertical distance from waveform envelope
  let distToWave = min(abs(y - minY), abs(y - maxY));

  // Anti-aliased edge
  let edgeWidth = 1.0 / uniforms.viewHeight;
  return smoothstep(edgeWidth, 0.0, distToWave);
}

fn color_from_bands(bands: array<f32, 16>, baseColor: vec3<f32>) -> vec3<f32> {
  // For 8-band system
  if (uniforms.bandCount == 8u) {
    let lowSum = bands[0] + bands[1];
    let midSum = bands[2] + bands[3] + bands[4];
    let highSum = bands[5] + bands[6] + bands[7];

    let total = lowSum + midSum + highSum + 0.001;
    let weights = vec3(lowSum, midSum, highSum) / total;

    let lowColor = vec3(1.0, 0.2, 0.2);
    let midColor = vec3(0.2, 1.0, 0.2);
    let highColor = vec3(0.2, 0.2, 1.0);

    let bandColor = lowColor * weights.x + midColor * weights.y + highColor * weights.z;
    return mix(baseColor, bandColor, 0.5); // Blend with stem base color
  }

  // Fallback: use base color
  return baseColor;
}

fn render_beat_grid(samplePosition: f32) -> f32 {
  let samplesPerBeat = (uniforms.sampleRate * 60.0) / uniforms.bpm;
  let beatSamplePosition = samplePosition + uniforms.beatPhaseOffset * samplesPerBeat;
  let beatPhase = fract(beatSamplePosition / samplesPerBeat);

  let beatDist = min(beatPhase, 1.0 - beatPhase) * samplesPerBeat;
  let beatDistPixels = beatDist / uniforms.samplesPerPixel;

  return smoothstep(2.0, 0.0, beatDistPixels) * 0.3;
}
```

---

## 3. Stem Management System

### 3.1 Stem Loader (`src/stem-deck/stem-loader.ts`)

```typescript
/**
 * Load and manage stem audio files
 */
export class StemLoader {
  private audioContext: AudioContext;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
  }

  /**
   * Load a multi-stem track from separate files
   */
  async loadFromFiles(files: {
    drums?: File;
    bass?: File;
    vocals?: File;
    other?: File;
    master: File;
  }): Promise<Map<StemType, AudioBuffer>> {
    const stems = new Map<StemType, AudioBuffer>();

    for (const [stemType, file] of Object.entries(files)) {
      if (file) {
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        stems.set(stemType as StemType, audioBuffer);
      }
    }

    return stems;
  }

  /**
   * Load stems from a directory (e.g., Spleeter output)
   */
  async loadFromDirectory(directory: FileSystemDirectoryHandle): Promise<Map<StemType, AudioBuffer>> {
    const stemFiles: Record<string, File> = {};

    for await (const entry of directory.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        const name = entry.name.toLowerCase();

        if (name.includes('drums')) stemFiles.drums = file;
        else if (name.includes('bass')) stemFiles.bass = file;
        else if (name.includes('vocals')) stemFiles.vocals = file;
        else if (name.includes('other')) stemFiles.other = file;
      }
    }

    return this.loadFromFiles(stemFiles);
  }

  /**
   * Inline stem separation using ML (future)
   * Requires ONNX Runtime or TensorFlow.js with Demucs/Spleeter model
   */
  async separateInline(masterAudio: AudioBuffer): Promise<Map<StemType, AudioBuffer>> {
    throw new Error('Inline separation not implemented yet. Use external tools like Spleeter/Demucs.');
  }
}
```

### 3.2 Multi-Band Analyzer (`src/stem-deck/multi-band-analyzer.ts`)

```typescript
/**
 * GPU-accelerated multi-band analysis
 */
export class MultiBandAnalyzer {
  private device: GPUDevice;
  private fftPipeline: GPUComputePipeline;
  private bandExtractorPipeline: GPUComputePipeline;
  private lodPyramidPipeline: GPUComputePipeline;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  async initialize(): Promise<void> {
    // Load and compile compute shaders
    this.fftPipeline = await this.createFFTPipeline();
    this.bandExtractorPipeline = await this.createBandExtractorPipeline();
    this.lodPyramidPipeline = await this.createLODPyramidPipeline();
  }

  /**
   * Analyze audio buffer and generate multi-band pyramid
   */
  async analyze(
    audioBuffer: AudioBuffer,
    bandConfig: MultiBandConfig
  ): Promise<StemWaveformPyramid> {
    const pcmData = extractMonoChannel(audioBuffer);
    const sampleRate = audioBuffer.sampleRate;

    // 1. Upload PCM to GPU
    const pcmBuffer = this.device.createBuffer({
      size: pcmData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(pcmBuffer, 0, pcmData);

    // 2. Run FFT analysis
    const fftOutput = await this.runFFT(pcmBuffer, sampleRate);

    // 3. Extract band energies
    const bandEnergies = await this.extractBands(fftOutput, bandConfig);

    // 4. Generate amplitude envelope
    const amplitudeEnvelope = await this.extractAmplitude(pcmBuffer, sampleRate);

    // 5. Build LOD pyramid
    const lods = await this.buildLODPyramid(amplitudeEnvelope, bandEnergies, bandConfig);

    return {
      stemType: 'master',
      totalSamples: pcmData.length,
      sampleRate,
      bands: bandConfig,
      lods
    };
  }

  private async runFFT(
    pcmBuffer: GPUBuffer,
    sampleRate: number
  ): Promise<GPUBuffer> {
    // ... compute pass implementation
  }

  private async extractBands(
    fftBuffer: GPUBuffer,
    bandConfig: MultiBandConfig
  ): Promise<Float32Array> {
    // ... compute pass implementation
  }

  private async buildLODPyramid(
    amplitude: Float32Array,
    bands: Float32Array,
    config: MultiBandConfig
  ): Promise<readonly StemWaveformLOD[]> {
    const lodLevels = [64, 128, 256, 512, 1024, 2048, 4096];
    const lods: StemWaveformLOD[] = [];

    for (const samplesPerPixel of lodLevels) {
      const lod = await this.generateLOD(amplitude, bands, samplesPerPixel, config);
      lods.push(lod);
    }

    return lods;
  }

  private async generateLOD(
    amplitude: Float32Array,
    bands: Float32Array,
    samplesPerPixel: number,
    config: MultiBandConfig
  ): Promise<StemWaveformLOD> {
    // ... GPU-accelerated downsampling
  }
}
```

---

## 4. Performance Optimization Strategy

### 4.1 Zero-GC Path

**Critical Requirements**:
1. **No per-frame allocations** in update/encode loops
2. **Reuse buffers** for uniform updates
3. **Object pooling** for temporary structures
4. **Typed arrays only** on hot path

**Implementation Pattern**:
```typescript
class StemWaveformComponent {
  // Pre-allocated buffers (never reallocate)
  private uniformData: Float32Array;
  private uniformBuffer: GPUBuffer;

  // Reusable state
  private cachedLODIndices: { primary: number; secondary: number };
  private cachedBlendFactor: number;

  update(dt: number, time: number, state: StemDeckState): void {
    // ✅ No allocations
    this.uniformData[0] = this.viewWidth;
    this.uniformData[1] = this.viewHeight;

    // ✅ Reuse cached values
    const lodBlend = this.calculateLODBlend(state.transport.playheadSamples);
    this.uniformData[7] = lodBlend.blendFactor;

    // ✅ Write directly to GPU
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
  }

  encode(encoder: GPUCommandEncoder, view: GPUTextureView): void {
    // ✅ No temporary objects
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ /* ... */ }]
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.sharedBindGroup);
    pass.setBindGroup(1, this.componentBindGroup);
    pass.draw(3, 1, 0, 0); // Fullscreen triangle
    pass.end();
  }
}
```

### 4.2 GPU Budget

**Per-deck target**: < 2ms GPU time

**Budget breakdown**:
- **Compute passes**: 0.5 ms (only on waveform change, not per-frame)
- **Render pass**: 1.5 ms
  - Texture sampling: 0.8 ms (8 textures × 2 LODs = 16 samples per pixel)
  - Fragment shader math: 0.5 ms
  - Blending & composition: 0.2 ms

**Optimization tactics**:
1. **Use r16float** instead of r32float (50% memory bandwidth savings)
2. **Texture compression**: BC6H for amplitude/band textures (4:1 compression)
3. **Workgroup optimization**: 256 threads per group (optimal for most GPUs)
4. **Early depth test**: Discard fragments outside waveform bounds early

### 4.3 Multi-Deck Rendering

**Parallel encoding**:
```typescript
function renderMultiDeck(decks: StemDeckState[]): void {
  const encoder = device.createCommandEncoder();

  // Encode all decks in single command buffer
  for (let i = 0; i < decks.length; i++) {
    const viewport = calculateViewport(i, decks.length);
    deckComponents[i].encode(encoder, outputView, viewport);
  }

  device.queue.submit([encoder.finish()]);
}
```

**Viewport layout** (2-deck example):
```
┌─────────────────────────────────────┐
│ Deck A Waveform (full width, 40%)  │
├─────────────────────────────────────┤
│ Deck B Waveform (full width, 40%)  │
├─────────────────────────────────────┤
│ Meters, Controls, etc. (20%)       │
└─────────────────────────────────────┘
```

---

## 5. Interaction Model

### 5.1 Mouse/Touch Event Mapping

```typescript
interface WaveformInteraction {
  onSeek(samplePosition: number): void;
  onScrub(delta: number, fine: boolean): void;
  onZoom(factor: number, pivot: number): void;
  onPlaceCue(samplePosition: number, type: CueType): void;
  onDragCue(cueId: string, newPosition: number): void;
  onToggleStem(stemType: StemType): void;
  onSoloStem(stemType: StemType): void;
}

class StemWaveformInteractionHandler {
  private canvas: HTMLCanvasElement;
  private state: StemDeckState;

  constructor(canvas: HTMLCanvasElement, state: StemDeckState) {
    this.canvas = canvas;
    this.state = state;

    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    this.canvas.addEventListener('click', this.handleClick.bind(this));
    this.canvas.addEventListener('wheel', this.handleWheel.bind(this));
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('contextmenu', this.handleContextMenu.bind(this));
  }

  private handleClick(e: MouseEvent): void {
    const samplePosition = this.screenXToSample(e.clientX);

    if (e.shiftKey) {
      // Shift+click: place cue point
      this.callbacks.onPlaceCue(samplePosition, 'hot');
    } else {
      // Normal click: seek
      this.callbacks.onSeek(samplePosition);
    }
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();

    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    const pivotSample = this.screenXToSample(e.clientX);

    this.callbacks.onZoom(zoomDelta, pivotSample);
  }

  private handleMouseDown(e: MouseEvent): void {
    if (e.button === 0) { // Left button
      const startX = e.clientX;
      const startSample = this.state.transport.playheadSamples;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaSamples = deltaX * this.state.samplesPerPixel;

        if (moveEvent.altKey) {
          // Fine scrubbing: 10x slower
          this.callbacks.onScrub(deltaSamples / 10, true);
        } else {
          this.callbacks.onScrub(deltaSamples, false);
        }
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
  }

  private screenXToSample(screenX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const normalizedX = (screenX - rect.left) / rect.width; // [0, 1]
    const xFromCenter = normalizedX - 0.5; // [-0.5, 0.5]
    const pixelsFromCenter = xFromCenter * rect.width;
    const sampleOffset = pixelsFromCenter * this.state.samplesPerPixel;

    return this.state.transport.playheadSamples + sampleOffset;
  }
}
```

### 5.2 Keyboard Shortcuts

```typescript
const SHORTCUTS: Record<string, () => void> = {
  'Space': () => togglePlayPause(),
  'ArrowLeft': () => nudgePlayhead(-1, 'beat'),
  'ArrowRight': () => nudgePlayhead(1, 'beat'),
  'Shift+ArrowLeft': () => nudgePlayhead(-1, 'bar'),
  'Shift+ArrowRight': () => nudgePlayhead(1, 'bar'),
  'Cmd+ArrowLeft': () => jumpToStart(),
  'Cmd+ArrowRight': () => jumpToEnd(),

  // Stem controls
  '1': () => toggleStem('drums'),
  '2': () => toggleStem('bass'),
  '3': () => toggleStem('vocals'),
  '4': () => toggleStem('other'),
  'Shift+1': () => soloStem('drums'),

  // Zoom
  '+': () => zoomIn(),
  '-': () => zoomOut(),
  '0': () => resetZoom(),

  // Cues
  'c': () => placeCueAtPlayhead('hot'),
  'l': () => setLoopIn(),
  'Shift+L': () => setLoopOut(),
};
```

---

## 6. Migration Path from Existing Code

### Phase 1: Extend Existing Components (Week 1)
1. ✅ Add 8-band support to `MultiBandConfig`
2. ✅ Update `test-data.ts` to generate 8-band mock data
3. ✅ Extend shader uniforms for dynamic band count
4. ✅ Test with existing `DeckWaveformComponent`

### Phase 2: Add Compute Shaders (Week 2)
1. ✅ Implement `fft-analyzer.wgsl`
2. ✅ Implement `band-extractor.wgsl`
3. ✅ Implement `lod-pyramid.wgsl`
4. ✅ Integrate with `MultiBandAnalyzer`

### Phase 3: Stem Infrastructure (Week 3)
1. ✅ Create `StemLoader` class
2. ✅ Extend data model for per-stem pyramids
3. ✅ Create multi-stem GPU resource manager
4. ✅ Test with externally separated stems

### Phase 4: Stem Rendering (Week 4)
1. ✅ Implement `stem-waveform.wgsl`
2. ✅ Create `StemWaveformComponent`
3. ✅ Add stem control UI
4. ✅ Implement blend modes

### Phase 5: Polish & Optimize (Week 5)
1. ✅ Beat detection integration
2. ✅ Cue point rendering
3. ✅ Multi-deck layout
4. ✅ Performance profiling to 120fps

---

## 7. Testing Strategy

### 7.1 Unit Tests
- FFT accuracy (compare against reference implementation)
- Band extraction (verify frequency ranges)
- LOD pyramid integrity (no data loss)

### 7.2 Visual Tests
- Screenshot diffs for waveform rendering
- LOD transition smoothness (no popping)
- Stem blending correctness

### 7.3 Performance Tests
- GPU frame time < 2ms per deck
- Zero GC during 60s playback
- 4-deck stress test at 120fps

### 7.4 Integration Tests
- External stem files (Spleeter/Demucs output)
- Various audio formats (MP3, WAV, FLAC)
- Long tracks (>10 minutes)

---

## 8. Future Extensions

### 8.1 Advanced Visuals
- **Spectral landscape**: 3D heightfield showing frequency × time × energy
- **Harmonic mixing hints**: Visual cues for compatible keys
- **Energy prediction**: ML model predicting drop/breakdown locations

### 8.2 Performance Features
- **Auto-cue detection**: Mark beats, drops, vocals-in using ML
- **BPM sync hints**: Visual alignment guides for beatmatching
- **Loop suggestions**: Auto-detect loop-compatible regions

### 8.3 Export Capabilities
- **Waveform image export** (PNG/SVG)
- **Session recording** (waveform + mix video)
- **Stem re-export** with applied EQ/effects

---

## Conclusion

This architecture builds on the **excellent existing foundation** while adding:

1. ✅ **Real FFT analysis** via GPU compute shaders
2. ✅ **Stem-aware infrastructure** with per-stem pyramids
3. ✅ **Multi-stem rendering** with configurable blending
4. ✅ **8-16 band support** for richer frequency visualization
5. ✅ **Performance optimization** for 120fps multi-deck rendering

**Key strengths**:
- Reuses existing LOD system, component architecture, and GPU runtime
- Modular design: each phase can ship independently
- Zero breaking changes to existing components
- Performance-first with zero-GC guarantees

**Next step**: Implement Phase 1 (8-band support) to validate the architecture before moving to compute shaders.

Ready to build when you are. 🎚️

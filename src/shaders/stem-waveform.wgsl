// =============================================================================
// Multi-Stem Waveform Compositor Shader
// Renders 1-4 stems (drums/bass/vocals/other) with 8-16 frequency bands each
// Supports multiple blend modes and per-stem control
// Based on deck-waveform-standalone.wgsl with multi-stem extension
// =============================================================================

// =============================================================================
// Uniforms
// =============================================================================

struct StemWaveUniforms {
    // View dimensions
    viewWidth: f32,
    viewHeight: f32,

    // Playhead (high-precision split)
    playheadSamplesHigh: f32,
    playheadSamplesLow: f32,

    // Audio metadata
    sampleRate: f32,
    totalSamples: f32,

    // Zoom and LOD
    samplesPerPixel: f32,
    lodLengthInPixels: f32,
    lodBlendFactor: f32,
    secondarySamplesPerPixel: f32,
    secondaryLodLengthInPixels: f32,

    // Band configuration
    bandCount: u32,  // 3, 8, or 16

    // Waveform geometry
    waveformCenterY: f32,
    waveformMaxHeight: f32,

    // Stem control (bitmask and gains)
    activeStemMask: u32,  // Bit 0=drums, 1=bass, 2=vocals, 3=other
    drumGain: f32,
    bassGain: f32,
    vocalGain: f32,
    otherGain: f32,
    drumOpacity: f32,
    bassOpacity: f32,
    vocalOpacity: f32,
    otherOpacity: f32,

    // Visual controls
    brightness: f32,
    contrast: f32,
    saturation: f32,

    // Layout and blend mode
    layoutMode: u32,    // 0=overlay, 1=stacked, 2=focus, 3=compare
    blendMode: u32,     // 0=additive, 1=screen, 2=overlay, 3=max

    // Beat grid
    bpm: f32,
    beatPhaseOffset: f32,
    showBeatGrid: u32,

    // Misc
    time: f32,
}

@group(0) @binding(0) var<uniform> uniforms: StemWaveUniforms;

// Texture bindings (4 stems × 2 LODs × 2 textures each = 16 bindings)
// Drums
@group(0) @binding(1) var drumsAmplitudePrimary: texture_2d<f32>;
@group(0) @binding(2) var drumsBandsPrimary: texture_2d<f32>;
@group(0) @binding(3) var drumsAmplitudeSecondary: texture_2d<f32>;
@group(0) @binding(4) var drumsBandsSecondary: texture_2d<f32>;

// Bass
@group(0) @binding(5) var bassAmplitudePrimary: texture_2d<f32>;
@group(0) @binding(6) var bassBandsPrimary: texture_2d<f32>;
@group(0) @binding(7) var bassAmplitudeSecondary: texture_2d<f32>;
@group(0) @binding(8) var bassBandsSecondary: texture_2d<f32>;

// Vocals
@group(0) @binding(9) var vocalsAmplitudePrimary: texture_2d<f32>;
@group(0) @binding(10) var vocalsBandsPrimary: texture_2d<f32>;
@group(0) @binding(11) var vocalsAmplitudeSecondary: texture_2d<f32>;
@group(0) @binding(12) var vocalsBandsSecondary: texture_2d<f32>;

// Other
@group(0) @binding(13) var otherAmplitudePrimary: texture_2d<f32>;
@group(0) @binding(14) var otherBandsPrimary: texture_2d<f32>;
@group(0) @binding(15) var otherAmplitudeSecondary: texture_2d<f32>;
@group(0) @binding(16) var otherBandsSecondary: texture_2d<f32>;

// Sampler
@group(0) @binding(17) var texSampler: sampler;

// =============================================================================
// Data Structures
// =============================================================================

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

// Per-stem sample data (support up to 16 bands)
struct StemSample {
    amplitude: f32,
    bands: array<f32, 16>,  // Max 16 bands
}

// Stem colors (configurable base tints)
const DRUM_COLOR = vec3<f32>(1.0, 0.2, 0.2);   // Red
const BASS_COLOR = vec3<f32>(0.2, 0.5, 1.0);   // Blue
const VOCAL_COLOR = vec3<f32>(1.0, 0.8, 0.2);  // Yellow
const OTHER_COLOR = vec3<f32>(0.5, 1.0, 0.5);  // Green

// =============================================================================
// Vertex Shader - Fullscreen Triangle
// =============================================================================

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var out: VertexOutput;

    let x = f32((vertexIndex << 1u) & 2u);
    let y = f32(vertexIndex & 2u);

    out.position = vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2<f32>(x, 1.0 - y);

    return out;
}

// =============================================================================
// Utility Functions
// =============================================================================

fn reconstruct_playhead() -> f32 {
    let splitFactor = 65536.0;
    return uniforms.playheadSamplesHigh * splitFactor + uniforms.playheadSamplesLow;
}

// Check if a stem is active
fn is_stem_active(stemIndex: u32) -> bool {
    return (uniforms.activeStemMask & (1u << stemIndex)) != 0u;
}

// =============================================================================
// Stem Sampling Functions
// =============================================================================

// Sample a single stem at a sample position (with dual-LOD blending)
fn sample_stem(
    ampPrimary: texture_2d<f32>,
    bandsPrimary: texture_2d<f32>,
    ampSecondary: texture_2d<f32>,
    bandsSecondary: texture_2d<f32>,
    samplePosition: f32
) -> StemSample {
    var result: StemSample;

    // Calculate texture coordinate
    let pixelIndexFloat = samplePosition / uniforms.samplesPerPixel;
    let texCoordX = clamp(pixelIndexFloat / uniforms.lodLengthInPixels, 0.0, 1.0);

    // Sample primary LOD amplitude
    let amp1 = textureSample(ampPrimary, texSampler, vec2<f32>(texCoordX, 0.5)).r;

    // Sample secondary LOD amplitude (if blending)
    var amp2 = amp1;
    if (uniforms.lodBlendFactor > 0.001) {
        let secondaryPixel = samplePosition / uniforms.secondarySamplesPerPixel;
        let secondaryX = clamp(secondaryPixel / uniforms.secondaryLodLengthInPixels, 0.0, 1.0);
        amp2 = textureSample(ampSecondary, texSampler, vec2<f32>(secondaryX, 0.5)).r;
    }

    result.amplitude = mix(amp1, amp2, uniforms.lodBlendFactor);

    // Sample bands (support 3, 8, or 16 bands)
    let bandTexHeight = f32(uniforms.bandCount);
    for (var i = 0u; i < uniforms.bandCount; i++) {
        let y = (f32(i) + 0.5) / bandTexHeight;
        let bandCoord = vec2<f32>(texCoordX, y);

        let band1 = textureSample(bandsPrimary, texSampler, bandCoord).r;

        var band2 = band1;
        if (uniforms.lodBlendFactor > 0.001) {
            let secondaryPixel = samplePosition / uniforms.secondarySamplesPerPixel;
            let secondaryX = clamp(secondaryPixel / uniforms.secondaryLodLengthInPixels, 0.0, 1.0);
            let secondaryCoord = vec2<f32>(secondaryX, y);
            band2 = textureSample(bandsSecondary, texSampler, secondaryCoord).r;
        }

        result.bands[i] = mix(band1, band2, uniforms.lodBlendFactor);
    }

    return result;
}

// Sample all active stems
fn sample_all_stems(samplePosition: f32) -> array<StemSample, 4> {
    var stems: array<StemSample, 4>;

    // Drums (index 0)
    if (is_stem_active(0u)) {
        stems[0] = sample_stem(
            drumsAmplitudePrimary, drumsBandsPrimary,
            drumsAmplitudeSecondary, drumsBandsSecondary,
            samplePosition
        );
    }

    // Bass (index 1)
    if (is_stem_active(1u)) {
        stems[1] = sample_stem(
            bassAmplitudePrimary, bassBandsPrimary,
            bassAmplitudeSecondary, bassBandsSecondary,
            samplePosition
        );
    }

    // Vocals (index 2)
    if (is_stem_active(2u)) {
        stems[2] = sample_stem(
            vocalsAmplitudePrimary, vocalsBandsPrimary,
            vocalsAmplitudeSecondary, vocalsBandsSecondary,
            samplePosition
        );
    }

    // Other (index 3)
    if (is_stem_active(3u)) {
        stems[3] = sample_stem(
            otherAmplitudePrimary, otherBandsPrimary,
            otherAmplitudeSecondary, otherBandsSecondary,
            samplePosition
        );
    }

    return stems;
}

// =============================================================================
// Color Mapping (Multi-Band)
// =============================================================================

// Map 3-band (legacy compatibility)
fn color_from_3_bands(bands: array<f32, 16>) -> vec3<f32> {
    let lowColor = vec3<f32>(0.98, 0.22, 0.12);
    let midColor = vec3<f32>(0.12, 0.92, 0.32);
    let highColor = vec3<f32>(0.15, 0.58, 0.98);

    let b = vec3<f32>(
        pow(bands[0], 3.0),
        pow(bands[1], 3.0),
        pow(bands[2], 3.0)
    );

    let sum = max(b.x + b.y + b.z, 1e-4);
    let weights = b / sum;

    return lowColor * weights.x + midColor * weights.y + highColor * weights.z;
}

// Map 8-band to color
fn color_from_8_bands(bands: array<f32, 16>) -> vec3<f32> {
    // Group into low (0-1), mid (2-5), high (6-7)
    let lowSum = bands[0] + bands[1];
    let midSum = bands[2] + bands[3] + bands[4] + bands[5];
    let highSum = bands[6] + bands[7];

    let total = lowSum + midSum + highSum + 0.001;
    let weights = vec3<f32>(lowSum, midSum, highSum) / total;

    let lowColor = vec3<f32>(0.98, 0.22, 0.12);   // Red/orange
    let midColor = vec3<f32>(0.12, 0.92, 0.32);   // Green
    let highColor = vec3<f32>(0.15, 0.58, 0.98);  // Blue

    return lowColor * weights.x + midColor * weights.y + highColor * weights.z;
}

// Map 16-band to color (more granular)
fn color_from_16_bands(bands: array<f32, 16>) -> vec3<f32> {
    // Group into low (0-3), mid (4-11), high (12-15)
    var lowSum = 0.0;
    var midSum = 0.0;
    var highSum = 0.0;

    for (var i = 0u; i < 4u; i++) { lowSum += bands[i]; }
    for (var i = 4u; i < 12u; i++) { midSum += bands[i]; }
    for (var i = 12u; i < 16u; i++) { highSum += bands[i]; }

    let total = lowSum + midSum + highSum + 0.001;
    let weights = vec3<f32>(lowSum, midSum, highSum) / total;

    let lowColor = vec3<f32>(0.98, 0.22, 0.12);
    let midColor = vec3<f32>(0.12, 0.92, 0.32);
    let highColor = vec3<f32>(0.15, 0.58, 0.98);

    return lowColor * weights.x + midColor * weights.y + highColor * weights.z;
}

// Dynamic color mapping based on band count
fn color_from_bands(bands: array<f32, 16>, baseColor: vec3<f32>) -> vec3<f32> {
    var bandColor: vec3<f32>;

    if (uniforms.bandCount <= 3u) {
        bandColor = color_from_3_bands(bands);
    } else if (uniforms.bandCount <= 8u) {
        bandColor = color_from_8_bands(bands);
    } else {
        bandColor = color_from_16_bands(bands);
    }

    // Blend with stem base color
    return mix(baseColor, bandColor, 0.5);
}

// =============================================================================
// Stem Blending Modes
// =============================================================================

fn blend_additive(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
    return vec4<f32>(a.rgb + b.rgb, max(a.a, b.a));
}

fn blend_screen(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
    let inv = (1.0 - a.a) * (1.0 - b.a);
    let color = a.rgb * a.a + b.rgb * b.a;
    return vec4<f32>(color, 1.0 - inv);
}

fn blend_overlay(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
    var result = a;
    for (var i = 0; i < 3; i++) {
        if (a[i] < 0.5) {
            result[i] = 2.0 * a[i] * b[i];
        } else {
            result[i] = 1.0 - 2.0 * (1.0 - a[i]) * (1.0 - b[i]);
        }
    }
    result.a = max(a.a, b.a);
    return result;
}

fn blend_max(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
    return max(a, b);
}

fn blend_stems(stem1: vec4<f32>, stem2: vec4<f32>, stem3: vec4<f32>, stem4: vec4<f32>) -> vec4<f32> {
    var result = stem1;

    if (uniforms.blendMode == 0u) { // Additive
        result = blend_additive(result, stem2);
        result = blend_additive(result, stem3);
        result = blend_additive(result, stem4);
    } else if (uniforms.blendMode == 1u) { // Screen
        result = blend_screen(result, stem2);
        result = blend_screen(result, stem3);
        result = blend_screen(result, stem4);
    } else if (uniforms.blendMode == 2u) { // Overlay
        result = blend_overlay(result, stem2);
        result = blend_overlay(result, stem3);
        result = blend_overlay(result, stem4);
    } else { // Max
        result = blend_max(result, stem2);
        result = blend_max(result, stem3);
        result = blend_max(result, stem4);
    }

    return result;
}

// =============================================================================
// Waveform Rendering
// =============================================================================

fn compute_brightness(amplitude: f32) -> f32 {
    let gamma = 0.55;
    let brightness = pow(clamp(amplitude, 0.0, 1.0), gamma);
    let minBrightness = 0.12;
    return mix(minBrightness, 1.0, brightness);
}

fn render_stem_waveform(
    sample: StemSample,
    dy: f32,
    stemColor: vec3<f32>,
    gain: f32,
    opacity: f32,
    columnMask: f32
) -> vec4<f32> {
    let amplitude = sample.amplitude * gain;
    let maxHeight = uniforms.waveformMaxHeight;

    // Waveform envelope
    let columnHeight = amplitude * maxHeight;

    // Anti-aliasing
    let pixelSize = 1.0 / uniforms.viewHeight;
    let aaWidth = pixelSize * 1.2;
    let edgeFactor = smoothstep(columnHeight + aaWidth, columnHeight - aaWidth, dy);

    // Apply column mask for discrete bars
    let shapedEdge = edgeFactor * columnMask;

    // Color from bands
    let bandColor = color_from_bands(sample.bands, stemColor);
    let brightness = compute_brightness(amplitude);

    // Vertical gradient
    let verticalPosition = dy / maxHeight;
    let verticalGradient = 1.0 - verticalPosition * 0.3;

    // Final color
    let finalColor = bandColor * brightness * verticalGradient * uniforms.brightness;

    return vec4<f32>(finalColor, shapedEdge * opacity);
}

// =============================================================================
// Beat Grid
// =============================================================================

fn render_beat_grid(samplePosition: f32, backgroundColor: vec3<f32>) -> vec3<f32> {
    if (uniforms.showBeatGrid == 0u) {
        return vec3<f32>(0.0);
    }

    let samplesPerBeat = (uniforms.sampleRate * 60.0) / uniforms.bpm;
    let beatSamplePosition = samplePosition + uniforms.beatPhaseOffset * samplesPerBeat;
    let beatPhase = fract(beatSamplePosition / samplesPerBeat);

    let beatDistance = abs(beatPhase - 0.5);
    let barPhase = fract(beatSamplePosition / (samplesPerBeat * 4.0));
    let barDistance = abs(barPhase - 0.5);

    let beatMarkerIntensity = smoothstep(0.02, 0.0, beatDistance) * 0.15;
    let barMarkerIntensity = smoothstep(0.01, 0.0, barDistance) * 0.25;
    let gridIntensity = max(beatMarkerIntensity, barMarkerIntensity);

    let beatGridColor = vec3<f32>(1.0, 0.7, 0.3);
    return mix(backgroundColor, beatGridColor, gridIntensity);
}

// =============================================================================
// Fragment Shader - Multi-Stem Compositor
// =============================================================================

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let uv = in.uv;
    let backgroundColor = vec3<f32>(0.04, 0.04, 0.07);

    // ==========================================================================
    // Centered Playhead Mapping
    // ==========================================================================

    let xFromCenter = uv.x - 0.5;
    let pixelsFromCenter = xFromCenter * uniforms.viewWidth;
    let sampleOffset = pixelsFromCenter * uniforms.samplesPerPixel;

    let playheadSamples = reconstruct_playhead();
    let samplePosition = playheadSamples + sampleOffset;

    // Boundary check
    if (samplePosition < 0.0 || samplePosition >= uniforms.totalSamples) {
        return vec4<f32>(backgroundColor, 1.0);
    }

    // ==========================================================================
    // Column Rendering (Discrete Bars)
    // ==========================================================================

    let pixelIndexFloat = samplePosition / uniforms.samplesPerPixel;
    let columnFraction = fract(pixelIndexFloat);
    let distFromColumnCenter = abs(columnFraction - 0.5);
    let columnWidth = clamp(0.4, 0.4, 0.85);
    let halfWidth = columnWidth * 0.5;
    let columnEdgeWidth = 0.05;
    let columnMask = smoothstep(halfWidth + columnEdgeWidth, halfWidth - columnEdgeWidth, distFromColumnCenter);

    // ==========================================================================
    // Sample All Stems
    // ==========================================================================

    let stems = sample_all_stems(samplePosition);

    // ==========================================================================
    // Render Each Stem
    // ==========================================================================

    let centerY = uniforms.waveformCenterY;
    let dy = abs(uv.y - centerY);

    var drumWave = vec4<f32>(0.0);
    var bassWave = vec4<f32>(0.0);
    var vocalWave = vec4<f32>(0.0);
    var otherWave = vec4<f32>(0.0);

    if (is_stem_active(0u)) {
        drumWave = render_stem_waveform(stems[0], dy, DRUM_COLOR, uniforms.drumGain, uniforms.drumOpacity, columnMask);
    }

    if (is_stem_active(1u)) {
        bassWave = render_stem_waveform(stems[1], dy, BASS_COLOR, uniforms.bassGain, uniforms.bassOpacity, columnMask);
    }

    if (is_stem_active(2u)) {
        vocalWave = render_stem_waveform(stems[2], dy, VOCAL_COLOR, uniforms.vocalGain, uniforms.vocalOpacity, columnMask);
    }

    if (is_stem_active(3u)) {
        otherWave = render_stem_waveform(stems[3], dy, OTHER_COLOR, uniforms.otherGain, uniforms.otherOpacity, columnMask);
    }

    // ==========================================================================
    // Blend Stems
    // ==========================================================================

    let blendedWave = blend_stems(drumWave, bassWave, vocalWave, otherWave);

    // ==========================================================================
    // Compose Final Image
    // ==========================================================================

    var finalColor = mix(backgroundColor, blendedWave.rgb, blendedWave.a);

    // Beat grid overlay
    finalColor = render_beat_grid(samplePosition, finalColor);

    // Playhead
    let playheadWidth = 1.2 / uniforms.viewWidth;
    let distToPlayhead = abs(uv.x - 0.5);
    let playheadIntensity = smoothstep(playheadWidth, 0.0, distToPlayhead);
    let playheadColor = vec3<f32>(0.96, 0.98, 1.0);
    finalColor = mix(finalColor, playheadColor, playheadIntensity * 0.95);

    return vec4<f32>(finalColor, 1.0);
}

// File: src/shaders/deck-waveform-standalone.wgsl

// =============================================================================
// Deck Waveform Shader - "Serato Pro" RGB Spectrum Style
// Target: Additive RGB color mixing (Red=Low, Green=Mid, Blue=High)
// Result: Cyan (Mid+High), Magenta (Low+High), White (All), Yellow (Low+Mid)
// =============================================================================

struct WaveUniforms {
    viewWidth: f32,
    viewHeight: f32,
    playheadSamplesHigh: f32,
    playheadSamplesLow: f32,
    sampleRate: f32,
    rate: f32,
    zoomLevel: f32,
    samplesPerPixel: f32,
    lodLengthInPixels: f32,
    totalSamples: f32,
    bandCount: u32,
    waveformCenterY: f32,
    waveformMaxHeight: f32,
    time: f32,
    lodBlendFactor: f32,
    secondarySamplesPerPixel: f32,
    secondaryLodLengthInPixels: f32,
    beatPhaseOffset: f32,
}

@group(0) @binding(0) var<uniform> uniforms: WaveUniforms;
@group(0) @binding(1) var amplitudeTex: texture_2d<f32>;
@group(0) @binding(2) var bandsTex: texture_2d<f32>;
@group(0) @binding(3) var secondaryAmplitudeTex: texture_2d<f32>;
@group(0) @binding(4) var secondaryBandsTex: texture_2d<f32>;
@group(0) @binding(5) var texSampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var out: VertexOutput;
    // Generate fullscreen triangle
    let x = f32((vertexIndex << 1u) & 2u);
    let y = f32(vertexIndex & 2u);
    out.position = vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2<f32>(x, 1.0 - y);
    return out;
}

// =============================================================================
// Helper Functions
// =============================================================================

fn reconstruct_playhead() -> f32 {
    return uniforms.playheadSamplesHigh * 65536.0 + uniforms.playheadSamplesLow;
}

// Sample Data with LOD Blending
// Returns: vec4(amplitude, low, mid, high)
fn sample_lod_data(samplePosition: f32) -> vec4<f32> {
    // 1. Primary LOD Sampling
    let px1 = samplePosition / uniforms.samplesPerPixel;
    let tx1 = clamp(px1 / uniforms.lodLengthInPixels, 0.0, 1.0);
    // Amplitude is usually stored in R or G. We use G (Max) for the envelope.
    let amp1 = textureSample(amplitudeTex, texSampler, vec2<f32>(tx1, 0.5)).g;
    // Bands are stored in RGB channels of the bands texture
    let bands1 = textureSample(bandsTex, texSampler, vec2<f32>(tx1, 0.5));

    // 2. Secondary LOD Sampling (for smooth zooming)
    let px2 = samplePosition / uniforms.secondarySamplesPerPixel;
    let tx2 = clamp(px2 / uniforms.secondaryLodLengthInPixels, 0.0, 1.0);
    let amp2 = textureSample(secondaryAmplitudeTex, texSampler, vec2<f32>(tx2, 0.5)).g;
    let bands2 = textureSample(secondaryBandsTex, texSampler, vec2<f32>(tx2, 0.5));

    // 3. Blend LODs
    let finalAmp = mix(amp1, amp2, uniforms.lodBlendFactor);
    let finalBands = mix(bands1, bands2, uniforms.lodBlendFactor);

    return vec4<f32>(finalAmp, finalBands.r, finalBands.g, finalBands.b);
}

// =============================================================================
// Fragment Shader - Additive RGB Spectrum
// =============================================================================

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // 1. Setup Coordinates
    let uv = in.uv;
    let xFromCenter = uv.x - 0.5;
    let pixelsFromCenter = xFromCenter * uniforms.viewWidth;
    let sampleOffset = pixelsFromCenter * uniforms.samplesPerPixel;
    let playheadSamples = reconstruct_playhead();
    let samplePosition = playheadSamples + sampleOffset;

    // 2. Sample Audio Data
    // x = Amplitude (envelope height)
    // y = Low (Red), z = Mid (Green), w = High (Blue)
    let data = sample_lod_data(samplePosition);
    let amplitude = data.x;
    let bands = vec3<f32>(data.y, data.z, data.w);

    // 3. Geometry (Symmetric)
    // Calculate distance from vertical center (0.0 to 1.0)
    let distY = abs(uv.y - 0.5) * 2.0;

    // Define the shape height based on amplitude
    // We scale it by 0.9 to leave a little headroom
    let height = amplitude * 0.9;

    // 4. Sharp Masking (The Digital Look)
    // Unlike the "Gold" shader which used soft gradients, Serato uses sharp edges.
    // We use fwidth for minimal anti-aliasing (1-2 pixels) without looking blurry.
    let edge_width = fwidth(distY);
    let mask = 1.0 - smoothstep(height - edge_width, height, distY);

    // Optimization: Discard pixels outside the waveform
    if (mask <= 0.001) {
        // Return black background immediately
        return vec4<f32>(0.05, 0.05, 0.05, 1.0);
    }

    // 5. RGB Additive Color Logic
    // Map bands directly to RGB.
    // This naturally creates:
    // - Low + Mid = Yellow
    // - Low + High = Magenta/Pink
    // - Mid + High = Cyan/Teal

    // We boost the values slightly (1.5x) to make colors vibrant against black
    let low  = bands.x * 1.5;
    let mid  = bands.y * 1.2;
    let high = bands.z * 1.5;

    var color = vec3<f32>(low, mid, high);

    // 6. White "Hot Core" Logic
    // In Spectrum mode, high energy signals (transients) turn white.
    // We calculate total energy to determine "whiteness".
    let total_energy = low + mid + high;

    // If energy exceeds threshold, blend towards white
    let white_threshold = 1.8;
    let core_intensity = smoothstep(white_threshold, 3.0, total_energy);

    color = mix(color, vec3<f32>(1.0, 1.0, 1.0), core_intensity);

    // 7. Vertical Density Adjustment
    // Serato waveforms are often slightly denser/brighter in the exact center line
    // We add a subtle boost at uv.y = 0.5
    let center_boost = 1.0 - distY;
    color *= (0.85 + 0.15 * center_boost);

    // 8. Gamma / Contrast Boost
    // Gives it that "screen" look (neon pop)
    color = pow(color, vec3<f32>(1.2));

    // 9. Playhead (Stark White Line)
    let playheadDist = abs(uv.x - 0.5);
    // 1 pixel width playhead
    let playheadWidth = 1.0 / uniforms.viewWidth;

    if (playheadDist < playheadWidth) {
        return vec4<f32>(1.0, 1.0, 1.0, 1.0);
    }

    return vec4<f32>(color, 1.0);
}

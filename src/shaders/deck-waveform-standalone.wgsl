// =============================================================================
// Deck Waveform Shader - Centered Playhead with Multi-Band Coloring
// Optimized for Serato DJ Pro-style visual quality
// Version 2: Improved color separation and discrete column rendering
// =============================================================================

// Uniform buffer matching the TypeScript WaveUniformsData structure
struct WaveUniforms {
    viewWidth: f32,
    viewHeight: f32,
    playheadSamplesHigh: f32,  // High-order component (floor div by 2^16)
    playheadSamplesLow: f32,   // Low-order component (remainder)
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
    bpm: f32,
    beatPhaseOffset: f32,  // Beat grid phase offset in samples
}

@group(0) @binding(0) var<uniform> uniforms: WaveUniforms;
@group(0) @binding(1) var amplitudeTex: texture_2d<f32>;
@group(0) @binding(2) var bandsTex: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

// Vertex output / Fragment input
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

// =============================================================================
// Vertex Shader - Fullscreen Triangle
// =============================================================================

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var out: VertexOutput;

    // Generate fullscreen triangle using vertex index
    let x = f32((vertexIndex << 1u) & 2u);
    let y = f32(vertexIndex & 2u);

    out.position = vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2<f32>(x, 1.0 - y); // Flip Y for correct orientation

    return out;
}

// =============================================================================
// Utility Functions
// =============================================================================

// Reconstruct high-precision sample position from split floats
fn reconstruct_playhead() -> f32 {
    let splitFactor = 65536.0; // 2^16
    return uniforms.playheadSamplesHigh * splitFactor + uniforms.playheadSamplesLow;
}

// =============================================================================
// Color Mapping Functions - Serato-Style Spectral Coloring (Improved)
// =============================================================================

// Map band energies to color with dominant frequency emphasis
fn color_from_bands_v2(bands: vec3<f32>) -> vec3<f32> {
    // Serato-inspired frequency band colors (more saturated)
    // High frequencies get extra brightness for prominence
    let lowColor = vec3<f32>(0.98, 0.22, 0.12);   // Pure red/orange for bass
    let midColor = vec3<f32>(0.12, 0.95, 0.35);   // Vibrant green for mids
    let highColor = vec3<f32>(0.35, 0.75, 1.0);   // Brighter cyan/blue for highs (enhanced)

    // Find the dominant band
    let maxBand = max(max(bands.x, bands.y), bands.z);
    let minBand = min(min(bands.x, bands.y), bands.z);

    // Compute dominance ratio (how much one band stands out)
    let dominanceRatio = (maxBand - minBand) / (maxBand + 1e-4);

    // Apply stronger non-linear emphasis
    // Higher emphasis for highs to make them pop more
    let lowEmph = pow(bands.x, 3.0);
    let midEmph = pow(bands.y, 3.0);
    let highEmph = pow(bands.z, 2.5); // Less aggressive power for highs = more prominence

    let b = vec3<f32>(lowEmph, midEmph, highEmph);

    // Normalize
    let sum = max(b.x + b.y + b.z, 1e-4);
    let weights = b / sum;

    // Weighted color blend
    var color = lowColor * weights.x + midColor * weights.y + highColor * weights.z;

    // Additional brightness boost when highs are dominant
    let highDominance = bands.z / (maxBand + 1e-4);
    let highBoost = 1.0 + highDominance * 0.3; // Up to 30% brighter for high-dominant
    color = color * highBoost;

    // Boost saturation based on dominance (more dominant = more saturated)
    let luminance = dot(color, vec3<f32>(0.299, 0.587, 0.114));
    let saturationBoost = 1.2 + dominanceRatio * 0.8; // Range: 1.2 to 2.0
    color = mix(vec3<f32>(luminance), color, saturationBoost);

    // Ensure minimum saturation by clamping away from gray
    let gray = vec3<f32>(luminance);
    let saturationFloor = 0.65; // Increased floor for more vivid colors
    let currentSaturation = length(color - gray) / (luminance + 0.1);
    if (currentSaturation < saturationFloor && maxBand > 0.1) {
        // Push color away from gray
        let toColor = normalize(color - gray + vec3<f32>(0.001));
        color = gray + toColor * saturationFloor * (luminance + 0.1);
    }

    return clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
}

// Compute brightness with perceptual gamma curve
fn compute_brightness(amplitude: f32) -> f32 {
    let gamma = 0.55;
    let brightness = pow(clamp(amplitude, 0.0, 1.0), gamma);

    // Ensure minimum visibility even for quiet sections
    let minBrightness = 0.12;
    return mix(minBrightness, 1.0, brightness);
}

// =============================================================================
// Fragment Shader - Centered Playhead Waveform Rendering (Improved)
// =============================================================================

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let uv = in.uv;

    // Background color (dark blue-gray for contrast)
    let backgroundColor = vec3<f32>(0.04, 0.04, 0.07);

    // ==========================================================================
    // Centered Playhead Mapping (High Precision)
    // ==========================================================================

    let xFromCenter = uv.x - 0.5;
    let pixelsFromCenter = xFromCenter * uniforms.viewWidth;
    let sampleOffset = pixelsFromCenter * uniforms.samplesPerPixel;

    let playheadSamples = reconstruct_playhead();
    let samplePosition = playheadSamples + sampleOffset;

    // Convert sample position to LOD pixel index (float for sub-pixel precision)
    let pixelIndexFloat = samplePosition / uniforms.samplesPerPixel;
    let texCoordX = pixelIndexFloat / uniforms.lodLengthInPixels;

    // ==========================================================================
    // Boundary Handling
    // ==========================================================================

    let normalizedPosition = samplePosition / uniforms.totalSamples;
    let isBeforeStart = samplePosition < 0.0;
    let isAfterEnd = normalizedPosition > 1.0;

    if (isBeforeStart || isAfterEnd) {
        var fadeDistance = 0.0;
        if (isBeforeStart) {
            fadeDistance = abs(samplePosition) / (uniforms.viewWidth * uniforms.samplesPerPixel * 0.5);
        } else {
            fadeDistance = (normalizedPosition - 1.0) * uniforms.lodLengthInPixels / (uniforms.viewWidth * 0.5);
        }
        let fade = exp(-fadeDistance * 3.0);
        let fadedBg = backgroundColor * (0.3 + 0.7 * fade);
        return vec4<f32>(fadedBg, 1.0);
    }

    let clampedTexCoordX = clamp(texCoordX, 0.0, 1.0);

    // ==========================================================================
    // Discrete Column Rendering (Serato-Style Thin Bars)
    // ==========================================================================

    // Calculate how many waveform pixels map to one screen pixel
    // This helps us adapt column rendering to avoid aliasing at extreme zoom
    let screenPixelsPerWaveformColumn = uniforms.viewWidth / (uniforms.lodLengthInPixels * uniforms.zoomLevel * 0.1);

    // Get the fractional position within the current waveform column
    let columnFraction = fract(pixelIndexFloat);

    // Adaptive column width based on density:
    // - At high zoom (few samples per pixel), show thin discrete bars
    // - At low zoom (many samples per pixel), widen bars to reduce aliasing
    var columnWidth = 0.0;
    if (screenPixelsPerWaveformColumn > 2.0) {
        // High zoom: thin discrete columns (0.5-0.7)
        columnWidth = clamp(0.5 + uniforms.zoomLevel * 0.05, 0.5, 0.7);
    } else if (screenPixelsPerWaveformColumn > 0.5) {
        // Medium zoom: wider columns to reduce gaps (0.7-0.85)
        columnWidth = clamp(0.7 + (2.0 - screenPixelsPerWaveformColumn) * 0.15, 0.7, 0.85);
    } else {
        // Low zoom: nearly continuous to avoid moiré patterns (0.85-0.95)
        let continuityFactor = clamp(1.0 - screenPixelsPerWaveformColumn * 2.0, 0.0, 1.0);
        columnWidth = 0.85 + continuityFactor * 0.1;
    }

    // Create column mask: 1.0 in center of column, 0.0 at edges
    let distFromColumnCenter = abs(columnFraction - 0.5);
    let halfWidth = columnWidth * 0.5;

    // Smooth column edges for anti-aliasing
    // Wider AA at low zoom to reduce shimmer
    let columnEdgeWidth = mix(0.05, 0.15, clamp(1.0 - screenPixelsPerWaveformColumn, 0.0, 1.0));
    let columnMask = smoothstep(halfWidth + columnEdgeWidth, halfWidth - columnEdgeWidth, distFromColumnCenter);

    // Inter-column gap darkening (subtle separation between columns)
    // Reduce darkening at low zoom where columns are nearly continuous
    let gapStrength = mix(0.7, 0.9, clamp(1.0 - screenPixelsPerWaveformColumn, 0.0, 1.0));
    let gapDarkening = mix(gapStrength, 1.0, columnMask);

    // ==========================================================================
    // Sample Waveform Data
    // ==========================================================================

    let amplitudeValue = textureSample(amplitudeTex, texSampler, vec2<f32>(clampedTexCoordX, 0.5)).r;
    let amplitude = clamp(amplitudeValue, 0.0, 1.0);

    var bands = vec3<f32>(0.0, 0.0, 0.0);

    if (uniforms.bandCount >= 3u) {
        let bandTexHeight = f32(uniforms.bandCount);
        let lowY = 0.5 / bandTexHeight;
        let midY = 1.5 / bandTexHeight;
        let highY = 2.5 / bandTexHeight;

        bands.x = textureSample(bandsTex, texSampler, vec2<f32>(clampedTexCoordX, lowY)).r;
        bands.y = textureSample(bandsTex, texSampler, vec2<f32>(clampedTexCoordX, midY)).r;
        bands.z = textureSample(bandsTex, texSampler, vec2<f32>(clampedTexCoordX, highY)).r;
    } else if (uniforms.bandCount == 1u) {
        bands = vec3<f32>(amplitude, amplitude, amplitude);
    } else if (uniforms.bandCount == 2u) {
        let bandTexHeight = f32(uniforms.bandCount);
        bands.x = textureSample(bandsTex, texSampler, vec2<f32>(clampedTexCoordX, 0.5 / bandTexHeight)).r;
        bands.z = textureSample(bandsTex, texSampler, vec2<f32>(clampedTexCoordX, 1.5 / bandTexHeight)).r;
        bands.y = (bands.x + bands.z) * 0.5;
    }

    bands = clamp(bands, vec3<f32>(0.0), vec3<f32>(1.0));

    // ==========================================================================
    // Waveform Geometry (Frequency-Layered 3D Depth Effect)
    // ==========================================================================

    let centerY = uniforms.waveformCenterY;
    let maxHeight = uniforms.waveformMaxHeight;
    let dy = abs(uv.y - centerY);

    // Compute separate heights for each frequency band (layered visualization)
    // Low frequencies form the base (largest), highs are on top (smallest)
    let lowHeight = bands.x * amplitude * maxHeight * 1.0;
    let midHeight = bands.y * amplitude * maxHeight * 0.85;
    let highHeight = bands.z * amplitude * maxHeight * 0.7;

    // Combined height for overall envelope
    let columnHeight = amplitude * maxHeight;

    // Anti-aliasing with sub-pixel precision
    let pixelSize = 1.0 / uniforms.viewHeight;
    let aaWidth = pixelSize * 1.2;

    // Main envelope edge factor
    let edgeFactor = smoothstep(columnHeight + aaWidth, columnHeight - aaWidth, dy);

    // Compute layered depth factors for each band
    let lowLayerFactor = smoothstep(lowHeight + aaWidth, lowHeight - aaWidth, dy);
    let midLayerFactor = smoothstep(midHeight + aaWidth, midHeight - aaWidth, dy);
    let highLayerFactor = smoothstep(highHeight + aaWidth, highHeight - aaWidth, dy);

    // Apply column mask to create discrete bars
    let shapedEdge = edgeFactor * columnMask;

    // ==========================================================================
    // Color Computation (Layered Depth Effect)
    // ==========================================================================

    // Define layer colors with depth cues
    let lowLayerColor = vec3<f32>(0.98, 0.22, 0.12) * 0.8;  // Red/orange, darker (back)
    let midLayerColor = vec3<f32>(0.12, 0.95, 0.35) * 0.9;  // Green, medium brightness
    let highLayerColor = vec3<f32>(0.35, 0.75, 1.0) * 1.1;  // Bright cyan, extra bright (front)

    // Compose layers from back to front (additive-like blending)
    let brightness = compute_brightness(amplitude);

    // Start with low layer (back)
    var layeredColor = lowLayerColor * lowLayerFactor * bands.x;

    // Add mid layer
    layeredColor = mix(layeredColor, midLayerColor, midLayerFactor * bands.y * 0.7);

    // Add high layer on top (most prominent)
    layeredColor = mix(layeredColor, highLayerColor, highLayerFactor * bands.z * 0.8);

    // Blend with standard color mapping for balance
    let baseColor = color_from_bands_v2(bands);
    let combinedColor = mix(baseColor, layeredColor, 0.4); // 40% layered effect, 60% base

    // Apply brightness
    let brightColor = combinedColor * brightness;

    // Vertical gradient (brighter at center, darker toward top/bottom)
    let verticalPosition = dy / maxHeight;
    let verticalGradient = 1.0 - verticalPosition * 0.3;

    // Depth shading: enhance 3D effect by darkening edges of each layer
    let depthShading = mix(0.85, 1.0, pow(edgeFactor, 0.5));

    // Edge glow effect for high amplitudes
    let edgeGlow = pow(edgeFactor, 2.0) * pow(amplitude, 2.0) * 0.12;

    // Final waveform color with all effects
    let waveformColor = brightColor * verticalGradient * gapDarkening * depthShading;

    // Add subtle inner glow
    let innerGlow = combinedColor * edgeGlow;

    // ==========================================================================
    // Beat Grid Rendering (Serato-Style Visual Timing Cues)
    // ==========================================================================

    // Calculate beat position in samples with phase offset support
    let samplesPerBeat = (60.0 / uniforms.bpm) * uniforms.sampleRate;
    // Apply phase offset: shift sample position by the offset so beat grid aligns correctly
    let adjustedSamplePosition = samplePosition - uniforms.beatPhaseOffset;
    let beatIndex = adjustedSamplePosition / samplesPerBeat;
    let beatFraction = fract(beatIndex);

    // Render subtle vertical lines at beat positions
    let beatLineWidth = 0.3;
    let distFromBeat = min(beatFraction, 1.0 - beatFraction);
    let beatLineIntensity = smoothstep(beatLineWidth * 0.1, 0.0, distFromBeat);

    // Bar lines (every 4 beats) are brighter
    let barIndex = beatIndex / 4.0;
    let barFraction = fract(barIndex);
    let distFromBar = min(barFraction, 1.0 - barFraction);
    let barLineIntensity = smoothstep(beatLineWidth * 0.15, 0.0, distFromBar);

    // Combine beat and bar grid
    let gridColor = vec3<f32>(0.2, 0.25, 0.35);
    let beatGridStrength = beatLineIntensity * 0.15 + barLineIntensity * 0.25;

    // Apply grid behind waveform (only visible in empty areas)
    finalColor = mix(finalColor, gridColor, beatGridStrength * (1.0 - shapedEdge * 0.7));

    // ==========================================================================
    // Playhead Rendering
    // ==========================================================================

    let playheadWidthPixels = 1.2;
    let playheadWidth = playheadWidthPixels / uniforms.viewWidth;
    let playheadX = 0.5;
    let distToPlayhead = abs(uv.x - playheadX);

    // Sharp core with soft glow
    let playheadCore = smoothstep(playheadWidth, 0.0, distToPlayhead);
    let playheadGlow = smoothstep(playheadWidth * 3.0, 0.0, distToPlayhead) * 0.25;
    let playheadIntensity = playheadCore + playheadGlow;

    // Playhead color (bright white)
    let playheadColor = vec3<f32>(0.96, 0.98, 1.0);

    // ==========================================================================
    // Final Composition (Clean, no scanlines)
    // ==========================================================================

    // Mix waveform and background
    var finalColor = mix(backgroundColor, waveformColor + innerGlow, shapedEdge);

    // Overlay playhead on top
    finalColor = mix(finalColor, playheadColor, playheadIntensity * 0.95);

    // Add subtle playhead shadow for depth (offset to right)
    let shadowOffset = 1.5 / uniforms.viewWidth;
    let shadowDist = abs(uv.x - playheadX - shadowOffset);
    let shadowIntensity = smoothstep(playheadWidth * 1.5, 0.0, shadowDist) * 0.2;
    finalColor = mix(finalColor, vec3<f32>(0.0), shadowIntensity * (1.0 - playheadIntensity));

    // Add subtle time-based "alive" indicator: playhead glow pulses gently
    let playheadPulse = 0.85 + 0.15 * sin(uniforms.time * 2.0);
    if (playheadIntensity > 0.1) {
        finalColor = finalColor * playheadPulse;
    }

    // Subtle animated gradient at the very top edge to show shader is active
    let topIndicator = smoothstep(0.01, 0.0, uv.y);
    let indicatorColor = vec3<f32>(0.1, 0.15, 0.25) * (0.5 + 0.5 * sin(uniforms.time * 3.0 + uv.x * 10.0));
    finalColor = mix(finalColor, indicatorColor, topIndicator * 0.3);

    return vec4<f32>(finalColor, 1.0);
}

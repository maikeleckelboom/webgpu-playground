// =============================================================================
// Deck Waveform Shader - Centered Playhead with Multi-Band Coloring
// =============================================================================

// Uniform buffer matching the TypeScript WaveUniformsData structure
struct WaveUniforms {
    viewWidth: f32,
    viewHeight: f32,
    playheadSamples: f32,
    sampleRate: f32,
    rate: f32,
    zoomLevel: f32,
    samplesPerPixel: f32,
    lodLengthInPixels: f32,
    bandCount: u32,
    waveformCenterY: f32,
    waveformMaxHeight: f32,
    time: f32,
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
    // This creates a triangle that covers the entire screen
    let x = f32((vertexIndex << 1u) & 2u);
    let y = f32(vertexIndex & 2u);

    out.position = vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2<f32>(x, 1.0 - y); // Flip Y for correct orientation

    return out;
}

// =============================================================================
// Color Mapping Functions
// =============================================================================

// Map normalized band energies to color
fn color_from_bands(n: vec3<f32>) -> vec3<f32> {
    // Frequency band colors
    let lowColor = vec3<f32>(1.0, 0.4, 0.1);   // Warm orange/red for bass
    let midColor = vec3<f32>(0.2, 0.9, 0.2);   // Green for mids
    let highColor = vec3<f32>(0.1, 0.7, 1.0);  // Cyan/blue for highs

    // Weighted blend based on band energies
    let sum = n.x + n.y + n.z + 1e-5;
    let weights = n / sum;

    let color = lowColor * weights.x + midColor * weights.y + highColor * weights.z;
    return color;
}

// Apply soft gamma curve to amplitude for better visual dynamics
fn amplitude_brightness(a: f32) -> f32 {
    return pow(clamp(a, 0.0, 1.0), 0.5);
}

// =============================================================================
// Fragment Shader - Centered Playhead Waveform Rendering
// =============================================================================

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let uv = in.uv;

    // Background color
    let backgroundColor = vec3<f32>(0.05, 0.05, 0.08);

    // ==========================================================================
    // Centered Playhead Mapping
    // ==========================================================================

    // Calculate offset from center (center = playhead position)
    let xFromCenter = uv.x - 0.5; // Range: [-0.5, +0.5]

    // Convert screen position to sample position
    let pixelsFromCenter = xFromCenter * uniforms.viewWidth;
    let sampleOffset = pixelsFromCenter * uniforms.samplesPerPixel;
    let samplePosition = uniforms.playheadSamples + sampleOffset;

    // Convert sample position to LOD texture coordinate
    let pixelIndexFloat = samplePosition / uniforms.samplesPerPixel;
    let texCoordX = pixelIndexFloat / uniforms.lodLengthInPixels;

    // ==========================================================================
    // Boundary Handling
    // ==========================================================================

    // Check if we're outside the track bounds
    let isOutOfBounds = texCoordX < 0.0 || texCoordX > 1.0;

    if (isOutOfBounds) {
        // Fade out regions outside the track
        let fadeDistance = select(abs(texCoordX), abs(texCoordX - 1.0), texCoordX < 0.0);
        let fade = exp(-fadeDistance * 10.0);
        return vec4<f32>(backgroundColor * fade, 1.0);
    }

    // ==========================================================================
    // Sample Waveform Data
    // ==========================================================================

    // Sample amplitude (single-channel r16float texture)
    let amplitudeValue = textureSample(amplitudeTex, texSampler, vec2<f32>(texCoordX, 0.5)).r;
    let amplitude = clamp(amplitudeValue, 0.0, 1.0);

    // Sample band energies (one row per band)
    var bands = vec3<f32>(0.0, 0.0, 0.0);

    if (uniforms.bandCount >= 3u) {
        // Sample each band row
        let bandTexHeight = f32(uniforms.bandCount);
        let lowY = 0.5 / bandTexHeight;
        let midY = 1.5 / bandTexHeight;
        let highY = 2.5 / bandTexHeight;

        bands.x = textureSample(bandsTex, texSampler, vec2<f32>(texCoordX, lowY)).r;
        bands.y = textureSample(bandsTex, texSampler, vec2<f32>(texCoordX, midY)).r;
        bands.z = textureSample(bandsTex, texSampler, vec2<f32>(texCoordX, highY)).r;
    } else if (uniforms.bandCount == 1u) {
        // Single band - use amplitude as all bands
        bands = vec3<f32>(amplitude, amplitude, amplitude);
    } else if (uniforms.bandCount == 2u) {
        // Two bands - low and high
        let bandTexHeight = f32(uniforms.bandCount);
        bands.x = textureSample(bandsTex, texSampler, vec2<f32>(texCoordX, 0.5 / bandTexHeight)).r;
        bands.z = textureSample(bandsTex, texSampler, vec2<f32>(texCoordX, 1.5 / bandTexHeight)).r;
        bands.y = (bands.x + bands.z) * 0.5; // Synthesize mid
    }

    bands = clamp(bands, vec3<f32>(0.0), vec3<f32>(1.0));

    // ==========================================================================
    // Waveform Geometry (Symmetric Bar)
    // ==========================================================================

    let centerY = uniforms.waveformCenterY;
    let maxHeight = uniforms.waveformMaxHeight;

    // Distance from vertical center
    let dy = abs(uv.y - centerY);

    // Column height based on amplitude
    let columnHeight = amplitude * maxHeight;

    // Antialiasing: smooth edge
    let edgeWidth = 1.0 / uniforms.viewHeight;
    let edgeFactor = smoothstep(columnHeight + edgeWidth, columnHeight - edgeWidth, dy);

    // ==========================================================================
    // Color Computation
    // ==========================================================================

    // Base color from frequency bands
    let baseColor = color_from_bands(bands);

    // Brightness based on amplitude
    let brightness = amplitude_brightness(amplitude);

    // Vertical gradient for depth (brighter at center, darker at edges)
    let verticalGradient = 1.0 - (dy / maxHeight) * 0.3;

    // Final waveform color
    let waveformColor = baseColor * brightness * verticalGradient;

    // ==========================================================================
    // Playhead Rendering (Center Vertical Line)
    // ==========================================================================

    let playheadWidth = 2.0 / uniforms.viewWidth; // 2 pixels wide
    let playheadX = 0.5;
    let distToPlayhead = abs(uv.x - playheadX);
    let playheadIntensity = smoothstep(playheadWidth, 0.0, distToPlayhead);

    // Playhead color (bright white/cyan)
    let playheadColor = vec3<f32>(0.9, 0.95, 1.0);

    // ==========================================================================
    // Final Composition
    // ==========================================================================

    // Mix waveform and background
    var finalColor = mix(backgroundColor, waveformColor, edgeFactor);

    // Overlay playhead
    finalColor = mix(finalColor, playheadColor, playheadIntensity * 0.9);

    // Add subtle vertical lines every ~beat grid (for visual rhythm reference)
    let gridSpacing = uniforms.sampleRate * 60.0 / max(uniforms.rate, 0.001) / 128.0; // Approximate 128 BPM
    let gridPixelSpacing = gridSpacing / uniforms.samplesPerPixel / uniforms.viewWidth;
    let gridPhase = fract(texCoordX * uniforms.lodLengthInPixels / (gridSpacing / uniforms.samplesPerPixel));
    let gridLine = smoothstep(0.01, 0.0, min(gridPhase, 1.0 - gridPhase));
    finalColor = mix(finalColor, vec3<f32>(0.15, 0.15, 0.2), gridLine * 0.3 * edgeFactor);

    return vec4<f32>(finalColor, 1.0);
}

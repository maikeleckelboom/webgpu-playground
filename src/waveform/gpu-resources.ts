/**
 * GPU resource management for the deck waveform component.
 * Handles texture creation, uniform buffer management, and bind group setup.
 * FIXED: Added safety checks for texture dimensions
 */

import type {LODGPUResources, WaveformLOD, WaveformPyramid, WaveUniformsData,} from './types.ts';

// =============================================================================
// Constants
// =============================================================================

/** Size of the uniform buffer in bytes (must be 16-byte aligned) */
const UNIFORM_BUFFER_SIZE = 80; // 20 floats * 4 bytes = 80 bytes (aligned)

// =============================================================================
// Texture Creation
// =============================================================================

/**
 * Create a 1D texture for amplitude data (stored as r16float).
 * Using r16float provides good precision while being memory efficient.
 * FIXED: Clamps texture dimensions to at least 1×1
 */
export function createAmplitudeTexture(
    device: GPUDevice,
    lod: WaveformLOD
): GPUTexture {
    // FIXED: Clamp width to at least 1 to avoid 0×0 textures
    const safeWidth = Math.max(1, lod.lengthInPixels);

    const texture = device.createTexture({
        label: `amplitude-lod-${lod.samplesPerPixel}`,
        size: {
            width: safeWidth,
            height: 1,
            depthOrArrayLayers: 1,
        },
        format: 'r16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // FIXED: Only upload if we have valid data
    if (lod.lengthInPixels > 0 && lod.amplitude.length >= lod.lengthInPixels) {
        // Convert Float32Array to Float16 and upload
        const float16Data = new Uint16Array(safeWidth);
        for (let i = 0; i < lod.lengthInPixels; i++) {
            float16Data[i] = float32ToFloat16(lod.amplitude[i] ?? 0);
        }

        device.queue.writeTexture(
            {texture},
            float16Data,
            {bytesPerRow: safeWidth * 2},
            {width: safeWidth, height: 1}
        );
    }

    return texture;
}

/**
 * Create a 2D texture for band energy data.
 * Layout: width = lengthInPixels, height = bandCount
 * Format: r16float for each band energy value
 * FIXED: Clamps texture dimensions to at least 1×1
 */
export function createBandTexture(
    device: GPUDevice,
    lod: WaveformLOD,
    bandCount: number
): GPUTexture {
    // FIXED: Clamp width to at least 1 to avoid 0×0 textures
    const safeWidth = Math.max(1, lod.lengthInPixels);

    const texture = device.createTexture({
        label: `bands-lod-${lod.samplesPerPixel}`,
        size: {
            width: safeWidth,
            height: bandCount,
            depthOrArrayLayers: 1,
        },
        format: 'r16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // FIXED: Only upload if we have valid data
    if (lod.lengthInPixels > 0 && lod.bandEnergies.length >= lod.lengthInPixels * bandCount) {
        // Convert and upload band energies
        // Input layout: interleaved [b0_p0, b1_p0, b2_p0, b0_p1, b1_p1, b2_p1, ...]
        // Output layout: row-major per band [row0: p0_b0, p1_b0, ..., row1: p0_b1, p1_b1, ...]
        const float16Data = new Uint16Array(safeWidth * bandCount);

        for (let bandIdx = 0; bandIdx < bandCount; bandIdx++) {
            for (let pixelIdx = 0; pixelIdx < lod.lengthInPixels; pixelIdx++) {
                const srcIndex = pixelIdx * bandCount + bandIdx;
                const dstIndex = bandIdx * safeWidth + pixelIdx;
                float16Data[dstIndex] = float32ToFloat16(lod.bandEnergies[srcIndex] ?? 0);
            }
        }

        device.queue.writeTexture(
            {texture},
            float16Data,
            {bytesPerRow: safeWidth * 2},
            {width: safeWidth, height: bandCount}
        );
    }

    return texture;
}

// =============================================================================
// Float16 Conversion
// =============================================================================

/**
 * Convert a 32-bit float to 16-bit float (IEEE 754 half precision).
 * This is a simplified conversion that handles the common cases.
 */
function float32ToFloat16(value: number): number {
    const floatView = new Float32Array(1);
    const int32View = new Int32Array(floatView.buffer);

    floatView[0] = value;
    const x = int32View[0] ?? 0;

    const sign = (x >> 16) & 0x8000;
    let exponent = ((x >> 23) & 0xff) - 127 + 15;
    let mantissa = (x >> 13) & 0x3ff;

    if (exponent <= 0) {
        // Underflow to zero
        return sign;
    } else if (exponent >= 31) {
        // Overflow to infinity
        return sign | 0x7c00;
    }

    // Round to nearest even
    const remainder = x & 0x1fff;
    if (remainder > 0x1000 || (remainder === 0x1000 && (mantissa & 1))) {
        mantissa++;
        if (mantissa > 0x3ff) {
            mantissa = 0;
            exponent++;
            if (exponent >= 31) {
                return sign | 0x7c00;
            }
        }
    }

    return sign | (exponent << 10) | mantissa;
}

// =============================================================================
// Bind Group Layout & Creation
// =============================================================================

/**
 * Create the bind group layout for the waveform shader.
 * Group 0: uniforms
 * Group 1: primary LOD amplitude texture + band texture
 * Group 2: secondary LOD amplitude texture + band texture (for blending)
 * Group 3: sampler
 */
export function createBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
    return device.createBindGroupLayout({
        label: 'waveform-bind-group-layout',
        entries: [
            {
                // Uniform buffer
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: {type: 'uniform'},
            },
            {
                // Primary amplitude texture
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {sampleType: 'float', viewDimension: '2d'},
            },
            {
                // Primary band texture
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {sampleType: 'float', viewDimension: '2d'},
            },
            {
                // Secondary amplitude texture (for LOD blending)
                binding: 3,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {sampleType: 'float', viewDimension: '2d'},
            },
            {
                // Secondary band texture (for LOD blending)
                binding: 4,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {sampleType: 'float', viewDimension: '2d'},
            },
            {
                // Texture sampler
                binding: 5,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: {type: 'filtering'},
            },
        ],
    });
}

/**
 * Create a bind group for a specific LOD's textures.
 * @deprecated Use createDualLODBindGroup for LOD blending support
 */
export function createLODBindGroup(
    device: GPUDevice,
    layout: GPUBindGroupLayout,
    uniformBuffer: GPUBuffer,
    amplitudeTexture: GPUTexture,
    bandTexture: GPUTexture,
    sampler: GPUSampler
): GPUBindGroup {
    // For backwards compatibility, bind same texture to both primary and secondary
    return device.createBindGroup({
        label: 'waveform-lod-bind-group',
        layout,
        entries: [
            {binding: 0, resource: {buffer: uniformBuffer}},
            {binding: 1, resource: amplitudeTexture.createView()},
            {binding: 2, resource: bandTexture.createView()},
            {binding: 3, resource: amplitudeTexture.createView()}, // Same as primary
            {binding: 4, resource: bandTexture.createView()},       // Same as primary
            {binding: 5, resource: sampler},
        ],
    });
}

/**
 * Create a bind group for blending between two LODs.
 * Primary LOD is the higher-detail (lower samplesPerPixel), secondary is lower-detail.
 */
export function createDualLODBindGroup(
    device: GPUDevice,
    layout: GPUBindGroupLayout,
    uniformBuffer: GPUBuffer,
    primaryAmplitudeTexture: GPUTexture,
    primaryBandTexture: GPUTexture,
    secondaryAmplitudeTexture: GPUTexture,
    secondaryBandTexture: GPUTexture,
    sampler: GPUSampler
): GPUBindGroup {
    return device.createBindGroup({
        label: 'waveform-dual-lod-bind-group',
        layout,
        entries: [
            {binding: 0, resource: {buffer: uniformBuffer}},
            {binding: 1, resource: primaryAmplitudeTexture.createView()},
            {binding: 2, resource: primaryBandTexture.createView()},
            {binding: 3, resource: secondaryAmplitudeTexture.createView()},
            {binding: 4, resource: secondaryBandTexture.createView()},
            {binding: 5, resource: sampler},
        ],
    });
}

// =============================================================================
// Uniform Buffer Management
// =============================================================================

/**
 * Create the uniform buffer for waveform rendering.
 */
export function createUniformBuffer(device: GPUDevice): GPUBuffer {
    return device.createBuffer({
        label: 'waveform-uniforms',
        size: UNIFORM_BUFFER_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
}

/**
 * Split a large sample count into high/low float components for precision.
 * Uses 2^16 as the split factor to maintain good precision in both components.
 */
export function splitPlayheadSamples(samples: number): { high: number; low: number } {
    const splitFactor = 65536; // 2^16
    const high = Math.floor(samples / splitFactor);
    const low = samples - high * splitFactor;
    return {high, low};
}

/**
 * Write uniform data to the GPU buffer.
 * Layout must match the WGSL WaveUniforms struct exactly.
 */
export function writeUniforms(
    device: GPUDevice,
    buffer: GPUBuffer,
    data: WaveUniformsData
): void {
    const arrayBuffer = new ArrayBuffer(UNIFORM_BUFFER_SIZE);
    const floatView = new Float32Array(arrayBuffer);
    const uintView = new Uint32Array(arrayBuffer);

    // Layout (must match WGSL struct with proper alignment):
    // offset 0:  viewWidth (f32)
    // offset 4:  viewHeight (f32)
    // offset 8:  playheadSamplesHigh (f32)
    // offset 12: playheadSamplesLow (f32)
    // offset 16: sampleRate (f32)
    // offset 20: rate (f32)
    // offset 24: zoomLevel (f32)
    // offset 28: samplesPerPixel (f32)
    // offset 32: lodLengthInPixels (f32)
    // offset 36: totalSamples (f32)
    // offset 40: bandCount (u32)
    // offset 44: waveformCenterY (f32)
    // offset 48: waveformMaxHeight (f32)
    // offset 52: time (f32)
    // offset 56: lodBlendFactor (f32)
    // offset 60: secondarySamplesPerPixel (f32)
    // offset 64: secondaryLodLengthInPixels (f32)
    // offset 68: beatPhaseOffset (f32)
    // offset 72-79: padding (to align to 16 bytes)

    floatView[0] = data.viewWidth;
    floatView[1] = data.viewHeight;
    floatView[2] = data.playheadSamplesHigh;
    floatView[3] = data.playheadSamplesLow;
    floatView[4] = data.sampleRate;
    floatView[5] = data.rate;
    floatView[6] = data.zoomLevel;
    floatView[7] = data.samplesPerPixel;
    floatView[8] = data.lodLengthInPixels;
    floatView[9] = data.totalSamples;
    uintView[10] = data.bandCount;
    floatView[11] = data.waveformCenterY;
    floatView[12] = data.waveformMaxHeight;
    floatView[13] = data.time;
    floatView[14] = data.lodBlendFactor;
    floatView[15] = data.secondarySamplesPerPixel;
    floatView[16] = data.secondaryLodLengthInPixels;
    floatView[17] = data.beatPhaseOffset;
    // Remaining slots (18, 19) are padding for 16-byte alignment

    device.queue.writeBuffer(buffer, 0, arrayBuffer);
}

// =============================================================================
// LOD Resource Management
// =============================================================================

/**
 * Create GPU resources for all LODs in the pyramid.
 */
export function createAllLODResources(
    device: GPUDevice,
    pyramid: WaveformPyramid,
    layout: GPUBindGroupLayout,
    uniformBuffer: GPUBuffer,
    sampler: GPUSampler
): LODGPUResources[] {
    const resources: LODGPUResources[] = [];

    for (const lod of pyramid.lods) {
        const amplitudeTexture = createAmplitudeTexture(device, lod);
        const bandTexture = createBandTexture(device, lod, pyramid.bandConfig.bandCount);
        const bindGroup = createLODBindGroup(
            device,
            layout,
            uniformBuffer,
            amplitudeTexture,
            bandTexture,
            sampler
        );

        resources.push({
            amplitudeTexture,
            bandTexture,
            bindGroup,
        });
    }

    return resources;
}

/**
 * Destroy all LOD GPU resources.
 */
export function destroyLODResources(resources: LODGPUResources[]): void {
    for (const res of resources) {
        res.amplitudeTexture.destroy();
        res.bandTexture.destroy();
        // Bind groups don't need explicit destruction
    }
}

// =============================================================================
// LOD Selection
// =============================================================================

/**
 * Select the best LOD index based on desired samples per pixel.
 * Returns the index of the LOD whose samplesPerPixel is closest to the target.
 */
export function selectLODIndex(
    pyramid: WaveformPyramid,
    targetSamplesPerPixel: number
): number {
    const firstLOD = pyramid.lods[0];
    if (!firstLOD) {
        return 0;
    }

    let bestIndex = 0;
    let bestDiff = Math.abs(firstLOD.samplesPerPixel - targetSamplesPerPixel);

    for (let i = 1; i < pyramid.lods.length; i++) {
        const lod = pyramid.lods[i];
        if (!lod) {
            continue;
        }
        const diff = Math.abs(lod.samplesPerPixel - targetSamplesPerPixel);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestIndex = i;
        }
    }

    return bestIndex;
}

/**
 * Calculate the desired samples per pixel based on zoom level.
 * Higher zoom = fewer samples per pixel (more detail).
 *
 * Base assumption: at zoom = 1.0, we show ~10 seconds of audio across the view width.
 */
export function calculateSamplesPerPixel(
    viewWidth: number,
    sampleRate: number,
    zoomLevel: number
): number {
    // At zoom 1.0: 10 seconds visible
    // At zoom 2.0: 5 seconds visible (more detail)
    // At zoom 0.5: 20 seconds visible (less detail)
    const baseSecondsVisible = 10.0;
    const secondsVisible = baseSecondsVisible / zoomLevel;
    const totalSamplesVisible = secondsVisible * sampleRate;
    return totalSamplesVisible / viewWidth;
}

/**
 * Result of LOD blending calculation.
 * Contains indices for primary and secondary LODs plus the blend factor.
 */
export interface LODBlendInfo {
    primaryIndex: number;
    secondaryIndex: number;
    blendFactor: number; // 0.0 = 100% primary, 1.0 = 100% secondary
}

/**
 * Calculate which two LODs to blend and the blend factor between them.
 * Returns the two nearest LODs (in terms of samplesPerPixel) and interpolation factor.
 * This enables smooth transitions between detail levels.
 */
export function calculateLODBlend(
    pyramid: WaveformPyramid,
    targetSamplesPerPixel: number
): LODBlendInfo {
    const {lods} = pyramid;

    if (lods.length === 0) {
        return {primaryIndex: 0, secondaryIndex: 0, blendFactor: 0};
    }

    if (lods.length === 1) {
        return {primaryIndex: 0, secondaryIndex: 0, blendFactor: 0};
    }

    // Find the two LODs that bracket the target samplesPerPixel
    // LODs are sorted from highest detail (low samplesPerPixel) to lowest detail (high samplesPerPixel)
    let lowerIndex = 0; // Higher detail (lower samplesPerPixel)
    let upperIndex = lods.length - 1; // Lower detail (higher samplesPerPixel)

    for (let i = 0; i < lods.length - 1; i++) {
        const currentLOD = lods[i];
        const nextLOD = lods[i + 1];

        if (!currentLOD || !nextLOD) {
            continue;
        }

        // If target is between these two LODs
        if (
            targetSamplesPerPixel >= currentLOD.samplesPerPixel &&
            targetSamplesPerPixel <= nextLOD.samplesPerPixel
        ) {
            lowerIndex = i;
            upperIndex = i + 1;
            break;
        }

        // If target is smaller than the first LOD (more detail needed than available)
        if (i === 0 && targetSamplesPerPixel < currentLOD.samplesPerPixel) {
            return {primaryIndex: 0, secondaryIndex: 0, blendFactor: 0};
        }
    }

    // If target is larger than the last LOD (less detail needed than available)
    const lastLOD = lods[lods.length - 1];
    if (lastLOD && targetSamplesPerPixel > lastLOD.samplesPerPixel) {
        return {
            primaryIndex: lods.length - 1,
            secondaryIndex: lods.length - 1,
            blendFactor: 0,
        };
    }

    // Calculate blend factor using logarithmic interpolation for perceptually smooth transitions
    const lowerLOD = lods[lowerIndex];
    const upperLOD = lods[upperIndex];

    if (!lowerLOD || !upperLOD) {
        return {primaryIndex: lowerIndex, secondaryIndex: upperIndex, blendFactor: 0};
    }

    // Use log scale for smooth perceptual blending
    const logTarget = Math.log(targetSamplesPerPixel);
    const logLower = Math.log(lowerLOD.samplesPerPixel);
    const logUpper = Math.log(upperLOD.samplesPerPixel);

    const blendFactor = Math.min(1.0, Math.max(0.0, (logTarget - logLower) / (logUpper - logLower)));

    return {
        primaryIndex: lowerIndex,
        secondaryIndex: upperIndex,
        blendFactor,
    };
}

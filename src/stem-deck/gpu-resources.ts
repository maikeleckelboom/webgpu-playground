/**
 * GPU Resource Management for Multi-Stem Waveforms
 *
 * Handles texture creation, uploads, and bind group management for:
 * - 4 stems (drums, bass, vocals, other)
 * - 7 LOD levels per stem
 * - 2 textures per LOD (amplitude + bands)
 * - Efficient texture packing and updates
 */

import type {
  StemType,
  StemWaveformPyramid,
  MultiStemTrack,
  StemLODTextures,
  StemGPUResources
} from './types.js';

// ============================================================================
// Float32 to Float16 Conversion (for texture upload efficiency)
// ============================================================================

/**
 * Convert Float32Array to Float16 (Uint16Array)
 * Uses standard IEEE 754 half-precision format
 */
export function float32ToFloat16Array(float32: Float32Array): Uint16Array {
  const float16 = new Uint16Array(float32.length);

  for (let i = 0; i < float32.length; i++) {
    float16[i] = float32ToFloat16(float32[i]);
  }

  return float16;
}

function float32ToFloat16(value: number): number {
  const floatView = new Float32Array(1);
  const int32View = new Int32Array(floatView.buffer);

  floatView[0] = value;
  const x = int32View[0];

  let bits = (x >> 16) & 0x8000; // Sign bit
  let exponent = ((x >> 23) & 0xff) - 127 + 15; // Exponent
  let mantissa = x & 0x007fffff; // Mantissa

  if (exponent <= 0) {
    // Zero or subnormal
    if (exponent < -10) {
      return bits; // Too small, round to zero
    }
    mantissa = (mantissa | 0x00800000) >> (1 - exponent);
    return bits | (mantissa >> 13);
  } else if (exponent === 0xff - 127 + 15) {
    // Infinity or NaN
    return bits | 0x7c00 | (mantissa ? 0x0200 : 0);
  }

  if (exponent > 30) {
    // Overflow to infinity
    return bits | 0x7c00;
  }

  return bits | (exponent << 10) | (mantissa >> 13);
}

// ============================================================================
// Texture Creation
// ============================================================================

export interface CreateStemLODTexturesOptions {
  device: GPUDevice;
  width: number; // lengthInPixels
  bandCount: number;
  label?: string;
}

/**
 * Create amplitude and band textures for a single LOD level
 */
export function createStemLODTextures(
  options: CreateStemLODTexturesOptions
): StemLODTextures {
  const { device, width, bandCount, label = 'StemLOD' } = options;

  // Amplitude texture (r16float, width × 1)
  const amplitudeTexture = device.createTexture({
    label: `${label}_amplitude`,
    size: [width, 1, 1],
    format: 'r16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  });

  // Band texture (r16float, width × bandCount)
  const bandsTexture = device.createTexture({
    label: `${label}_bands`,
    size: [width, bandCount, 1],
    format: 'r16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  });

  return {
    amplitudeTexture,
    bandsTexture
  };
}

// ============================================================================
// Texture Upload
// ============================================================================

export interface UploadWaveformLODOptions {
  device: GPUDevice;
  textures: StemLODTextures;
  amplitudeData: Float32Array; // Min/max pairs: [min0, max0, min1, max1, ...]
  bandData: Float32Array; // Interleaved: [b0_0, b1_0, ..., bN_0, b0_1, ...]
  bandCount: number;
  lengthInPixels: number;
}

/**
 * Upload waveform LOD data to GPU textures
 */
export function uploadWaveformLOD(options: UploadWaveformLODOptions): void {
  const { device, textures, amplitudeData, bandData, bandCount, lengthInPixels } = options;

  // Convert amplitude min/max pairs to single channel (use max for simplicity)
  // TODO: Consider encoding min/max in RG16Float texture for full envelope
  const amplitudeSingle = new Float32Array(lengthInPixels);
  for (let i = 0; i < lengthInPixels; i++) {
    const minVal = amplitudeData[i * 2 + 0];
    const maxVal = amplitudeData[i * 2 + 1];
    // Use max of abs(min) and abs(max)
    amplitudeSingle[i] = Math.max(Math.abs(minVal), Math.abs(maxVal));
  }

  // Convert to Float16
  const amplitudeF16 = float32ToFloat16Array(amplitudeSingle);

  // Upload amplitude
  device.queue.writeTexture(
    { texture: textures.amplitudeTexture },
    amplitudeF16.buffer,
    {
      bytesPerRow: lengthInPixels * 2, // 2 bytes per pixel (r16float)
      rowsPerImage: 1
    },
    { width: lengthInPixels, height: 1, depthOrArrayLayers: 1 }
  );

  // Convert band data to Float16
  const bandF16 = float32ToFloat16Array(bandData);

  // Upload bands
  device.queue.writeTexture(
    { texture: textures.bandsTexture },
    bandF16.buffer,
    {
      bytesPerRow: lengthInPixels * 2, // 2 bytes per pixel
      rowsPerImage: bandCount
    },
    { width: lengthInPixels, height: bandCount, depthOrArrayLayers: 1 }
  );
}

// ============================================================================
// Multi-Stem Resource Management
// ============================================================================

export interface StemDeckGPUResources {
  // Per-stem resources (4 stems × 7 LODs)
  readonly drums: readonly StemLODTextures[] | null;
  readonly bass: readonly StemLODTextures[] | null;
  readonly vocals: readonly StemLODTextures[] | null;
  readonly other: readonly StemLODTextures[] | null;

  // Bind group (all textures bound together)
  readonly bindGroup: GPUBindGroup;

  // Bind group layout (for pipeline creation)
  readonly bindGroupLayout: GPUBindGroupLayout;

  // Cleanup
  destroy(): void;
}

export interface CreateStemDeckResourcesOptions {
  device: GPUDevice;
  track: MultiStemTrack;
}

/**
 * Create GPU resources for all stems in a track
 */
export function createStemDeckGPUResources(
  options: CreateStemDeckResourcesOptions
): StemDeckGPUResources {
  const { device, track } = options;

  // Create textures for each stem
  const drumsTextures = track.stems.has('drums')
    ? createStemTextures(device, track.stems.get('drums')!, 'drums')
    : null;

  const bassTextures = track.stems.has('bass')
    ? createStemTextures(device, track.stems.get('bass')!, 'bass')
    : null;

  const vocalsTextures = track.stems.has('vocals')
    ? createStemTextures(device, track.stems.get('vocals')!, 'vocals')
    : null;

  const otherTextures = track.stems.has('other')
    ? createStemTextures(device, track.stems.get('other')!, 'other')
    : null;

  // Create fallback 1×1 textures for missing stems
  const fallbackAmp = createFallbackTexture(device, 'fallback_amp', 1, 1);
  const fallbackBands = createFallbackTexture(device, 'fallback_bands', 1, track.master.bandCount);

  // Helper to get texture or fallback
  const getTexture = (
    textures: readonly StemLODTextures[] | null,
    lodIndex: number,
    type: 'amplitude' | 'bands'
  ): GPUTexture => {
    if (textures && textures[lodIndex]) {
      return type === 'amplitude'
        ? textures[lodIndex].amplitudeTexture
        : textures[lodIndex].bandsTexture;
    }
    return type === 'amplitude' ? fallbackAmp : fallbackBands;
  };

  // Create bind group layout
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'StemDeck_BindGroupLayout',
    entries: [
      // Group 0 Binding 0: Uniforms (will be bound separately)
      // Skipped here - handled by uniform buffer

      // Drums (bindings 1-4)
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },

      // Bass (bindings 5-8)
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },

      // Vocals (bindings 9-12)
      { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 10, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 11, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 12, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },

      // Other (bindings 13-16)
      { binding: 13, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 14, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 15, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 16, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },

      // Sampler (binding 17)
      { binding: 17, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }
    ]
  });

  // Create sampler
  const sampler = device.createSampler({
    label: 'StemDeck_Sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge'
  });

  // Create bind group (use LOD 0 as primary, LOD 1 as secondary by default)
  const bindGroup = device.createBindGroup({
    label: 'StemDeck_BindGroup',
    layout: bindGroupLayout,
    entries: [
      // Drums
      { binding: 1, resource: getTexture(drumsTextures, 0, 'amplitude').createView() },
      { binding: 2, resource: getTexture(drumsTextures, 0, 'bands').createView() },
      { binding: 3, resource: getTexture(drumsTextures, 1, 'amplitude').createView() },
      { binding: 4, resource: getTexture(drumsTextures, 1, 'bands').createView() },

      // Bass
      { binding: 5, resource: getTexture(bassTextures, 0, 'amplitude').createView() },
      { binding: 6, resource: getTexture(bassTextures, 0, 'bands').createView() },
      { binding: 7, resource: getTexture(bassTextures, 1, 'amplitude').createView() },
      { binding: 8, resource: getTexture(bassTextures, 1, 'bands').createView() },

      // Vocals
      { binding: 9, resource: getTexture(vocalsTextures, 0, 'amplitude').createView() },
      { binding: 10, resource: getTexture(vocalsTextures, 0, 'bands').createView() },
      { binding: 11, resource: getTexture(vocalsTextures, 1, 'amplitude').createView() },
      { binding: 12, resource: getTexture(vocalsTextures, 1, 'bands').createView() },

      // Other
      { binding: 13, resource: getTexture(otherTextures, 0, 'amplitude').createView() },
      { binding: 14, resource: getTexture(otherTextures, 0, 'bands').createView() },
      { binding: 15, resource: getTexture(otherTextures, 1, 'amplitude').createView() },
      { binding: 16, resource: getTexture(otherTextures, 1, 'bands').createView() },

      // Sampler
      { binding: 17, resource: sampler }
    ]
  });

  return {
    drums: drumsTextures,
    bass: bassTextures,
    vocals: vocalsTextures,
    other: otherTextures,
    bindGroup,
    bindGroupLayout,

    destroy() {
      drumsTextures?.forEach(lod => {
        lod.amplitudeTexture.destroy();
        lod.bandsTexture.destroy();
      });
      bassTextures?.forEach(lod => {
        lod.amplitudeTexture.destroy();
        lod.bandsTexture.destroy();
      });
      vocalsTextures?.forEach(lod => {
        lod.amplitudeTexture.destroy();
        lod.bandsTexture.destroy();
      });
      otherTextures?.forEach(lod => {
        lod.amplitudeTexture.destroy();
        lod.bandsTexture.destroy();
      });
      fallbackAmp.destroy();
      fallbackBands.destroy();
    }
  };
}

/**
 * Create textures for all LOD levels of a single stem
 */
function createStemTextures(
  device: GPUDevice,
  pyramid: StemWaveformPyramid,
  stemType: StemType
): readonly StemLODTextures[] {
  const textures: StemLODTextures[] = [];

  for (let i = 0; i < pyramid.lods.length; i++) {
    const lod = pyramid.lods[i];

    const lodTextures = createStemLODTextures({
      device,
      width: lod.lengthInPixels,
      bandCount: pyramid.bandCount,
      label: `${stemType}_LOD${i}`
    });

    // Upload data
    uploadWaveformLOD({
      device,
      textures: lodTextures,
      amplitudeData: lod.amplitude,
      bandData: lod.bandEnergies,
      bandCount: pyramid.bandCount,
      lengthInPixels: lod.lengthInPixels
    });

    textures.push(lodTextures);
  }

  return textures;
}

/**
 * Create a 1×1 fallback texture (for missing stems)
 */
function createFallbackTexture(
  device: GPUDevice,
  label: string,
  width: number,
  height: number
): GPUTexture {
  const texture = device.createTexture({
    label,
    size: [width, height, 1],
    format: 'r16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  });

  // Upload zero data
  const zero = new Uint16Array(width * height);
  device.queue.writeTexture(
    { texture },
    zero.buffer,
    { bytesPerRow: width * 2, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 }
  );

  return texture;
}

// ============================================================================
// LOD Selection (from existing codebase patterns)
// ============================================================================

export interface LODBlendInfo {
  readonly primaryIndex: number;
  readonly secondaryIndex: number;
  readonly blendFactor: number; // 0.0 = 100% primary, 1.0 = 100% secondary
}

/**
 * Calculate which LOD levels to use and blend factor based on zoom
 */
export function calculateLODBlend(
  pyramid: StemWaveformPyramid,
  targetSamplesPerPixel: number
): LODBlendInfo {
  const lods = pyramid.lods;

  // Find LOD levels that bracket the target
  let primaryIndex = 0;
  let secondaryIndex = 0;

  for (let i = 0; i < lods.length; i++) {
    if (lods[i].samplesPerPixel <= targetSamplesPerPixel) {
      primaryIndex = i;
    } else {
      secondaryIndex = i;
      break;
    }
  }

  // Clamp indices
  secondaryIndex = Math.min(secondaryIndex, lods.length - 1);

  // Calculate blend factor (logarithmic interpolation)
  let blendFactor = 0.0;
  if (primaryIndex !== secondaryIndex) {
    const primarySPP = lods[primaryIndex].samplesPerPixel;
    const secondarySPP = lods[secondaryIndex].samplesPerPixel;

    const logTarget = Math.log2(targetSamplesPerPixel);
    const logPrimary = Math.log2(primarySPP);
    const logSecondary = Math.log2(secondarySPP);

    blendFactor = (logTarget - logPrimary) / (logSecondary - logPrimary);
    blendFactor = Math.max(0.0, Math.min(1.0, blendFactor));
  }

  return { primaryIndex, secondaryIndex, blendFactor };
}

/**
 * Calculate samples per pixel based on view width and zoom
 */
export function calculateSamplesPerPixel(
  viewWidth: number,
  sampleRate: number,
  zoomLevel: number
): number {
  const baseSecondsVisible = 10.0; // 10 seconds at zoom=1.0
  const secondsVisible = baseSecondsVisible / zoomLevel;
  const totalSamplesVisible = secondsVisible * sampleRate;
  return totalSamplesVisible / viewWidth;
}

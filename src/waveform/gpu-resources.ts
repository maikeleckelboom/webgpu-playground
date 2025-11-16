/**
 * GPU resource management for the deck waveform component.
 * Handles texture creation, uniform buffer management, and bind group setup.
 */

import type {
  WaveformLOD,
  WaveformPyramid,
  LODGPUResources,
  WaveUniformsData,
} from './types.ts';

// =============================================================================
// Constants
// =============================================================================

/** Size of the uniform buffer in bytes (must be 16-byte aligned) */
const UNIFORM_BUFFER_SIZE = 64; // 16 floats * 4 bytes = 64 bytes (aligned)

// =============================================================================
// Texture Creation
// =============================================================================

/**
 * Create a 1D texture for amplitude data (stored as r16float).
 * Using r16float provides good precision while being memory efficient.
 */
export function createAmplitudeTexture(
  device: GPUDevice,
  lod: WaveformLOD
): GPUTexture {
  const texture = device.createTexture({
    label: `amplitude-lod-${lod.samplesPerPixel}`,
    size: {
      width: lod.lengthInPixels,
      height: 1,
      depthOrArrayLayers: 1,
    },
    format: 'r16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  // Convert Float32Array to Float16 and upload
  const float16Data = new Uint16Array(lod.lengthInPixels);
  for (let i = 0; i < lod.lengthInPixels; i++) {
    float16Data[i] = float32ToFloat16(lod.amplitude[i] ?? 0);
  }

  device.queue.writeTexture(
    { texture },
    float16Data,
    { bytesPerRow: lod.lengthInPixels * 2 },
    { width: lod.lengthInPixels, height: 1 }
  );

  return texture;
}

/**
 * Create a 2D texture for band energy data.
 * Layout: width = lengthInPixels, height = bandCount
 * Format: r16float for each band energy value
 */
export function createBandTexture(
  device: GPUDevice,
  lod: WaveformLOD,
  bandCount: number
): GPUTexture {
  const texture = device.createTexture({
    label: `bands-lod-${lod.samplesPerPixel}`,
    size: {
      width: lod.lengthInPixels,
      height: bandCount,
      depthOrArrayLayers: 1,
    },
    format: 'r16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  // Convert and upload band energies
  // Input layout: interleaved [b0_p0, b1_p0, b2_p0, b0_p1, b1_p1, b2_p1, ...]
  // Output layout: row-major per band [row0: p0_b0, p1_b0, ..., row1: p0_b1, p1_b1, ...]
  const float16Data = new Uint16Array(lod.lengthInPixels * bandCount);

  for (let bandIdx = 0; bandIdx < bandCount; bandIdx++) {
    for (let pixelIdx = 0; pixelIdx < lod.lengthInPixels; pixelIdx++) {
      const srcIndex = pixelIdx * bandCount + bandIdx;
      const dstIndex = bandIdx * lod.lengthInPixels + pixelIdx;
      float16Data[dstIndex] = float32ToFloat16(lod.bandEnergies[srcIndex] ?? 0);
    }
  }

  device.queue.writeTexture(
    { texture },
    float16Data,
    { bytesPerRow: lod.lengthInPixels * 2 },
    { width: lod.lengthInPixels, height: bandCount }
  );

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
 * Group 1: amplitude texture + band texture + sampler
 */
export function createBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: 'waveform-bind-group-layout',
    entries: [
      {
        // Uniform buffer
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      {
        // Amplitude texture
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '2d' },
      },
      {
        // Band texture
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '2d' },
      },
      {
        // Texture sampler
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: 'filtering' },
      },
    ],
  });
}

/**
 * Create a bind group for a specific LOD's textures.
 */
export function createLODBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  uniformBuffer: GPUBuffer,
  amplitudeTexture: GPUTexture,
  bandTexture: GPUTexture,
  sampler: GPUSampler
): GPUBindGroup {
  return device.createBindGroup({
    label: 'waveform-lod-bind-group',
    layout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: amplitudeTexture.createView() },
      { binding: 2, resource: bandTexture.createView() },
      { binding: 3, resource: sampler },
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
  // offset 8:  playheadSamples (f32)
  // offset 12: sampleRate (f32)
  // offset 16: rate (f32)
  // offset 20: zoomLevel (f32)
  // offset 24: samplesPerPixel (f32)
  // offset 28: lodLengthInPixels (f32)
  // offset 32: bandCount (u32)
  // offset 36: waveformCenterY (f32)
  // offset 40: waveformMaxHeight (f32)
  // offset 44: time (f32)
  // offset 48-63: padding (to align to 16 bytes)

  floatView[0] = data.viewWidth;
  floatView[1] = data.viewHeight;
  floatView[2] = data.playheadSamples;
  floatView[3] = data.sampleRate;
  floatView[4] = data.rate;
  floatView[5] = data.zoomLevel;
  floatView[6] = data.samplesPerPixel;
  floatView[7] = data.lodLengthInPixels;
  uintView[8] = data.bandCount;
  floatView[9] = data.waveformCenterY;
  floatView[10] = data.waveformMaxHeight;
  floatView[11] = data.time;
  // Remaining slots are padding

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

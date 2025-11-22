/**
 * GPU Readback Debug Utilities
 * Helps verify that WebGPU is actually rendering to the canvas
 */

export interface PixelSample {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
  isBlack: boolean;
}

/**
 * Read pixels from a WebGPU texture and verify rendering
 * This is useful for debugging when the canvas appears black
 */
export async function readbackTexturePixels(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number
): Promise<PixelSample[]> {
  // Create a buffer to read back pixel data
  const bytesPerPixel = 4; // RGBA
  const bytesPerRow = Math.ceil((width * bytesPerPixel) / 256) * 256; // Align to 256
  const bufferSize = bytesPerRow * height;

  const readbackBuffer = device.createBuffer({
    size: bufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    label: 'Readback Buffer',
  });

  // Copy texture to buffer
  const encoder = device.createCommandEncoder({ label: 'Readback Encoder' });

  encoder.copyTextureToBuffer(
    { texture, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
    { buffer: readbackBuffer, bytesPerRow, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 }
  );

  device.queue.submit([encoder.finish()]);

  // Map buffer and read pixels
  await readbackBuffer.mapAsync(GPUMapMode.READ);
  const arrayBuffer = readbackBuffer.getMappedRange();
  const pixelData = new Uint8Array(arrayBuffer);

  // Sample pixels at key locations
  const samples: PixelSample[] = [];
  const samplePoints = [
    { x: Math.floor(width / 2), y: Math.floor(height / 2) }, // Center
    { x: 0, y: 0 }, // Top-left corner
    { x: width - 1, y: 0 }, // Top-right corner
    { x: 0, y: height - 1 }, // Bottom-left corner
    { x: width - 1, y: height - 1 }, // Bottom-right corner
    { x: Math.floor(width / 4), y: Math.floor(height / 2) }, // Left quarter
    { x: Math.floor((width * 3) / 4), y: Math.floor(height / 2) }, // Right quarter
  ];

  for (const point of samplePoints) {
    const offset = point.y * bytesPerRow + point.x * bytesPerPixel;
    const r = pixelData[offset] ?? 0;
    const g = pixelData[offset + 1] ?? 0;
    const b = pixelData[offset + 2] ?? 0;
    const a = pixelData[offset + 3] ?? 0;

    samples.push({
      x: point.x,
      y: point.y,
      r,
      g,
      b,
      a,
      isBlack: r === 0 && g === 0 && b === 0,
    });
  }

  readbackBuffer.unmap();
  readbackBuffer.destroy();

  return samples;
}

/**
 * Analyze pixel samples and provide diagnostic information
 */
export function analyzePixelSamples(samples: PixelSample[]): {
  allBlack: boolean;
  allSameColor: boolean;
  hasVariation: boolean;
  summary: string;
} {
  const allBlack = samples.every((s) => s.isBlack);
  const firstPixel = samples[0];
  const allSameColor = samples.every(
    (s) => s.r === firstPixel?.r && s.g === firstPixel?.g && s.b === firstPixel?.b
  );

  // Check for any variation in colors
  const uniqueColors = new Set(samples.map((s) => `${s.r},${s.g},${s.b}`));
  const hasVariation = uniqueColors.size > 1;

  let summary = '';

  if (allBlack) {
    summary =
      '❌ All sampled pixels are pure black (0,0,0) - shader not rendering or cleared to black';
  } else if (allSameColor) {
    summary = `⚠️ All pixels are the same color (${firstPixel?.r},${firstPixel?.g},${firstPixel?.b}) - possible clear color only`;
  } else if (hasVariation) {
    summary = `✅ Pixels show variation (${uniqueColors.size} unique colors) - rendering is working!`;
  }

  return { allBlack, allSameColor, hasVariation, summary };
}

/**
 * Debug helper to log pixel readback results
 */
export async function debugCanvasPixels(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number
): Promise<void> {
  console.log('[Debug] Reading back pixels from GPU texture...');

  const samples = await readbackTexturePixels(device, texture, width, height);
  const analysis = analyzePixelSamples(samples);

  console.log('[Debug] Pixel Analysis:', analysis);
  console.log('[Debug] Sample Points:');
  console.table(
    samples.map((s) => ({
      Position: `(${s.x}, ${s.y})`,
      RGB: `(${s.r}, ${s.g}, ${s.b})`,
      Alpha: s.a,
      'Is Black': s.isBlack ? '❌ YES' : '✅ NO',
    }))
  );

  // Expected values from shader
  console.log('[Debug] Expected pixel values if shader is working:');
  console.log('  - Background: RGB(12-20, 10-15, 20-30) - dark blue/purple gradient');
  console.log('  - Center line (playhead): RGB(255, 255, 255) - bright white');
  console.log('  - If all pixels are (0,0,0), the shader is not executing');
}

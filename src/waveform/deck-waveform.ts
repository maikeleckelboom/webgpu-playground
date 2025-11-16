/**
 * Main deck waveform component implementation.
 * Provides a reusable WebGPU-based waveform visualization with centered playhead.
 */

import type {
  DeckWaveform,
  DeckWaveformOptions,
  DeckTransportState,
  LODGPUResources,
  WaveUniformsData,
} from './types.ts';

import {
  createBindGroupLayout,
  createUniformBuffer,
  writeUniforms,
  createAllLODResources,
  destroyLODResources,
  selectLODIndex,
  calculateSamplesPerPixel,
  splitPlayheadSamples,
} from './gpu-resources.ts';

import shaderCode from '../shaders/deck-waveform-standalone.wgsl?raw';

// =============================================================================
// Internal Component State
// =============================================================================

interface DeckWaveformInternals {
  device: GPUDevice;
  canvas: HTMLCanvasElement;
  context: GPUCanvasContext;
  format: GPUTextureFormat;

  // Render pipeline
  pipeline: GPURenderPipeline;
  bindGroupLayout: GPUBindGroupLayout;

  // GPU resources
  uniformBuffer: GPUBuffer;
  sampler: GPUSampler;
  lodResources: LODGPUResources[];

  // Current state
  currentTransport: DeckTransportState;
  currentZoom: number;
  currentLODIndex: number;
  viewWidth: number;
  viewHeight: number;
  dpr: number;

  // Waveform pyramid reference
  pyramid: typeof options.waveform;
}

// Capture the options type for the pyramid
let options: DeckWaveformOptions;

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new WebGPU deck waveform instance bound to a given canvas and device.
 * Configures the WebGPU context and all resources required for rendering.
 */
export function createDeckWaveform(opts: DeckWaveformOptions): DeckWaveform {
  options = opts;
  const { device, canvas, waveform } = opts;

  // ==========================================================================
  // WebGPU Context Configuration
  // ==========================================================================

  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('Failed to get WebGPU context from canvas');
  }

  const format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });

  // ==========================================================================
  // Create Shader Module
  // ==========================================================================

  const shaderModule = device.createShaderModule({
    label: 'deck-waveform-shader',
    code: shaderCode,
  });

  // ==========================================================================
  // Create Bind Group Layout and Pipeline Layout
  // ==========================================================================

  const bindGroupLayout = createBindGroupLayout(device);
  const pipelineLayout = device.createPipelineLayout({
    label: 'deck-waveform-pipeline-layout',
    bindGroupLayouts: [bindGroupLayout],
  });

  // ==========================================================================
  // Create Render Pipeline
  // ==========================================================================

  const pipeline = device.createRenderPipeline({
    label: 'deck-waveform-pipeline',
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  // ==========================================================================
  // Create GPU Resources
  // ==========================================================================

  const uniformBuffer = createUniformBuffer(device);

  const sampler = device.createSampler({
    label: 'waveform-sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });

  // Create textures and bind groups for all LODs
  const lodResources = createAllLODResources(
    device,
    waveform,
    bindGroupLayout,
    uniformBuffer,
    sampler
  );

  // ==========================================================================
  // Initialize Internal State
  // ==========================================================================

  const internals: DeckWaveformInternals = {
    device,
    canvas,
    context,
    format,
    pipeline,
    bindGroupLayout,
    uniformBuffer,
    sampler,
    lodResources,
    currentTransport: {
      playheadSamples: 0,
      rate: 1.0,
      bpm: 128,
    },
    currentZoom: 1.0,
    currentLODIndex: 0,
    viewWidth: canvas.width,
    viewHeight: canvas.height,
    dpr: window.devicePixelRatio ?? 1,
    pyramid: waveform,
  };

  // ==========================================================================
  // Component Methods
  // ==========================================================================

  const updateTransport = (state: DeckTransportState): void => {
    internals.currentTransport = state;
  };

  const setZoom = (zoom: number): void => {
    internals.currentZoom = Math.max(0.01, zoom);

    // Update LOD selection based on new zoom
    const targetSamplesPerPixel = calculateSamplesPerPixel(
      internals.viewWidth,
      internals.pyramid.bandConfig.sampleRate,
      internals.currentZoom
    );

    internals.currentLODIndex = selectLODIndex(internals.pyramid, targetSamplesPerPixel);
  };

  const resize = (width: number, height: number, dpr: number): void => {
    internals.viewWidth = width;
    internals.viewHeight = height;
    internals.dpr = dpr;

    // Update canvas size (physical pixels)
    internals.canvas.width = Math.floor(width * dpr);
    internals.canvas.height = Math.floor(height * dpr);

    // Reconfigure context with new size
    internals.context.configure({
      device: internals.device,
      format: internals.format,
      alphaMode: 'premultiplied',
    });

    // Update LOD selection for new viewport
    const targetSamplesPerPixel = calculateSamplesPerPixel(
      width,
      internals.pyramid.bandConfig.sampleRate,
      internals.currentZoom
    );

    internals.currentLODIndex = selectLODIndex(internals.pyramid, targetSamplesPerPixel);
  };

  const frame = (_dt: number, time: number): void => {
    // Select current LOD
    const currentLOD = internals.pyramid.lods[internals.currentLODIndex];
    if (!currentLOD) {
      return;
    }

    // Split playhead into high/low for precision
    const { high: playheadHigh, low: playheadLow } = splitPlayheadSamples(
      internals.currentTransport.playheadSamples
    );

    // Prepare uniforms
    const uniformData: WaveUniformsData = {
      viewWidth: internals.canvas.width,
      viewHeight: internals.canvas.height,
      playheadSamplesHigh: playheadHigh,
      playheadSamplesLow: playheadLow,
      sampleRate: internals.pyramid.bandConfig.sampleRate,
      rate: internals.currentTransport.rate,
      zoomLevel: internals.currentZoom,
      samplesPerPixel: currentLOD.samplesPerPixel,
      lodLengthInPixels: currentLOD.lengthInPixels,
      totalSamples: internals.pyramid.totalSamples,
      bandCount: internals.pyramid.bandConfig.bandCount,
      waveformCenterY: 0.5,     // Center of canvas vertically
      waveformMaxHeight: 0.4,   // Use 80% of canvas height total
      time,
    };

    writeUniforms(internals.device, internals.uniformBuffer, uniformData);

    // Get current texture to render into
    const textureView = internals.context.getCurrentTexture().createView();

    // Create command encoder
    const encoder = internals.device.createCommandEncoder({
      label: 'deck-waveform-encoder',
    });

    // Begin render pass
    const renderPass = encoder.beginRenderPass({
      label: 'deck-waveform-render-pass',
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    // Set pipeline and bind group
    renderPass.setPipeline(internals.pipeline);

    const lodBindGroup = internals.lodResources[internals.currentLODIndex];
    if (lodBindGroup) {
      renderPass.setBindGroup(0, lodBindGroup.bindGroup);
    }

    // Draw fullscreen triangle (3 vertices)
    renderPass.draw(3, 1, 0, 0);

    // End render pass
    renderPass.end();

    // Submit commands
    internals.device.queue.submit([encoder.finish()]);
  };

  const destroy = (): void => {
    // Destroy LOD resources (textures)
    destroyLODResources(internals.lodResources);

    // Destroy uniform buffer
    internals.uniformBuffer.destroy();

    // Clear references
    internals.lodResources = [];
  };

  // ==========================================================================
  // Return Public Interface
  // ==========================================================================

  return {
    updateTransport,
    setZoom,
    resize,
    frame,
    destroy,
  };
}

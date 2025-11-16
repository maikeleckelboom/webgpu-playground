/**
 * Track Overview Component
 * Compact full-track waveform visualization
 */

import type { VisualComponent, VisualContext, Dimensions } from '../types/visual-component.ts';
import type { AudioVisualState, WaveformPyramid } from '../types/audio-state.ts';
import overviewShaderCode from '../shaders/overview.wgsl?raw';

const OVERVIEW_UNIFORMS_SIZE = 32; // 8 floats

interface OverviewGPUResources {
  pipeline: GPURenderPipeline;
  uniformBuffer: GPUBuffer;
  amplitudeTexture: GPUTexture;
  sampler: GPUSampler;
  bindGroup: GPUBindGroup;
  bindGroupLayout: GPUBindGroupLayout;
}

export class TrackOverviewComponent implements VisualComponent {
  readonly id: string;

  private device: GPUDevice | null = null;
  private _ctx: VisualContext | null = null;
  private resources: OverviewGPUResources | null = null;
  private dimensions: Dimensions = {
    width: 800,
    height: 50,
    dpr: 1,
    physicalWidth: 800,
    physicalHeight: 50,
  };

  private deckIndex: number;
  private waveformUploaded = false;

  constructor(deckIndex: number) {
    this.id = `track-overview-${deckIndex}`;
    this.deckIndex = deckIndex;
  }

  async initialize(device: GPUDevice, ctx: VisualContext): Promise<void> {
    this.device = device;
    this._ctx = ctx;

    const shaderModule = device.createShaderModule({
      label: 'Overview Shader',
      code: overviewShaderCode,
    });

    const bindGroupLayout = device.createBindGroupLayout({
      label: 'Overview Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({
      label: 'Overview Pipeline Layout',
      bindGroupLayouts: [bindGroupLayout],
    });

    const pipeline = device.createRenderPipeline({
      label: 'Overview Render Pipeline',
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: ctx.format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    const uniformBuffer = device.createBuffer({
      label: 'Overview Uniforms',
      size: OVERVIEW_UNIFORMS_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Placeholder texture
    const amplitudeTexture = device.createTexture({
      label: 'Overview Amplitude Texture',
      size: [1, 1],
      format: 'rg32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    const sampler = device.createSampler({
      label: 'Overview Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    const bindGroup = device.createBindGroup({
      label: 'Overview Bind Group',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: amplitudeTexture.createView() },
        { binding: 2, resource: sampler },
      ],
    });

    this.resources = {
      pipeline,
      uniformBuffer,
      amplitudeTexture,
      sampler,
      bindGroup,
      bindGroupLayout,
    };
  }

  resize(dim: Dimensions): void {
    this.dimensions = dim;
  }

  update(_dt: number, _time: number, audio: AudioVisualState): void {
    if (!this.device || !this.resources) {return;}

    const deckState = audio.decks[this.deckIndex];
    if (!deckState) {return;}

    // Upload waveform data (use lowest resolution LOD for overview)
    if (!this.waveformUploaded && deckState.waveform) {
      this.uploadWaveformData(deckState.waveform);
      this.waveformUploaded = true;
    }

    // Update uniforms
    const lod = deckState.waveform.lods[deckState.waveform.lods.length - 1]; // Lowest res LOD

    const uniformData = new Float32Array([
      this.dimensions.physicalWidth,
      this.dimensions.physicalHeight,
      deckState.waveform.totalSamples,
      deckState.transport.playheadSamples,
      lod.lengthInPixels,
      deckState.loop.active ? 1.0 : 0.0,
      deckState.loop.inSample,
      deckState.loop.outSample,
    ]);

    this.device.queue.writeBuffer(this.resources.uniformBuffer, 0, uniformData);
  }

  private uploadWaveformData(pyramid: WaveformPyramid): void {
    if (!this.device || !this.resources) {return;}

    // Use the lowest resolution LOD for overview
    const lod = pyramid.lods[pyramid.lods.length - 1];

    this.resources.amplitudeTexture.destroy();

    const amplitudeTexture = this.device.createTexture({
      label: 'Overview Amplitude Texture',
      size: [lod.lengthInPixels, 1],
      format: 'rg32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    this.device.queue.writeTexture(
      { texture: amplitudeTexture },
      lod.amplitude.buffer as ArrayBuffer,
      { bytesPerRow: lod.lengthInPixels * 8 },
      { width: lod.lengthInPixels, height: 1 }
    );

    this.resources.amplitudeTexture = amplitudeTexture;
    this.resources.bindGroup = this.device.createBindGroup({
      label: 'Overview Bind Group',
      layout: this.resources.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.resources.uniformBuffer } },
        { binding: 1, resource: amplitudeTexture.createView() },
        { binding: 2, resource: this.resources.sampler },
      ],
    });
  }

  encode(encoder: GPUCommandEncoder, view: GPUTextureView): void {
    if (!this.resources) {return;}

    const renderPass = encoder.beginRenderPass({
      label: 'Overview Render Pass',
      colorAttachments: [
        {
          view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.08, g: 0.08, b: 0.1, a: 1.0 },
        },
      ],
    });

    renderPass.setPipeline(this.resources.pipeline);
    renderPass.setBindGroup(0, this.resources.bindGroup);
    renderPass.draw(6);

    renderPass.end();
  }

  destroy(): void {
    if (this.resources) {
      this.resources.uniformBuffer.destroy();
      this.resources.amplitudeTexture.destroy();
    }
  }
}

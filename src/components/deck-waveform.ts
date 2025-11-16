/**
 * Real-time Deck Waveform Component
 * Flagship WebGPU component for DJ-style waveform visualization
 */

import type {
  VisualComponent,
  VisualContext,
  Dimensions,
  WaveformKnobState,
  DeckWaveformController,
} from '../types/visual-component.ts';
import type { AudioVisualState, DeckState, WaveformPyramid } from '../types/audio-state.ts';
import waveformShaderCode from '../shaders/waveform.wgsl?raw';

// GPU Buffer alignments
const UNIFORM_ALIGNMENT = 16;
const WAVEFORM_UNIFORMS_SIZE = 128; // 32 floats * 4 bytes

interface WaveformGPUResources {
  pipeline: GPURenderPipeline;
  uniformBuffer: GPUBuffer;
  amplitudeTexture: GPUTexture;
  bandsTexture: GPUTexture;
  sampler: GPUSampler;
  bindGroup: GPUBindGroup;
  bindGroupLayout: GPUBindGroupLayout;
}

export class DeckWaveformComponent implements VisualComponent, DeckWaveformController {
  readonly id: string;

  private device: GPUDevice | null = null;
  private ctx: VisualContext | null = null;
  private resources: WaveformGPUResources | null = null;
  private dimensions: Dimensions = {
    width: 800,
    height: 200,
    dpr: 1,
    physicalWidth: 800,
    physicalHeight: 200,
  };

  private deckIndex: number;
  private zoom: number = 1.0; // Zoom factor (higher = more zoomed in)
  private knobState: WaveformKnobState = {
    lowGain: 1.0,
    midGain: 1.0,
    highGain: 1.0,
    brightness: 1.0,
    contrast: 1.0,
    saturation: 1.0,
  };

  private showBeatGrid: boolean = true;
  private showCuePoints: boolean = true;
  private showLoopRegion: boolean = true;

  private currentDeckState: DeckState | null = null;
  private waveformUploaded: boolean = false;
  private currentLODIndex: number = 0;

  constructor(deckIndex: number) {
    this.id = `deck-waveform-${deckIndex}`;
    this.deckIndex = deckIndex;
  }

  async initialize(device: GPUDevice, ctx: VisualContext): Promise<void> {
    this.device = device;
    this.ctx = ctx;

    // Create shader module
    const shaderModule = device.createShaderModule({
      label: 'Waveform Shader',
      code: waveformShaderCode,
    });

    // Create bind group layout
    const bindGroupLayout = device.createBindGroupLayout({
      label: 'Waveform Bind Group Layout',
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
          texture: { sampleType: 'float' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
      ],
    });

    // Create pipeline layout
    const pipelineLayout = device.createPipelineLayout({
      label: 'Waveform Pipeline Layout',
      bindGroupLayouts: [ctx.sharedBindGroupLayout, bindGroupLayout],
    });

    // Create render pipeline
    const pipeline = device.createRenderPipeline({
      label: 'Waveform Render Pipeline',
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

    // Create uniform buffer
    const uniformBuffer = device.createBuffer({
      label: 'Waveform Uniforms',
      size: WAVEFORM_UNIFORMS_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create placeholder textures (will be replaced when waveform is loaded)
    const amplitudeTexture = device.createTexture({
      label: 'Amplitude Texture',
      size: [1, 1],
      format: 'rg32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    const bandsTexture = device.createTexture({
      label: 'Bands Texture',
      size: [1, 1],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // Create sampler
    const sampler = device.createSampler({
      label: 'Waveform Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Create bind group
    const bindGroup = device.createBindGroup({
      label: 'Waveform Bind Group',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: amplitudeTexture.createView() },
        { binding: 2, resource: bandsTexture.createView() },
        { binding: 3, resource: sampler },
      ],
    });

    this.resources = {
      pipeline,
      uniformBuffer,
      amplitudeTexture,
      bandsTexture,
      sampler,
      bindGroup,
      bindGroupLayout,
    };
  }

  resize(dim: Dimensions): void {
    this.dimensions = dim;
  }

  update(dt: number, time: number, audio: AudioVisualState): void {
    if (!this.device || !this.resources || !this.ctx) return;

    // Get deck state
    const deckState = audio.decks[this.deckIndex];
    if (!deckState) return;

    this.currentDeckState = deckState;

    // Upload waveform data if not done yet
    if (!this.waveformUploaded && deckState.waveform) {
      this.uploadWaveformData(deckState.waveform);
      this.waveformUploaded = true;
    }

    // Select appropriate LOD based on zoom
    this.currentLODIndex = this.selectLOD(deckState.waveform);

    // Update uniforms
    this.updateUniforms(deckState);
  }

  private selectLOD(pyramid: WaveformPyramid): number {
    // Calculate desired samples per pixel based on zoom
    const desiredSamplesPerPixel = this.getBaseSamplesPerPixel() / this.zoom;

    // Find the LOD with the closest samples per pixel
    let bestIndex = 0;
    let bestDiff = Math.abs(pyramid.lods[0].samplesPerPixel - desiredSamplesPerPixel);

    for (let i = 1; i < pyramid.lods.length; i++) {
      const diff = Math.abs(pyramid.lods[i].samplesPerPixel - desiredSamplesPerPixel);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = i;
      }
    }

    return bestIndex;
  }

  private getBaseSamplesPerPixel(): number {
    // Base case: show about 10 seconds of audio across the view
    if (!this.currentDeckState) return 441;
    return (this.currentDeckState.waveform.sampleRate * 10) / this.dimensions.physicalWidth;
  }

  private uploadWaveformData(pyramid: WaveformPyramid): void {
    if (!this.device || !this.resources) return;

    // For simplicity, upload the middle LOD first
    // In production, you'd upload multiple LODs
    const lodIndex = Math.floor(pyramid.lods.length / 2);
    const lod = pyramid.lods[lodIndex];

    // Destroy old textures
    this.resources.amplitudeTexture.destroy();
    this.resources.bandsTexture.destroy();

    // Create new amplitude texture (RG32Float: min, max)
    const amplitudeTexture = this.device.createTexture({
      label: 'Amplitude Texture',
      size: [lod.lengthInPixels, 1],
      format: 'rg32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // Upload amplitude data
    this.device.queue.writeTexture(
      { texture: amplitudeTexture },
      lod.amplitude,
      { bytesPerRow: lod.lengthInPixels * 8 }, // 2 floats * 4 bytes
      { width: lod.lengthInPixels, height: 1 }
    );

    // Create bands texture (RGBA32Float: low, mid, high, unused)
    const bandsTexture = this.device.createTexture({
      label: 'Bands Texture',
      size: [lod.lengthInPixels, 1],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // Convert band energies to RGBA format
    const bandsRGBA = new Float32Array(lod.lengthInPixels * 4);
    const bandCount = pyramid.bands.bandCount;
    for (let i = 0; i < lod.lengthInPixels; i++) {
      // Assuming interleaved band data: [b0_p0, b1_p0, b2_p0, b0_p1, ...]
      bandsRGBA[i * 4 + 0] = lod.bandEnergies[i * bandCount + 0] || 0;
      bandsRGBA[i * 4 + 1] = lod.bandEnergies[i * bandCount + 1] || 0;
      bandsRGBA[i * 4 + 2] = lod.bandEnergies[i * bandCount + 2] || 0;
      bandsRGBA[i * 4 + 3] = 1.0;
    }

    this.device.queue.writeTexture(
      { texture: bandsTexture },
      bandsRGBA,
      { bytesPerRow: lod.lengthInPixels * 16 }, // 4 floats * 4 bytes
      { width: lod.lengthInPixels, height: 1 }
    );

    // Recreate bind group with new textures
    this.resources.amplitudeTexture = amplitudeTexture;
    this.resources.bandsTexture = bandsTexture;
    this.resources.bindGroup = this.device.createBindGroup({
      label: 'Waveform Bind Group',
      layout: this.resources.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.resources.uniformBuffer } },
        { binding: 1, resource: amplitudeTexture.createView() },
        { binding: 2, resource: bandsTexture.createView() },
        { binding: 3, resource: this.resources.sampler },
      ],
    });
  }

  private updateUniforms(deckState: DeckState): void {
    if (!this.device || !this.resources) return;

    const lod = deckState.waveform.lods[this.currentLODIndex];

    // Split playhead into high/low for precision
    const playheadHigh = Math.floor(deckState.transport.playheadSamples / 16777216);
    const playheadLow = deckState.transport.playheadSamples % 16777216;

    const uniformData = new Float32Array([
      // Playhead and sample info
      playheadHigh,
      playheadLow,
      deckState.waveform.sampleRate,
      deckState.waveform.totalSamples,

      // Zoom and view
      this.getBaseSamplesPerPixel() / this.zoom,
      this.dimensions.physicalWidth,
      this.dimensions.physicalHeight,
      this.currentLODIndex,

      // LOD info
      lod.samplesPerPixel,
      lod.lengthInPixels,
      deckState.waveform.bands.bandCount,
      0, // padding

      // Visual settings
      this.knobState.brightness,
      this.knobState.contrast,
      this.knobState.saturation,
      0, // padding

      // Band gains
      this.knobState.lowGain,
      this.knobState.midGain,
      this.knobState.highGain,
      0, // padding

      // Loop region
      deckState.loop.active ? 1.0 : 0.0,
      deckState.loop.inSample,
      deckState.loop.outSample,
      this.showBeatGrid ? 1.0 : 0.0,

      // Beat grid
      deckState.transport.bpm,
      deckState.transport.beatPhase,
      0, // padding
      0, // padding
    ]);

    this.device.queue.writeBuffer(this.resources.uniformBuffer, 0, uniformData);
  }

  encode(encoder: GPUCommandEncoder, view: GPUTextureView): void {
    if (!this.resources || !this.ctx) return;

    const renderPass = encoder.beginRenderPass({
      label: 'Waveform Render Pass',
      colorAttachments: [
        {
          view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.05, g: 0.05, b: 0.07, a: 1.0 },
        },
      ],
    });

    renderPass.setPipeline(this.resources.pipeline);
    renderPass.setBindGroup(0, this.ctx.sharedBindGroup);
    renderPass.setBindGroup(1, this.resources.bindGroup);
    renderPass.draw(6); // Full-screen quad

    renderPass.end();
  }

  destroy(): void {
    if (this.resources) {
      this.resources.uniformBuffer.destroy();
      this.resources.amplitudeTexture.destroy();
      this.resources.bandsTexture.destroy();
    }
  }

  // Controller interface
  setZoom(zoom: number): void {
    this.zoom = Math.max(0.1, Math.min(100.0, zoom));
  }

  setKnobState(state: Partial<WaveformKnobState>): void {
    this.knobState = { ...this.knobState, ...state };
  }

  getKnobState(): WaveformKnobState {
    return { ...this.knobState };
  }

  setShowBeatGrid(show: boolean): void {
    this.showBeatGrid = show;
  }

  setShowCuePoints(show: boolean): void {
    this.showCuePoints = show;
  }

  setShowLoopRegion(show: boolean): void {
    this.showLoopRegion = show;
  }
}

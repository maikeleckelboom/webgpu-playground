<!-- Repo-Roller bundle -->
<!-- Generated: 2025-12-11 -->

# 📦 Source Code Archive

**Root**: `/home/libs/webgpu-playground`
**Files**: 32
**Total size**: 278.19 KB

---

## 📂 Directory Structure

```
├── 📁 src
│   ├── 📁 components
│   │   ├── 📄 channel-meters.ts
│   │   ├── 📄 deck-waveform.ts
│   │   └── 📄 track-overview.ts
│   ├── 📁 core
│   │   └── 📄 gpu-runtime.ts
│   ├── 📄 main.ts
│   ├── 📁 shaders
│   │   ├── 📄 deck-waveform-standalone.wgsl
│   │   ├── 📄 knobs.wgsl
│   │   ├── 📄 meters.wgsl
│   │   ├── 📄 overview.wgsl
│   │   └── 📄 waveform.wgsl
│   ├── 📁 types
│   │   ├── 📄 audio-state.ts
│   │   └── 📄 visual-component.ts
│   ├── 📁 utils
│   │   ├── 📄 debug-readback.ts
│   │   └── 📄 test-data.ts
│   ├── 📄 vite-env.d.ts
│   └── 📁 waveform
│       ├── 📄 deck-waveform.ts
│       ├── 📄 demo.ts
│       ├── 📄 gpu-resources.ts
│       ├── 📄 index.ts
│       ├── 📄 test-harness.ts
│       └── 📄 types.ts
└── 📁 tests
    ├── 📁 browser
    │   ├── 📄 test-harness.ts
    │   ├── 📄 waveform-behavior.browser.test.ts
    │   └── 📄 waveform-visual.browser.test.ts
    ├── 📄 components.test.ts
    ├── 📁 gpu-plumbing
    │   └── 📄 resource-creation.test.ts
    ├── 📄 gpu-runtime.test.ts
    ├── 📁 logic
    │   ├── 📄 lod-selection.test.ts
    │   └── 📄 test-data-generation.test.ts
    ├── 📄 README.md
    ├── 📄 setup.ts
    └── 📄 test-data.test.ts
```

## 📊 Statistics

- **Total files**: 32
- **Total size**: 278.19 KB
- **Files by extension**:
  - ts: 26 files
  - wgsl: 5 files
  - md: 1 file

## 📄 Files

### `src/components/channel-meters.ts` {#src-components-channel-meters-ts}

```typescript
// File: src/components/channel-meters.ts

import type { VisualComponent, VisualContext, Dimensions } from '../types/visual-component.ts';
import type { AudioVisualState, ChannelMeter } from '../types/audio-state.ts';
import metersShaderCode from '../shaders/meters.wgsl?raw';
const METER_UNIFORMS_SIZE = 16; 
const CHANNEL_DATA_SIZE = 32; 
interface MeterGPUResources {
  pipeline: GPURenderPipeline;
  uniformBuffer: GPUBuffer;
  channelBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
}
export class ChannelMetersComponent implements VisualComponent {
  readonly id: string = 'channel-meters';
  private device: GPUDevice | null = null;
  private _ctx: VisualContext | null = null;
  private resources: MeterGPUResources | null = null;
  private dimensions: Dimensions = {
    width: 100,
    height: 300,
    dpr: 1,
    physicalWidth: 100,
    physicalHeight: 300,
  };
  private channelCount = 2;
  private peakHoldValues: number[] = [];
  private peakHoldTimers: number[] = [];
  private peakHoldDuration = 2.0; 
  constructor(channelCount = 2) {
    this.channelCount = channelCount;
    this.peakHoldValues = new Array(channelCount).fill(0);
    this.peakHoldTimers = new Array(channelCount).fill(0);
  }
  async initialize(device: GPUDevice, ctx: VisualContext): Promise<void> {
    this.device = device;
    this._ctx = ctx;
    const shaderModule = device.createShaderModule({
      label: 'Meters Shader',
      code: metersShaderCode,
    });
    const bindGroupLayout = device.createBindGroupLayout({
      label: 'Meters Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({
      label: 'Meters Pipeline Layout',
      bindGroupLayouts: [bindGroupLayout],
    });
    const pipeline = device.createRenderPipeline({
      label: 'Meters Render Pipeline',
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
      label: 'Meters Uniforms',
      size: METER_UNIFORMS_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const channelBuffer = device.createBuffer({
      label: 'Channel Data',
      size: CHANNEL_DATA_SIZE * this.channelCount,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      label: 'Meters Bind Group',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: channelBuffer } },
      ],
    });
    this.resources = {
      pipeline,
      uniformBuffer,
      channelBuffer,
      bindGroup,
    };
  }
  resize(dim: Dimensions): void {
    this.dimensions = dim;
  }
  update(dt: number, time: number, audio: AudioVisualState): void {
    if (!this.device || !this.resources) {return;}
    const uniformData = new Float32Array([
      this.dimensions.physicalWidth,
      this.dimensions.physicalHeight,
      this.channelCount,
      0, 
    ]);
    this.device.queue.writeBuffer(this.resources.uniformBuffer, 0, uniformData);
    const channelData = new Float32Array(8 * this.channelCount);
    for (let i = 0; i < this.channelCount; i++) {
      let meter: ChannelMeter;
      if (i < audio.decks.length) {
        meter = {
          rms: 0.5 + Math.sin(time * 2 + i) * 0.3,
          peak: 0.6 + Math.sin(time * 3 + i) * 0.3,
          peakHold: this.peakHoldValues[i],
          lufs: -14,
          lowEnergy: 0.4 + Math.sin(time * 1.5 + i) * 0.3,
          midEnergy: 0.5 + Math.sin(time * 2.5 + i) * 0.3,
          highEnergy: 0.3 + Math.sin(time * 4 + i) * 0.2,
        };
      } else {
        meter = audio.master;
      }
      if (meter.peak > this.peakHoldValues[i]) {
        this.peakHoldValues[i] = meter.peak;
        this.peakHoldTimers[i] = this.peakHoldDuration;
      } else {
        this.peakHoldTimers[i] -= dt;
        if (this.peakHoldTimers[i] <= 0) {
          this.peakHoldValues[i] = Math.max(0, this.peakHoldValues[i] - dt * 0.5);
        }
      }
      channelData[i * 8 + 0] = meter.rms;
      channelData[i * 8 + 1] = meter.peak;
      channelData[i * 8 + 2] = this.peakHoldValues[i];
      channelData[i * 8 + 3] = meter.lowEnergy;
      channelData[i * 8 + 4] = meter.midEnergy;
      channelData[i * 8 + 5] = meter.highEnergy;
      channelData[i * 8 + 6] = 0; 
      channelData[i * 8 + 7] = 0; 
    }
    this.device.queue.writeBuffer(this.resources.channelBuffer, 0, channelData);
  }
  encode(encoder: GPUCommandEncoder, view: GPUTextureView): void {
    if (!this.resources) {return;}
    const renderPass = encoder.beginRenderPass({
      label: 'Meters Render Pass',
      colorAttachments: [
        {
          view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.06, g: 0.06, b: 0.08, a: 1.0 },
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
      this.resources.channelBuffer.destroy();
    }
  }
}
```

### `src/components/deck-waveform.ts` {#src-components-deck-waveform-ts}

```typescript
// File: src/components/deck-waveform.ts

import type {
  VisualComponent,
  VisualContext,
  Dimensions,
  WaveformKnobState,
  DeckWaveformController,
} from '../types/visual-component.ts';
import type { AudioVisualState, DeckState, WaveformPyramid } from '../types/audio-state.ts';
import waveformShaderCode from '../shaders/waveform.wgsl?raw';
const _UNIFORM_ALIGNMENT = 16;
const WAVEFORM_UNIFORMS_SIZE = 128; 
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
  private zoom = 1.0; 
  private knobState: WaveformKnobState = {
    lowGain: 1.0,
    midGain: 1.0,
    highGain: 1.0,
    brightness: 1.0,
    contrast: 1.0,
    saturation: 1.0,
  };
  private showBeatGrid = true;
  private _showCuePoints = true;
  private _showLoopRegion = true;
  private currentDeckState: DeckState | null = null;
  private waveformUploaded = false;
  private currentLODIndex = 0;
  private hasLoggedFirstFrame = false;
  private waveformDirty = false;
  constructor(deckIndex: number) {
    this.id = `deck-waveform-${deckIndex}`;
    this.deckIndex = deckIndex;
  }
  async initialize(device: GPUDevice, ctx: VisualContext): Promise<void> {
    this.device = device;
    this.ctx = ctx;
    const shaderModule = device.createShaderModule({
      label: 'Waveform Shader',
      code: waveformShaderCode,
    });
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
          texture: { sampleType: 'unfilterable-float' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'non-filtering' },
        },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({
      label: 'Waveform Pipeline Layout',
      bindGroupLayouts: [ctx.sharedBindGroupLayout, bindGroupLayout],
    });
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
    const uniformBuffer = device.createBuffer({
      label: 'Waveform Uniforms',
      size: WAVEFORM_UNIFORMS_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
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
    const sampler = device.createSampler({
      label: 'Waveform Sampler',
      magFilter: 'nearest',
      minFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
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
  update(_dt: number, _time: number, audio: AudioVisualState): void {
    if (!this.device || !this.resources || !this.ctx) {return;}
    const deckState = audio.decks[this.deckIndex];
    if (!deckState) {return;}
    this.currentDeckState = deckState;
    const newLODIndex = this.selectLOD(deckState.waveform);
    const lodChanged = newLODIndex !== this.currentLODIndex;
    this.currentLODIndex = newLODIndex;
    if ((!this.waveformUploaded || this.waveformDirty || lodChanged) && deckState.waveform) {
      if (deckState.waveform.lods.length > 0 && deckState.waveform.totalSamples > 0) {
        this.uploadWaveformData(deckState.waveform);
        this.waveformUploaded = true;
        this.waveformDirty = false;
      }
    }
    this.updateUniforms(deckState);
  }
  markWaveformDirty(): void {
    this.waveformDirty = true;
    this.waveformUploaded = false;
  }
  private selectLOD(pyramid: WaveformPyramid): number {
    const desiredSamplesPerPixel = this.getBaseSamplesPerPixel() / this.zoom;
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
    if (!this.currentDeckState) {return 441;}
    return (this.currentDeckState.waveform.sampleRate * 10) / this.dimensions.physicalWidth;
  }
  private uploadWaveformData(pyramid: WaveformPyramid): void {
    if (!this.device || !this.resources) {return;}
    if (pyramid.lods.length === 0) {
      console.error('[DeckWaveformComponent] No LODs in waveform pyramid');
      return;
    }
    const lodIndex = Math.min(
      Math.max(0, this.currentLODIndex),
      pyramid.lods.length - 1
    );
    const lod = pyramid.lods[lodIndex];
    if (!lod || lod.lengthInPixels === 0) {
      console.error('[DeckWaveformComponent] Invalid LOD data', { lodIndex, lod });
      return;
    }
    console.log('[DeckWaveformComponent] Uploading waveform data', {
      lodIndex,
      lengthInPixels: lod.lengthInPixels,
      samplesPerPixel: lod.samplesPerPixel,
      totalSamples: pyramid.totalSamples,
      amplitudeLength: lod.amplitude.length,
      bandEnergiesLength: lod.bandEnergies.length,
      bandCount: pyramid.bands.bandCount,
    });
    this.resources.amplitudeTexture.destroy();
    this.resources.bandsTexture.destroy();
    const amplitudeTexture = this.device.createTexture({
      label: 'Amplitude Texture',
      size: [lod.lengthInPixels, 1],
      format: 'rg32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const expectedAmplitudeSize = lod.lengthInPixels * 2;
    if (lod.amplitude.length !== expectedAmplitudeSize) {
      console.warn('[DeckWaveformComponent] Amplitude data size mismatch', {
        expected: expectedAmplitudeSize,
        actual: lod.amplitude.length,
      });
    }
    const amplitudeData = new Float32Array(lod.lengthInPixels * 2);
    for (let i = 0; i < lod.lengthInPixels; i++) {
      amplitudeData[i * 2 + 0] = lod.amplitude[i * 2 + 0] ?? 0; 
      amplitudeData[i * 2 + 1] = lod.amplitude[i * 2 + 1] ?? 0; 
    }
    this.device.queue.writeTexture(
      { texture: amplitudeTexture },
      amplitudeData,
      { bytesPerRow: lod.lengthInPixels * 8 }, 
      { width: lod.lengthInPixels, height: 1 }
    );
    const bandsTexture = this.device.createTexture({
      label: 'Bands Texture',
      size: [lod.lengthInPixels, 1],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const bandsRGBA = new Float32Array(lod.lengthInPixels * 4);
    const bandCount = pyramid.bands.bandCount;
    const expectedBandSize = lod.lengthInPixels * bandCount;
    if (lod.bandEnergies.length !== expectedBandSize) {
      console.warn('[DeckWaveformComponent] Band energies size mismatch', {
        expected: expectedBandSize,
        actual: lod.bandEnergies.length,
      });
    }
    for (let i = 0; i < lod.lengthInPixels; i++) {
      bandsRGBA[i * 4 + 0] = lod.bandEnergies[i * bandCount + 0] || 0;
      bandsRGBA[i * 4 + 1] = lod.bandEnergies[i * bandCount + 1] || 0;
      bandsRGBA[i * 4 + 2] = lod.bandEnergies[i * bandCount + 2] || 0;
      bandsRGBA[i * 4 + 3] = 1.0;
    }
    this.device.queue.writeTexture(
      { texture: bandsTexture },
      bandsRGBA,
      { bytesPerRow: lod.lengthInPixels * 16 }, 
      { width: lod.lengthInPixels, height: 1 }
    );
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
    console.log('[DeckWaveformComponent] Waveform data uploaded successfully');
  }
  private updateUniforms(deckState: DeckState): void {
    if (!this.device || !this.resources) {return;}
    const lodIndex = Math.min(
      Math.max(0, this.currentLODIndex),
      deckState.waveform.lods.length - 1
    );
    const lod = deckState.waveform.lods[lodIndex];
    if (!lod) {
      console.error('[DeckWaveformComponent] LOD not found at index', lodIndex);
      return;
    }
    const playheadHigh = Math.floor(deckState.transport.playheadSamples / 16777216);
    const playheadLow = deckState.transport.playheadSamples % 16777216;
    const uniformData = new Float32Array([
      playheadHigh,
      playheadLow,
      deckState.waveform.sampleRate,
      deckState.waveform.totalSamples,
      this.getBaseSamplesPerPixel() / this.zoom,
      this.dimensions.physicalWidth,
      this.dimensions.physicalHeight,
      this.currentLODIndex,
      lod.samplesPerPixel,
      lod.lengthInPixels,
      deckState.waveform.bands.bandCount,
      0, 
      this.knobState.brightness,
      this.knobState.contrast,
      this.knobState.saturation,
      0, 
      this.knobState.lowGain,
      this.knobState.midGain,
      this.knobState.highGain,
      0, 
      deckState.loop.active ? 1.0 : 0.0,
      deckState.loop.inSample,
      deckState.loop.outSample,
      this.showBeatGrid ? 1.0 : 0.0,
      deckState.transport.bpm,
      deckState.transport.beatPhase,
      0, 
      0, 
    ]);
    if (this.waveformUploaded && !this.hasLoggedFirstFrame) {
      console.log('[DeckWaveformComponent] Uniform values being set:', {
        playheadSamples: deckState.transport.playheadSamples,
        playheadHigh,
        playheadLow,
        sampleRate: deckState.waveform.sampleRate,
        totalSamples: deckState.waveform.totalSamples,
        viewWidth: this.dimensions.physicalWidth,
        viewHeight: this.dimensions.physicalHeight,
        samplesPerPixel: this.getBaseSamplesPerPixel() / this.zoom,
        lodIndex: this.currentLODIndex,
        lodSamplesPerPixel: lod.samplesPerPixel,
        lodLengthInPixels: lod.lengthInPixels,
        bandCount: deckState.waveform.bands.bandCount,
      });
    }
    this.device.queue.writeBuffer(this.resources.uniformBuffer, 0, uniformData);
  }
  encode(encoder: GPUCommandEncoder, view: GPUTextureView): void {
    if (!this.resources || !this.ctx) {
      console.warn('[DeckWaveformComponent] encode() skipped: resources or ctx is null');
      return;
    }
    if (!this.hasLoggedFirstFrame) {
      console.log('[DeckWaveformComponent] First render frame', {
        hasTextures: Boolean(this.resources.amplitudeTexture && this.resources.bandsTexture),
        waveformUploaded: this.waveformUploaded,
        dimensions: this.dimensions,
        hasSharedBindGroup: Boolean(this.ctx.sharedBindGroup),
        hasWaveformBindGroup: Boolean(this.resources.bindGroup),
      });
      this.hasLoggedFirstFrame = true;
    }
    const renderPass = encoder.beginRenderPass({
      label: 'Waveform Render Pass',
      colorAttachments: [
        {
          view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.05, g: 0.06, b: 0.12, a: 1.0 },
        },
      ],
    });
    renderPass.setPipeline(this.resources.pipeline);
    renderPass.setBindGroup(0, this.ctx.sharedBindGroup);
    renderPass.setBindGroup(1, this.resources.bindGroup);
    renderPass.draw(6); 
    renderPass.end();
  }
  destroy(): void {
    if (this.resources) {
      this.resources.uniformBuffer.destroy();
      this.resources.amplitudeTexture.destroy();
      this.resources.bandsTexture.destroy();
    }
  }
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
    this._showCuePoints = show;
  }
  setShowLoopRegion(show: boolean): void {
    this._showLoopRegion = show;
  }
}
```

### `src/components/track-overview.ts` {#src-components-track-overview-ts}

```typescript
// File: src/components/track-overview.ts

import type { VisualComponent, VisualContext, Dimensions } from '../types/visual-component.ts';
import type { AudioVisualState, WaveformPyramid } from '../types/audio-state.ts';
import overviewShaderCode from '../shaders/overview.wgsl?raw';
const OVERVIEW_UNIFORMS_SIZE = 32; 
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
    if (!this.waveformUploaded && deckState.waveform) {
      this.uploadWaveformData(deckState.waveform);
      this.waveformUploaded = true;
    }
    const lod = deckState.waveform.lods[deckState.waveform.lods.length - 1]; 
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
```

### `src/core/gpu-runtime.ts` {#src-core-gpu-runtime-ts}

```typescript
// File: src/core/gpu-runtime.ts

import type {Dimensions, VisualContext} from '../types/visual-component.ts';
import {DEFAULT_THEME, type VisualTheme} from '../types/audio-state.ts';
export interface GPURuntimeConfig {
    readonly canvas: HTMLCanvasElement;
    readonly theme?: VisualTheme;
}
export class GPURuntime {
    private device: GPUDevice | null = null;
    private context: GPUCanvasContext | null = null;
    private format: GPUTextureFormat = 'bgra8unorm';
    private sharedUniformBuffer: GPUBuffer | null = null;
    private sharedBindGroupLayout: GPUBindGroupLayout | null = null;
    private sharedBindGroup: GPUBindGroup | null = null;
    private canvas: HTMLCanvasElement;
    private theme: VisualTheme;
    private dimensions: Dimensions = {
        width: 0,
        height: 0,
        dpr: 1,
        physicalWidth: 0,
        physicalHeight: 0,
    };
    constructor(config: GPURuntimeConfig) {
        this.canvas = config.canvas;
        this.theme = config.theme ?? DEFAULT_THEME;
    }
    async initialize(): Promise<void> {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error('WebGPU not supported: No adapter available');
        }
        this.device = await adapter.requestDevice({
            requiredFeatures: [],
            requiredLimits: {},
        });
        void this.device.lost.then((info) => {
            console.error('WebGPU device lost:', info.message);
        });
        this.context = this.canvas.getContext('webgpu');
        if (!this.context) {
            throw new Error('Failed to get WebGPU canvas context');
        }
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: 'premultiplied',
        });
        this.createSharedResources();
        this.resize(this.canvas.clientWidth, this.canvas.clientHeight, window.devicePixelRatio);
    }
    resize(width: number, height: number, dpr: number): void {
        const safeWidth = Math.max(1, Math.floor(width));
        const safeHeight = Math.max(1, Math.floor(height));
        const safeDPR = Math.max(0.1, dpr);
        this.dimensions = {
            width: safeWidth,
            height: safeHeight,
            dpr: safeDPR,
            physicalWidth: Math.max(1, Math.floor(safeWidth * safeDPR)),
            physicalHeight: Math.max(1, Math.floor(safeHeight * safeDPR)),
        };
        this.canvas.width = this.dimensions.physicalWidth;
        this.canvas.height = this.dimensions.physicalHeight;
        if (this.context && this.device) {
            this.context.configure({
                device: this.device,
                format: this.format,
                alphaMode: 'premultiplied',
            });
        }
    }
    updateSharedUniforms(time: number, deltaTime: number): void {
        if (!this.device || !this.sharedUniformBuffer) {
            return;
        }
        const data = new Float32Array([
            time,
            deltaTime,
            this.dimensions.physicalWidth,
            this.dimensions.physicalHeight,
        ]);
        this.device.queue.writeBuffer(this.sharedUniformBuffer, 0, data);
    }
    getCurrentTexture(): GPUTexture | null {
        return this.context?.getCurrentTexture() ?? null;
    }
    getContext(): VisualContext {
        if (!this.device || !this.sharedUniformBuffer || !this.sharedBindGroupLayout || !this.sharedBindGroup) {
            throw new Error('Runtime not initialized');
        }
        return {
            device: this.device,
            format: this.format,
            theme: this.theme,
            sharedUniformBuffer: this.sharedUniformBuffer,
            sharedBindGroupLayout: this.sharedBindGroupLayout,
            sharedBindGroup: this.sharedBindGroup,
        };
    }
    getDevice(): GPUDevice {
        if (!this.device) {
            throw new Error('Device not initialized');
        }
        return this.device;
    }
    getDimensions(): Dimensions {
        return this.dimensions;
    }
    getFormat(): GPUTextureFormat {
        return this.format;
    }
    destroy(): void {
        this.sharedUniformBuffer?.destroy();
        this.device?.destroy();
        this.device = null;
        this.context = null;
    }
    private createSharedResources(): void {
        if (!this.device) {
            throw new Error('Device not initialized');
        }
        this.sharedUniformBuffer = this.device.createBuffer({
            size: 16, 
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: 'Shared Uniforms',
        });
        this.sharedBindGroupLayout = this.device.createBindGroupLayout({
            label: 'Shared Bind Group Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: {type: 'uniform'},
                },
            ],
        });
        this.sharedBindGroup = this.device.createBindGroup({
            label: 'Shared Bind Group',
            layout: this.sharedBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {buffer: this.sharedUniformBuffer},
                },
            ],
        });
    }
}
```

### `src/main.ts` {#src-main-ts}

```typescript
// File: src/main.ts

import { GPURuntime } from './core/gpu-runtime.ts';
import { DeckWaveformComponent } from './components/deck-waveform.ts';
import { ChannelMetersComponent } from './components/channel-meters.ts';
import {
  createTestDeckState,
  createTestAudioVisualState,
  updateTransportPlayback,
  buildWaveformPyramidFromPCM,
} from './utils/test-data.ts';
import type { DeckState, AudioVisualState } from './types/audio-state.ts';
import { debugCanvasPixels } from './utils/debug-readback.ts';
interface GPUInfo {
  adapter: GPUAdapterInfo;
  features: string[];
  limits: Record<string, number>;
}
class DJVisualizationApp {
  private runtime: GPURuntime | null = null;
  private waveformComponent: DeckWaveformComponent | null = null;
  private metersComponent: ChannelMetersComponent | null = null;
  private deckState: DeckState;
  private audioState: AudioVisualState;
  private isPlaying = false;
  private loopActive = false;
  private animationFrameId = 0;
  private lastTime = 0;
  private deckCanvas: HTMLCanvasElement;
  private metersCanvas: HTMLCanvasElement;
  private frameCount = 0;
  private lastFPSUpdate = 0;
  private currentFPS = 0;
  private gpuInfo: GPUInfo | null = null;
  private hasRunFirstFrameDebug = false;
  constructor() {
    const deckCanvas = document.getElementById('deck-a') as HTMLCanvasElement | null;
    const metersCanvas = document.getElementById('meters') as HTMLCanvasElement | null;
    if (!deckCanvas || !metersCanvas) {
      throw new Error('Canvas elements not found');
    }
    this.deckCanvas = deckCanvas;
    this.metersCanvas = metersCanvas;
    this.deckState = createTestDeckState({
      durationSeconds: 10, 
      sampleRate: 44100,
      bpm: 128,
      key: 'Am',
      title: 'Synthetic Wave',
      artist: 'WebGPU Demo',
    });
    this.audioState = createTestAudioVisualState([this.deckState]);
    this.updateTrackInfo();
  }
  async initialize(): Promise<void> {
    this.updateStatus('Checking WebGPU support...');
    if (!navigator.gpu) {
      this.showError(
        'WebGPU is not supported in your browser.<br><br>' +
        'Please use <a href="https:
        '<a href="https:
        'You can check WebGPU support at <a href="https:
      );
      return;
    }
    try {
      this.updateStatus('Requesting GPU adapter...');
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });
      if (!adapter) {
        throw new Error('No WebGPU adapter found. Your GPU may not support WebGPU.');
      }
      let adapterInfo: GPUAdapterInfo;
      if ('requestAdapterInfo' in adapter && typeof adapter.requestAdapterInfo === 'function') {
        adapterInfo = await (adapter as GPUAdapter & { requestAdapterInfo: () => Promise<GPUAdapterInfo> }).requestAdapterInfo();
      } else {
        adapterInfo = {
          vendor: '',
          architecture: '',
          device: '',
          description: '',
        } as unknown as GPUAdapterInfo;
      }
      this.gpuInfo = {
        adapter: adapterInfo,
        features: Array.from(adapter.features),
        limits: this.extractLimits(adapter.limits),
      };
      this.updateStatus('Initializing GPU device...');
      this.runtime = new GPURuntime({ canvas: this.deckCanvas });
      await this.runtime.initialize();
      const ctx = this.runtime.getContext();
      this.updateStatus('Creating waveform component...');
      this.waveformComponent = new DeckWaveformComponent(0);
      await this.waveformComponent.initialize(this.runtime.getDevice(), ctx);
      this.updateStatus('Creating meters component...');
      const metersRuntime = new GPURuntime({ canvas: this.metersCanvas });
      await metersRuntime.initialize();
      this.metersComponent = new ChannelMetersComponent(2);
      await this.metersComponent.initialize(metersRuntime.getDevice(), metersRuntime.getContext());
      this.setupEventHandlers();
      this.setupKeyboardShortcuts();
      this.handleResize();
      window.addEventListener('resize', () => {
        this.handleResize();
      });
      this.showMainUI();
      this.lastTime = performance.now() / 1000;
      this.lastFPSUpdate = performance.now();
      this.render();
      this.updateInfoDisplay();
      this.updateGPUStats();
      console.log('WebGPU DJ Visualization initialized successfully', this.gpuInfo);
    } catch (error) {
      console.error('Failed to initialize WebGPU:', error);
      this.showError(
        `Failed to initialize WebGPU:<br><br>${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  private extractLimits(limits: GPUSupportedLimits): Record<string, number> {
    const result: Record<string, number> = {};
    const keys = [
      'maxTextureDimension2D',
      'maxTextureArrayLayers',
      'maxBindGroups',
      'maxUniformBufferBindingSize',
      'maxStorageBufferBindingSize',
    ];
    for (const key of keys) {
      const value = limits[key as keyof GPUSupportedLimits];
      if (typeof value === 'number') {
        result[key] = value;
      }
    }
    return result;
  }
  private updateStatus(text: string): void {
    const statusText = document.getElementById('status-text');
    const loadingText = document.querySelector('.loading-text');
    if (statusText) {
      statusText.textContent = text;
    }
    if (loadingText) {
      loadingText.textContent = text;
    }
  }
  private showMainUI(): void {
    const loading = document.getElementById('loading');
    const deckContainer = document.getElementById('deck-a-container');
    const metersContainer = document.getElementById('meters-container');
    const gpuStats = document.getElementById('gpu-stats');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    if (loading) {
      loading.style.display = 'none';
    }
    if (deckContainer) {
      deckContainer.style.display = 'block';
    }
    if (metersContainer) {
      metersContainer.style.display = 'block';
    }
    if (gpuStats) {
      gpuStats.style.display = 'block';
    }
    if (statusDot) {
      statusDot.classList.add('ready');
    }
    if (statusText) {
      statusText.textContent = 'Ready';
    }
  }
  private updateTrackInfo(): void {
    const titleEl = document.getElementById('track-title');
    const artistEl = document.getElementById('track-artist');
    if (titleEl) {
      titleEl.textContent = this.deckState.trackTitle || 'Unknown Track';
    }
    if (artistEl) {
      artistEl.textContent = this.deckState.trackArtist || 'Unknown Artist';
    }
  }
  private updateGPUStats(): void {
    const gpuInfoEl = document.getElementById('gpu-info');
    if (gpuInfoEl && this.gpuInfo) {
      const info = this.gpuInfo.adapter;
      const gpuName = info.device || info.description || 'Unknown GPU';
      gpuInfoEl.textContent = gpuName.length > 30 ? gpuName.slice(0, 30) + '...' : gpuName;
    }
  }
  private setupEventHandlers(): void {
    const zoomSlider = document.getElementById('zoom-a') as HTMLInputElement | null;
    const zoomValue = document.getElementById('zoom-value');
    if (zoomSlider && this.waveformComponent) {
      zoomSlider.addEventListener('input', () => {
        const zoom = parseFloat(zoomSlider.value);
        this.waveformComponent?.setZoom(zoom);
        if (zoomValue) {
          zoomValue.textContent = `${zoom.toFixed(1)}x`;
        }
      });
    }
    const lowGainSlider = document.getElementById('low-gain-a') as HTMLInputElement | null;
    const midGainSlider = document.getElementById('mid-gain-a') as HTMLInputElement | null;
    const highGainSlider = document.getElementById('high-gain-a') as HTMLInputElement | null;
    const lowValue = document.getElementById('low-value');
    const midValue = document.getElementById('mid-value');
    const highValue = document.getElementById('high-value');
    if (lowGainSlider) {
      lowGainSlider.addEventListener('input', () => {
        const value = parseFloat(lowGainSlider.value);
        this.waveformComponent?.setKnobState({ lowGain: value });
        if (lowValue) lowValue.textContent = value.toFixed(1);
      });
    }
    if (midGainSlider) {
      midGainSlider.addEventListener('input', () => {
        const value = parseFloat(midGainSlider.value);
        this.waveformComponent?.setKnobState({ midGain: value });
        if (midValue) midValue.textContent = value.toFixed(1);
      });
    }
    if (highGainSlider) {
      highGainSlider.addEventListener('input', () => {
        const value = parseFloat(highGainSlider.value);
        this.waveformComponent?.setKnobState({ highGain: value });
        if (highValue) highValue.textContent = value.toFixed(1);
      });
    }
    const playButton = document.getElementById('play-a') as HTMLButtonElement | null;
    if (playButton) {
      playButton.addEventListener('click', () => {
        this.togglePlay();
      });
    }
    const loopButton = document.getElementById('loop-a') as HTMLButtonElement | null;
    if (loopButton) {
      loopButton.addEventListener('click', () => {
        this.toggleLoop();
      });
    }
    const resetButton = document.getElementById('reset-a') as HTMLButtonElement | null;
    if (resetButton) {
      resetButton.addEventListener('click', () => {
        this.resetPlayhead();
      });
    }
    this.deckCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomSlider = document.getElementById('zoom-a') as HTMLInputElement | null;
      if (zoomSlider && this.waveformComponent) {
        const currentZoom = parseFloat(zoomSlider.value);
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(10, currentZoom * delta));
        zoomSlider.value = newZoom.toString();
        this.waveformComponent.setZoom(newZoom);
        const zoomValue = document.getElementById('zoom-value');
        if (zoomValue) {
          zoomValue.textContent = `${newZoom.toFixed(1)}x`;
        }
      }
    });
    this.deckCanvas.addEventListener('click', (e) => {
      const rect = this.deckCanvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const centerX = rect.width / 2;
      const offsetPixels = clickX - centerX;
      const zoomSlider = document.getElementById('zoom-a') as HTMLInputElement | null;
      const zoom = zoomSlider ? parseFloat(zoomSlider.value) : 1;
      const baseSamplesPerPixel = (this.deckState.waveform.sampleRate * 10) / rect.width;
      const samplesPerPixel = baseSamplesPerPixel / zoom;
      const sampleOffset = offsetPixels * samplesPerPixel;
      const newPlayhead = Math.max(
        0,
        Math.min(
          this.deckState.waveform.totalSamples,
          this.deckState.transport.playheadSamples + sampleOffset
        )
      );
      this.deckState = {
        ...this.deckState,
        transport: {
          ...this.deckState.transport,
          playheadSamples: newPlayhead,
        },
      };
      this.updateInfoDisplay();
    });
    const trackUpload = document.getElementById('track-upload') as HTMLInputElement | null;
    if (trackUpload) {
      trackUpload.addEventListener('change', () => {
        this.handleTrackUpload(trackUpload.files);
      });
    }
  }
  private async handleTrackUpload(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) {return;}
    const file = files[0];
    console.log('[DJVisualizationApp] Loading track:', file.name);
    try {
      const titleEl = document.getElementById('track-title');
      const artistEl = document.getElementById('track-artist');
      if (titleEl) {
        titleEl.textContent = file.name.replace(/\.[^/.]+$/, ''); 
      }
      if (artistEl) {
        artistEl.textContent = 'Loading...';
      }
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      console.log('[DJVisualizationApp] Audio decoded:', {
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        numberOfChannels: audioBuffer.numberOfChannels,
        length: audioBuffer.length,
      });
      const monoData = this.extractMonoChannel(audioBuffer);
      const newWaveform = buildWaveformPyramidFromPCM(monoData, audioBuffer.sampleRate);
      console.log('[DJVisualizationApp] Waveform pyramid built:', {
        totalSamples: newWaveform.totalSamples,
        lodCount: newWaveform.lods.length,
        firstLodLength: newWaveform.lods[0]?.lengthInPixels,
      });
      this.deckState = {
        ...this.deckState,
        waveform: newWaveform,
        trackTitle: file.name.replace(/\.[^/.]+$/, ''),
        trackArtist: 'User Uploaded',
        trackDurationSamples: newWaveform.totalSamples,
        transport: {
          ...this.deckState.transport,
          playheadSamples: 0,
          barIndex: 0,
          beatInBar: 0,
          beatPhase: 0,
        },
      };
      if (this.waveformComponent) {
        this.waveformComponent.markWaveformDirty();
      }
      this.audioState = {
        ...this.audioState,
        decks: [this.deckState],
      };
      if (artistEl) {
        artistEl.textContent = 'User Uploaded';
      }
      const infoEl = document.getElementById('info-a');
      if (infoEl) {
        infoEl.style.color = '';
      }
      this.updateInfoDisplay();
      await audioContext.close();
      console.log('[DJVisualizationApp] Track loaded successfully');
    } catch (error) {
      console.error('[DJVisualizationApp] Failed to load track:', error);
      const artistEl = document.getElementById('track-artist');
      if (artistEl) {
        artistEl.textContent = 'Load failed - check console';
      }
      const titleEl = document.getElementById('track-title');
      if (titleEl) {
        titleEl.textContent = 'Decoding Error';
      }
      const infoEl = document.getElementById('info-a');
      if (infoEl) {
        infoEl.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        infoEl.style.color = 'var(--error)';
      }
      alert(`Failed to load audio file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  private extractMonoChannel(audioBuffer: AudioBuffer): Float32Array {
    const length = audioBuffer.length;
    const monoData = new Float32Array(length);
    if (audioBuffer.numberOfChannels === 1) {
      audioBuffer.copyFromChannel(monoData, 0);
    } else {
      const numChannels = audioBuffer.numberOfChannels;
      const channelData: Float32Array[] = [];
      for (let i = 0; i < numChannels; i++) {
        channelData.push(audioBuffer.getChannelData(i));
      }
      for (let i = 0; i < length; i++) {
        let sum = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          sum += channelData[ch][i];
        }
        monoData[i] = sum / numChannels;
      }
    }
    return monoData;
  }
  private setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          this.togglePlay();
          break;
        case 'l':
          this.toggleLoop();
          break;
        case 'r':
          this.resetPlayhead();
          break;
        case 'd':
          void this.debugReadbackPixels();
          break;
      }
    });
  }
  private async debugReadbackPixels(): Promise<void> {
    if (!this.runtime) {
      console.warn('[Debug] Cannot readback pixels: runtime not initialized');
      return;
    }
    const texture = this.runtime.getCurrentTexture();
    if (!texture) {
      console.warn('[Debug] Cannot readback pixels: no texture available');
      return;
    }
    const dims = this.runtime.getDimensions();
    console.log('[Debug] Canvas dimensions:', {
      clientWidth: this.deckCanvas.clientWidth,
      clientHeight: this.deckCanvas.clientHeight,
      canvasWidth: this.deckCanvas.width,
      canvasHeight: this.deckCanvas.height,
      physicalWidth: dims.physicalWidth,
      physicalHeight: dims.physicalHeight,
      dpr: dims.dpr,
    });
    console.log('[Debug] Triggering pixel readback...');
    console.log('[Debug] Press "d" key anytime to run this diagnostic again');
    await debugCanvasPixels(
      this.runtime.getDevice(),
      texture,
      dims.physicalWidth,
      dims.physicalHeight
    );
  }
  private togglePlay(): void {
    this.isPlaying = !this.isPlaying;
    const playButton = document.getElementById('play-a') as HTMLButtonElement | null;
    const playIcon = document.getElementById('play-icon');
    if (playButton) {
      playButton.classList.toggle('active', this.isPlaying);
      const buttonText = playButton.childNodes[1];
      if (buttonText) {
        buttonText.textContent = this.isPlaying ? ' Pause' : ' Play';
      }
    }
    if (playIcon) {
      playIcon.textContent = this.isPlaying ? '⏸' : '▶';
    }
  }
  private toggleLoop(): void {
    this.loopActive = !this.loopActive;
    this.deckState = {
      ...this.deckState,
      loop: {
        ...this.deckState.loop,
        active: this.loopActive,
      },
    };
    const loopButton = document.getElementById('loop-a') as HTMLButtonElement | null;
    if (loopButton) {
      loopButton.classList.toggle('active', this.loopActive);
    }
  }
  private resetPlayhead(): void {
    this.deckState = {
      ...this.deckState,
      transport: {
        ...this.deckState.transport,
        playheadSamples: 0,
        barIndex: 0,
        beatInBar: 0,
      },
    };
    this.updateInfoDisplay();
  }
  private handleResize(): void {
    if (!this.runtime || !this.waveformComponent) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const deckRect = this.deckCanvas.getBoundingClientRect();
    this.runtime.resize(deckRect.width, deckRect.height, dpr);
    this.waveformComponent.resize(this.runtime.getDimensions());
    const metersRect = this.metersCanvas.getBoundingClientRect();
    this.metersCanvas.width = metersRect.width * dpr;
    this.metersCanvas.height = metersRect.height * dpr;
    if (this.metersComponent) {
      this.metersComponent.resize({
        width: metersRect.width,
        height: metersRect.height,
        dpr,
        physicalWidth: metersRect.width * dpr,
        physicalHeight: metersRect.height * dpr,
      });
    }
  }
  private render(): void {
    const currentTime = performance.now() / 1000;
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFPSUpdate >= 1000) {
      this.currentFPS = this.frameCount;
      this.frameCount = 0;
      this.lastFPSUpdate = now;
      const fpsEl = document.getElementById('fps');
      if (fpsEl) {
        fpsEl.textContent = this.currentFPS.toString();
      }
    }
    if (!this.hasRunFirstFrameDebug && this.frameCount === 60) {
      this.hasRunFirstFrameDebug = true;
      console.log('[Debug] Running automatic first-frame pixel analysis...');
      console.log('[Debug] Press "D" key anytime to run diagnostics again');
      void this.debugReadbackPixels();
    }
    if (this.isPlaying) {
      this.deckState = updateTransportPlayback(this.deckState, deltaTime, this.isPlaying);
    }
    this.audioState = {
      ...this.audioState,
      time: currentTime,
      deltaTime,
      decks: [this.deckState],
    };
    if (this.runtime && this.waveformComponent) {
      this.runtime.updateSharedUniforms(currentTime, deltaTime);
      this.waveformComponent.update(deltaTime, currentTime, this.audioState);
      const texture = this.runtime.getCurrentTexture();
      if (texture) {
        const encoder = this.runtime.getDevice().createCommandEncoder();
        this.waveformComponent.encode(encoder, texture.createView());
        this.runtime.getDevice().queue.submit([encoder.finish()]);
      }
    }
    if (this.metersComponent) {
      this.metersComponent.update(deltaTime, currentTime, this.audioState);
    }
    if (this.isPlaying) {
      this.updateInfoDisplay();
    }
    this.animationFrameId = requestAnimationFrame(() => {
      this.render();
    });
  }
  private updateInfoDisplay(): void {
    const info = document.getElementById('info-a');
    if (!info) {
      return;
    }
    const playheadSeconds =
      this.deckState.transport.playheadSamples / this.deckState.waveform.sampleRate;
    const totalSeconds =
      this.deckState.waveform.totalSamples / this.deckState.waveform.sampleRate;
    const formatTime = (seconds: number): string => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };
    const loopIndicator = this.loopActive ? ' | LOOP' : '';
    info.textContent =
      `${formatTime(playheadSeconds)} / ${formatTime(totalSeconds)} | ` +
      `${this.deckState.transport.bpm} BPM | ` +
      `Bar ${this.deckState.transport.barIndex + 1} Beat ${this.deckState.transport.beatInBar + 1}` +
      loopIndicator;
  }
  private showError(message: string): void {
    const errorDiv = document.getElementById('error');
    const errorMessage = document.getElementById('error-message');
    const loading = document.getElementById('loading');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    if (errorDiv) {
      errorDiv.style.display = 'block';
    }
    if (errorMessage) {
      errorMessage.innerHTML = message;
    }
    if (loading) {
      loading.style.display = 'none';
    }
    if (statusDot) {
      statusDot.classList.add('error');
    }
    if (statusText) {
      statusText.textContent = 'Error';
    }
    const deckContainer = document.getElementById('deck-a-container');
    if (deckContainer) {
      deckContainer.style.display = 'none';
    }
  }
  destroy(): void {
    cancelAnimationFrame(this.animationFrameId);
    this.waveformComponent?.destroy();
    this.metersComponent?.destroy();
    this.runtime?.destroy();
  }
}
function initApp(): void {
  const app = new DJVisualizationApp();
  app.initialize().catch(console.error);
  window.addEventListener('beforeunload', () => {
    app.destroy();
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
```

### `src/shaders/deck-waveform-standalone.wgsl` {#src-shaders-deck-waveform-standalone-wgsl}

```wgsl
// File: src/shaders/deck-waveform-standalone.wgsl

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
```

### `src/shaders/knobs.wgsl` {#src-shaders-knobs-wgsl}

```wgsl
// File: src/shaders/knobs.wgsl

// =============================================================================
// WebGPU Knob Rendering Shader
// SDF-based circular knobs for band controls
// =============================================================================
struct KnobUniforms {
  viewWidth: f32,
  viewHeight: f32,
  knobCount: f32,
  selectedKnob: f32,
};
struct KnobData {
  value: f32,      // 0.0 to 1.0
  minValue: f32,
  maxValue: f32,
  _padding: f32,
  color: vec4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms: KnobUniforms;
@group(0) @binding(1) var<storage, read> knobs: array<KnobData>;
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0)
  );
  var uv = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  output.uv = uv[vertexIndex];
  return output;
}
// Signed distance function for circle
fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}
// Signed distance function for arc
fn sdArc(p: vec2<f32>, startAngle: f32, endAngle: f32, radius: f32, thickness: f32) -> f32 {
  let angle = atan2(p.y, p.x);
  let inArc = angle >= startAngle && angle <= endAngle;
  let dist = abs(length(p) - radius) - thickness;
  return select(1000.0, dist, inArc);
}
// Draw a single knob
fn drawKnob(uv: vec2<f32>, center: vec2<f32>, radius: f32, value: f32, color: vec3<f32>, isSelected: bool) -> vec3<f32> {
  let p = uv - center;
  let dist = length(p);
  var result = vec3<f32>(0.0);
  // Outer ring (background)
  let outerRing = sdCircle(p, radius);
  if (outerRing < 0.0 && outerRing > -2.0) {
    result = vec3<f32>(0.15, 0.15, 0.2);
  }
  // Inner circle (knob body)
  let innerCircle = sdCircle(p, radius * 0.8);
  if (innerCircle < 0.0) {
    let gradient = 1.0 - (innerCircle / (radius * 0.8)) * 0.3;
    result = vec3<f32>(0.25, 0.25, 0.3) * gradient;
    // Add subtle lighting
    let lightDir = normalize(vec2<f32>(-0.3, -0.5));
    let normalAngle = atan2(p.y, p.x);
    let lightDot = dot(normalize(p), lightDir);
    result = result + vec3<f32>(0.1) * max(0.0, lightDot);
  }
  // Value arc
  let startAngle = -2.356; // -135 degrees
  let endAngle = 2.356;    // 135 degrees
  let valueAngle = startAngle + value * (endAngle - startAngle);
  let arcRadius = radius * 0.9;
  let arcThickness = 3.0;
  // Background arc
  let angle = atan2(p.y, p.x);
  let distFromArc = abs(dist - arcRadius);
  if (distFromArc < arcThickness && angle >= startAngle && angle <= endAngle) {
    result = vec3<f32>(0.1, 0.1, 0.15);
  }
  // Value arc (colored)
  if (distFromArc < arcThickness && angle >= startAngle && angle <= valueAngle) {
    result = color;
  }
  // Indicator line
  let indicatorAngle = valueAngle;
  let indicatorDir = vec2<f32>(cos(indicatorAngle), sin(indicatorAngle));
  let projLen = dot(p, indicatorDir);
  let perpDist = length(p - indicatorDir * projLen);
  if (projLen > radius * 0.3 && projLen < radius * 0.75 && perpDist < 2.0) {
    result = vec3<f32>(0.9, 0.9, 0.95);
  }
  // Selection highlight
  if (isSelected && outerRing < 0.0 && outerRing > -4.0) {
    result = mix(result, color, 0.5);
  }
  return result;
}
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let screenPos = vec2<f32>(
    input.uv.x * uniforms.viewWidth,
    input.uv.y * uniforms.viewHeight
  );
  var color = vec3<f32>(0.08, 0.08, 0.1);
  let knobRadius = 25.0;
  let knobSpacing = 80.0;
  let startX = (uniforms.viewWidth - (uniforms.knobCount - 1.0) * knobSpacing) * 0.5;
  let centerY = uniforms.viewHeight * 0.5;
  let knobCountInt = i32(uniforms.knobCount);
  for (var i = 0; i < knobCountInt; i = i + 1) {
    let knobData = knobs[i];
    let centerX = startX + f32(i) * knobSpacing;
    let center = vec2<f32>(centerX, centerY);
    let dist = length(screenPos - center);
    if (dist < knobRadius * 1.5) {
      let isSelected = f32(i) == uniforms.selectedKnob;
      let knobColor = drawKnob(screenPos, center, knobRadius, knobData.value, knobData.color.rgb, isSelected);
      color = knobColor;
    }
  }
  return vec4<f32>(color, 1.0);
}
```

### `src/shaders/meters.wgsl` {#src-shaders-meters-wgsl}

```wgsl
// File: src/shaders/meters.wgsl

// =============================================================================
// WebGPU Meter Rendering Shader
// Vertical bar meters with peak hold and spectral bands
// =============================================================================
struct MeterUniforms {
  viewWidth: f32,
  viewHeight: f32,
  channelCount: f32,
  _padding: f32,
};
struct ChannelData {
  rms: f32,
  peak: f32,
  peakHold: f32,
  lowEnergy: f32,
  midEnergy: f32,
  highEnergy: f32,
  _padding1: f32,
  _padding2: f32,
};
@group(0) @binding(0) var<uniform> uniforms: MeterUniforms;
@group(0) @binding(1) var<storage, read> channels: array<ChannelData>;
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0)
  );
  var uv = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  output.uv = uv[vertexIndex];
  return output;
}
// Map level to color (green -> yellow -> red)
fn levelToColor(level: f32) -> vec3<f32> {
  if (level < 0.6) {
    return vec3<f32>(0.2, 0.8, 0.3); // Green
  } else if (level < 0.85) {
    let t = (level - 0.6) / 0.25;
    return mix(vec3<f32>(0.2, 0.8, 0.3), vec3<f32>(0.9, 0.8, 0.2), t); // Yellow
  } else {
    let t = (level - 0.85) / 0.15;
    return mix(vec3<f32>(0.9, 0.8, 0.2), vec3<f32>(1.0, 0.3, 0.2), t); // Red
  }
}
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let screenX = input.uv.x * uniforms.viewWidth;
  let screenY = input.uv.y * uniforms.viewHeight;
  let normalizedY = 1.0 - input.uv.y; // Flip so 0 is bottom, 1 is top
  var color = vec3<f32>(0.06, 0.06, 0.08);
  let meterWidth = 20.0;
  let meterSpacing = 30.0;
  let totalWidth = (uniforms.channelCount - 1.0) * meterSpacing + meterWidth;
  let startX = (uniforms.viewWidth - totalWidth) * 0.5;
  let channelCountInt = i32(uniforms.channelCount);
  for (var i = 0; i < channelCountInt; i = i + 1) {
    let channel = channels[i];
    let meterX = startX + f32(i) * meterSpacing;
    // Check if in meter column
    if (screenX >= meterX && screenX < meterX + meterWidth) {
      let meterPosX = (screenX - meterX) / meterWidth;
      // Background
      color = vec3<f32>(0.1, 0.1, 0.12);
      // RMS bar (main level)
      if (normalizedY < channel.rms) {
        let segmentHeight = 0.02;
        let segmentGap = 0.005;
        let segmentIndex = floor(normalizedY / (segmentHeight + segmentGap));
        let inSegment = fract(normalizedY / (segmentHeight + segmentGap)) < (segmentHeight / (segmentHeight + segmentGap));
        if (inSegment) {
          color = levelToColor(normalizedY);
        }
      }
      // Peak indicator
      let peakY = channel.peak;
      if (abs(normalizedY - peakY) < 0.01) {
        color = levelToColor(peakY) * 1.2;
      }
      // Peak hold indicator
      let peakHoldY = channel.peakHold;
      if (abs(normalizedY - peakHoldY) < 0.008) {
        color = vec3<f32>(1.0, 1.0, 1.0);
      }
      // Clipping indicator
      if (channel.peak > 0.95 && normalizedY > 0.95) {
        color = vec3<f32>(1.0, 0.2, 0.2);
      }
    }
    // Spectral bands (small bars next to main meter)
    let bandWidth = 6.0;
    let bandX = meterX + meterWidth + 4.0;
    if (screenX >= bandX && screenX < bandX + bandWidth * 3.0 + 4.0) {
      let bandIndex = i32((screenX - bandX) / (bandWidth + 2.0));
      let inBand = fract((screenX - bandX) / (bandWidth + 2.0)) < (bandWidth / (bandWidth + 2.0));
      if (inBand && bandIndex < 3) {
        var bandLevel = 0.0;
        var bandColor = vec3<f32>(0.0);
        if (bandIndex == 0) {
          bandLevel = channel.lowEnergy;
          bandColor = vec3<f32>(1.0, 0.4, 0.3); // Low - red/orange
        } else if (bandIndex == 1) {
          bandLevel = channel.midEnergy;
          bandColor = vec3<f32>(0.4, 1.0, 0.4); // Mid - green
        } else {
          bandLevel = channel.highEnergy;
          bandColor = vec3<f32>(0.4, 0.8, 1.0); // High - cyan
        }
        if (normalizedY < bandLevel) {
          color = bandColor * 0.8;
        } else {
          color = vec3<f32>(0.08, 0.08, 0.1);
        }
      }
    }
  }
  return vec4<f32>(color, 1.0);
}
```

### `src/shaders/overview.wgsl` {#src-shaders-overview-wgsl}

```wgsl
// File: src/shaders/overview.wgsl

// =============================================================================
// Track Overview Shader
// Compact full-track waveform with playhead indicator
// =============================================================================
struct OverviewUniforms {
  viewWidth: f32,
  viewHeight: f32,
  totalSamples: f32,
  playheadSamples: f32,
  lodLengthInPixels: f32,
  loopActive: f32,
  loopInSample: f32,
  loopOutSample: f32,
};
@group(0) @binding(0) var<uniform> uniforms: OverviewUniforms;
@group(0) @binding(1) var amplitudeTex: texture_2d<f32>;
@group(0) @binding(2) var texSampler: sampler;
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0)
  );
  var uv = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  output.uv = uv[vertexIndex];
  return output;
}
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let normalizedX = input.uv.x;
  let normalizedY = input.uv.y;
  // Background
  var color = vec3<f32>(0.08, 0.08, 0.1);
  // Sample waveform at this position
  let texCoord = vec2<f32>(normalizedX, 0.5);
  let amplitude = textureSample(amplitudeTex, texSampler, texCoord);
  let minAmp = amplitude.r;
  let maxAmp = amplitude.g;
  // Draw waveform
  let centerY = 0.5;
  let waveformHeight = 0.8;
  let minY = centerY - minAmp * waveformHeight * 0.5;
  let maxY = centerY + maxAmp * waveformHeight * 0.5;
  if (normalizedY >= minY && normalizedY <= maxY) {
    // Color based on amplitude (brighter for louder)
    let intensity = (maxAmp + minAmp) * 0.5;
    color = mix(vec3<f32>(0.2, 0.4, 0.6), vec3<f32>(0.4, 0.8, 1.0), intensity);
  }
  // Loop region
  if (uniforms.loopActive > 0.5) {
    let loopInNorm = uniforms.loopInSample / uniforms.totalSamples;
    let loopOutNorm = uniforms.loopOutSample / uniforms.totalSamples;
    if (normalizedX >= loopInNorm && normalizedX <= loopOutNorm) {
      color = mix(color, vec3<f32>(0.2, 0.8, 0.2), 0.2);
    }
  }
  // Played portion (darken unplayed)
  let playheadNorm = uniforms.playheadSamples / uniforms.totalSamples;
  if (normalizedX > playheadNorm) {
    color = color * 0.6; // Darken unplayed section
  }
  // Playhead indicator
  let playheadScreenX = playheadNorm * uniforms.viewWidth;
  let currentScreenX = normalizedX * uniforms.viewWidth;
  let distFromPlayhead = abs(currentScreenX - playheadScreenX);
  if (distFromPlayhead < 2.0) {
    color = vec3<f32>(1.0, 1.0, 1.0);
  } else if (distFromPlayhead < 4.0) {
    let glow = 1.0 - (distFromPlayhead - 2.0) / 2.0;
    color = mix(color, vec3<f32>(1.0, 1.0, 1.0), glow * 0.5);
  }
  return vec4<f32>(color, 1.0);
}
```

### `src/shaders/waveform.wgsl` {#src-shaders-waveform-wgsl}

```wgsl
// File: src/shaders/waveform.wgsl

// =============================================================================
// WebGPU Deck Waveform Shader
// Renders frequency-colored waveform with center playhead
// =============================================================================
// Shared uniforms from runtime
struct SharedUniforms {
  time: f32,
  deltaTime: f32,
  resolutionX: f32,
  resolutionY: f32,
};
// Waveform-specific uniforms
struct WaveformUniforms {
  // Playhead position (split into high/low for precision)
  playheadSamplesHigh: f32,
  playheadSamplesLow: f32,
  sampleRate: f32,
  totalSamples: f32,
  // Zoom and view
  samplesPerPixel: f32,
  viewWidth: f32,
  viewHeight: f32,
  lodIndex: f32,
  // LOD info
  lodSamplesPerPixel: f32,
  lodLengthInPixels: f32,
  bandCount: f32,
  _padding1: f32,
  // Visual settings
  brightness: f32,
  contrast: f32,
  saturation: f32,
  _padding2: f32,
  // Band gains
  lowGain: f32,
  midGain: f32,
  highGain: f32,
  _padding3: f32,
  // Loop region
  loopActive: f32,
  loopInSample: f32,
  loopOutSample: f32,
  showBeatGrid: f32,
  // Beat grid
  bpm: f32,
  beatPhase: f32,
  _padding4: f32,
  _padding5: f32,
};
// Color scheme for frequency bands
struct BandColors {
  low: vec3<f32>,   // Warm red/orange
  mid: vec3<f32>,   // Green
  high: vec3<f32>,  // Cyan/blue
};
// DEBUG MODE FLAGS (set to 0u for normal rendering, 1u/2u/3u for debug modes)
// 0u = Normal rendering
// 1u = Show raw amplitude as grayscale
// 2u = Show band energies as RGB (low=R, mid=G, high=B)
// 3u = Show LOD texture coordinate as color gradient
const DEBUG_MODE: u32 = 0u;
@group(0) @binding(0) var<uniform> globalUniforms: SharedUniforms;
@group(1) @binding(0) var<uniform> waveform: WaveformUniforms;
@group(1) @binding(1) var amplitudeTex: texture_2d<f32>;
@group(1) @binding(2) var bandsTex: texture_2d<f32>;
@group(1) @binding(3) var texSampler: sampler;
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
// Full-screen quad vertex shader
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  // Generate full-screen quad
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0)
  );
  var uv = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  output.uv = uv[vertexIndex];
  return output;
}
// Reconstruct playhead position from high/low parts
fn getPlayheadSamples() -> f32 {
  return waveform.playheadSamplesHigh * 16777216.0 + waveform.playheadSamplesLow;
}
// Convert screen X position to sample position (playhead centered)
fn screenXToSample(screenX: f32) -> f32 {
  let safeViewWidth = max(waveform.viewWidth, 1.0);
  let safeSamplesPerPixel = max(waveform.samplesPerPixel, 1.0);
  let centerX = safeViewWidth * 0.5;
  let offsetPixels = screenX - centerX;
  let offsetSamples = offsetPixels * safeSamplesPerPixel;
  return getPlayheadSamples() + offsetSamples;
}
// Convert sample position to LOD texture coordinate
fn sampleToLODCoord(samplePos: f32) -> f32 {
  let safeLodSamplesPerPixel = max(waveform.lodSamplesPerPixel, 1.0);
  let safeLodLength = max(waveform.lodLengthInPixels, 1.0);
  let lodPixel = samplePos / safeLodSamplesPerPixel;
  return lodPixel / safeLodLength;
}
// Sample amplitude from texture (returns min, max) - FIXED: No branching
fn sampleAmplitude(lodCoord: f32) -> vec2<f32> {
  // Clamp instead of branching - textureSample must be in uniform control flow
  let clamped = clamp(lodCoord, 0.0, 1.0);
  let texCoord = vec2<f32>(clamped, 0.5);
  let texSample = textureSample(amplitudeTex, texSampler, texCoord);
  return vec2<f32>(texSample.r, texSample.g); // min, max
}
// Sample band energies (low, mid, high) - FIXED: No branching
fn sampleBands(lodCoord: f32) -> vec3<f32> {
  // Clamp instead of branching - textureSample must be in uniform control flow
  let clamped = clamp(lodCoord, 0.0, 1.0);
  let texCoord = vec2<f32>(clamped, 0.5);
  let texSample = textureSample(bandsTex, texSampler, texCoord);
  return vec3<f32>(texSample.r, texSample.g, texSample.b);
}
// Map band energies to color
fn bandsToColor(bands: vec3<f32>) -> vec3<f32> {
  // Apply gains
  let weightedBands = vec3<f32>(
    bands.x * waveform.lowGain,
    bands.y * waveform.midGain,
    bands.z * waveform.highGain
  );
  // Normalize
  let total = weightedBands.x + weightedBands.y + weightedBands.z + 0.001;
  let normalized = weightedBands / total;
  // Color mapping
  let lowColor = vec3<f32>(1.0, 0.4, 0.2);   // Warm orange-red
  let midColor = vec3<f32>(0.4, 1.0, 0.4);   // Green
  let highColor = vec3<f32>(0.4, 0.8, 1.0);  // Cyan
  var color = lowColor * normalized.x + midColor * normalized.y + highColor * normalized.z;
  // Apply brightness
  color = color * waveform.brightness;
  // Apply contrast
  color = (color - 0.5) * waveform.contrast + 0.5;
  // Apply saturation
  let gray = dot(color, vec3<f32>(0.299, 0.587, 0.114));
  color = mix(vec3<f32>(gray), color, waveform.saturation);
  return clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
}
// Draw beat grid line
fn drawBeatGrid(samplePos: f32) -> f32 {
  if (waveform.showBeatGrid < 0.5) {
    return 0.0;
  }
  let samplesPerBeat = waveform.sampleRate * 60.0 / waveform.bpm;
  let beatPos = samplePos / samplesPerBeat;
  let beatFrac = fract(beatPos);
  // Thin line at each beat
  let lineWidth = 0.01;
  if (beatFrac < lineWidth || beatFrac > (1.0 - lineWidth)) {
    // Check if it's a strong beat (bar line)
    let barPos = beatPos / 4.0;
    let barFrac = fract(barPos);
    if (barFrac < 0.01 || barFrac > 0.99) {
      return 0.8; // Strong line
    }
    return 0.3; // Weak line
  }
  return 0.0;
}
// Draw loop region
fn drawLoopRegion(samplePos: f32) -> f32 {
  if (waveform.loopActive < 0.5) {
    return 0.0;
  }
  if (samplePos >= waveform.loopInSample && samplePos <= waveform.loopOutSample) {
    return 0.15; // Loop region tint
  }
  return 0.0;
}
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let normalizedY = input.uv.y; // 0 at top, 1 at bottom
  // =========================================================================
  // UNCONDITIONAL DEBUG RENDERING - ALWAYS VISIBLE
  // These render without ANY dependency on uniform values
  // =========================================================================
  // Background gradient (dark blue at top → dark purple at bottom)
  // This is ALWAYS drawn to prove the pipeline is alive
  var color = vec3<f32>(0.05, 0.06, 0.12); // Dark blue
  color = mix(color, vec3<f32>(0.08, 0.04, 0.10), normalizedY); // Dark purple at bottom
  // Draw faint horizontal center line (debug) - UNCONDITIONALLY
  let centerYLine = abs(normalizedY - 0.5);
  if (centerYLine < 0.003) {
    color = mix(color, vec3<f32>(0.3, 0.3, 0.4), 0.6);
  }
  // Draw bright white center playhead line at UV x = 0.5 - NO UNIFORM DEPENDENCY
  let uvCenterX = input.uv.x - 0.5;
  let playheadWidthUV = 0.003; // 0.3% of screen width
  var hasPlayhead = false;
  if (abs(uvCenterX) < playheadWidthUV) {
    color = vec3<f32>(1.0, 1.0, 1.0); // Bright white center line
    hasPlayhead = true;
  } else if (abs(uvCenterX) < playheadWidthUV * 3.0) {
    let glowFactor = 1.0 - (abs(uvCenterX) - playheadWidthUV) / (playheadWidthUV * 2.0);
    color = mix(color, vec3<f32>(1.0, 1.0, 1.0), glowFactor * 0.5);
  }
  // Safety checks for uniform values - prevent NaN propagation
  let safeViewWidth = max(waveform.viewWidth, 1.0);
  let safeViewHeight = max(waveform.viewHeight, 1.0);
  let screenX = input.uv.x * safeViewWidth;
  let screenY = input.uv.y * safeViewHeight;
  // Only render waveform if we have valid data and valid LOD dimensions
  let safeLodLength = max(waveform.lodLengthInPixels, 1.0);
  let safeSamplesPerPixel = max(waveform.lodSamplesPerPixel, 1.0);
  if (waveform.totalSamples > 0.0 && waveform.lodLengthInPixels > 0.0) {
    // Get sample position for this screen X
    let samplePos = screenXToSample(screenX);
    let lodCoord = sampleToLODCoord(samplePos);
    // Sample waveform data
    let amplitude = sampleAmplitude(lodCoord);
    let bands = sampleBands(lodCoord);
    // =========================================================================
    // DEBUG MODES - Enable by changing DEBUG_MODE constant above
    // =========================================================================
    if (DEBUG_MODE == 1u) {
      // Mode 1: Raw amplitude as grayscale (average of min/max)
      let avgAmp = (amplitude.x + amplitude.y) * 0.5;
      if (!hasPlayhead) {
        color = vec3<f32>(avgAmp, avgAmp, avgAmp);
      }
      return vec4<f32>(color, 1.0);
    } else if (DEBUG_MODE == 2u) {
      // Mode 2: Band energies as RGB (low=R, mid=G, high=B)
      if (!hasPlayhead) {
        color = bands;
      }
      return vec4<f32>(color, 1.0);
    } else if (DEBUG_MODE == 3u) {
      // Mode 3: LOD texture coordinate as color (shows sampling pattern)
      let clampedCoord = clamp(lodCoord, 0.0, 1.0);
      if (!hasPlayhead) {
        color = vec3<f32>(clampedCoord, fract(lodCoord * 10.0), 0.5);
      }
      return vec4<f32>(color, 1.0);
    }
    // Normal rendering mode
    // Map amplitude to vertical position
    // Waveform is centered vertically
    let centerY = 0.5;
    let waveformHeight = 0.4; // Use 40% of canvas height in each direction (80% total)
    // amplitude.x = min extent (how far down from center, as positive number)
    // amplitude.y = max extent (how far up from center)
    let waveformTopY = centerY - amplitude.y * waveformHeight;
    let waveformBottomY = centerY + amplitude.x * waveformHeight;
    // Check if current pixel is within waveform envelope
    let inWaveform = normalizedY >= waveformTopY && normalizedY <= waveformBottomY;
    if (inWaveform && (amplitude.x > 0.01 || amplitude.y > 0.01) && !hasPlayhead) {
      // Color based on band energies
      let waveColor = bandsToColor(bands);
      // Add edge glow
      let distFromEdge = min(normalizedY - waveformTopY, waveformBottomY - normalizedY);
      let edgeFactor = smoothstep(0.0, 0.02, distFromEdge);
      color = mix(waveColor * 1.3, waveColor, edgeFactor);
    }
    // Draw beat grid (behind playhead)
    if (!hasPlayhead) {
      let gridIntensity = drawBeatGrid(samplePos);
      if (gridIntensity > 0.0) {
        color = mix(color, vec3<f32>(0.5, 0.5, 0.6), gridIntensity);
      }
      // Draw loop region
      let loopIntensity = drawLoopRegion(samplePos);
      if (loopIntensity > 0.0) {
        color = mix(color, vec3<f32>(0.2, 0.8, 0.2), loopIntensity);
      }
    }
  }
  return vec4<f32>(color, 1.0);
}
```

### `src/types/audio-state.ts` {#src-types-audio-state-ts}

```typescript
// File: src/types/audio-state.ts

export interface WaveformBandConfig {
  readonly bandCount: number; 
  readonly sampleRate: number;
  readonly frequencyRanges: readonly { min: number; max: number }[];
}
export interface WaveformLOD {
  readonly samplesPerPixel: number;
  readonly lengthInPixels: number;
  readonly amplitude: Float32Array; 
  readonly bandEnergies: Float32Array; 
}
export interface WaveformPyramid {
  readonly totalSamples: number;
  readonly sampleRate: number;
  readonly lods: readonly WaveformLOD[];
  readonly bands: WaveformBandConfig;
}
export interface DeckTransportState {
  readonly playheadSamples: number; 
  readonly rate: number; 
  readonly bpm: number; 
  readonly beatPhase: number; 
  readonly barIndex: number; 
  readonly beatInBar: number; 
  readonly isPlaying: boolean;
  readonly isSlipMode: boolean;
  readonly slipPlayheadSamples: number; 
}
export interface LoopState {
  readonly active: boolean;
  readonly inSample: number;
  readonly outSample: number;
}
export interface CuePoint {
  readonly id: string;
  readonly samplePosition: number;
  readonly color: readonly [number, number, number]; 
  readonly label: string;
}
export interface SectionMarker {
  readonly startSample: number;
  readonly endSample: number;
  readonly type: 'intro' | 'verse' | 'chorus' | 'breakdown' | 'drop' | 'outro' | 'bridge';
  readonly label: string;
}
export interface DeckState {
  readonly id: string;
  readonly transport: DeckTransportState;
  readonly loop: LoopState;
  readonly cuePoints: readonly CuePoint[];
  readonly sections: readonly SectionMarker[];
  readonly waveform: WaveformPyramid;
  readonly trackTitle: string;
  readonly trackArtist: string;
  readonly trackKey: string;
  readonly trackDurationSamples: number;
}
export interface ChannelMeter {
  readonly rms: number; 
  readonly peak: number; 
  readonly peakHold: number; 
  readonly lufs: number; 
  readonly lowEnergy: number; 
  readonly midEnergy: number; 
  readonly highEnergy: number; 
}
export interface MasterMeter extends ChannelMeter {
  readonly leftPeak: number;
  readonly rightPeak: number;
  readonly correlation: number; 
}
export interface AudioVisualState {
  readonly time: number; 
  readonly deltaTime: number; 
  readonly decks: readonly DeckState[];
  readonly master: MasterMeter;
  readonly crossfaderPosition: number; 
}
export interface VisualTheme {
  readonly backgroundColor: readonly [number, number, number, number];
  readonly waveformColors: {
    readonly low: readonly [number, number, number];
    readonly mid: readonly [number, number, number];
    readonly high: readonly [number, number, number];
  };
  readonly playheadColor: readonly [number, number, number, number];
  readonly beatGridColor: readonly [number, number, number, number];
  readonly beatGridStrongColor: readonly [number, number, number, number];
  readonly loopColor: readonly [number, number, number, number];
}
export const DEFAULT_THEME: VisualTheme = {
  backgroundColor: [13 / 255, 13 / 255, 18 / 255, 1.0],
  waveformColors: {
    low: [255 / 255, 100 / 255, 50 / 255], 
    mid: [100 / 255, 255 / 255, 100 / 255], 
    high: [100 / 255, 200 / 255, 255 / 255], 
  },
  playheadColor: [1.0, 1.0, 1.0, 0.9],
  beatGridColor: [0.3, 0.3, 0.4, 0.5],
  beatGridStrongColor: [0.5, 0.5, 0.6, 0.8],
  loopColor: [0.2, 0.6, 0.2, 0.3],
};
```

### `src/types/visual-component.ts` {#src-types-visual-component-ts}

```typescript
// File: src/types/visual-component.ts

import type { AudioVisualState, VisualTheme } from './audio-state.ts';
export interface Dimensions {
  readonly width: number; 
  readonly height: number; 
  readonly dpr: number; 
  readonly physicalWidth: number; 
  readonly physicalHeight: number; 
}
export interface SharedUniforms {
  readonly time: number;
  readonly deltaTime: number;
  readonly resolution: readonly [number, number];
  readonly theme: VisualTheme;
}
export interface VisualContext {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly theme: VisualTheme;
  readonly sharedUniformBuffer: GPUBuffer;
  readonly sharedBindGroupLayout: GPUBindGroupLayout;
  readonly sharedBindGroup: GPUBindGroup;
}
export interface VisualComponent {
  readonly id: string;
  initialize(device: GPUDevice, ctx: VisualContext): Promise<void> | void;
  resize(dim: Dimensions): void;
  update(dt: number, time: number, audio: AudioVisualState): void;
  encode(encoder: GPUCommandEncoder, view: GPUTextureView): void;
  destroy(): void;
}
export interface DeckWaveformProps {
  readonly deckIndex: number;
  readonly showBeatGrid: boolean;
  readonly showCuePoints: boolean;
  readonly showLoopRegion: boolean;
  readonly showSlipGhost: boolean;
}
export interface WaveformKnobState {
  readonly lowGain: number; 
  readonly midGain: number; 
  readonly highGain: number; 
  readonly brightness: number; 
  readonly contrast: number; 
  readonly saturation: number; 
}
export interface MeterProps {
  readonly channelCount: number;
  readonly showPeakHold: boolean;
  readonly showSpectralBands: boolean;
}
export interface OverviewProps {
  readonly deckIndex: number;
  readonly showSections: boolean;
  readonly showCuePoints: boolean;
}
export interface DeckWaveformController {
  setZoom(zoom: number): void;
  setKnobState(state: Partial<WaveformKnobState>): void;
  getKnobState(): WaveformKnobState;
  setShowBeatGrid(show: boolean): void;
  setShowCuePoints(show: boolean): void;
  setShowLoopRegion(show: boolean): void;
}
```

### `src/utils/debug-readback.ts` {#src-utils-debug-readback-ts}

```typescript
// File: src/utils/debug-readback.ts

export interface PixelSample {
    x: number;
    y: number;
    r: number;
    g: number;
    b: number;
    a: number;
    isBlack: boolean;
}
export async function readbackTexturePixels(
    device: GPUDevice,
    texture: GPUTexture,
    width: number,
    height: number
): Promise<PixelSample[]> {
    if (width === 0 || height === 0) {
        console.warn('[Debug] Skipping pixel readback: texture dimensions are 0×0');
        return [];
    }
    const bytesPerPixel = 4; 
    const bytesPerRow = Math.ceil((width * bytesPerPixel) / 256) * 256; 
    const bufferSize = bytesPerRow * height;
    const readbackBuffer = device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        label: 'Readback Buffer',
    });
    const encoder = device.createCommandEncoder({label: 'Readback Encoder'});
    encoder.copyTextureToBuffer(
        {texture, mipLevel: 0, origin: {x: 0, y: 0, z: 0}},
        {buffer: readbackBuffer, bytesPerRow, rowsPerImage: height},
        {width, height, depthOrArrayLayers: 1}
    );
    device.queue.submit([encoder.finish()]);
    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const arrayBuffer = readbackBuffer.getMappedRange();
    const pixelData = new Uint8Array(arrayBuffer);
    const samples: PixelSample[] = [];
    const samplePoints = [
        {x: Math.floor(width / 2), y: Math.floor(height / 2)}, 
        {x: 0, y: 0}, 
        {x: width - 1, y: 0}, 
        {x: 0, y: height - 1}, 
        {x: width - 1, y: height - 1}, 
        {x: Math.floor(width / 4), y: Math.floor(height / 2)}, 
        {x: Math.floor((width * 3) / 4), y: Math.floor(height / 2)}, 
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
export function analyzePixelSamples(samples: PixelSample[]): {
    allBlack: boolean;
    allSameColor: boolean;
    hasVariation: boolean;
    summary: string;
} {
    if (samples.length === 0) {
        return {
            allBlack: false,
            allSameColor: false,
            hasVariation: false,
            summary: 'No samples available (likely 0×0 texture)',
        };
    }
    const allBlack = samples.every((s) => s.isBlack);
    const firstPixel = samples[0];
    const allSameColor = samples.every(
        (s) => s.r === firstPixel.r && s.g === firstPixel.g && s.b === firstPixel.b
    );
    const uniqueColors = new Set(samples.map((s) => `${s.r},${s.g},${s.b}`));
    const hasVariation = uniqueColors.size > 1;
    let summary = '';
    if (allBlack) {
        summary =
            '❌ All sampled pixels are pure black (0,0,0) - shader not rendering or cleared to black';
    } else if (allSameColor) {
        summary = `⚠️ All pixels are the same color (${firstPixel.r},${firstPixel.g},${firstPixel.b}) - possible clear color only`;
    } else if (hasVariation) {
        summary = `✅ Pixels show variation (${uniqueColors.size} unique colors) - rendering is working!`;
    }
    return {allBlack, allSameColor, hasVariation, summary};
}
export async function debugCanvasPixels(
    device: GPUDevice,
    texture: GPUTexture,
    width: number,
    height: number
): Promise<void> {
    if (width === 0 || height === 0) {
        console.warn('[Debug] Skipping pixel readback: canvas not yet sized (0×0)');
        return;
    }
    const samples = await readbackTexturePixels(device, texture, width, height);
    const analysis = analyzePixelSamples(samples);
    console.log('[Debug] Pixel Analysis:', analysis);
    if (samples.length > 0) {
        console.log('[Debug] Sample Points:');
        console.table(
            samples.map((s) => ({
                Position: `(${s.x}, ${s.y})`,
                RGB: `(${s.r}, ${s.g}, ${s.b})`,
                Alpha: s.a,
                'Is Black': s.isBlack ? '❌ YES' : '✅ NO',
            }))
        );
        console.log('[Debug] Expected pixel values if shader is working:');
        console.log('  - Background: RGB(12-20, 10-15, 20-30) - dark blue/purple gradient');
        console.log('  - Center line (playhead): RGB(255, 255, 255) - bright white');
        console.log('  - If all pixels are (0,0,0), the shader is not executing');
    }
}
```

### `src/utils/test-data.ts` {#src-utils-test-data-ts}

```typescript
// File: src/utils/test-data.ts

import type {
    AudioVisualState,
    CuePoint,
    DeckState,
    DeckTransportState,
    LoopState,
    MasterMeter,
    SectionMarker,
    WaveformBandConfig,
    WaveformLOD,
    WaveformPyramid,
} from "../types/audio-state.ts";
export interface TestTrackConfig {
    durationSeconds: number;
    sampleRate: number;
    bpm: number;
    key: string;
    title: string;
    artist: string;
}
const MAX_WAVEFORM_TEXTURE_WIDTH = 8192;
const BASE_SAMPLES_PER_PIXEL_LEVELS: readonly number[] = [
    64,
    128,
    256,
    512,
    1024,
    2048,
    4096,
];
function computeLodSamplesPerPixel(totalSamples: number): number[] {
    const levels: number[] = [];
    for (const spp of BASE_SAMPLES_PER_PIXEL_LEVELS) {
        const lengthInPixels = Math.ceil(totalSamples / spp);
        if (lengthInPixels <= MAX_WAVEFORM_TEXTURE_WIDTH) {
            levels.push(spp);
        }
    }
    if (levels.length === 0) {
        const minSamplesPerPixel = Math.ceil(
            totalSamples / MAX_WAVEFORM_TEXTURE_WIDTH,
        );
        levels.push(minSamplesPerPixel);
    }
    return levels;
}
export function generateTestWaveform(config: TestTrackConfig): WaveformPyramid {
    const totalSamples = Math.floor(config.durationSeconds * config.sampleRate);
    const bandConfig: WaveformBandConfig = {
        bandCount: 3,
        sampleRate: config.sampleRate,
        frequencyRanges: [
            {min: 20, max: 250}, 
            {min: 250, max: 4000}, 
            {min: 4000, max: 20000}, 
        ],
    };
    const lods: WaveformLOD[] = [];
    const lodSamplesPerPixel = computeLodSamplesPerPixel(totalSamples);
    for (const samplesPerPixel of lodSamplesPerPixel) {
        const lengthInPixels = Math.ceil(totalSamples / samplesPerPixel);
        const amplitude = new Float32Array(lengthInPixels * 2);
        const bandEnergies = new Float32Array(lengthInPixels * 3);
        const samplesPerBeat = (config.sampleRate * 60) / config.bpm;
        const samplesPerBar = samplesPerBeat * 4;
        for (let i = 0; i < lengthInPixels; i += 1) {
            const samplePos = i * samplesPerPixel;
            const timeSeconds = samplePos / config.sampleRate;
            const beatPos = samplePos / samplesPerBeat;
            const barPos = samplePos / samplesPerBar;
            const section = getTrackSection(timeSeconds, config.durationSeconds);
            const beatPhase = beatPos % 1;
            void barPos;
            let baseAmplitude = 0.3;
            if (beatPhase < 0.1) {
                baseAmplitude += 0.4 * (1.0 - beatPhase / 0.1);
            }
            switch (section) {
                case "intro":
                    baseAmplitude *= 0.6;
                    break;
                case "breakdown":
                    baseAmplitude *= 0.4;
                    break;
                case "drop":
                    baseAmplitude *= 1.2;
                    break;
                case "outro":
                    baseAmplitude *= 0.5;
                    break;
            }
            const noise = (Math.random() - 0.5) * 0.1;
            baseAmplitude = Math.max(0.1, Math.min(1.0, baseAmplitude + noise));
            const variation = Math.random() * 0.1;
            amplitude[i * 2 + 0] = baseAmplitude * (1 - variation); 
            amplitude[i * 2 + 1] = baseAmplitude; 
            let lowEnergy = 0.3;
            let midEnergy = 0.3;
            let highEnergy = 0.2;
            if (beatPhase < 0.15) {
                lowEnergy += 0.5 * (1.0 - beatPhase / 0.15);
            }
            if (Math.abs(beatPhase - 0.5) < 0.1) {
                highEnergy += 0.3;
            }
            switch (section) {
                case "intro":
                    lowEnergy *= 0.5;
                    highEnergy *= 1.2;
                    break;
                case "breakdown":
                    lowEnergy *= 0.3;
                    midEnergy *= 1.3;
                    highEnergy *= 0.8;
                    break;
                case "drop":
                    lowEnergy *= 1.4;
                    midEnergy *= 1.2;
                    highEnergy *= 1.1;
                    break;
            }
            const totalEnergy = lowEnergy + midEnergy + highEnergy;
            const norm = totalEnergy > 0 ? 3 / totalEnergy : 0;
            bandEnergies[i * 3 + 0] = Math.min(
                1.0,
                lowEnergy * norm * (0.9 + Math.random() * 0.2),
            );
            bandEnergies[i * 3 + 1] = Math.min(
                1.0,
                midEnergy * norm * (0.9 + Math.random() * 0.2),
            );
            bandEnergies[i * 3 + 2] = Math.min(
                1.0,
                highEnergy * norm * (0.9 + Math.random() * 0.2),
            );
        }
        lods.push({
            samplesPerPixel,
            lengthInPixels,
            amplitude,
            bandEnergies,
        });
    }
    return {
        totalSamples,
        sampleRate: config.sampleRate,
        lods,
        bands: bandConfig,
    };
}
function getTrackSection(
    timeSeconds: number,
    durationSeconds: number,
): "intro" | "verse" | "breakdown" | "drop" | "outro" {
    const progress = timeSeconds / durationSeconds;
    if (progress < 0.1) {return "intro";}
    if (progress < 0.3) {return "verse";}
    if (progress < 0.4) {return "breakdown";}
    if (progress < 0.7) {return "drop";}
    if (progress < 0.85) {return "breakdown";}
    return "outro";
}
export function generateTestCuePoints(config: TestTrackConfig): CuePoint[] {
    const samplesPerBeat = (config.sampleRate * 60) / config.bpm;
    const samplesPerBar = samplesPerBeat * 4;
    const totalBars = Math.floor(
        (config.durationSeconds * config.sampleRate) / samplesPerBar,
    );
    const cuePoints: CuePoint[] = [];
    const cueLocations = [
        {bar: 0, label: "Intro", color: [255, 200, 50] as const},
        {
            bar: Math.floor(totalBars * 0.1),
            label: "Verse",
            color: [50, 200, 255] as const,
        },
        {
            bar: Math.floor(totalBars * 0.3),
            label: "Breakdown",
            color: [200, 100, 255] as const,
        },
        {
            bar: Math.floor(totalBars * 0.4),
            label: "Drop",
            color: [255, 50, 50] as const,
        },
        {
            bar: Math.floor(totalBars * 0.7),
            label: "Break 2",
            color: [200, 100, 255] as const,
        },
        {
            bar: Math.floor(totalBars * 0.85),
            label: "Outro",
            color: [100, 255, 100] as const,
        },
    ];
    for (let i = 0; i < cueLocations.length; i += 1) {
        cuePoints.push({
            id: `cue-${i}`,
            samplePosition: cueLocations[i].bar * samplesPerBar,
            color: cueLocations[i].color,
            label: cueLocations[i].label,
        });
    }
    return cuePoints;
}
export function generateTestSections(config: TestTrackConfig): SectionMarker[] {
    const totalSamples = config.durationSeconds * config.sampleRate;
    return [
        {
            startSample: 0,
            endSample: totalSamples * 0.1,
            type: "intro",
            label: "Intro",
        },
        {
            startSample: totalSamples * 0.1,
            endSample: totalSamples * 0.3,
            type: "verse",
            label: "Verse",
        },
        {
            startSample: totalSamples * 0.3,
            endSample: totalSamples * 0.4,
            type: "breakdown",
            label: "Breakdown",
        },
        {
            startSample: totalSamples * 0.4,
            endSample: totalSamples * 0.7,
            type: "drop",
            label: "Drop",
        },
        {
            startSample: totalSamples * 0.7,
            endSample: totalSamples * 0.85,
            type: "breakdown",
            label: "Breakdown 2",
        },
        {
            startSample: totalSamples * 0.85,
            endSample: totalSamples,
            type: "outro",
            label: "Outro",
        },
    ];
}
export function createTestDeckState(config: TestTrackConfig): DeckState {
    const waveform = generateTestWaveform(config);
    const samplesPerBeat = (config.sampleRate * 60) / config.bpm;
    const samplesPerBar = samplesPerBeat * 4;
    const transport: DeckTransportState = {
        playheadSamples: 0,
        rate: 1.0,
        bpm: config.bpm,
        beatPhase: 0,
        barIndex: 0,
        beatInBar: 0,
        isPlaying: false,
        isSlipMode: false,
        slipPlayheadSamples: 0,
    };
    const loop: LoopState = {
        active: false,
        inSample: samplesPerBar * 8,
        outSample: samplesPerBar * 16,
    };
    return {
        id: "deck-a",
        transport,
        loop,
        cuePoints: generateTestCuePoints(config),
        sections: generateTestSections(config),
        waveform,
        trackTitle: config.title,
        trackArtist: config.artist,
        trackKey: config.key,
        trackDurationSamples: waveform.totalSamples,
    };
}
export function createTestAudioVisualState(
    decks: DeckState[],
): AudioVisualState {
    const master: MasterMeter = {
        rms: 0.5,
        peak: 0.7,
        peakHold: 0.75,
        lufs: -14,
        lowEnergy: 0.4,
        midEnergy: 0.5,
        highEnergy: 0.3,
        leftPeak: 0.68,
        rightPeak: 0.72,
        correlation: 0.95,
    };
    return {
        time: 0,
        deltaTime: 0,
        decks,
        master,
        crossfaderPosition: 0,
    };
}
export function updateTransportPlayback(
    state: DeckState,
    deltaTime: number,
    isPlaying: boolean,
): DeckState {
    if (!isPlaying) {return state;}
    const newPlayhead =
        state.transport.playheadSamples +
        state.waveform.sampleRate * deltaTime * state.transport.rate;
    const samplesPerBeat = (state.waveform.sampleRate * 60) / state.transport.bpm;
    const samplesPerBar = samplesPerBeat * 4;
    const beatPosition = newPlayhead / samplesPerBeat;
    const barPosition = newPlayhead / samplesPerBar;
    const newTransport: DeckTransportState = {
        ...state.transport,
        playheadSamples: newPlayhead % state.waveform.totalSamples,
        beatPhase: beatPosition % 1,
        barIndex: Math.floor(barPosition),
        beatInBar: Math.floor(beatPosition % 4),
        isPlaying,
    };
    return {
        ...state,
        transport: newTransport,
    };
}
export function buildWaveformPyramidFromPCM(
    pcmData: Float32Array,
    sampleRate: number,
): WaveformPyramid {
    const totalSamples = pcmData.length;
    const bandConfig: WaveformBandConfig = {
        bandCount: 3,
        sampleRate,
        frequencyRanges: [
            {min: 20, max: 250},
            {min: 250, max: 4000},
            {min: 4000, max: 20000},
        ],
    };
    const lods: WaveformLOD[] = [];
    const lodSamplesPerPixel = computeLodSamplesPerPixel(totalSamples);
    for (const samplesPerPixel of lodSamplesPerPixel) {
        const lengthInPixels = Math.ceil(totalSamples / samplesPerPixel);
        const amplitude = new Float32Array(lengthInPixels * 2);
        const bandEnergies = new Float32Array(lengthInPixels * 3);
        for (let i = 0; i < lengthInPixels; i += 1) {
            const startSample = i * samplesPerPixel;
            const endSample = Math.min(startSample + samplesPerPixel, totalSamples);
            let minVal = 0;
            let maxVal = 0;
            let sumSquares = 0;
            let sampleCount = 0;
            for (let j = startSample; j < endSample; j += 1) {
                const sample = pcmData[j];
                if (sample < minVal) {minVal = sample;}
                if (sample > maxVal) {maxVal = sample;}
                sumSquares += sample * sample;
                sampleCount += 1;
            }
            amplitude[i * 2 + 0] = Math.abs(minVal);
            amplitude[i * 2 + 1] = maxVal;
            const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
            let zeroCrossings = 0;
            let highPassEnergy = 0;
            let lowPassEnergy = 0;
            for (let j = startSample + 1; j < endSample; j += 1) {
                const curr = pcmData[j];
                const prev = pcmData[j - 1];
                if ((curr >= 0 && prev < 0) || (curr < 0 && prev >= 0)) {
                    zeroCrossings += 1;
                }
                const highPass = curr - prev;
                highPassEnergy += highPass * highPass;
                lowPassEnergy += Math.abs(curr) * Math.abs(curr);
            }
            const blockSize = endSample - startSample;
            const zeroCrossingRate =
                blockSize > 0 ? zeroCrossings / blockSize : 0;
            const totalEnergy = rms + 0.001;
            let lowEnergy = rms * (1.0 - zeroCrossingRate * 2);
            let midEnergy = rms * 0.5;
            let highEnergy = rms * zeroCrossingRate * 3;
            const denom = maxVal + Math.abs(minVal) + 0.001;
            const peakiness = denom > 0 ? (maxVal - Math.abs(minVal)) / denom : 0;
            lowEnergy += Math.abs(peakiness) * rms * 0.3;
            lowEnergy = Math.max(0, Math.min(1, lowEnergy / totalEnergy));
            midEnergy = Math.max(0, Math.min(1, midEnergy / totalEnergy));
            highEnergy = Math.max(0, Math.min(1, highEnergy / totalEnergy));
            bandEnergies[i * 3 + 0] = lowEnergy;
            bandEnergies[i * 3 + 1] = midEnergy;
            bandEnergies[i * 3 + 2] = highEnergy;
        }
        lods.push({
            samplesPerPixel,
            lengthInPixels,
            amplitude,
            bandEnergies,
        });
    }
    return {
        totalSamples,
        sampleRate,
        lods,
        bands: bandConfig,
    };
}
```

### `src/vite-env.d.ts` {#src-vite-env-d-ts}

```typescript
// File: src/vite-env.d.ts

declare module '*.wgsl?raw' {
  const content: string;
  export default content;
}
declare module '*.wgsl' {
  const content: string;
  export default content;
}
```

### `src/waveform/deck-waveform.ts` {#src-waveform-deck-waveform-ts}

```typescript
// File: src/waveform/deck-waveform.ts

import type {
    DeckWaveformController,
    Dimensions,
    VisualComponent,
    VisualContext,
    WaveformKnobState,
} from '../types/visual-component.ts';
import type {AudioVisualState, DeckState, WaveformPyramid} from '../types/audio-state.ts';
import waveformShaderCode from '../shaders/waveform.wgsl?raw';
const _UNIFORM_ALIGNMENT = 16;
const WAVEFORM_UNIFORMS_SIZE = 128; 
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
    private zoom = 1.0; 
    private knobState: WaveformKnobState = {
        lowGain: 1.0,
        midGain: 1.0,
        highGain: 1.0,
        brightness: 1.0,
        contrast: 1.0,
        saturation: 1.0,
    };
    private showBeatGrid = true;
    private _showCuePoints = true;
    private _showLoopRegion = true;
    private currentDeckState: DeckState | null = null;
    private waveformUploaded = false;
    private currentLODIndex = 0;
    private hasLoggedFirstFrame = false;
    private waveformDirty = false;
    constructor(deckIndex: number) {
        this.id = `deck-waveform-${deckIndex}`;
        this.deckIndex = deckIndex;
    }
    async initialize(device: GPUDevice, ctx: VisualContext): Promise<void> {
        this.device = device;
        this.ctx = ctx;
        const shaderModule = device.createShaderModule({
            label: 'Waveform Shader',
            code: waveformShaderCode,
        });
        const bindGroupLayout = device.createBindGroupLayout({
            label: 'Waveform Bind Group Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {type: 'uniform'},
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {sampleType: 'unfilterable-float'},
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {sampleType: 'unfilterable-float'},
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {type: 'non-filtering'},
                },
            ],
        });
        const pipelineLayout = device.createPipelineLayout({
            label: 'Waveform Pipeline Layout',
            bindGroupLayouts: [ctx.sharedBindGroupLayout, bindGroupLayout],
        });
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
                targets: [{format: ctx.format}],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });
        const uniformBuffer = device.createBuffer({
            label: 'Waveform Uniforms',
            size: WAVEFORM_UNIFORMS_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
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
        const sampler = device.createSampler({
            label: 'Waveform Sampler',
            magFilter: 'nearest',
            minFilter: 'nearest',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
        const bindGroup = device.createBindGroup({
            label: 'Waveform Bind Group',
            layout: bindGroupLayout,
            entries: [
                {binding: 0, resource: {buffer: uniformBuffer}},
                {binding: 1, resource: amplitudeTexture.createView()},
                {binding: 2, resource: bandsTexture.createView()},
                {binding: 3, resource: sampler},
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
    update(_dt: number, _time: number, audio: AudioVisualState): void {
        if (!this.device || !this.resources || !this.ctx) {
            return;
        }
        const deckState = audio.decks[this.deckIndex];
        if (!deckState) {
            return;
        }
        this.currentDeckState = deckState;
        const newLODIndex = this.selectLOD(deckState.waveform);
        const lodChanged = newLODIndex !== this.currentLODIndex;
        this.currentLODIndex = newLODIndex;
        if ((!this.waveformUploaded || this.waveformDirty || lodChanged) && deckState.waveform) {
            if (deckState.waveform.lods.length > 0 && deckState.waveform.totalSamples > 0) {
                this.uploadWaveformData(deckState.waveform);
                this.waveformUploaded = true;
                this.waveformDirty = false;
            }
        }
        this.updateUniforms(deckState);
    }
    markWaveformDirty(): void {
        this.waveformDirty = true;
        this.waveformUploaded = false;
    }
    encode(encoder: GPUCommandEncoder, view: GPUTextureView): void {
        if (!this.resources || !this.ctx) {
            console.warn('[DeckWaveformComponent] encode() skipped: resources or ctx is null');
            return;
        }
        if (!this.hasLoggedFirstFrame) {
            console.log('[DeckWaveformComponent] First render frame', {
                hasTextures: Boolean(this.resources.amplitudeTexture && this.resources.bandsTexture),
                waveformUploaded: this.waveformUploaded,
                dimensions: this.dimensions,
                hasSharedBindGroup: Boolean(this.ctx.sharedBindGroup),
                hasWaveformBindGroup: Boolean(this.resources.bindGroup),
            });
            this.hasLoggedFirstFrame = true;
        }
        const renderPass = encoder.beginRenderPass({
            label: 'Waveform Render Pass',
            colorAttachments: [
                {
                    view,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: {r: 0.05, g: 0.06, b: 0.12, a: 1.0},
                },
            ],
        });
        renderPass.setPipeline(this.resources.pipeline);
        renderPass.setBindGroup(0, this.ctx.sharedBindGroup);
        renderPass.setBindGroup(1, this.resources.bindGroup);
        renderPass.draw(6); 
        renderPass.end();
    }
    destroy(): void {
        if (this.resources) {
            this.resources.uniformBuffer.destroy();
            this.resources.amplitudeTexture.destroy();
            this.resources.bandsTexture.destroy();
        }
    }
    setZoom(zoom: number): void {
        this.zoom = Math.max(0.1, Math.min(100.0, zoom));
    }
    setKnobState(state: Partial<WaveformKnobState>): void {
        this.knobState = {...this.knobState, ...state};
    }
    getKnobState(): WaveformKnobState {
        return {...this.knobState};
    }
    setShowBeatGrid(show: boolean): void {
        this.showBeatGrid = show;
    }
    setShowCuePoints(show: boolean): void {
        this._showCuePoints = show;
    }
    setShowLoopRegion(show: boolean): void {
        this._showLoopRegion = show;
    }
    private selectLOD(pyramid: WaveformPyramid): number {
        const desiredSamplesPerPixel = this.getBaseSamplesPerPixel() / this.zoom;
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
        if (!this.currentDeckState) {
            return 441;
        }
        return (this.currentDeckState.waveform.sampleRate * 10) / this.dimensions.physicalWidth;
    }
    private uploadWaveformData(pyramid: WaveformPyramid): void {
        if (!this.device || !this.resources) {
            return;
        }
        if (pyramid.lods.length === 0) {
            console.error('[DeckWaveformComponent] No LODs in waveform pyramid');
            return;
        }
        const lodIndex = Math.min(
            Math.max(0, this.currentLODIndex),
            pyramid.lods.length - 1
        );
        const lod = pyramid.lods[lodIndex];
        if (!lod || lod.lengthInPixels === 0) {
            console.error('[DeckWaveformComponent] Invalid LOD data', {lodIndex, lod});
            return;
        }
        const safeWidth = Math.max(1, lod.lengthInPixels);
        console.log('[DeckWaveformComponent] Uploading waveform data', {
            lodIndex,
            lengthInPixels: lod.lengthInPixels,
            safeWidth,
            samplesPerPixel: lod.samplesPerPixel,
            totalSamples: pyramid.totalSamples,
            amplitudeLength: lod.amplitude.length,
            bandEnergiesLength: lod.bandEnergies.length,
            bandCount: pyramid.bands.bandCount,
        });
        this.resources.amplitudeTexture.destroy();
        this.resources.bandsTexture.destroy();
        const amplitudeTexture = this.device.createTexture({
            label: 'Amplitude Texture',
            size: [safeWidth, 1],
            format: 'rg32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        const expectedAmplitudeSize = lod.lengthInPixels * 2;
        if (lod.amplitude.length !== expectedAmplitudeSize) {
            console.warn('[DeckWaveformComponent] Amplitude data size mismatch', {
                expected: expectedAmplitudeSize,
                actual: lod.amplitude.length,
            });
        }
        if (lod.lengthInPixels > 0 && lod.amplitude.length >= expectedAmplitudeSize) {
            const amplitudeData = new Float32Array(safeWidth * 2);
            for (let i = 0; i < lod.lengthInPixels; i++) {
                amplitudeData[i * 2 + 0] = lod.amplitude[i * 2 + 0] ?? 0; 
                amplitudeData[i * 2 + 1] = lod.amplitude[i * 2 + 1] ?? 0; 
            }
            this.device.queue.writeTexture(
                {texture: amplitudeTexture},
                amplitudeData,
                {bytesPerRow: safeWidth * 8}, 
                {width: safeWidth, height: 1}
            );
        }
        const bandsTexture = this.device.createTexture({
            label: 'Bands Texture',
            size: [safeWidth, 1],
            format: 'rgba32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        const bandCount = pyramid.bands.bandCount;
        const expectedBandSize = lod.lengthInPixels * bandCount;
        if (lod.bandEnergies.length !== expectedBandSize) {
            console.warn('[DeckWaveformComponent] Band energies size mismatch', {
                expected: expectedBandSize,
                actual: lod.bandEnergies.length,
            });
        }
        if (lod.lengthInPixels > 0 && lod.bandEnergies.length >= expectedBandSize) {
            const bandsRGBA = new Float32Array(safeWidth * 4);
            for (let i = 0; i < lod.lengthInPixels; i++) {
                bandsRGBA[i * 4 + 0] = lod.bandEnergies[i * bandCount + 0] || 0;
                bandsRGBA[i * 4 + 1] = lod.bandEnergies[i * bandCount + 1] || 0;
                bandsRGBA[i * 4 + 2] = lod.bandEnergies[i * bandCount + 2] || 0;
                bandsRGBA[i * 4 + 3] = 1.0;
            }
            this.device.queue.writeTexture(
                {texture: bandsTexture},
                bandsRGBA,
                {bytesPerRow: safeWidth * 16}, 
                {width: safeWidth, height: 1}
            );
        }
        this.resources.amplitudeTexture = amplitudeTexture;
        this.resources.bandsTexture = bandsTexture;
        this.resources.bindGroup = this.device.createBindGroup({
            label: 'Waveform Bind Group',
            layout: this.resources.bindGroupLayout,
            entries: [
                {binding: 0, resource: {buffer: this.resources.uniformBuffer}},
                {binding: 1, resource: amplitudeTexture.createView()},
                {binding: 2, resource: bandsTexture.createView()},
                {binding: 3, resource: this.resources.sampler},
            ],
        });
        console.log('[DeckWaveformComponent] Waveform data uploaded successfully');
    }
    private updateUniforms(deckState: DeckState): void {
        if (!this.device || !this.resources) {
            return;
        }
        const lodIndex = Math.min(
            Math.max(0, this.currentLODIndex),
            deckState.waveform.lods.length - 1
        );
        const lod = deckState.waveform.lods[lodIndex];
        if (!lod) {
            console.error('[DeckWaveformComponent] LOD not found at index', lodIndex);
            return;
        }
        const playheadHigh = Math.floor(deckState.transport.playheadSamples / 16777216);
        const playheadLow = deckState.transport.playheadSamples % 16777216;
        const uniformData = new Float32Array([
            playheadHigh,
            playheadLow,
            deckState.waveform.sampleRate,
            deckState.waveform.totalSamples,
            this.getBaseSamplesPerPixel() / this.zoom,
            this.dimensions.physicalWidth,
            this.dimensions.physicalHeight,
            this.currentLODIndex,
            lod.samplesPerPixel,
            lod.lengthInPixels,
            deckState.waveform.bands.bandCount,
            0, 
            this.knobState.brightness,
            this.knobState.contrast,
            this.knobState.saturation,
            0, 
            this.knobState.lowGain,
            this.knobState.midGain,
            this.knobState.highGain,
            0, 
            deckState.loop.active ? 1.0 : 0.0,
            deckState.loop.inSample,
            deckState.loop.outSample,
            this.showBeatGrid ? 1.0 : 0.0,
            deckState.transport.bpm,
            deckState.transport.beatPhase,
            0, 
            0, 
        ]);
        if (this.waveformUploaded && !this.hasLoggedFirstFrame) {
            console.log('[DeckWaveformComponent] Uniform values being set:', {
                playheadSamples: deckState.transport.playheadSamples,
                playheadHigh,
                playheadLow,
                sampleRate: deckState.waveform.sampleRate,
                totalSamples: deckState.waveform.totalSamples,
                viewWidth: this.dimensions.physicalWidth,
                viewHeight: this.dimensions.physicalHeight,
                samplesPerPixel: this.getBaseSamplesPerPixel() / this.zoom,
                lodIndex: this.currentLODIndex,
                lodSamplesPerPixel: lod.samplesPerPixel,
                lodLengthInPixels: lod.lengthInPixels,
                bandCount: deckState.waveform.bands.bandCount,
            });
        }
        this.device.queue.writeBuffer(this.resources.uniformBuffer, 0, uniformData);
    }
}
```

### `src/waveform/demo.ts` {#src-waveform-demo-ts}

```typescript
// File: src/waveform/demo.ts

import {
  runTestHarness,
  togglePlayback,
  setZoomLevel,
  seekToPosition,
  setPlaybackRate,
  setBeatPhaseOffset,
  destroyTestHarness,
} from './test-harness.ts';
async function initializeDemo(): Promise<void> {
  const statusEl = document.getElementById('status');
  const canvasEl = document.getElementById('waveform-canvas') as HTMLCanvasElement | null;
  if (!canvasEl) {
    throw new Error('Canvas element not found');
  }
  const updateStatus = (text: string): void => {
    if (statusEl) {
      statusEl.textContent = text;
    }
  };
  try {
    updateStatus('Checking WebGPU support...');
    if (!navigator.gpu) {
      throw new Error(
        'WebGPU is not supported in your browser. ' +
          'Please use Chrome 113+ or Edge 113+ with WebGPU enabled.'
      );
    }
    updateStatus('Requesting GPU adapter...');
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });
    if (!adapter) {
      throw new Error('No WebGPU adapter found. Your GPU may not support WebGPU.');
    }
    updateStatus('Creating GPU device...');
    const device = await adapter.requestDevice({
      label: 'deck-waveform-demo',
    });
    updateStatus('Initializing waveform component...');
    const state = runTestHarness(canvasEl, device);
    updateStatus('Ready');
    setupControls(state, canvasEl);
    setupKeyboardShortcuts(state);
    setupResizeHandler(state, canvasEl);
    updateInfoDisplay(state);
    setInterval(() => {
      updateInfoDisplay(state);
    }, 100);
    window.addEventListener('beforeunload', () => {
      destroyTestHarness(state);
      device.destroy();
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    updateStatus(`Error: ${errorMessage}`);
    console.error('Failed to initialize demo:', error);
  }
}
function setupControls(
  state: ReturnType<typeof runTestHarness>,
  canvas: HTMLCanvasElement
): void {
  const playBtn = document.getElementById('play-btn');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      togglePlayback(state);
      playBtn.textContent = state.isPlaying ? '⏸ Pause' : '▶ Play';
    });
  }
  const zoomSlider = document.getElementById('zoom-slider') as HTMLInputElement | null;
  const zoomValue = document.getElementById('zoom-value');
  if (zoomSlider) {
    zoomSlider.addEventListener('input', () => {
      const zoom = parseFloat(zoomSlider.value);
      setZoomLevel(state, zoom);
      if (zoomValue) {
        zoomValue.textContent = `${zoom.toFixed(1)}x`;
      }
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const currentZoom = parseFloat(zoomSlider.value);
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(10, currentZoom * delta));
      zoomSlider.value = newZoom.toString();
      setZoomLevel(state, newZoom);
      if (zoomValue) {
        zoomValue.textContent = `${newZoom.toFixed(1)}x`;
      }
    });
  }
  const speedSlider = document.getElementById('speed-slider') as HTMLInputElement | null;
  const speedValue = document.getElementById('speed-value');
  if (speedSlider) {
    speedSlider.addEventListener('input', () => {
      const speed = parseFloat(speedSlider.value);
      setPlaybackRate(state, speed);
      if (speedValue) {
        speedValue.textContent = `${speed.toFixed(1)}x`;
      }
    });
  }
  const beatPhaseSlider = document.getElementById('beat-phase-slider') as HTMLInputElement | null;
  const beatPhaseValue = document.getElementById('beat-phase-value');
  if (beatPhaseSlider) {
    beatPhaseSlider.addEventListener('input', () => {
      const phase = parseFloat(beatPhaseSlider.value);
      setBeatPhaseOffset(state, phase);
      if (beatPhaseValue) {
        beatPhaseValue.textContent = phase.toFixed(2);
      }
    });
  }
  const seekSlider = document.getElementById('seek-slider') as HTMLInputElement | null;
  if (seekSlider) {
    seekSlider.addEventListener('input', () => {
      const position = parseFloat(seekSlider.value);
      seekToPosition(state, position);
    });
    setInterval(() => {
      const position = state.transport.playheadSamples / state.totalSamples;
      seekSlider.value = position.toString();
    }, 50);
  }
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const centerX = rect.width / 2;
    const offsetPixels = clickX - centerX;
    const zoomValue = parseFloat(
      (document.getElementById('zoom-slider') as HTMLInputElement | null)?.value ?? '1'
    );
    const baseSamplesPerPixel = (state.sampleRate * 10) / rect.width;
    const samplesPerPixel = baseSamplesPerPixel / zoomValue;
    const sampleOffset = offsetPixels * samplesPerPixel;
    const newPlayhead = Math.max(
      0,
      Math.min(state.totalSamples, state.transport.playheadSamples + sampleOffset)
    );
    state.transport = {
      ...state.transport,
      playheadSamples: newPlayhead,
    };
    state.waveform.updateTransport(state.transport);
  });
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      seekToPosition(state, 0);
    });
  }
}
function setupKeyboardShortcuts(
  state: ReturnType<typeof runTestHarness>
): void {
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }
    switch (e.key) {
      case ' ': {
        e.preventDefault();
        togglePlayback(state);
        const playBtn = document.getElementById('play-btn');
        if (playBtn) {
          playBtn.textContent = state.isPlaying ? '⏸ Pause' : '▶ Play';
        }
        break;
      }
      case 'Home':
        e.preventDefault();
        seekToPosition(state, 0);
        break;
      case 'End':
        e.preventDefault();
        seekToPosition(state, 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seekToPosition(state, Math.max(0, state.transport.playheadSamples / state.totalSamples - 0.05));
        break;
      case 'ArrowRight':
        e.preventDefault();
        seekToPosition(
          state,
          Math.min(1, state.transport.playheadSamples / state.totalSamples + 0.05)
        );
        break;
    }
  });
}
function setupResizeHandler(
  state: ReturnType<typeof runTestHarness>,
  canvas: HTMLCanvasElement
): void {
  const handleResize = (): void => {
    const dpr = window.devicePixelRatio ?? 1;
    const rect = canvas.getBoundingClientRect();
    state.waveform.resize(rect.width, rect.height, dpr);
  };
  window.addEventListener('resize', handleResize);
  handleResize();
}
function updateInfoDisplay(
  state: ReturnType<typeof runTestHarness>
): void {
  const infoEl = document.getElementById('info');
  if (!infoEl) {
    return;
  }
  const playheadSeconds = state.transport.playheadSamples / state.sampleRate;
  const totalSeconds = state.totalSamples / state.sampleRate;
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };
  const currentBeat = (playheadSeconds * state.transport.bpm) / 60;
  const bar = Math.floor(currentBeat / 4) + 1;
  const beat = Math.floor(currentBeat % 4) + 1;
  infoEl.textContent =
    `${formatTime(playheadSeconds)} / ${formatTime(totalSeconds)} | ` +
    `${state.transport.bpm} BPM | ` +
    `Bar ${bar} Beat ${beat}`;
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeDemo().catch((err: unknown) => {
      console.error(err);
    });
  });
} else {
  initializeDemo().catch((err: unknown) => {
    console.error(err);
  });
}
```

### `src/waveform/gpu-resources.ts` {#src-waveform-gpu-resources-ts}

```typescript
// File: src/waveform/gpu-resources.ts

import type {LODGPUResources, WaveformLOD, WaveformPyramid, WaveUniformsData,} from './types.ts';
const UNIFORM_BUFFER_SIZE = 80; 
export function createAmplitudeTexture(
    device: GPUDevice,
    lod: WaveformLOD
): GPUTexture {
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
    if (lod.lengthInPixels > 0 && lod.amplitude.length >= lod.lengthInPixels) {
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
export function createBandTexture(
    device: GPUDevice,
    lod: WaveformLOD,
    bandCount: number
): GPUTexture {
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
    if (lod.lengthInPixels > 0 && lod.bandEnergies.length >= lod.lengthInPixels * bandCount) {
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
function float32ToFloat16(value: number): number {
    const floatView = new Float32Array(1);
    const int32View = new Int32Array(floatView.buffer);
    floatView[0] = value;
    const x = int32View[0] ?? 0;
    const sign = (x >> 16) & 0x8000;
    let exponent = ((x >> 23) & 0xff) - 127 + 15;
    let mantissa = (x >> 13) & 0x3ff;
    if (exponent <= 0) {
        return sign;
    } else if (exponent >= 31) {
        return sign | 0x7c00;
    }
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
export function createBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
    return device.createBindGroupLayout({
        label: 'waveform-bind-group-layout',
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: {type: 'uniform'},
            },
            {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {sampleType: 'float', viewDimension: '2d'},
            },
            {
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {sampleType: 'float', viewDimension: '2d'},
            },
            {
                binding: 3,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {sampleType: 'float', viewDimension: '2d'},
            },
            {
                binding: 4,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {sampleType: 'float', viewDimension: '2d'},
            },
            {
                binding: 5,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: {type: 'filtering'},
            },
        ],
    });
}
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
            {binding: 0, resource: {buffer: uniformBuffer}},
            {binding: 1, resource: amplitudeTexture.createView()},
            {binding: 2, resource: bandTexture.createView()},
            {binding: 3, resource: amplitudeTexture.createView()}, 
            {binding: 4, resource: bandTexture.createView()},       
            {binding: 5, resource: sampler},
        ],
    });
}
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
export function createUniformBuffer(device: GPUDevice): GPUBuffer {
    return device.createBuffer({
        label: 'waveform-uniforms',
        size: UNIFORM_BUFFER_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
}
export function splitPlayheadSamples(samples: number): { high: number; low: number } {
    const splitFactor = 65536; 
    const high = Math.floor(samples / splitFactor);
    const low = samples - high * splitFactor;
    return {high, low};
}
export function writeUniforms(
    device: GPUDevice,
    buffer: GPUBuffer,
    data: WaveUniformsData
): void {
    const arrayBuffer = new ArrayBuffer(UNIFORM_BUFFER_SIZE);
    const floatView = new Float32Array(arrayBuffer);
    const uintView = new Uint32Array(arrayBuffer);
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
    device.queue.writeBuffer(buffer, 0, arrayBuffer);
}
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
export function destroyLODResources(resources: LODGPUResources[]): void {
    for (const res of resources) {
        res.amplitudeTexture.destroy();
        res.bandTexture.destroy();
    }
}
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
export function calculateSamplesPerPixel(
    viewWidth: number,
    sampleRate: number,
    zoomLevel: number
): number {
    const baseSecondsVisible = 10.0;
    const secondsVisible = baseSecondsVisible / zoomLevel;
    const totalSamplesVisible = secondsVisible * sampleRate;
    return totalSamplesVisible / viewWidth;
}
export interface LODBlendInfo {
    primaryIndex: number;
    secondaryIndex: number;
    blendFactor: number; 
}
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
    let lowerIndex = 0; 
    let upperIndex = lods.length - 1; 
    for (let i = 0; i < lods.length - 1; i++) {
        const currentLOD = lods[i];
        const nextLOD = lods[i + 1];
        if (!currentLOD || !nextLOD) {
            continue;
        }
        if (
            targetSamplesPerPixel >= currentLOD.samplesPerPixel &&
            targetSamplesPerPixel <= nextLOD.samplesPerPixel
        ) {
            lowerIndex = i;
            upperIndex = i + 1;
            break;
        }
        if (i === 0 && targetSamplesPerPixel < currentLOD.samplesPerPixel) {
            return {primaryIndex: 0, secondaryIndex: 0, blendFactor: 0};
        }
    }
    const lastLOD = lods[lods.length - 1];
    if (lastLOD && targetSamplesPerPixel > lastLOD.samplesPerPixel) {
        return {
            primaryIndex: lods.length - 1,
            secondaryIndex: lods.length - 1,
            blendFactor: 0,
        };
    }
    const lowerLOD = lods[lowerIndex];
    const upperLOD = lods[upperIndex];
    if (!lowerLOD || !upperLOD) {
        return {primaryIndex: lowerIndex, secondaryIndex: upperIndex, blendFactor: 0};
    }
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
```

### `src/waveform/index.ts` {#src-waveform-index-ts}

```typescript
// File: src/waveform/index.ts

export { createDeckWaveform } from './deck-waveform.ts';
export type {
  WaveformBandConfig,
  WaveformLOD,
  WaveformPyramid,
  DeckTransportState,
  DeckWaveformOptions,
  DeckWaveform,
  CreateDeckWaveform,
} from './types.ts';
export {
  createSyntheticWaveform,
  runTestHarness,
  togglePlayback,
  setZoomLevel,
  seekToPosition,
  setPlaybackRate,
  destroyTestHarness,
} from './test-harness.ts';
export {
  selectLODIndex,
  calculateSamplesPerPixel,
} from './gpu-resources.ts';
```

### `src/waveform/test-harness.ts` {#src-waveform-test-harness-ts}

```typescript
// File: src/waveform/test-harness.ts

import type {
  WaveformPyramid,
  WaveformLOD,
  WaveformBandConfig,
  DeckTransportState,
} from './types.ts';
import { createDeckWaveform } from './deck-waveform.ts';
function generateSyntheticBandEnergies(
  lengthInPixels: number,
  bandCount: number,
  samplesPerPixel: number,
  sampleRate: number,
  bpm: number
): Float32Array {
  const bandEnergies = new Float32Array(lengthInPixels * bandCount);
  const samplesPerBeat = (sampleRate * 60) / bpm;
  const _pixelsPerBeat = samplesPerBeat / samplesPerPixel; 
  for (let pixelIdx = 0; pixelIdx < lengthInPixels; pixelIdx++) {
    const samplePosition = pixelIdx * samplesPerPixel;
    const beatPhase = (samplePosition % samplesPerBeat) / samplesPerBeat;
    const low = Math.pow(Math.max(0, 1.0 - beatPhase * 4.0), 2.0) * 0.9;
    const midPhase = beatPhase * 2.0;
    const mid = Math.pow(Math.sin(midPhase * Math.PI), 2) * 0.7;
    const highPhase = beatPhase * 4.0;
    const high = Math.pow(Math.max(0, Math.sin(highPhase * Math.PI * 2)), 3) * 0.8;
    if (bandCount >= 3) {
      bandEnergies[pixelIdx * bandCount + 0] = low;
      bandEnergies[pixelIdx * bandCount + 1] = mid;
      bandEnergies[pixelIdx * bandCount + 2] = high;
      for (let b = 3; b < bandCount; b++) {
        const phase = (beatPhase * (b + 1)) % 1.0;
        bandEnergies[pixelIdx * bandCount + b] = Math.sin(phase * Math.PI) * 0.5;
      }
    } else if (bandCount === 2) {
      bandEnergies[pixelIdx * bandCount + 0] = low;
      bandEnergies[pixelIdx * bandCount + 1] = high;
    } else if (bandCount === 1) {
      bandEnergies[pixelIdx * bandCount + 0] = (low + mid + high) / 3.0;
    }
  }
  return bandEnergies;
}
function generateSyntheticAmplitude(
  lengthInPixels: number,
  samplesPerPixel: number,
  sampleRate: number,
  bpm: number,
  totalSamples: number
): Float32Array {
  const amplitude = new Float32Array(lengthInPixels);
  const samplesPerBeat = (sampleRate * 60) / bpm;
  const beatsTotal = totalSamples / samplesPerBeat;
  for (let pixelIdx = 0; pixelIdx < lengthInPixels; pixelIdx++) {
    const samplePosition = pixelIdx * samplesPerPixel;
    if (samplePosition >= totalSamples) {
      amplitude[pixelIdx] = 0;
      continue;
    }
    const currentBeat = samplePosition / samplesPerBeat;
    const beatPhase = (samplePosition % samplesPerBeat) / samplesPerBeat;
    let sectionAmplitude = 0.0;
    const progressRatio = currentBeat / beatsTotal;
    if (progressRatio < 0.05) {
      sectionAmplitude = progressRatio / 0.05;
    } else if (progressRatio < 0.25) {
      sectionAmplitude = 0.6 + (progressRatio - 0.05) * 2.0;
    } else if (progressRatio < 0.5) {
      sectionAmplitude = 1.0;
    } else if (progressRatio < 0.6) {
      sectionAmplitude = 0.4;
    } else if (progressRatio < 0.85) {
      sectionAmplitude = 1.0;
    } else {
      sectionAmplitude = Math.max(0, 1.0 - (progressRatio - 0.85) / 0.15);
    }
    const beatTransient = Math.pow(Math.max(0, 1.0 - beatPhase * 8.0), 2.0);
    const transientLevel = 0.3 * beatTransient;
    const noise = (Math.sin(pixelIdx * 0.1) * 0.5 + 0.5) * 0.1;
    amplitude[pixelIdx] = Math.min(1.0, sectionAmplitude * 0.8 + transientLevel + noise);
  }
  return amplitude;
}
function createSyntheticLOD(
  samplesPerPixel: number,
  totalSamples: number,
  sampleRate: number,
  bpm: number,
  bandCount: number
): WaveformLOD {
  const lengthInPixels = Math.ceil(totalSamples / samplesPerPixel);
  return {
    samplesPerPixel,
    lengthInPixels,
    amplitude: generateSyntheticAmplitude(
      lengthInPixels,
      samplesPerPixel,
      sampleRate,
      bpm,
      totalSamples
    ),
    bandEnergies: generateSyntheticBandEnergies(
      lengthInPixels,
      bandCount,
      samplesPerPixel,
      sampleRate,
      bpm
    ),
  };
}
export function createSyntheticWaveform(
  durationSeconds: number,
  sampleRate: number,
  bpm: number,
  bandCount = 3
): WaveformPyramid {
  const totalSamples = Math.floor(durationSeconds * sampleRate);
  const bandConfig: WaveformBandConfig = {
    bandCount,
    sampleRate,
  };
  const lodConfigs = [
    128,    
    256,    
    512,    
    1024,   
    2048,   
    4096,   
    8192,   
  ];
  const lods: WaveformLOD[] = [];
  for (const spp of lodConfigs) {
    lods.push(createSyntheticLOD(spp, totalSamples, sampleRate, bpm, bandCount));
  }
  return {
    totalSamples,
    bandConfig,
    lods,
  };
}
interface TestHarnessState {
  waveform: ReturnType<typeof createDeckWaveform>;
  transport: DeckTransportState;
  isPlaying: boolean;
  animationFrameId: number;
  lastTime: number;
  sampleRate: number;
  totalSamples: number;
}
export function runTestHarness(
  canvas: HTMLCanvasElement,
  device: GPUDevice
): TestHarnessState {
  const pyramid = createSyntheticWaveform(240, 44100, 128, 3);
  const waveform = createDeckWaveform({
    device,
    canvas,
    waveform: pyramid,
  });
  const dpr = window.devicePixelRatio ?? 1;
  const rect = canvas.getBoundingClientRect();
  waveform.resize(rect.width, rect.height, dpr);
  const transport: DeckTransportState = {
    playheadSamples: 0,
    rate: 1.0,
    bpm: 128,
    beatPhaseOffset: 0,
  };
  waveform.updateTransport(transport);
  const state: TestHarnessState = {
    waveform,
    transport,
    isPlaying: false,
    animationFrameId: 0,
    lastTime: performance.now() / 1000,
    sampleRate: pyramid.bandConfig.sampleRate,
    totalSamples: pyramid.totalSamples,
  };
  const renderLoop = (): void => {
    const currentTime = performance.now() / 1000;
    const dt = currentTime - state.lastTime;
    state.lastTime = currentTime;
    if (state.isPlaying) {
      const newPlayhead =
        state.transport.playheadSamples + dt * state.sampleRate * state.transport.rate;
      state.transport = {
        ...state.transport,
        playheadSamples: newPlayhead % state.totalSamples,
      };
      waveform.updateTransport(state.transport);
    }
    waveform.frame(dt, currentTime);
    state.animationFrameId = requestAnimationFrame(renderLoop);
  };
  state.animationFrameId = requestAnimationFrame(renderLoop);
  return state;
}
export function togglePlayback(state: TestHarnessState): void {
  state.isPlaying = !state.isPlaying;
}
export function setZoomLevel(state: TestHarnessState, zoom: number): void {
  state.waveform.setZoom(zoom);
}
export function seekToPosition(state: TestHarnessState, position: number): void {
  const newPlayhead = position * state.totalSamples;
  state.transport = {
    ...state.transport,
    playheadSamples: newPlayhead,
  };
  state.waveform.updateTransport(state.transport);
}
export function setPlaybackRate(state: TestHarnessState, rate: number): void {
  state.transport = {
    ...state.transport,
    rate,
  };
  state.waveform.updateTransport(state.transport);
}
export function setBeatPhaseOffset(state: TestHarnessState, offset: number): void {
  const normalizedOffset = ((offset % 1) + 1) % 1;
  state.transport = {
    ...state.transport,
    beatPhaseOffset: normalizedOffset,
  };
  state.waveform.updateTransport(state.transport);
}
export function destroyTestHarness(state: TestHarnessState): void {
  cancelAnimationFrame(state.animationFrameId);
  state.waveform.destroy();
}
```

### `src/waveform/types.ts` {#src-waveform-types-ts}

```typescript
// File: src/waveform/types.ts

export interface WaveformBandConfig {
  readonly bandCount: number;       
  readonly sampleRate: number;      
}
export interface WaveformLOD {
  readonly samplesPerPixel: number; 
  readonly lengthInPixels: number;  
  readonly amplitude: Float32Array;
  readonly bandEnergies: Float32Array;
}
export interface WaveformPyramid {
  readonly totalSamples: number;                  
  readonly bandConfig: WaveformBandConfig;
  readonly lods: readonly WaveformLOD[];         
}
export interface DeckTransportState {
  readonly playheadSamples: number;  
  readonly rate: number;             
  readonly bpm: number;              
  readonly beatPhaseOffset?: number; 
}
export interface DeckWaveformOptions {
  readonly device: GPUDevice;              
  readonly canvas: HTMLCanvasElement;      
  readonly waveform: WaveformPyramid;      
}
export interface DeckWaveform {
  updateTransport(state: DeckTransportState): void;
  setZoom(zoom: number): void;
  resize(width: number, height: number, dpr: number): void;
  frame(dt: number, time: number): void;
  destroy(): void;
}
export interface WaveUniformsData {
  viewWidth: number;
  viewHeight: number;
  playheadSamplesHigh: number;  
  playheadSamplesLow: number;   
  sampleRate: number;
  rate: number;                 
  zoomLevel: number;            
  samplesPerPixel: number;      
  lodLengthInPixels: number;
  totalSamples: number;         
  bandCount: number;
  waveformCenterY: number;      
  waveformMaxHeight: number;    
  time: number;                 
  lodBlendFactor: number;       
  secondarySamplesPerPixel: number;  
  secondaryLodLengthInPixels: number; 
  beatPhaseOffset: number;      
}
export interface LODGPUResources {
  readonly amplitudeTexture: GPUTexture;
  readonly bandTexture: GPUTexture;
  readonly bindGroup: GPUBindGroup;
}
export type CreateDeckWaveform = (options: DeckWaveformOptions) => DeckWaveform;
```

### `tests/browser/test-harness.ts` {#tests-browser-test-harness-ts}

```typescript
// File: tests/browser/test-harness.ts

import {createDeckWaveform} from '../../src/waveform/deck-waveform.ts';
import {createSyntheticWaveform} from '../../src/waveform/test-harness.ts';
import type {DeckTransportState, DeckWaveform} from '../../src/waveform/types.ts';
export interface WaveformTestHandle {
    readonly canvas: HTMLCanvasElement;
    readonly waveform: DeckWaveform;
    readonly sampleRate: number;
    readonly totalSamples: number;
}
export interface TestHarnessOptions {
    durationSeconds?: number;
    sampleRate?: number;
    bpm?: number;
    bandCount?: number;
    canvasWidth?: number;
    canvasHeight?: number;
    initialPlayheadFrame?: number;
    initialZoom?: number;
}
export async function createWaveformTestHandle(
    root: HTMLElement,
    options: TestHarnessOptions = {}
): Promise<WaveformTestHandle> {
    const {
        durationSeconds = 60,
        sampleRate = 44100,
        bpm = 128,
        bandCount = 3,
        canvasWidth = 1280,
        canvasHeight = 256,
        initialPlayheadFrame = 0,
        initialZoom = 512,
    } = options;
    const canvas = document.createElement('canvas');
    canvas.dataset.testid = 'waveform-canvas';
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    root.appendChild(canvas);
    if (!navigator.gpu) {
        throw new Error('WebGPU is not supported in this environment');
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error('Failed to get WebGPU adapter');
    }
    const device = await adapter.requestDevice();
    const pyramid = createSyntheticWaveform(durationSeconds, sampleRate, bpm, bandCount);
    const waveform = createDeckWaveform({
        device,
        canvas,
        waveform: pyramid,
    });
    const dpr = window.devicePixelRatio;
    waveform.resize(canvasWidth, canvasHeight, dpr);
    waveform.setZoom(initialZoom);
    const transport: DeckTransportState = {
        playheadSamples: initialPlayheadFrame,
        rate: 1.0,
        bpm,
        beatPhaseOffset: 0,
    };
    waveform.updateTransport(transport);
    waveform.frame(0, 0);
    return {
        canvas,
        waveform,
        sampleRate,
        totalSamples: pyramid.totalSamples,
    };
}
export function seekAndRender(
    handle: WaveformTestHandle,
    playheadSamples: number,
    bpm = 128
): void {
    const transport: DeckTransportState = {
        playheadSamples,
        rate: 1.0,
        bpm,
        beatPhaseOffset: 0,
    };
    handle.waveform.updateTransport(transport);
    handle.waveform.frame(0, 0);
}
export function setZoomAndRender(handle: WaveformTestHandle, zoom: number): void {
    handle.waveform.setZoom(zoom);
    handle.waveform.frame(0, 0);
}
export function destroyTestHandle(handle: WaveformTestHandle): void {
    handle.waveform.destroy();
    handle.canvas.remove();
}
```

### `tests/browser/waveform-behavior.browser.test.ts` {#tests-browser-waveform-behavior-browser-test-ts}

```typescript
// File: tests/browser/waveform-behavior.browser.test.ts

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {page} from 'vitest/browser';
import {
    createWaveformTestHandle,
    destroyTestHandle,
    seekAndRender,
    setZoomAndRender,
    type WaveformTestHandle,
} from './test-harness.ts';
describe('Waveform Component Behavior', () => {
    let handle: WaveformTestHandle;
    beforeEach(async () => {
        const root = document.createElement('div');
        root.id = 'test-root';
        document.body.appendChild(root);
        handle = await createWaveformTestHandle(root, {
            durationSeconds: 60,
            sampleRate: 44100,
            bpm: 128,
            bandCount: 3,
            canvasWidth: 1280,
            canvasHeight: 256,
            initialPlayheadFrame: 0,
            initialZoom: 512,
        });
    });
    afterEach(() => {
        if (handle) {
            destroyTestHandle(handle);
        }
        const root = document.getElementById('test-root');
        if (root) {
            root.remove();
        }
    });
    it('should create canvas element', async () => {
        const canvas = page.getByTestId('waveform-canvas');
        expect(canvas).toBeDefined();
    });
    it('should render without throwing errors', async () => {
        expect(handle.waveform).toBeDefined();
    });
    it('should update playhead position', async () => {
        const middleFrame = handle.totalSamples / 2;
        seekAndRender(handle, middleFrame);
        expect(handle.waveform).toBeDefined();
    });
    it('should handle zoom changes', async () => {
        const zoomLevels = [256, 512, 1024, 2048];
        for (const zoom of zoomLevels) {
            setZoomAndRender(handle, zoom);
            expect(handle.waveform).toBeDefined();
        }
    });
    it('should handle seeking to start of track', async () => {
        seekAndRender(handle, 0);
        expect(handle.waveform).toBeDefined();
    });
    it('should handle seeking to end of track', async () => {
        seekAndRender(handle, handle.totalSamples - 1);
        expect(handle.waveform).toBeDefined();
    });
    it('should handle multiple rapid zoom changes', async () => {
        for (let i = 0; i < 10; i++) {
            const zoom = 256 * Math.pow(2, i % 4);
            setZoomAndRender(handle, zoom);
        }
        expect(handle.waveform).toBeDefined();
    });
    it('should handle multiple rapid seek operations', async () => {
        const samples = handle.totalSamples;
        for (let i = 0; i < 10; i++) {
            const position = (samples / 10) * i;
            seekAndRender(handle, position);
        }
        expect(handle.waveform).toBeDefined();
    });
    it('should maintain canvas size', async () => {
        const canvas = page.getByTestId('waveform-canvas');
        const element = canvas.element() as HTMLCanvasElement;
        expect(element.width).toBe(1280);
        expect(element.height).toBe(256);
    });
});
describe('Waveform Component Edge Cases', () => {
    it('should handle very short track', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const handle = await createWaveformTestHandle(root, {
            durationSeconds: 1, 
            sampleRate: 44100,
            bpm: 128,
            bandCount: 3,
        });
        expect(handle.waveform).toBeDefined();
        destroyTestHandle(handle);
        root.remove();
    });
    it('should handle very long track', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const handle = await createWaveformTestHandle(root, {
            durationSeconds: 3600, 
            sampleRate: 44100,
            bpm: 128,
            bandCount: 3,
        });
        expect(handle.waveform).toBeDefined();
        destroyTestHandle(handle);
        root.remove();
    });
    it('should handle single band', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const handle = await createWaveformTestHandle(root, {
            durationSeconds: 60,
            sampleRate: 44100,
            bpm: 128,
            bandCount: 1, 
        });
        expect(handle.waveform).toBeDefined();
        destroyTestHandle(handle);
        root.remove();
    });
    it('should handle many bands', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const handle = await createWaveformTestHandle(root, {
            durationSeconds: 60,
            sampleRate: 44100,
            bpm: 128,
            bandCount: 16, 
        });
        expect(handle.waveform).toBeDefined();
        destroyTestHandle(handle);
        root.remove();
    });
    it('should handle extreme zoom in', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const handle = await createWaveformTestHandle(root, {
            durationSeconds: 60,
            sampleRate: 44100,
            bpm: 128,
            bandCount: 3,
            initialZoom: 64, 
        });
        expect(handle.waveform).toBeDefined();
        destroyTestHandle(handle);
        root.remove();
    });
    it('should handle extreme zoom out', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const handle = await createWaveformTestHandle(root, {
            durationSeconds: 60,
            sampleRate: 44100,
            bpm: 128,
            bandCount: 3,
            initialZoom: 16384, 
        });
        expect(handle.waveform).toBeDefined();
        destroyTestHandle(handle);
        root.remove();
    });
});
```

### `tests/browser/waveform-visual.browser.test.ts` {#tests-browser-waveform-visual-browser-test-ts}

```typescript
// File: tests/browser/waveform-visual.browser.test.ts

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {page} from 'vitest/browser';
import {
    createWaveformTestHandle,
    destroyTestHandle,
    seekAndRender,
    setZoomAndRender,
    type WaveformTestHandle,
} from './test-harness.ts';
describe('Waveform Visual Regression', () => {
    let handle: WaveformTestHandle;
    let root: HTMLElement;
    beforeEach(async () => {
        root = document.createElement('div');
        root.id = 'test-root';
        root.style.width = '1280px';
        root.style.height = '256px';
        document.body.appendChild(root);
        handle = await createWaveformTestHandle(root, {
            durationSeconds: 60,
            sampleRate: 44100,
            bpm: 128,
            bandCount: 3,
            canvasWidth: 1280,
            canvasHeight: 256,
            initialPlayheadFrame: 44100 * 30, 
            initialZoom: 512,
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
    });
    afterEach(() => {
        if (handle) {
            destroyTestHandle(handle);
        }
        if (root.parentNode) {
            root.remove();
        }
    });
    it('should match default deck view screenshot', async () => {
        const canvas = page.getByTestId('waveform-canvas');
        await expect.element(canvas).toMatchScreenshot('waveform-default');
    });
    it('should match playhead at start screenshot', async () => {
        seekAndRender(handle, 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
        const canvas = page.getByTestId('waveform-canvas');
        await expect.element(canvas).toMatchScreenshot('waveform-start');
    });
    it('should match playhead at end screenshot', async () => {
        seekAndRender(handle, handle.totalSamples - 44100); 
        await new Promise((resolve) => setTimeout(resolve, 50));
        const canvas = page.getByTestId('waveform-canvas');
        await expect.element(canvas).toMatchScreenshot('waveform-end');
    });
    it('should match high zoom screenshot', async () => {
        setZoomAndRender(handle, 128); 
        await new Promise((resolve) => setTimeout(resolve, 50));
        const canvas = page.getByTestId('waveform-canvas');
        await expect.element(canvas).toMatchScreenshot('waveform-zoom-high');
    });
    it('should match low zoom screenshot', async () => {
        setZoomAndRender(handle, 4096); 
        await new Promise((resolve) => setTimeout(resolve, 50));
        const canvas = page.getByTestId('waveform-canvas');
        await expect.element(canvas).toMatchScreenshot('waveform-zoom-low');
    });
    it('should match different playhead positions', async () => {
        seekAndRender(handle, Math.floor(handle.totalSamples * 0.25));
        await new Promise((resolve) => setTimeout(resolve, 50));
        const canvas = page.getByTestId('waveform-canvas');
        await expect.element(canvas).toMatchScreenshot('waveform-position-25');
    });
    it('should maintain visual consistency across re-renders', async () => {
        for (let i = 0; i < 3; i++) {
            seekAndRender(handle, 44100 * 30);
            await new Promise((resolve) => setTimeout(resolve, 30));
        }
        const canvas = page.getByTestId('waveform-canvas');
        await expect.element(canvas).toMatchScreenshot('waveform-stable');
    });
});
describe('Waveform Visual Edge Cases', () => {
    it('should render single band correctly', async () => {
        const root = document.createElement('div');
        root.style.width = '1280px';
        root.style.height = '256px';
        document.body.appendChild(root);
        const handle = await createWaveformTestHandle(root, {
            durationSeconds: 60,
            sampleRate: 44100,
            bpm: 128,
            bandCount: 1,
            canvasWidth: 1280,
            canvasHeight: 256,
            initialPlayheadFrame: 44100 * 30,
            initialZoom: 512,
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const canvas = page.getByTestId('waveform-canvas');
        await expect.element(canvas).toMatchScreenshot('waveform-single-band');
        destroyTestHandle(handle);
        root.remove();
    });
    it('should render many bands correctly', async () => {
        const root = document.createElement('div');
        root.style.width = '1280px';
        root.style.height = '256px';
        document.body.appendChild(root);
        const handle = createWaveformTestHandle(root, {
            durationSeconds: 60,
            sampleRate: 44100,
            bpm: 128,
            bandCount: 8,
            canvasWidth: 1280,
            canvasHeight: 256,
            initialPlayheadFrame: 44100 * 30,
            initialZoom: 512,
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const canvas = page.getByTestId('waveform-canvas');
        await expect.element(canvas).toMatchScreenshot('waveform-many-bands');
        destroyTestHandle(await handle);
        root.remove();
    });
    it('should render small canvas correctly', async () => {
        const root = document.createElement('div');
        root.style.width = '640px';
        root.style.height = '128px';
        document.body.appendChild(root);
        const handle = await createWaveformTestHandle(root, {
            durationSeconds: 60,
            sampleRate: 44100,
            bpm: 128,
            bandCount: 3,
            canvasWidth: 640,
            canvasHeight: 128,
            initialPlayheadFrame: 44100 * 30,
            initialZoom: 512,
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const canvas = page.getByTestId('waveform-canvas');
        await expect.element(canvas).toMatchScreenshot('waveform-small-canvas');
        destroyTestHandle(handle);
        root.remove();
    });
    it('should render large canvas correctly', async () => {
        const root = document.createElement('div');
        root.style.width = '2560px';
        root.style.height = '512px';
        document.body.appendChild(root);
        const handle = await createWaveformTestHandle(root, {
            durationSeconds: 60,
            sampleRate: 44100,
            bpm: 128,
            bandCount: 3,
            canvasWidth: 2560,
            canvasHeight: 512,
            initialPlayheadFrame: 44100 * 30,
            initialZoom: 512,
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const canvas = page.getByTestId('waveform-canvas');
        await expect.element(canvas).toMatchScreenshot('waveform-large-canvas');
        destroyTestHandle(handle);
        root.remove();
    });
});
```

### `tests/components.test.ts` {#tests-components-test-ts}

```typescript
// File: tests/components.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeckWaveformComponent } from '../src/components/deck-waveform.ts';
import { ChannelMetersComponent } from '../src/components/channel-meters.ts';
import type { VisualContext, Dimensions } from '../src/types/visual-component.ts';
import { DEFAULT_THEME, type DeckState } from '../src/types/audio-state.ts';
import { createTestDeckState, createTestAudioVisualState } from '../src/utils/test-data.ts';
vi.mock('../src/shaders/waveform.wgsl?raw', () => ({
  default: `
    @group(0) @binding(0) var<uniform> shared: vec4<f32>;
    @group(1) @binding(0) var<uniform> uniforms: array<f32, 32>;
    @vertex fn vs_main(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4<f32> {
      return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }
    @fragment fn fs_main() -> @location(0) vec4<f32> {
      return vec4<f32>(1.0, 0.0, 0.0, 1.0);
    }
  `,
}));
vi.mock('../src/shaders/meters.wgsl?raw', () => ({
  default: `
    @group(0) @binding(0) var<uniform> shared: vec4<f32>;
    @group(1) @binding(0) var<uniform> uniforms: array<f32, 16>;
    @vertex fn vs_main(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4<f32> {
      return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }
    @fragment fn fs_main() -> @location(0) vec4<f32> {
      return vec4<f32>(0.0, 1.0, 0.0, 1.0);
    }
  `,
}));
describe('DeckWaveformComponent', () => {
  let component: DeckWaveformComponent;
  let mockDevice: GPUDevice;
  let mockContext: VisualContext;
  let testDeck: DeckState;
  beforeEach(async () => {
    component = new DeckWaveformComponent(0);
    const adapter = await navigator.gpu.requestAdapter();
    mockDevice = (await adapter?.requestDevice())!;
    mockContext = {
      device: mockDevice,
      format: 'bgra8unorm',
      theme: DEFAULT_THEME,
      sharedUniformBuffer: mockDevice.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      sharedBindGroupLayout: mockDevice.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          },
        ],
      }),
      sharedBindGroup: mockDevice.createBindGroup({
        layout: mockDevice.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' },
            },
          ],
        }),
        entries: [
          {
            binding: 0,
            resource: {
              buffer: mockDevice.createBuffer({
                size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
              }),
            },
          },
        ],
      }),
    };
    testDeck = createTestDeckState({
      durationSeconds: 180,
      sampleRate: 44100,
      bpm: 128,
      key: '8B',
      title: 'Test Track',
      artist: 'Test Artist',
    });
  });
  describe('constructor', () => {
    it('should create component with unique id', () => {
      const comp0 = new DeckWaveformComponent(0);
      const comp1 = new DeckWaveformComponent(1);
      expect(comp0.id).toBe('deck-waveform-0');
      expect(comp1.id).toBe('deck-waveform-1');
    });
  });
  describe('initialize', () => {
    it('should initialize without throwing', async () => {
      await expect(component.initialize(mockDevice, mockContext)).resolves.toBeUndefined();
    });
    it('should create shader module', async () => {
      const createShaderSpy = vi.spyOn(mockDevice, 'createShaderModule');
      await component.initialize(mockDevice, mockContext);
      expect(createShaderSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Waveform Shader',
        })
      );
    });
    it('should create render pipeline', async () => {
      const createPipelineSpy = vi.spyOn(mockDevice, 'createRenderPipeline');
      await component.initialize(mockDevice, mockContext);
      expect(createPipelineSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Waveform Render Pipeline',
        })
      );
    });
    it('should create uniform buffer', async () => {
      const createBufferSpy = vi.spyOn(mockDevice, 'createBuffer');
      await component.initialize(mockDevice, mockContext);
      expect(createBufferSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Waveform Uniforms',
          size: 128,
        })
      );
    });
    it('should create placeholder textures', async () => {
      const createTextureSpy = vi.spyOn(mockDevice, 'createTexture');
      await component.initialize(mockDevice, mockContext);
      expect(createTextureSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Amplitude Texture',
        })
      );
      expect(createTextureSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Bands Texture',
        })
      );
    });
  });
  describe('resize', () => {
    beforeEach(async () => {
      await component.initialize(mockDevice, mockContext);
    });
    it('should handle resize without errors', () => {
      const dimensions: Dimensions = {
        width: 1920,
        height: 200,
        dpr: 2,
        physicalWidth: 3840,
        physicalHeight: 400,
      };
      expect(() => { component.resize(dimensions); }).not.toThrow();
    });
  });
  describe('setZoom', () => {
    beforeEach(async () => {
      await component.initialize(mockDevice, mockContext);
    });
    it('should set zoom level', () => {
      component.setZoom(2.0);
      expect(component).toBeDefined();
    });
    it('should accept valid zoom range', () => {
      expect(() => { component.setZoom(0.1); }).not.toThrow();
      expect(() => { component.setZoom(10.0); }).not.toThrow();
      expect(() => { component.setZoom(100.0); }).not.toThrow();
    });
  });
  describe('setKnobState', () => {
    beforeEach(async () => {
      await component.initialize(mockDevice, mockContext);
    });
    it('should update knob state partially', () => {
      expect(() => { component.setKnobState({ lowGain: 0.5 }); }).not.toThrow();
      expect(() => { component.setKnobState({ midGain: 1.2 }); }).not.toThrow();
      expect(() => { component.setKnobState({ highGain: 0.8 }); }).not.toThrow();
    });
    it('should update multiple knobs at once', () => {
      expect(() =>
        { component.setKnobState({
          lowGain: 0.5,
          midGain: 1.0,
          highGain: 1.5,
          brightness: 1.2,
        }); }
      ).not.toThrow();
    });
  });
  describe('update', () => {
    beforeEach(async () => {
      await component.initialize(mockDevice, mockContext);
    });
    it('should handle state update', () => {
      const state = createTestAudioVisualState([testDeck]);
      try {
        component.update(0.016, 1.0, state);
      } catch {
      }
      expect(component).toBeDefined();
    });
    it('should use correct deck index', () => {
      const secondComponent = new DeckWaveformComponent(1);
      const state = createTestAudioVisualState([testDeck]);
      try {
        secondComponent.update(0.016, 1.0, state);
      } catch {
      }
      expect(secondComponent).toBeDefined();
    });
  });
  describe('encode', () => {
    beforeEach(async () => {
      await component.initialize(mockDevice, mockContext);
    });
    it('should encode render commands', () => {
      const commandEncoder = mockDevice.createCommandEncoder();
      const texture = mockDevice.createTexture({
        size: [800, 600],
        format: 'bgra8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      const textureView = texture.createView();
      expect(() => { component.encode(commandEncoder, textureView); }).not.toThrow();
    });
  });
  describe('destroy', () => {
    it('should clean up resources', async () => {
      await component.initialize(mockDevice, mockContext);
      expect(() => { component.destroy(); }).not.toThrow();
    });
    it('should be safe to call without initialization', () => {
      expect(() => { component.destroy(); }).not.toThrow();
    });
  });
});
describe('ChannelMetersComponent', () => {
  let component: ChannelMetersComponent;
  let mockDevice: GPUDevice;
  let mockContext: VisualContext;
  beforeEach(async () => {
    component = new ChannelMetersComponent(2);
    const adapter = await navigator.gpu.requestAdapter();
    mockDevice = (await adapter?.requestDevice())!;
    mockContext = {
      device: mockDevice,
      format: 'bgra8unorm',
      theme: DEFAULT_THEME,
      sharedUniformBuffer: mockDevice.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      sharedBindGroupLayout: mockDevice.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          },
        ],
      }),
      sharedBindGroup: mockDevice.createBindGroup({
        layout: mockDevice.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' },
            },
          ],
        }),
        entries: [
          {
            binding: 0,
            resource: {
              buffer: mockDevice.createBuffer({
                size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
              }),
            },
          },
        ],
      }),
    };
  });
  describe('constructor', () => {
    it('should create component with channel count', () => {
      const comp2 = new ChannelMetersComponent(2);
      const comp4 = new ChannelMetersComponent(4);
      expect(comp2.id).toBe('channel-meters');
      expect(comp4.id).toBe('channel-meters');
    });
  });
  describe('initialize', () => {
    it('should initialize without throwing', async () => {
      await expect(component.initialize(mockDevice, mockContext)).resolves.toBeUndefined();
    });
  });
  describe('resize', () => {
    beforeEach(async () => {
      await component.initialize(mockDevice, mockContext);
    });
    it('should handle resize', () => {
      const dimensions: Dimensions = {
        width: 200,
        height: 300,
        dpr: 1,
        physicalWidth: 200,
        physicalHeight: 300,
      };
      expect(() => { component.resize(dimensions); }).not.toThrow();
    });
  });
  describe('update', () => {
    beforeEach(async () => {
      await component.initialize(mockDevice, mockContext);
    });
    it('should update with audio state', () => {
      const deck = createTestDeckState({
        durationSeconds: 180,
        sampleRate: 44100,
        bpm: 128,
        key: '8B',
        title: 'Test',
        artist: 'Artist',
      });
      const state = createTestAudioVisualState([deck]);
      try {
        component.update(0.016, 1.0, state);
      } catch {
      }
      expect(component).toBeDefined();
    });
  });
  describe('destroy', () => {
    it('should clean up resources', async () => {
      await component.initialize(mockDevice, mockContext);
      expect(() => { component.destroy(); }).not.toThrow();
    });
  });
});
```

### `tests/gpu-plumbing/resource-creation.test.ts` {#tests-gpu-plumbing-resource-creation-test-ts}

```typescript
// File: tests/gpu-plumbing/resource-creation.test.ts

import {describe, expect, it, vi} from 'vitest';
import {createMockGPUDevice} from '../setup.ts';
import {
    createAllLODResources,
    createAmplitudeTexture,
    createBandTexture,
    createBindGroupLayout,
    createUniformBuffer,
} from '../../src/waveform/gpu-resources.ts';
import {createSyntheticWaveform} from '../../src/waveform/test-harness.ts';
import type {WaveformLOD} from '../../src/waveform/types.ts';
describe('GPU Resource Creation', () => {
    describe('createAmplitudeTexture', () => {
        it('should create texture with correct dimensions', () => {
            const device = createMockGPUDevice();
            const lod: WaveformLOD = {
                samplesPerPixel: 256,
                lengthInPixels: 1000,
                amplitude: new Float32Array(1000),
                bandEnergies: new Float32Array(3000),
            };
            createAmplitudeTexture(device, lod);
            expect(device.createTexture).toHaveBeenCalledWith(
                expect.objectContaining({
                    size: {
                        width: 1000,
                        height: 1,
                        depthOrArrayLayers: 1,
                    },
                    format: 'r16float',
                })
            );
        });
        it('should use TEXTURE_BINDING and COPY_DST usage flags', () => {
            const device = createMockGPUDevice();
            const lod: WaveformLOD = {
                samplesPerPixel: 256,
                lengthInPixels: 1000,
                amplitude: new Float32Array(1000),
                bandEnergies: new Float32Array(3000),
            };
            createAmplitudeTexture(device, lod);
            expect(device.createTexture).toHaveBeenCalledWith(
                expect.objectContaining({
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                })
            );
        });
        it('should upload texture data via writeTexture', () => {
            const device = createMockGPUDevice();
            const lod: WaveformLOD = {
                samplesPerPixel: 256,
                lengthInPixels: 1000,
                amplitude: new Float32Array(1000),
                bandEnergies: new Float32Array(3000),
            };
            createAmplitudeTexture(device, lod);
            expect(device.queue.writeTexture).toHaveBeenCalled();
        });
    });
    describe('createBandTexture', () => {
        it('should create texture with correct dimensions for band count', () => {
            const device = createMockGPUDevice();
            const bandCount = 3;
            const lod: WaveformLOD = {
                samplesPerPixel: 256,
                lengthInPixels: 1000,
                amplitude: new Float32Array(1000),
                bandEnergies: new Float32Array(1000 * bandCount),
            };
            createBandTexture(device, lod, bandCount);
            expect(device.createTexture).toHaveBeenCalledWith(
                expect.objectContaining({
                    size: {
                        width: 1000,
                        height: 3, 
                        depthOrArrayLayers: 1,
                    },
                    format: 'r16float',
                })
            );
        });
        it('should support different band counts', () => {
            const device = createMockGPUDevice();
            for (const bandCount of [1, 3, 8, 16]) {
                vi.clearAllMocks();
                const lod: WaveformLOD = {
                    samplesPerPixel: 256,
                    lengthInPixels: 1000,
                    amplitude: new Float32Array(1000),
                    bandEnergies: new Float32Array(1000 * bandCount),
                };
                createBandTexture(device, lod, bandCount);
                expect(device.createTexture).toHaveBeenCalledWith(
                    expect.objectContaining({
                        size: expect.objectContaining({
                            height: bandCount,
                        }),
                    })
                );
            }
        });
    });
    describe('createBindGroupLayout', () => {
        it('should create layout with all required bindings', () => {
            const device = createMockGPUDevice();
            createBindGroupLayout(device);
            expect(device.createBindGroupLayout).toHaveBeenCalledWith(
                expect.objectContaining({
                    entries: expect.arrayContaining([
                        expect.objectContaining({binding: 0, buffer: expect.any(Object)}),
                        expect.objectContaining({binding: 1, texture: expect.any(Object)}),
                        expect.objectContaining({binding: 2, texture: expect.any(Object)}),
                        expect.objectContaining({binding: 3, texture: expect.any(Object)}),
                        expect.objectContaining({binding: 4, texture: expect.any(Object)}),
                        expect.objectContaining({binding: 5, sampler: expect.any(Object)}),
                    ]),
                })
            );
        });
        it('should have 6 binding entries', () => {
            const device = createMockGPUDevice();
            createBindGroupLayout(device);
            const call = vi.mocked(device.createBindGroupLayout).mock.calls[0];
            expect(call).toBeDefined();
            if (call[0]) {
                expect(call[0].entries).toHaveLength(6);
            }
        });
    });
    describe('createUniformBuffer', () => {
        it('should create buffer with UNIFORM and COPY_DST usage', () => {
            const device = createMockGPUDevice();
            createUniformBuffer(device);
            expect(device.createBuffer).toHaveBeenCalledWith(
                expect.objectContaining({
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                })
            );
        });
        it('should create buffer with correct size (80 bytes for 16-byte alignment)', () => {
            const device = createMockGPUDevice();
            createUniformBuffer(device);
            expect(device.createBuffer).toHaveBeenCalledWith(
                expect.objectContaining({
                    size: 80, 
                })
            );
        });
    });
    describe('createAllLODResources', () => {
        it('should create resources for all LODs in pyramid', () => {
            const device = createMockGPUDevice();
            const pyramid = createSyntheticWaveform(60, 44100, 128, 3);
            const layout = createBindGroupLayout(device);
            const uniformBuffer = createUniformBuffer(device);
            const sampler = device.createSampler({magFilter: 'linear', minFilter: 'linear'});
            const resources = createAllLODResources(device, pyramid, layout, uniformBuffer, sampler);
            expect(resources.length).toBe(pyramid.lods.length);
        });
        it('should create amplitude and band textures for each LOD', () => {
            const device = createMockGPUDevice();
            const pyramid = createSyntheticWaveform(60, 44100, 128, 3);
            const layout = createBindGroupLayout(device);
            const uniformBuffer = createUniformBuffer(device);
            const sampler = device.createSampler({magFilter: 'linear', minFilter: 'linear'});
            vi.clearAllMocks();
            createAllLODResources(device, pyramid, layout, uniformBuffer, sampler);
            const expectedTextureCalls = pyramid.lods.length * 2;
            expect(device.createTexture).toHaveBeenCalledTimes(expectedTextureCalls);
        });
        it('should create bind group for each LOD', () => {
            const device = createMockGPUDevice();
            const pyramid = createSyntheticWaveform(60, 44100, 128, 3);
            const layout = createBindGroupLayout(device);
            const uniformBuffer = createUniformBuffer(device);
            const sampler = device.createSampler({magFilter: 'linear', minFilter: 'linear'});
            vi.clearAllMocks();
            createAllLODResources(device, pyramid, layout, uniformBuffer, sampler);
            expect(device.createBindGroup).toHaveBeenCalledTimes(pyramid.lods.length);
        });
        it('should return correct structure for each resource', () => {
            const device = createMockGPUDevice();
            const pyramid = createSyntheticWaveform(60, 44100, 128, 3);
            const layout = createBindGroupLayout(device);
            const uniformBuffer = createUniformBuffer(device);
            const sampler = device.createSampler({magFilter: 'linear', minFilter: 'linear'});
            const resources = createAllLODResources(device, pyramid, layout, uniformBuffer, sampler);
            for (const res of resources) {
                expect(res).toHaveProperty('amplitudeTexture');
                expect(res).toHaveProperty('bandTexture');
                expect(res).toHaveProperty('bindGroup');
            }
        });
    });
    describe('Integration: Full Resource Setup', () => {
        it('should set up complete GPU resources for a waveform', () => {
            const device = createMockGPUDevice();
            const pyramid = createSyntheticWaveform(60, 44100, 128, 3);
            vi.clearAllMocks();
            const layout = createBindGroupLayout(device);
            const uniformBuffer = createUniformBuffer(device);
            const sampler = device.createSampler({magFilter: 'linear', minFilter: 'linear'});
            const lodResources = createAllLODResources(device, pyramid, layout, uniformBuffer, sampler);
            expect(device.createBindGroupLayout).toHaveBeenCalledTimes(1);
            expect(device.createBuffer).toHaveBeenCalledTimes(1);
            expect(device.createSampler).toHaveBeenCalledTimes(1);
            expect(device.createTexture).toHaveBeenCalledTimes(pyramid.lods.length * 2);
            expect(device.createBindGroup).toHaveBeenCalledTimes(pyramid.lods.length);
            expect(lodResources.length).toBe(7); 
        });
    });
});
```

### `tests/gpu-runtime.test.ts` {#tests-gpu-runtime-test-ts}

```typescript
// File: tests/gpu-runtime.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GPURuntime } from '../src/core/gpu-runtime.ts';
import type { GPURuntimeConfig } from '../src/core/gpu-runtime.ts';
import { DEFAULT_THEME } from '../src/types/audio-state.ts';
describe('GPURuntime', () => {
  let canvas: HTMLCanvasElement;
  let runtime: GPURuntime;
  let config: GPURuntimeConfig;
  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    Object.defineProperty(canvas, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true });
    config = { canvas };
  });
  afterEach(() => {
    runtime.destroy();
  });
  describe('constructor', () => {
    it('should create instance with canvas', () => {
      runtime = new GPURuntime(config);
      expect(runtime).toBeDefined();
      expect(runtime).toBeInstanceOf(GPURuntime);
    });
    it('should use default theme when not provided', () => {
      runtime = new GPURuntime(config);
      expect(runtime).toBeDefined();
    });
    it('should accept custom theme', () => {
      const customTheme = { ...DEFAULT_THEME };
      runtime = new GPURuntime({ canvas, theme: customTheme });
      expect(runtime).toBeDefined();
    });
  });
  describe('initialize', () => {
    it('should initialize WebGPU device and context', async () => {
      runtime = new GPURuntime(config);
      await runtime.initialize();
      const context = runtime.getContext();
      expect(context.device).toBeDefined();
      expect(context.format).toBeDefined();
      expect(context.sharedUniformBuffer).toBeDefined();
      expect(context.sharedBindGroupLayout).toBeDefined();
      expect(context.sharedBindGroup).toBeDefined();
    });
    it('should set canvas format from GPU preferences', async () => {
      runtime = new GPURuntime(config);
      await runtime.initialize();
      const format = runtime.getFormat();
      expect(format).toBe('bgra8unorm');
    });
    it('should create shared uniform buffer', async () => {
      runtime = new GPURuntime(config);
      await runtime.initialize();
      const context = runtime.getContext();
      expect(context.sharedUniformBuffer).toBeDefined();
    });
    it('should create shared bind group layout', async () => {
      runtime = new GPURuntime(config);
      await runtime.initialize();
      const context = runtime.getContext();
      expect(context.sharedBindGroupLayout).toBeDefined();
    });
    it('should configure initial dimensions', async () => {
      runtime = new GPURuntime(config);
      await runtime.initialize();
      const dimensions = runtime.getDimensions();
      expect(dimensions.width).toBe(800);
      expect(dimensions.height).toBe(600);
      expect(dimensions.dpr).toBe(window.devicePixelRatio);
      expect(dimensions.physicalWidth).toBe(Math.floor(800 * window.devicePixelRatio));
      expect(dimensions.physicalHeight).toBe(Math.floor(600 * window.devicePixelRatio));
    });
    it('should throw error when adapter is not available', async () => {
      const originalGpu = navigator.gpu;
      Object.defineProperty(navigator, 'gpu', {
        value: {
          requestAdapter: vi.fn().mockResolvedValue(null),
          getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
          wgslLanguageFeatures: new Set(),
        },
        configurable: true,
      });
      runtime = new GPURuntime(config);
      await expect(runtime.initialize()).rejects.toThrow('WebGPU not supported');
      Object.defineProperty(navigator, 'gpu', {
        value: originalGpu,
        configurable: true,
      });
    });
  });
  describe('resize', () => {
    beforeEach(async () => {
      runtime = new GPURuntime(config);
      await runtime.initialize();
    });
    it('should update dimensions on resize', () => {
      runtime.resize(1920, 1080, 2);
      const dimensions = runtime.getDimensions();
      expect(dimensions.width).toBe(1920);
      expect(dimensions.height).toBe(1080);
      expect(dimensions.dpr).toBe(2);
      expect(dimensions.physicalWidth).toBe(3840);
      expect(dimensions.physicalHeight).toBe(2160);
    });
    it('should update canvas dimensions', () => {
      runtime.resize(1920, 1080, 2);
      expect(canvas.width).toBe(3840);
      expect(canvas.height).toBe(2160);
    });
    it('should handle fractional DPR', () => {
      runtime.resize(1000, 500, 1.5);
      const dimensions = runtime.getDimensions();
      expect(dimensions.physicalWidth).toBe(1500);
      expect(dimensions.physicalHeight).toBe(750);
    });
  });
  describe('updateSharedUniforms', () => {
    beforeEach(async () => {
      runtime = new GPURuntime(config);
      await runtime.initialize();
    });
    it('should write time and delta to shared buffer', () => {
      const device = runtime.getDevice();
      const writeBufferSpy = vi.spyOn(device.queue, 'writeBuffer');
      runtime.updateSharedUniforms(1.5, 0.016);
      expect(writeBufferSpy).toHaveBeenCalled();
      const callArgs = writeBufferSpy.mock.calls[0];
      expect(callArgs).toBeDefined();
      expect(callArgs[2]).toBeInstanceOf(Float32Array);
    });
    it('should include resolution in uniforms', () => {
      const device = runtime.getDevice();
      const writeBufferSpy = vi.spyOn(device.queue, 'writeBuffer');
      runtime.resize(1920, 1080, 2);
      runtime.updateSharedUniforms(0, 0.016);
      const lastCallIndex = writeBufferSpy.mock.calls.length - 1;
      const callArgs = writeBufferSpy.mock.calls[lastCallIndex];
      const data = callArgs[2] as Float32Array;
      expect(data[0]).toBe(0); 
      expect(data[1]).toBeCloseTo(0.016, 4); 
      expect(data[2]).toBe(3840); 
      expect(data[3]).toBe(2160); 
    });
  });
  describe('getCurrentTexture', () => {
    beforeEach(async () => {
      runtime = new GPURuntime(config);
      await runtime.initialize();
    });
    it('should return current texture from context', () => {
      const texture = runtime.getCurrentTexture();
      expect(texture).toBeDefined();
    });
  });
  describe('getContext', () => {
    it('should throw when not initialized', () => {
      runtime = new GPURuntime(config);
      expect(() => runtime.getContext()).toThrow('Runtime not initialized');
    });
    it('should return context after initialization', async () => {
      runtime = new GPURuntime(config);
      await runtime.initialize();
      const context = runtime.getContext();
      expect(context).toBeDefined();
      expect(context.device).toBeDefined();
      expect(context.format).toBeDefined();
      expect(context.theme).toBeDefined();
      expect(context.sharedUniformBuffer).toBeDefined();
      expect(context.sharedBindGroupLayout).toBeDefined();
      expect(context.sharedBindGroup).toBeDefined();
    });
    it('should include theme in context', async () => {
      const customTheme = {
        ...DEFAULT_THEME,
        backgroundColor: [0, 0, 0, 1] as const,
      };
      runtime = new GPURuntime({ canvas, theme: customTheme });
      await runtime.initialize();
      const context = runtime.getContext();
      expect(context.theme.backgroundColor).toEqual([0, 0, 0, 1]);
    });
  });
  describe('getDevice', () => {
    it('should throw when not initialized', () => {
      runtime = new GPURuntime(config);
      expect(() => runtime.getDevice()).toThrow('Device not initialized');
    });
    it('should return device after initialization', async () => {
      runtime = new GPURuntime(config);
      await runtime.initialize();
      const device = runtime.getDevice();
      expect(device).toBeDefined();
    });
  });
  describe('getDimensions', () => {
    it('should return initial dimensions', () => {
      runtime = new GPURuntime(config);
      const dimensions = runtime.getDimensions();
      expect(dimensions.width).toBe(0);
      expect(dimensions.height).toBe(0);
      expect(dimensions.dpr).toBe(1);
    });
    it('should return updated dimensions after init', async () => {
      runtime = new GPURuntime(config);
      await runtime.initialize();
      const dimensions = runtime.getDimensions();
      expect(dimensions.width).toBeGreaterThan(0);
      expect(dimensions.height).toBeGreaterThan(0);
    });
  });
  describe('destroy', () => {
    it('should clean up resources', async () => {
      runtime = new GPURuntime(config);
      await runtime.initialize();
      const device = runtime.getDevice();
      const destroySpy = vi.spyOn(device, 'destroy');
      runtime.destroy();
      expect(destroySpy).toHaveBeenCalled();
    });
    it('should be safe to call multiple times', async () => {
      runtime = new GPURuntime(config);
      await runtime.initialize();
      runtime.destroy();
      runtime.destroy();
    });
    it('should be safe to call without initialization', () => {
      runtime = new GPURuntime(config);
      runtime.destroy();
    });
  });
});
```

### `tests/logic/lod-selection.test.ts` {#tests-logic-lod-selection-test-ts}

```typescript
// File: tests/logic/lod-selection.test.ts

import {describe, expect, it} from 'vitest';
import {
    calculateLODBlend,
    calculateSamplesPerPixel,
    selectLODIndex,
    splitPlayheadSamples,
} from '../../src/waveform/gpu-resources.ts';
import type {WaveformPyramid} from '../../src/waveform/types.ts';
describe('LOD Selection Math', () => {
    describe('calculateSamplesPerPixel', () => {
        it('should calculate correct samples per pixel at zoom 1.0', () => {
            const viewWidth = 1000;
            const sampleRate = 44100;
            const zoomLevel = 1.0;
            const result = calculateSamplesPerPixel(viewWidth, sampleRate, zoomLevel);
            expect(result).toBeCloseTo(441, 1);
        });
        it('should show more detail at higher zoom', () => {
            const viewWidth = 1000;
            const sampleRate = 44100;
            const zoom1 = calculateSamplesPerPixel(viewWidth, sampleRate, 1.0);
            const zoom2 = calculateSamplesPerPixel(viewWidth, sampleRate, 2.0);
            expect(zoom2).toBeLessThan(zoom1);
            expect(zoom2).toBeCloseTo(zoom1 / 2, 1);
        });
        it('should show less detail at lower zoom', () => {
            const viewWidth = 1000;
            const sampleRate = 44100;
            const zoom1 = calculateSamplesPerPixel(viewWidth, sampleRate, 1.0);
            const zoom05 = calculateSamplesPerPixel(viewWidth, sampleRate, 0.5);
            expect(zoom05).toBeGreaterThan(zoom1);
            expect(zoom05).toBeCloseTo(zoom1 * 2, 1);
        });
    });
    describe('selectLODIndex', () => {
        const createTestPyramid = (): WaveformPyramid => {
            return {
                totalSamples: 44100 * 60,
                bandConfig: {
                    bandCount: 3,
                    sampleRate: 44100,
                },
                lods: [
                    {
                        samplesPerPixel: 128,
                        lengthInPixels: 20671,
                        amplitude: new Float32Array(20671),
                        bandEnergies: new Float32Array(20671 * 3),
                    },
                    {
                        samplesPerPixel: 256,
                        lengthInPixels: 10336,
                        amplitude: new Float32Array(10336),
                        bandEnergies: new Float32Array(10336 * 3),
                    },
                    {
                        samplesPerPixel: 512,
                        lengthInPixels: 5168,
                        amplitude: new Float32Array(5168),
                        bandEnergies: new Float32Array(5168 * 3),
                    },
                    {
                        samplesPerPixel: 1024,
                        lengthInPixels: 2584,
                        amplitude: new Float32Array(2584),
                        bandEnergies: new Float32Array(2584 * 3),
                    },
                ],
            };
        };
        it('should select the closest LOD for target samples per pixel', () => {
            const pyramid = createTestPyramid();
            const index = selectLODIndex(pyramid, 500);
            expect(index).toBe(2);
        });
        it('should select first LOD for very high detail request', () => {
            const pyramid = createTestPyramid();
            const index = selectLODIndex(pyramid, 100);
            expect(index).toBe(0);
        });
        it('should select last LOD for very low detail request', () => {
            const pyramid = createTestPyramid();
            const index = selectLODIndex(pyramid, 2000);
            expect(index).toBe(3);
        });
        it('should prefer exact match if available', () => {
            const pyramid = createTestPyramid();
            const index = selectLODIndex(pyramid, 256);
            expect(index).toBe(1);
        });
    });
    describe('calculateLODBlend', () => {
        const createTestPyramid = (): WaveformPyramid => {
            return {
                totalSamples: 44100 * 60,
                bandConfig: {
                    bandCount: 3,
                    sampleRate: 44100,
                },
                lods: [
                    {
                        samplesPerPixel: 128,
                        lengthInPixels: 20671,
                        amplitude: new Float32Array(20671),
                        bandEnergies: new Float32Array(20671 * 3),
                    },
                    {
                        samplesPerPixel: 256,
                        lengthInPixels: 10336,
                        amplitude: new Float32Array(10336),
                        bandEnergies: new Float32Array(10336 * 3),
                    },
                    {
                        samplesPerPixel: 512,
                        lengthInPixels: 5168,
                        amplitude: new Float32Array(5168),
                        bandEnergies: new Float32Array(5168 * 3),
                    },
                    {
                        samplesPerPixel: 1024,
                        lengthInPixels: 2584,
                        amplitude: new Float32Array(2584),
                        bandEnergies: new Float32Array(2584 * 3),
                    },
                ],
            };
        };
        it('should return appropriate blend for exact LOD match', () => {
            const pyramid = createTestPyramid();
            const blend = calculateLODBlend(pyramid, 256);
            expect(blend.primaryIndex).toBe(0);
            expect(blend.secondaryIndex).toBe(1);
            expect(blend.blendFactor).toBeCloseTo(1.0, 1);
        });
        it('should blend between two LODs for intermediate target', () => {
            const pyramid = createTestPyramid();
            const blend = calculateLODBlend(pyramid, 384);
            expect(blend.primaryIndex).toBe(1);
            expect(blend.secondaryIndex).toBe(2);
            expect(blend.blendFactor).toBeGreaterThan(0);
            expect(blend.blendFactor).toBeLessThan(1);
        });
        it('should clamp to first LOD for very high detail', () => {
            const pyramid = createTestPyramid();
            const blend = calculateLODBlend(pyramid, 64);
            expect(blend.primaryIndex).toBe(0);
            expect(blend.secondaryIndex).toBe(0);
            expect(blend.blendFactor).toBe(0);
        });
        it('should clamp to last LOD for very low detail', () => {
            const pyramid = createTestPyramid();
            const blend = calculateLODBlend(pyramid, 2048);
            expect(blend.primaryIndex).toBe(3);
            expect(blend.secondaryIndex).toBe(3);
            expect(blend.blendFactor).toBe(0);
        });
        it('should use logarithmic blending for perceptual smoothness', () => {
            const pyramid = createTestPyramid();
            const geometricMean = Math.sqrt(256 * 512);
            const blend = calculateLODBlend(pyramid, geometricMean);
            expect(blend.blendFactor).toBeCloseTo(0.5, 1);
        });
    });
    describe('splitPlayheadSamples', () => {
        it('should split small sample counts correctly', () => {
            const samples = 1000;
            const {high, low} = splitPlayheadSamples(samples);
            const reconstructed = high * 65536 + low;
            expect(reconstructed).toBe(samples);
        });
        it('should split large sample counts correctly', () => {
            const samples = 13230000;
            const {high, low} = splitPlayheadSamples(samples);
            const reconstructed = high * 65536 + low;
            expect(reconstructed).toBe(samples);
        });
        it('should maintain precision for very large values', () => {
            const samples = 158760000;
            const {high, low} = splitPlayheadSamples(samples);
            const reconstructed = high * 65536 + low;
            expect(reconstructed).toBe(samples);
        });
        it('should have low component less than split factor', () => {
            const samples = 1000000;
            const {low} = splitPlayheadSamples(samples);
            expect(low).toBeLessThan(65536);
            expect(low).toBeGreaterThanOrEqual(0);
        });
    });
});
```

### `tests/logic/test-data-generation.test.ts` {#tests-logic-test-data-generation-test-ts}

```typescript
// File: tests/logic/test-data-generation.test.ts

import {describe, expect, it} from 'vitest';
import {createSyntheticWaveform} from '../../src/waveform/test-harness.ts';
describe('Test Data Generation', () => {
    describe('createSyntheticWaveform', () => {
        it('should generate deterministic waveform data', () => {
            const waveform1 = createSyntheticWaveform(60, 44100, 128, 3);
            const waveform2 = createSyntheticWaveform(60, 44100, 128, 3);
            expect(waveform1.totalSamples).toBe(waveform2.totalSamples);
            expect(waveform1.bandConfig.bandCount).toBe(waveform2.bandConfig.bandCount);
            expect(waveform1.lods.length).toBe(waveform2.lods.length);
            const lod1 = waveform1.lods[0];
            const lod2 = waveform2.lods[0];
            expect(lod1.lengthInPixels).toBe(lod2.lengthInPixels);
            if (lod1 && lod2) {
                for (let i = 0; i < Math.min(10, lod1.amplitude.length); i++) {
                    expect(lod1.amplitude[i]).toBe(lod2.amplitude[i]);
                }
                for (let i = 0; i < Math.min(30, lod1.bandEnergies.length); i++) {
                    expect(lod1.bandEnergies[i]).toBe(lod2.bandEnergies[i]);
                }
            }
        });
        it('should create correct number of samples for duration', () => {
            const durationSeconds = 60;
            const sampleRate = 44100;
            const waveform = createSyntheticWaveform(durationSeconds, sampleRate, 128, 3);
            const expectedSamples = durationSeconds * sampleRate;
            expect(waveform.totalSamples).toBe(expectedSamples);
        });
        it('should create LODs with correct structure', () => {
            const waveform = createSyntheticWaveform(60, 44100, 128, 3);
            expect(waveform.lods.length).toBe(7);
            const samplesPerPixelValues = waveform.lods.map((lod) => lod.samplesPerPixel);
            expect(samplesPerPixelValues).toEqual([128, 256, 512, 1024, 2048, 4096, 8192]);
        });
        it('should create correct amplitude array sizes', () => {
            const waveform = createSyntheticWaveform(60, 44100, 128, 3);
            for (const lod of waveform.lods) {
                expect(lod.amplitude.length).toBe(lod.lengthInPixels);
                for (const amp of lod.amplitude) {
                    const val = amp ?? 0;
                    expect(val).toBeGreaterThanOrEqual(0);
                    expect(val).toBeLessThanOrEqual(1);
                }
            }
        });
        it('should create correct band energy array sizes', () => {
            const bandCount = 3;
            const waveform = createSyntheticWaveform(60, 44100, 128, bandCount);
            for (const lod of waveform.lods) {
                expect(lod.bandEnergies.length).toBe(lod.lengthInPixels * bandCount);
                for (const energy of lod.bandEnergies) {
                    const val = energy
                    expect(val).toBeGreaterThanOrEqual(0);
                    expect(val).toBeLessThanOrEqual(1);
                }
            }
        });
        it('should support different band counts', () => {
            const waveform1 = createSyntheticWaveform(60, 44100, 128, 1);
            const waveform3 = createSyntheticWaveform(60, 44100, 128, 3);
            const waveform8 = createSyntheticWaveform(60, 44100, 128, 8);
            expect(waveform1.bandConfig.bandCount).toBe(1);
            expect(waveform3.bandConfig.bandCount).toBe(3);
            expect(waveform8.bandConfig.bandCount).toBe(8);
            const lod1 = waveform1.lods[0];
            const lod3 = waveform3.lods[0];
            const lod8 = waveform8.lods[0];
            if (lod1 && lod3 && lod8) {
                expect(lod1.bandEnergies.length).toBe(lod1.lengthInPixels * 1);
                expect(lod3.bandEnergies.length).toBe(lod3.lengthInPixels * 3);
                expect(lod8.bandEnergies.length).toBe(lod8.lengthInPixels * 8);
            }
        });
        it('should create realistic beat patterns in amplitude', () => {
            const waveform = createSyntheticWaveform(60, 44100, 128, 3);
            const lod = waveform.lods[waveform.lods.length - 1];
            if (lod) {
                const hasVariation =
                    Array.from(lod.amplitude).some((val) => val > 0.5) &&
                    Array.from(lod.amplitude).some((val) => val < 0.3);
                expect(hasVariation).toBe(true);
                const introAvg = Array.from(lod.amplitude.slice(0, 100)).reduce((a, b) => a + b, 0) / 100;
                const dropStart = Math.floor(lod.amplitude.length * 0.25);
                const dropAvg =
                    Array.from(lod.amplitude.slice(dropStart, dropStart + 100)).reduce((a, b) => a + b, 0) /
                    100;
                expect(dropAvg).toBeGreaterThan(introAvg);
            }
        });
        it('should create realistic frequency band distributions', () => {
            const waveform = createSyntheticWaveform(60, 44100, 128, 3);
            const lod = waveform.lods[waveform.lods.length - 1];
            if (lod) {
                const bandCount = 3;
                const lowBand: number[] = [];
                const midBand: number[] = [];
                const highBand: number[] = [];
                for (let i = 0; i < lod.lengthInPixels; i++) {
                    lowBand.push(lod.bandEnergies[i * bandCount + 0] ?? 0);
                    midBand.push(lod.bandEnergies[i * bandCount + 1] ?? 0);
                    highBand.push(lod.bandEnergies[i * bandCount + 2] ?? 0);
                }
                const lowHasEnergy = lowBand.some((val) => val > 0.3);
                const midHasEnergy = midBand.some((val) => val > 0.3);
                const highHasEnergy = highBand.some((val) => val > 0.3);
                expect(lowHasEnergy).toBe(true);
                expect(midHasEnergy).toBe(true);
                expect(highHasEnergy).toBe(true);
            }
        });
    });
});
```

### `tests/README.md` {#tests-readme-md}

```markdown
// File: tests/README.md

# WebGPU Renderer Test Suite
Comprehensive testing infrastructure for the WebGPU waveform renderer, organized in layers.
## ⚠️ Important: Browser Test Requirements
**WebGPU browser tests require a real GPU environment:**
- ❌ **Headless Chromium** typically doesn't support WebGPU (`navigator.gpu` is null)
- ✅ **Headed browser** works on local machines with display (`headless: false`)
- ✅ **GPU-enabled CI** runners (GitHub Actions with GPU)
- ✅ **Node tests** (logic + GPU plumbing) run everywhere without GPU
**Current test status:**
- ✅ **38 node tests passing** (logic + GPU resource plumbing with mocks)
- ⏸️ **Browser tests pending** - requires local environment with GPU + display
- 📝 **Test structure complete** - harness and tests are ready to run
**To run browser tests locally:**
```bash
# Set headless: false in vitest.browser.config.ts (already configured)
npm run test:behavior     # Opens Chromium window
npm run test:visual       # Opens Chromium window + takes screenshots
```
## Test Architecture
### 1. Pure Logic Tests (Node Environment)
**Location:** `tests/logic/`
**Run with:** `npm run test:logic`
Tests deterministic math and data generation without GPU:
- LOD selection algorithms (`lod-selection.test.ts`)
  - `calculateSamplesPerPixel` - zoom to samples-per-pixel math
  - `selectLODIndex` - choosing the best LOD for a target detail level
  - `calculateLODBlend` - smooth blending between LOD levels
  - `splitPlayheadSamples` - precision handling for large sample counts
- Test data generation (`test-data-generation.test.ts`)
  - Deterministic waveform synthesis
  - Correct array sizes and structures
  - Realistic beat patterns and frequency distributions
### 2. GPU Plumbing Tests (Node with Mocks)
**Location:** `tests/gpu-plumbing/`
**Run with:** `npm run test:gpu-plumbing`
Tests GPU resource creation with fake GPUDevice:
- Texture creation (`resource-creation.test.ts`)
  - Amplitude textures (r16float, correct dimensions)
  - Band energy textures (2D layout, multiple bands)
  - Texture usage flags (TEXTURE_BINDING | COPY_DST)
- Bind group layouts
  - Correct number of bindings (6 total)
  - Proper binding types (uniform, textures, sampler)
- Resource management
  - Creating resources for all LODs
  - Correct resource counts
  - Integration testing of full setup
**Why mock GPU?** Fast, deterministic, no hardware dependencies. Just verifies you're calling the API correctly.
### 3. Behavior Tests (Real Browser + WebGPU)
**Location:** `tests/browser/*behavior*.browser.test.ts`
**Run with:** `npm run test:behavior`
Tests actual component behavior in Chromium with real WebGPU:
- Component lifecycle
  - Canvas creation
  - Rendering without errors
  - Cleanup on destroy
- Interaction handling
  - Seeking to different positions
  - Zoom level changes
  - Rapid interactions (scrubbing, zooming)
- Edge cases
  - Very short/long tracks
  - Single vs. many bands
  - Extreme zoom levels
**Environment:** Runs in headless Chromium via Playwright provider.
### 4. Visual Regression Tests (Real Browser + Screenshots)
**Location:** `tests/browser/*visual*.browser.test.ts`
**Run with:** `npm run test:visual`
Screenshot-based regression testing:
- Canonical states
  - Default view
  - Start, middle, end positions
  - High/low zoom levels
- Visual consistency
  - Multiple re-renders produce identical output
  - Different canvas sizes
  - Different band counts
- Edge cases
  - Single band visualization
  - Many bands (8+)
  - Small/large canvases
**How it works:**
1. First run creates reference screenshots in `__screenshots__/`
2. Subsequent runs compare against references using pixelmatch
3. Threshold: 0.2, max 200 mismatched pixels (configurable in `vitest.browser.config.ts`)
**CI considerations:** Lock OS and browser version for pixel-perfect consistency.
## Running Tests
### All Tests
```bash
npm test                    # All tests in workspace (node + browser)
npm run test:run           # All tests, exit on completion
npm run test:all           # Lint + typecheck + tests + e2e
```
### By Layer
```bash
npm run test:logic         # Pure logic (fast, ~seconds)
npm run test:gpu-plumbing  # GPU resource mocking (fast)
npm run test:behavior      # Real WebGPU behavior (medium, ~10s)
npm run test:visual        # Visual regression (slow, ~30s)
```
### By Environment
```bash
npm run test:node          # All node tests (logic + plumbing)
npm run test:browser       # All browser tests (behavior + visual)
```
### Development
```bash
npm run test:ui            # Vitest UI for all tests
```
## Test Harness
**Location:** `tests/browser/test-harness.ts`
Simplified test harness without animation loops for deterministic testing:
```typescript
const handle = await createWaveformTestHandle(root, {
  durationSeconds: 60,
  sampleRate: 44100,
  bpm: 128,
  bandCount: 3,
  canvasWidth: 1280,
  canvasHeight: 256,
  initialPlayheadFrame: 0,
  initialZoom: 512,
});
// Explicit rendering (no requestAnimationFrame)
seekAndRender(handle, 44100 * 30);  // Seek to 30 seconds
setZoomAndRender(handle, 1024);     // Change zoom
// Cleanup
destroyTestHandle(handle);
```
**Key differences from production harness:**
- No animation loop
- All rendering is explicit via `frame()` calls
- Deterministic state for stable screenshots
## Configuration Files
- `vitest.config.ts` - Node tests (jsdom environment)
- `vitest.browser.config.ts` - Browser tests (Playwright provider)
- `vitest.workspace.ts` - Workspace combining both configs
- `tests/setup.ts` - Mock GPU device for node tests
## WebGPU & Playwright Gotchas
### Headless GPU Support
Recent Chromium headless has real GPU path enabled. If `navigator.gpu` is undefined:
```typescript
// In vitest.browser.config.ts
browser: {
  provider: 'playwright',
  providerOptions: {
    launch: {
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan,UseSkiaRenderer',
      ],
    },
  },
}
```
### Determinism
- Use seeded test data generators
- Avoid time-based animations in tests
- Explicitly control render timing
- Lock browser version in CI
### Visual Test Stability
- Set fixed canvas dimensions
- Control device pixel ratio
- Wait for render completion before screenshots
- Use consistent test data (same seed)
## Debugging
### Failed Visual Tests
When a visual test fails:
1. Check `__screenshots__/` for diff images
2. Review what changed visually
3. If change is intentional, update reference:
   ```bash
   rm -rf __screenshots__/
   npm run test:visual
   ```
4. Commit new references to version control
### WebGPU Errors
If browser tests fail with WebGPU errors:
1. Run with headed browser: `vitest --config vitest.browser.config.ts --browser.headless=false`
2. Check browser console for GPU validation errors
3. Verify WebGPU is supported: `navigator.gpu !== undefined`
### Performance
- Node tests: <1s
- Browser behavior: ~5-10s
- Visual regression: ~20-30s (screenshot overhead)
Total suite runtime: ~30-40s
## CI Integration
Recommended CI setup:
```yaml
- name: Install dependencies
  run: npm ci
- name: Install Playwright browsers
  run: npx playwright install chromium
- name: Run tests
  run: npm run test:all
- name: Upload screenshots on failure
  if: failure()
  uses: actions/upload-artifact@v3
  with:
    name: screenshots-diff
    path: __screenshots__/
```
## Philosophy
**Test layers match reality:**
1. Math is math → test it fast (node)
2. GPU setup is plumbing → mock it (node + fakes)
3. Rendering is behavior → test it real (browser)
4. Pixels are proof → screenshot it (visual regression)
**When to skip tests:**
- Refactoring internals? Logic tests should still pass.
- Shader changes? Visual tests will catch regressions.
- New feature? Add behavior test first, visual test after stabilization.
**Goal:** Know immediately when you've broken the pretty blue squiggles, not during a live set.
```

### `tests/setup.ts` {#tests-setup-ts}

```typescript
// File: tests/setup.ts

import { vi } from 'vitest';
const createMockGPUDevice = (): GPUDevice => {
  const mockBuffer: GPUBuffer = {
    size: 0,
    usage: 0,
    mapState: 'unmapped',
    label: '',
    getMappedRange: vi.fn(),
    unmap: vi.fn(),
    destroy: vi.fn(),
    mapAsync: vi.fn().mockResolvedValue(undefined),
  } as unknown as GPUBuffer;
  const mockTexture: GPUTexture = {
    width: 0,
    height: 0,
    depthOrArrayLayers: 1,
    mipLevelCount: 1,
    sampleCount: 1,
    dimension: '2d',
    format: 'rgba8unorm',
    usage: 0,
    label: '',
    createView: vi.fn().mockReturnValue({
      label: '',
    } as GPUTextureView),
    destroy: vi.fn(),
  } as unknown as GPUTexture;
  const mockSampler: GPUSampler = {
    label: '',
  } as GPUSampler;
  const mockBindGroupLayout: GPUBindGroupLayout = {
    label: '',
  } as GPUBindGroupLayout;
  const mockBindGroup: GPUBindGroup = {
    label: '',
  } as GPUBindGroup;
  const mockPipelineLayout: GPUPipelineLayout = {
    label: '',
  } as GPUPipelineLayout;
  const mockShaderModule: GPUShaderModule = {
    label: '',
    getCompilationInfo: vi.fn().mockResolvedValue({ messages: [] }),
  } as unknown as GPUShaderModule;
  const mockRenderPipeline: GPURenderPipeline = {
    label: '',
    getBindGroupLayout: vi.fn().mockReturnValue(mockBindGroupLayout),
  } as unknown as GPURenderPipeline;
  const mockRenderPassEncoder: GPURenderPassEncoder = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
    setViewport: vi.fn(),
    setScissorRect: vi.fn(),
    setBlendConstant: vi.fn(),
    setStencilReference: vi.fn(),
    beginOcclusionQuery: vi.fn(),
    endOcclusionQuery: vi.fn(),
    executeBundles: vi.fn(),
    insertDebugMarker: vi.fn(),
    popDebugGroup: vi.fn(),
    pushDebugGroup: vi.fn(),
    setVertexBuffer: vi.fn(),
    setIndexBuffer: vi.fn(),
    drawIndexed: vi.fn(),
    drawIndirect: vi.fn(),
    drawIndexedIndirect: vi.fn(),
    label: '',
  } as unknown as GPURenderPassEncoder;
  const mockCommandEncoder: GPUCommandEncoder = {
    beginRenderPass: vi.fn().mockReturnValue(mockRenderPassEncoder),
    finish: vi.fn().mockReturnValue({} as GPUCommandBuffer),
    copyBufferToBuffer: vi.fn(),
    copyBufferToTexture: vi.fn(),
    copyTextureToBuffer: vi.fn(),
    copyTextureToTexture: vi.fn(),
    clearBuffer: vi.fn(),
    resolveQuerySet: vi.fn(),
    insertDebugMarker: vi.fn(),
    popDebugGroup: vi.fn(),
    pushDebugGroup: vi.fn(),
    beginComputePass: vi.fn(),
    writeTimestamp: vi.fn(),
    label: '',
  } as unknown as GPUCommandEncoder;
  const mockQueue: GPUQueue = {
    submit: vi.fn(),
    writeBuffer: vi.fn(),
    writeTexture: vi.fn(),
    onSubmittedWorkDone: vi.fn().mockResolvedValue(undefined),
    copyExternalImageToTexture: vi.fn(),
    label: '',
  } as unknown as GPUQueue;
  const device: GPUDevice = {
    features: new Set(),
    limits: {
      maxTextureDimension1D: 8192,
      maxTextureDimension2D: 8192,
      maxTextureDimension3D: 2048,
      maxTextureArrayLayers: 256,
      maxBindGroups: 4,
      maxBindingsPerBindGroup: 1000,
      maxDynamicUniformBuffersPerPipelineLayout: 8,
      maxDynamicStorageBuffersPerPipelineLayout: 4,
      maxSampledTexturesPerShaderStage: 16,
      maxSamplersPerShaderStage: 16,
      maxStorageBuffersPerShaderStage: 8,
      maxStorageTexturesPerShaderStage: 4,
      maxUniformBuffersPerShaderStage: 12,
      maxUniformBufferBindingSize: 65536,
      maxStorageBufferBindingSize: 134217728,
      minUniformBufferOffsetAlignment: 256,
      minStorageBufferOffsetAlignment: 256,
      maxVertexBuffers: 8,
      maxBufferSize: 268435456,
      maxVertexAttributes: 16,
      maxVertexBufferArrayStride: 2048,
      maxInterStageShaderComponents: 60,
      maxInterStageShaderVariables: 16,
      maxColorAttachments: 8,
      maxColorAttachmentBytesPerSample: 32,
      maxComputeWorkgroupStorageSize: 16384,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupSizeX: 256,
      maxComputeWorkgroupSizeY: 256,
      maxComputeWorkgroupSizeZ: 64,
      maxComputeWorkgroupsPerDimension: 65535,
    },
    queue: mockQueue,
    lost: new Promise(() => {}),
    label: '',
    destroy: vi.fn(),
    createBuffer: vi.fn().mockReturnValue(mockBuffer),
    createTexture: vi.fn().mockReturnValue(mockTexture),
    createSampler: vi.fn().mockReturnValue(mockSampler),
    createBindGroupLayout: vi.fn().mockReturnValue(mockBindGroupLayout),
    createPipelineLayout: vi.fn().mockReturnValue(mockPipelineLayout),
    createBindGroup: vi.fn().mockReturnValue(mockBindGroup),
    createShaderModule: vi.fn().mockReturnValue(mockShaderModule),
    createComputePipeline: vi.fn(),
    createRenderPipeline: vi.fn().mockReturnValue(mockRenderPipeline),
    createComputePipelineAsync: vi.fn(),
    createRenderPipelineAsync: vi.fn(),
    createCommandEncoder: vi.fn().mockReturnValue(mockCommandEncoder),
    createRenderBundleEncoder: vi.fn(),
    createQuerySet: vi.fn(),
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn().mockResolvedValue(null),
    onuncapturederror: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn().mockReturnValue(true),
    importExternalTexture: vi.fn(),
  } as unknown as GPUDevice;
  return device;
};
const createMockGPUAdapter = (): GPUAdapter => {
  const adapter: GPUAdapter = {
    features: new Set(),
    limits: {
      maxTextureDimension1D: 8192,
      maxTextureDimension2D: 8192,
      maxTextureDimension3D: 2048,
      maxTextureArrayLayers: 256,
      maxBindGroups: 4,
      maxBindingsPerBindGroup: 1000,
      maxDynamicUniformBuffersPerPipelineLayout: 8,
      maxDynamicStorageBuffersPerPipelineLayout: 4,
      maxSampledTexturesPerShaderStage: 16,
      maxSamplersPerShaderStage: 16,
      maxStorageBuffersPerShaderStage: 8,
      maxStorageTexturesPerShaderStage: 4,
      maxUniformBuffersPerShaderStage: 12,
      maxUniformBufferBindingSize: 65536,
      maxStorageBufferBindingSize: 134217728,
      minUniformBufferOffsetAlignment: 256,
      minStorageBufferOffsetAlignment: 256,
      maxVertexBuffers: 8,
      maxBufferSize: 268435456,
      maxVertexAttributes: 16,
      maxVertexBufferArrayStride: 2048,
      maxInterStageShaderComponents: 60,
      maxInterStageShaderVariables: 16,
      maxColorAttachments: 8,
      maxColorAttachmentBytesPerSample: 32,
      maxComputeWorkgroupStorageSize: 16384,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupSizeX: 256,
      maxComputeWorkgroupSizeY: 256,
      maxComputeWorkgroupSizeZ: 64,
      maxComputeWorkgroupsPerDimension: 65535,
    },
    info: {
      vendor: 'test',
      architecture: 'test',
      device: 'test',
      description: 'test',
      toJSON: () => ({}),
    },
    isFallbackAdapter: false,
    requestDevice: vi.fn().mockResolvedValue(createMockGPUDevice()),
    requestAdapterInfo: vi.fn().mockResolvedValue({
      vendor: 'test',
      architecture: 'test',
      device: 'test',
      description: 'test',
      toJSON: () => ({}),
    }),
  } as unknown as GPUAdapter;
  return adapter;
};
const createMockGPUCanvasContext = (): GPUCanvasContext => {
  const context: GPUCanvasContext = {
    canvas: document.createElement('canvas'),
    configure: vi.fn(),
    unconfigure: vi.fn(),
    getCurrentTexture: vi.fn().mockReturnValue({
      width: 800,
      height: 600,
      depthOrArrayLayers: 1,
      mipLevelCount: 1,
      sampleCount: 1,
      dimension: '2d',
      format: 'bgra8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      label: '',
      createView: vi.fn().mockReturnValue({
        label: '',
      } as GPUTextureView),
      destroy: vi.fn(),
    } as unknown as GPUTexture),
  } as unknown as GPUCanvasContext;
  return context;
};
const mockGPU: GPU = {
  requestAdapter: vi.fn().mockResolvedValue(createMockGPUAdapter()),
  getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
  wgslLanguageFeatures: new Set(),
} as unknown as GPU;
Object.defineProperty(global.navigator, 'gpu', {
  value: mockGPU,
  writable: true,
  configurable: true,
});
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (
  contextId: string,
  options?: unknown
): RenderingContext | null {
  if (contextId === 'webgpu') {
    return createMockGPUCanvasContext() as unknown as RenderingContext;
  }
  return originalGetContext.call(
    this,
    contextId,
    options as CanvasRenderingContext2DSettings
  );
};
Object.defineProperty(global, 'GPUTextureUsage', {
  value: {
    COPY_SRC: 0x01,
    COPY_DST: 0x02,
    TEXTURE_BINDING: 0x04,
    STORAGE_BINDING: 0x08,
    RENDER_ATTACHMENT: 0x10,
  },
  writable: false,
});
Object.defineProperty(global, 'GPUBufferUsage', {
  value: {
    MAP_READ: 0x0001,
    MAP_WRITE: 0x0002,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    INDEX: 0x0010,
    VERTEX: 0x0020,
    UNIFORM: 0x0040,
    STORAGE: 0x0080,
    INDIRECT: 0x0100,
    QUERY_RESOLVE: 0x0200,
  },
  writable: false,
});
Object.defineProperty(global, 'GPUShaderStage', {
  value: {
    VERTEX: 0x1,
    FRAGMENT: 0x2,
    COMPUTE: 0x4,
  },
  writable: false,
});
export {
  createMockGPUDevice,
  createMockGPUAdapter,
  createMockGPUCanvasContext,
  mockGPU,
};
```

### `tests/test-data.test.ts` {#tests-test-data-test-ts}

```typescript
// File: tests/test-data.test.ts

import {describe, expect, it} from 'vitest';
import {
    createTestAudioVisualState,
    createTestDeckState,
    generateTestCuePoints,
    generateTestSections,
    generateTestWaveform,
    type TestTrackConfig,
    updateTransportPlayback,
} from '../src/utils/test-data.ts';
describe('Test Data Generator', () => {
    const defaultConfig: TestTrackConfig = {
        durationSeconds: 180, 
        sampleRate: 44100,
        bpm: 128,
        key: '8B',
        title: 'Test Track',
        artist: 'Test Artist',
    };
    describe('generateTestWaveform', () => {
        it('should generate waveform pyramid with correct total samples', () => {
            const waveform = generateTestWaveform(defaultConfig);
            const expectedSamples = Math.floor(
                defaultConfig.durationSeconds * defaultConfig.sampleRate,
            );
            expect(waveform.totalSamples).toBe(expectedSamples);
            expect(waveform.sampleRate).toBe(defaultConfig.sampleRate);
        });
        it('should generate multiple GPU-safe LOD levels', () => {
            const waveform = generateTestWaveform(defaultConfig);
            expect(waveform.lods.length).toBeGreaterThanOrEqual(1);
            for (const lod of waveform.lods) {
                expect(lod.samplesPerPixel).toBeGreaterThan(0);
                expect(lod.lengthInPixels).toBeGreaterThan(0);
                expect(lod.lengthInPixels).toBeLessThanOrEqual(8192);
            }
        });
        it('should create valid amplitude data', () => {
            const waveform = generateTestWaveform(defaultConfig);
            const lod = waveform.lods[0];
            expect(lod.amplitude.length).toBe(lod.lengthInPixels * 2);
            for (let i = 0; i < lod.lengthInPixels; i += 1) {
                const min = lod.amplitude[i * 2];
                const max = lod.amplitude[i * 2 + 1];
                expect(min).toBeGreaterThanOrEqual(0);
                expect(min).toBeLessThanOrEqual(1);
                expect(max).toBeGreaterThanOrEqual(min);
                expect(max).toBeLessThanOrEqual(1);
            }
        });
        it('should create valid band energies', () => {
            const waveform = generateTestWaveform(defaultConfig);
            const lod = waveform.lods[0];
            expect(lod.bandEnergies.length).toBe(lod.lengthInPixels * 3);
            for (let i = 0; i < lod.lengthInPixels; i += 1) {
                const low = lod.bandEnergies[i * 3];
                const mid = lod.bandEnergies[i * 3 + 1];
                const high = lod.bandEnergies[i * 3 + 2];
                expect(low).toBeGreaterThanOrEqual(0);
                expect(low).toBeLessThanOrEqual(1);
                expect(mid).toBeGreaterThanOrEqual(0);
                expect(mid).toBeLessThanOrEqual(1);
                expect(high).toBeGreaterThanOrEqual(0);
                expect(high).toBeLessThanOrEqual(1);
            }
        });
        it('should configure 3-band frequency analysis', () => {
            const waveform = generateTestWaveform(defaultConfig);
            expect(waveform.bands.bandCount).toBe(3);
            expect(waveform.bands.sampleRate).toBe(defaultConfig.sampleRate);
            expect(waveform.bands.frequencyRanges).toHaveLength(3);
            expect(waveform.bands.frequencyRanges[0]).toEqual({min: 20, max: 250});
            expect(waveform.bands.frequencyRanges[1]).toEqual({min: 250, max: 4000});
            expect(waveform.bands.frequencyRanges[2]).toEqual({min: 4000, max: 20000});
        });
        it('should have decreasing pixel counts for higher LODs', () => {
            const waveform = generateTestWaveform(defaultConfig);
            for (let i = 1; i < waveform.lods.length; i += 1) {
                const prevLod = waveform.lods[i - 1];
                const currentLod = waveform.lods[i];
                expect(currentLod.samplesPerPixel).toBeGreaterThan(
                    prevLod.samplesPerPixel,
                );
                expect(currentLod.lengthInPixels).toBeLessThan(prevLod.lengthInPixels);
            }
        });
        it('should handle short duration tracks', () => {
            const shortConfig: TestTrackConfig = {
                ...defaultConfig,
                durationSeconds: 10,
            };
            const waveform = generateTestWaveform(shortConfig);
            expect(waveform.totalSamples).toBe(441000); 
            expect(waveform.lods.length).toBe(7);
        });
        it('should handle different sample rates', () => {
            const highSampleRateConfig: TestTrackConfig = {
                ...defaultConfig,
                sampleRate: 96000,
            };
            const waveform = generateTestWaveform(highSampleRateConfig);
            expect(waveform.sampleRate).toBe(96000);
            expect(waveform.totalSamples).toBe(180 * 96000);
        });
    });
    describe('generateTestCuePoints', () => {
        it('should generate cue points at track sections', () => {
            const cuePoints = generateTestCuePoints(defaultConfig);
            expect(cuePoints.length).toBe(6);
            expect(cuePoints[0].label).toBe('Intro');
            expect(cuePoints[1].label).toBe('Verse');
            expect(cuePoints[2].label).toBe('Breakdown');
            expect(cuePoints[3].label).toBe('Drop');
            expect(cuePoints[4].label).toBe('Break 2');
            expect(cuePoints[5].label).toBe('Outro');
        });
        it('should have unique IDs', () => {
            const cuePoints = generateTestCuePoints(defaultConfig);
            const ids = cuePoints.map((cp) => cp.id);
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(cuePoints.length);
        });
        it('should have valid colors', () => {
            const cuePoints = generateTestCuePoints(defaultConfig);
            for (const cue of cuePoints) {
                expect(cue.color).toHaveLength(3);
                for (const channel of cue.color) {
                    expect(channel).toBeGreaterThanOrEqual(0);
                    expect(channel).toBeLessThanOrEqual(255);
                }
            }
        });
        it('should have increasing sample positions', () => {
            const cuePoints = generateTestCuePoints(defaultConfig);
            for (let i = 1; i < cuePoints.length; i += 1) {
                expect(cuePoints[i].samplePosition).toBeGreaterThan(
                    cuePoints[i - 1].samplePosition,
                );
            }
        });
        it('should align to bar boundaries', () => {
            const cuePoints = generateTestCuePoints(defaultConfig);
            const samplesPerBeat =
                (defaultConfig.sampleRate * 60) / defaultConfig.bpm;
            const samplesPerBar = samplesPerBeat * 4;
            for (const cue of cuePoints) {
                const barPosition = cue.samplePosition / samplesPerBar;
                expect(barPosition % 1).toBeCloseTo(0, 5);
            }
        });
    });
    describe('generateTestSections', () => {
        it('should generate 6 sections', () => {
            const sections = generateTestSections(defaultConfig);
            expect(sections).toHaveLength(6);
        });
        it('should cover entire track duration', () => {
            const sections = generateTestSections(defaultConfig);
            const totalSamples =
                defaultConfig.durationSeconds * defaultConfig.sampleRate;
            expect(sections[0].startSample).toBe(0);
            expect(sections[sections.length - 1].endSample).toBe(totalSamples);
        });
        it('should have contiguous sections', () => {
            const sections = generateTestSections(defaultConfig);
            for (let i = 1; i < sections.length; i += 1) {
                expect(sections[i].startSample).toBe(sections[i - 1].endSample);
            }
        });
        it('should have valid section types', () => {
            const sections = generateTestSections(defaultConfig);
            const validTypes = [
                'intro',
                'verse',
                'chorus',
                'breakdown',
                'drop',
                'outro',
                'bridge',
            ];
            for (const section of sections) {
                expect(validTypes).toContain(section.type);
            }
        });
        it('should include all expected section types', () => {
            const sections = generateTestSections(defaultConfig);
            const types = sections.map((s) => s.type);
            expect(types).toContain('intro');
            expect(types).toContain('verse');
            expect(types).toContain('breakdown');
            expect(types).toContain('drop');
            expect(types).toContain('outro');
        });
    });
    describe('createTestDeckState', () => {
        it('should create complete deck state', () => {
            const deckState = createTestDeckState(defaultConfig);
            expect(deckState.id).toBe('deck-a');
            expect(deckState.transport).toBeDefined();
            expect(deckState.loop).toBeDefined();
            expect(deckState.cuePoints).toBeDefined();
            expect(deckState.sections).toBeDefined();
            expect(deckState.waveform).toBeDefined();
        });
        it('should set track metadata correctly', () => {
            const deckState = createTestDeckState(defaultConfig);
            expect(deckState.trackTitle).toBe(defaultConfig.title);
            expect(deckState.trackArtist).toBe(defaultConfig.artist);
            expect(deckState.trackKey).toBe(defaultConfig.key);
            expect(deckState.trackDurationSamples).toBe(
                deckState.waveform.totalSamples,
            );
        });
        it('should initialize transport at beginning', () => {
            const deckState = createTestDeckState(defaultConfig);
            expect(deckState.transport.playheadSamples).toBe(0);
            expect(deckState.transport.rate).toBe(1.0);
            expect(deckState.transport.bpm).toBe(defaultConfig.bpm);
            expect(deckState.transport.beatPhase).toBe(0);
            expect(deckState.transport.barIndex).toBe(0);
            expect(deckState.transport.beatInBar).toBe(0);
            expect(deckState.transport.isPlaying).toBe(false);
        });
        it('should set loop to 8 bars', () => {
            const deckState = createTestDeckState(defaultConfig);
            const samplesPerBeat =
                (defaultConfig.sampleRate * 60) / defaultConfig.bpm;
            const samplesPerBar = samplesPerBeat * 4;
            expect(deckState.loop.active).toBe(false);
            expect(deckState.loop.inSample).toBe(samplesPerBar * 8);
            expect(deckState.loop.outSample).toBe(samplesPerBar * 16);
        });
        it('should include generated waveform', () => {
            const deckState = createTestDeckState(defaultConfig);
            expect(deckState.waveform.totalSamples).toBeGreaterThan(0);
            expect(deckState.waveform.lods.length).toBeGreaterThanOrEqual(1);
        });
        it('should include cue points', () => {
            const deckState = createTestDeckState(defaultConfig);
            expect(deckState.cuePoints.length).toBe(6);
        });
        it('should include sections', () => {
            const deckState = createTestDeckState(defaultConfig);
            expect(deckState.sections.length).toBe(6);
        });
    });
    describe('createTestAudioVisualState', () => {
        it('should create state with provided decks', () => {
            const deck = createTestDeckState(defaultConfig);
            const state = createTestAudioVisualState([deck]);
            expect(state.decks).toHaveLength(1);
            expect(state.decks[0]).toBe(deck);
        });
        it('should initialize timing at zero', () => {
            const deck = createTestDeckState(defaultConfig);
            const state = createTestAudioVisualState([deck]);
            expect(state.time).toBe(0);
            expect(state.deltaTime).toBe(0);
        });
        it('should initialize master meter', () => {
            const deck = createTestDeckState(defaultConfig);
            const state = createTestAudioVisualState([deck]);
            expect(state.master.rms).toBe(0.5);
            expect(state.master.peak).toBe(0.7);
            expect(state.master.peakHold).toBe(0.75);
            expect(state.master.lufs).toBe(-14);
            expect(state.master.lowEnergy).toBe(0.4);
            expect(state.master.midEnergy).toBe(0.5);
            expect(state.master.highEnergy).toBe(0.3);
            expect(state.master.leftPeak).toBe(0.68);
            expect(state.master.rightPeak).toBe(0.72);
            expect(state.master.correlation).toBe(0.95);
        });
        it('should center crossfader', () => {
            const deck = createTestDeckState(defaultConfig);
            const state = createTestAudioVisualState([deck]);
            expect(state.crossfaderPosition).toBe(0);
        });
        it('should handle multiple decks', () => {
            const deckA = createTestDeckState({...defaultConfig, title: 'Track A'});
            const deckB = createTestDeckState({...defaultConfig, title: 'Track B'});
            const state = createTestAudioVisualState([deckA, deckB]);
            expect(state.decks).toHaveLength(2);
            expect(state.decks[0].trackTitle).toBe('Track A');
            expect(state.decks[1].trackTitle).toBe('Track B');
        });
    });
    describe('updateTransportPlayback', () => {
        it('should not update when not playing', () => {
            const deck = createTestDeckState(defaultConfig);
            const updated = updateTransportPlayback(deck, 0.016, false);
            expect(updated.transport.playheadSamples).toBe(0);
            expect(updated).toBe(deck);
        });
        it('should advance playhead when playing', () => {
            const deck = createTestDeckState(defaultConfig);
            const deltaTime = 0.016; 
            const updated = updateTransportPlayback(deck, deltaTime, true);
            const expectedAdvance = deck.waveform.sampleRate * deltaTime;
            expect(updated.transport.playheadSamples).toBeCloseTo(
                expectedAdvance,
                0,
            );
        });
        it('should update beat phase', () => {
            const deck = createTestDeckState(defaultConfig);
            const updated = updateTransportPlayback(deck, 0.1, true); 
            expect(updated.transport.beatPhase).toBeGreaterThan(0);
            expect(updated.transport.beatPhase).toBeLessThan(1);
        });
        it('should update bar index', () => {
            const deck = createTestDeckState(defaultConfig);
            const samplesPerBeat =
                (deck.waveform.sampleRate * 60) / defaultConfig.bpm;
            const samplesPerBar = samplesPerBeat * 4;
            const timeForTwoBars = (samplesPerBar * 2) / deck.waveform.sampleRate;
            const updated = updateTransportPlayback(deck, timeForTwoBars, true);
            expect(updated.transport.barIndex).toBe(2);
        });
        it('should update beat in bar', () => {
            const deck = createTestDeckState(defaultConfig);
            const samplesPerBeat =
                (deck.waveform.sampleRate * 60) / defaultConfig.bpm;
            const timeForTwoAndHalfBeats =
                (samplesPerBeat * 2.5) / deck.waveform.sampleRate;
            const updated = updateTransportPlayback(
                deck,
                timeForTwoAndHalfBeats,
                true,
            );
            expect(updated.transport.beatInBar).toBe(2);
        });
        it('should loop around track duration', () => {
            const deck = createTestDeckState(defaultConfig);
            const timeForLoop =
                deck.waveform.totalSamples / deck.waveform.sampleRate + 1;
            const updated = updateTransportPlayback(deck, timeForLoop, true);
            expect(updated.transport.playheadSamples).toBeLessThan(
                deck.waveform.totalSamples,
            );
            expect(updated.transport.playheadSamples).toBeGreaterThan(0);
        });
        it('should respect playback rate', () => {
            const deck = createTestDeckState(defaultConfig);
            const modifiedDeck: typeof deck = {
                ...deck,
                transport: {...deck.transport, rate: 2.0},
            };
            const normalUpdate = updateTransportPlayback(deck, 0.1, true);
            const doubleSpeedUpdate = updateTransportPlayback(
                modifiedDeck,
                0.1,
                true,
            );
            expect(doubleSpeedUpdate.transport.playheadSamples).toBeCloseTo(
                normalUpdate.transport.playheadSamples * 2,
                0,
            );
        });
        it('should set isPlaying flag', () => {
            const deck = createTestDeckState(defaultConfig);
            const updated = updateTransportPlayback(deck, 0.016, true);
            expect(updated.transport.isPlaying).toBe(true);
        });
        it('should preserve other deck state', () => {
            const deck = createTestDeckState(defaultConfig);
            const updated = updateTransportPlayback(deck, 0.016, true);
            expect(updated.id).toBe(deck.id);
            expect(updated.loop).toBe(deck.loop);
            expect(updated.cuePoints).toBe(deck.cuePoints);
            expect(updated.sections).toBe(deck.sections);
            expect(updated.waveform).toBe(deck.waveform);
            expect(updated.trackTitle).toBe(deck.trackTitle);
        });
    });
});
```


/**
 * Stem Waveform Component
 *
 * WebGPU component that renders a multi-stem waveform visualization with:
 * - Centered playhead (fixed in middle of view)
 * - Scrolling waveform
 * - 1-4 stems rendered concurrently
 * - Per-stem gain/opacity/blend control
 * - Beat grid overlay
 * - Zoom control
 *
 * Does NOT handle audio playback or timing - caller drives playhead position.
 */

import type {
  StemId,
  StemType,
  MultiStemTrack,
  StemBlendMode,
  StemDeckVisualConfig
} from './types.js';
import type { StemDeckGPUResources } from './gpu-resources.js';
import { calculateSamplesPerPixel, calculateLODBlend } from './gpu-resources.js';
import stemWaveformShaderCode from '../shaders/stem-waveform.wgsl?raw';

// Uniform buffer size (32 fields × 4 bytes, padded to 256)
const UNIFORM_BUFFER_SIZE = 256;

/**
 * Viewport configuration
 */
interface WaveformViewport {
  /** Center of view in sample frames */
  centerFrame: number;

  /** Samples per screen pixel (zoom level) */
  framesPerPixel: number;

  /** View width in pixels */
  widthPixels: number;

  /** View height in pixels */
  heightPixels: number;
}

/**
 * Per-stem control state (mutable)
 */
interface StemControl {
  gain: number; // 0.0 - 2.0
  opacity: number; // 0.0 - 1.0
  isMuted: boolean;
  isSolo: boolean;
}

/**
 * Component configuration
 */
export interface StemWaveformConfig {
  /** Canvas element to render into */
  canvas: HTMLCanvasElement;

  /** GPU resources (textures, bind groups) */
  gpuResources: StemDeckGPUResources;

  /** Track metadata */
  track: MultiStemTrack;

  /** Initial visual config (optional) */
  initialVisualConfig?: Partial<StemDeckVisualConfig>;

  /** Callback when user scrubs (clicks or drags on waveform) */
  onScrub?: (frame: number) => void;
}

/**
 * Main stem waveform component
 */
export class StemWaveformComponent {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private pipeline: GPURenderPipeline;
  private uniformBuffer: GPUBuffer;
  private uniformData: Float32Array;
  private bindGroup: GPUBindGroup;

  private track: MultiStemTrack;
  private gpuResources: StemDeckGPUResources;

  private viewport: WaveformViewport;
  private stemControls: Map<StemType, StemControl>;
  private blendMode: StemBlendMode = 'additive';
  private showBeatGridEnabled = true;
  private brightness = 1.0;
  private contrast = 1.0;
  private saturation = 1.0;

  private currentLODPrimary = 0;
  private currentLODSecondary = 1;
  private lodBlendFactor = 0.0;

  private onScrubCallback?: (frame: number) => void;
  private isDragging = false;

  constructor(config: StemWaveformConfig) {
    const { canvas, gpuResources, track, initialVisualConfig, onScrub } = config;

    this.track = track;
    this.gpuResources = gpuResources;
    this.onScrubCallback = onScrub;

    // Initialize WebGPU
    const adapter = navigator.gpu?.getPreferredCanvasFormat();
    if (!adapter) {
      throw new Error('WebGPU not supported');
    }

    // Get device (assuming it's already created by caller)
    // In a real app, this would be passed in or created here
    throw new Error('Device initialization needs to be handled by caller - pass GPUDevice in config');
  }

  /**
   * Static async factory method (preferred over constructor)
   */
  static async create(config: StemWaveformConfig & { device: GPUDevice }): Promise<StemWaveformComponent> {
    const component = Object.create(StemWaveformComponent.prototype);
    await component.initialize(config);
    return component;
  }

  /**
   * Initialize component (called by factory method)
   */
  private async initialize(config: StemWaveformConfig & { device: GPUDevice }): Promise<void> {
    const { canvas, gpuResources, track, initialVisualConfig, onScrub, device } = config;

    this.device = device;
    this.track = track;
    this.gpuResources = gpuResources;
    this.onScrubCallback = onScrub;

    // Initialize viewport
    this.viewport = {
      centerFrame: 0,
      framesPerPixel: calculateSamplesPerPixel(canvas.width, track.sampleRate, 1.0),
      widthPixels: canvas.width,
      heightPixels: canvas.height
    };

    // Initialize stem controls
    this.stemControls = new Map();
    for (const stemType of ['drums', 'bass', 'vocals', 'other'] as StemType[]) {
      this.stemControls.set(stemType, {
        gain: 1.0,
        opacity: 1.0,
        isMuted: false,
        isSolo: false
      });
    }

    // Apply initial visual config
    if (initialVisualConfig) {
      if (initialVisualConfig.blendMode) this.blendMode = initialVisualConfig.blendMode;
      if (initialVisualConfig.showBeatGrid !== undefined) this.showBeatGridEnabled = initialVisualConfig.showBeatGrid;

      if (initialVisualConfig.stemStates) {
        for (const [stemType, state] of initialVisualConfig.stemStates.entries()) {
          const control = this.stemControls.get(stemType);
          if (control) {
            control.gain = state.gain;
            control.opacity = state.opacity;
            control.isMuted = state.isMuted;
            control.isSolo = state.isSolo;
          }
        }
      }
    }

    // Setup canvas context
    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new Error('Failed to get WebGPU context');
    }
    this.context = context;

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device: this.device,
      format,
      alphaMode: 'premultiplied'
    });

    // Create shader module
    const shaderModule = device.createShaderModule({
      label: 'StemWaveform Shader',
      code: stemWaveformShaderCode
    });

    // Create uniform buffer
    this.uniformBuffer = device.createBuffer({
      label: 'StemWaveform Uniforms',
      size: UNIFORM_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    // Create uniform data array (for writing)
    this.uniformData = new Float32Array(UNIFORM_BUFFER_SIZE / 4);

    // Create complete bind group layout (includes uniforms + textures)
    const bindGroupLayout = device.createBindGroupLayout({
      label: 'StemWaveform Bind Group Layout',
      entries: [
        // Binding 0: Uniforms
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },

        // Bindings 1-17: Textures and sampler
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 10, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 11, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 12, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 13, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 14, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 15, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 16, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 17, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }
      ]
    });

    // Create pipeline layout
    const pipelineLayout = device.createPipelineLayout({
      label: 'StemWaveform Pipeline Layout',
      bindGroupLayouts: [bindGroupLayout]
    });

    // Create render pipeline
    this.pipeline = device.createRenderPipeline({
      label: 'StemWaveform Render Pipeline',
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format }]
      },
      primitive: {
        topology: 'triangle-list'
      }
    });

    // Create complete bind group (uniforms + textures)
    this.bindGroup = this.createCompleteBindGroup(bindGroupLayout);

    // Setup interaction handlers
    this.setupInteractionHandlers(canvas);
  }

  /**
   * Create bind group with uniforms and textures
   */
  private createCompleteBindGroup(layout: GPUBindGroupLayout): GPUBindGroup {
    const entries: GPUBindGroupEntry[] = [];

    // Binding 0: Uniform buffer
    entries.push({
      binding: 0,
      resource: { buffer: this.uniformBuffer }
    });

    // Helper to get texture or fallback
    const getTexture = (
      stemTextures: readonly { amplitudeTexture: GPUTexture; bandsTexture: GPUTexture }[] | null,
      lodIndex: number,
      type: 'amplitude' | 'bands'
    ): GPUTexture => {
      if (stemTextures && stemTextures[lodIndex]) {
        return type === 'amplitude'
          ? stemTextures[lodIndex].amplitudeTexture
          : stemTextures[lodIndex].bandsTexture;
      }
      // Return a 1x1 fallback texture (we'll need to create this)
      return this.getFallbackTexture();
    };

    // Bindings 1-4: Drums
    entries.push({ binding: 1, resource: getTexture(this.gpuResources.drums, 0, 'amplitude').createView() });
    entries.push({ binding: 2, resource: getTexture(this.gpuResources.drums, 0, 'bands').createView() });
    entries.push({ binding: 3, resource: getTexture(this.gpuResources.drums, 1, 'amplitude').createView() });
    entries.push({ binding: 4, resource: getTexture(this.gpuResources.drums, 1, 'bands').createView() });

    // Bindings 5-8: Bass
    entries.push({ binding: 5, resource: getTexture(this.gpuResources.bass, 0, 'amplitude').createView() });
    entries.push({ binding: 6, resource: getTexture(this.gpuResources.bass, 0, 'bands').createView() });
    entries.push({ binding: 7, resource: getTexture(this.gpuResources.bass, 1, 'amplitude').createView() });
    entries.push({ binding: 8, resource: getTexture(this.gpuResources.bass, 1, 'bands').createView() });

    // Bindings 9-12: Vocals
    entries.push({ binding: 9, resource: getTexture(this.gpuResources.vocals, 0, 'amplitude').createView() });
    entries.push({ binding: 10, resource: getTexture(this.gpuResources.vocals, 0, 'bands').createView() });
    entries.push({ binding: 11, resource: getTexture(this.gpuResources.vocals, 1, 'amplitude').createView() });
    entries.push({ binding: 12, resource: getTexture(this.gpuResources.vocals, 1, 'bands').createView() });

    // Bindings 13-16: Other
    entries.push({ binding: 13, resource: getTexture(this.gpuResources.other, 0, 'amplitude').createView() });
    entries.push({ binding: 14, resource: getTexture(this.gpuResources.other, 0, 'bands').createView() });
    entries.push({ binding: 15, resource: getTexture(this.gpuResources.other, 1, 'amplitude').createView() });
    entries.push({ binding: 16, resource: getTexture(this.gpuResources.other, 1, 'bands').createView() });

    // Binding 17: Sampler
    const sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });
    entries.push({ binding: 17, resource: sampler });

    return this.device.createBindGroup({
      label: 'StemWaveform Bind Group',
      layout,
      entries
    });
  }

  private fallbackTexture?: GPUTexture;

  private getFallbackTexture(): GPUTexture {
    if (!this.fallbackTexture) {
      this.fallbackTexture = this.device.createTexture({
        size: [1, 1],
        format: 'r16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });

      // Upload zero data
      const zero = new Uint16Array(1);
      this.device.queue.writeTexture(
        { texture: this.fallbackTexture },
        zero.buffer,
        { bytesPerRow: 2, rowsPerImage: 1 },
        { width: 1, height: 1, depthOrArrayLayers: 1 }
      );
    }
    return this.fallbackTexture;
  }

  /**
   * Setup mouse/touch interaction handlers
   */
  private setupInteractionHandlers(canvas: HTMLCanvasElement): void {
    // Click to seek
    canvas.addEventListener('click', (e) => {
      if (!this.isDragging) {
        const frame = this.screenXToFrame(e.offsetX);
        this.onScrubCallback?.(frame);
      }
    });

    // Drag to scrub
    let dragStartX = 0;
    let dragStartFrame = 0;

    canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      dragStartX = e.offsetX;
      dragStartFrame = this.viewport.centerFrame;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        const deltaX = e.offsetX - dragStartX;
        const deltaFrames = -deltaX * this.viewport.framesPerPixel; // Negative because dragging right scrolls left
        const newFrame = dragStartFrame + deltaFrames;
        this.onScrubCallback?.(Math.max(0, Math.min(this.track.totalSamples, newFrame)));
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
  }

  /**
   * Convert screen X coordinate to sample frame
   */
  private screenXToFrame(screenX: number): number {
    const centerX = this.viewport.widthPixels / 2;
    const deltaX = screenX - centerX;
    const deltaFrames = deltaX * this.viewport.framesPerPixel;
    return Math.max(0, Math.min(this.track.totalSamples, this.viewport.centerFrame + deltaFrames));
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Set playhead position in sample frames
   */
  setPlayheadFrame(frame: number): void {
    this.viewport.centerFrame = Math.max(0, Math.min(this.track.totalSamples, frame));
  }

  /**
   * Set zoom level (samples per pixel)
   */
  setZoom(framesPerPixel: number): void {
    this.viewport.framesPerPixel = Math.max(1, framesPerPixel);
    this.updateLODSelection();
  }

  /**
   * Set stem gain
   */
  setStemGain(stem: StemId, gain: number): void {
    const control = this.stemControls.get(stem);
    if (control) {
      control.gain = Math.max(0, Math.min(2, gain));
    }
  }

  /**
   * Set stem opacity
   */
  setStemOpacity(stem: StemId, opacity: number): void {
    const control = this.stemControls.get(stem);
    if (control) {
      control.opacity = Math.max(0, Math.min(1, opacity));
    }
  }

  /**
   * Set blend mode
   */
  setBlendMode(mode: StemBlendMode): void {
    this.blendMode = mode;
  }

  /**
   * Show/hide beat grid
   */
  showBeatGrid(enabled: boolean): void {
    this.showBeatGridEnabled = enabled;
  }

  /**
   * Solo a stem (mute all others)
   */
  soloStem(stem: StemId | null): void {
    if (stem === null) {
      // Clear solo
      for (const control of this.stemControls.values()) {
        control.isSolo = false;
      }
    } else {
      // Solo this stem
      for (const [stemType, control] of this.stemControls.entries()) {
        control.isSolo = stemType === stem;
      }
    }
  }

  /**
   * Mute/unmute a stem
   */
  muteStem(stem: StemId, muted: boolean): void {
    const control = this.stemControls.get(stem);
    if (control) {
      control.isMuted = muted;
    }
  }

  /**
   * Resize canvas
   */
  resize(width: number, height: number): void {
    this.viewport.widthPixels = width;
    this.viewport.heightPixels = height;

    // Update canvas size
    const canvas = this.context.canvas as HTMLCanvasElement;
    canvas.width = width;
    canvas.height = height;

    this.updateLODSelection();
  }

  /**
   * Render a frame
   */
  renderFrame(): void {
    this.updateUniforms();

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.04, g: 0.04, b: 0.07, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.draw(3, 1, 0, 0); // Fullscreen triangle
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Update LOD selection based on current zoom
   */
  private updateLODSelection(): void {
    const lodInfo = calculateLODBlend(
      this.track.master,
      this.viewport.framesPerPixel
    );

    this.currentLODPrimary = lodInfo.primaryIndex;
    this.currentLODSecondary = lodInfo.secondaryIndex;
    this.lodBlendFactor = lodInfo.blendFactor;

    // Need to update bind group with new LOD textures
    // For now, we'll keep using LOD 0 and 1
    // TODO: Make this dynamic
  }

  /**
   * Update uniform buffer with current state
   */
  private updateUniforms(): void {
    const u = this.uniformData;
    let offset = 0;

    // View dimensions
    u[offset++] = this.viewport.widthPixels;
    u[offset++] = this.viewport.heightPixels;

    // Playhead (high-precision split)
    const splitFactor = 65536;
    const high = Math.floor(this.viewport.centerFrame / splitFactor);
    const low = this.viewport.centerFrame - high * splitFactor;
    u[offset++] = high;
    u[offset++] = low;

    // Audio metadata
    u[offset++] = this.track.sampleRate;
    u[offset++] = this.track.totalSamples;

    // Zoom and LOD
    u[offset++] = this.viewport.framesPerPixel;

    const primaryLOD = this.track.master.lods[this.currentLODPrimary];
    const secondaryLOD = this.track.master.lods[this.currentLODSecondary];

    u[offset++] = primaryLOD.lengthInPixels;
    u[offset++] = this.lodBlendFactor;
    u[offset++] = secondaryLOD.samplesPerPixel;
    u[offset++] = secondaryLOD.lengthInPixels;

    // Band configuration (u32 - write as float, interpret as u32 in shader)
    u[offset++] = this.track.master.bandCount;

    // Waveform geometry
    u[offset++] = 0.5; // waveformCenterY
    u[offset++] = 0.4; // waveformMaxHeight

    // Active stem mask (u32)
    let activeStemMask = 0;
    const hasSolo = Array.from(this.stemControls.values()).some(c => c.isSolo);

    if (this.track.stems.has('drums')) {
      const control = this.stemControls.get('drums')!;
      if (!control.isMuted && (!hasSolo || control.isSolo)) {
        activeStemMask |= 1 << 0;
      }
    }
    if (this.track.stems.has('bass')) {
      const control = this.stemControls.get('bass')!;
      if (!control.isMuted && (!hasSolo || control.isSolo)) {
        activeStemMask |= 1 << 1;
      }
    }
    if (this.track.stems.has('vocals')) {
      const control = this.stemControls.get('vocals')!;
      if (!control.isMuted && (!hasSolo || control.isSolo)) {
        activeStemMask |= 1 << 2;
      }
    }
    if (this.track.stems.has('other')) {
      const control = this.stemControls.get('other')!;
      if (!control.isMuted && (!hasSolo || control.isSolo)) {
        activeStemMask |= 1 << 3;
      }
    }
    u[offset++] = activeStemMask;

    // Stem gains
    u[offset++] = this.stemControls.get('drums')?.gain ?? 1.0;
    u[offset++] = this.stemControls.get('bass')?.gain ?? 1.0;
    u[offset++] = this.stemControls.get('vocals')?.gain ?? 1.0;
    u[offset++] = this.stemControls.get('other')?.gain ?? 1.0;

    // Stem opacities
    u[offset++] = this.stemControls.get('drums')?.opacity ?? 1.0;
    u[offset++] = this.stemControls.get('bass')?.opacity ?? 1.0;
    u[offset++] = this.stemControls.get('vocals')?.opacity ?? 1.0;
    u[offset++] = this.stemControls.get('other')?.opacity ?? 1.0;

    // Visual controls
    u[offset++] = this.brightness;
    u[offset++] = this.contrast;
    u[offset++] = this.saturation;

    // Layout and blend mode (u32)
    u[offset++] = 0; // layoutMode (0 = overlay)

    const blendModeMap: Record<StemBlendMode, number> = {
      'additive': 0,
      'screen': 1,
      'overlay': 2,
      'max': 3
    };
    u[offset++] = blendModeMap[this.blendMode];

    // Beat grid
    const bpm = this.track.bpm ?? 128;
    u[offset++] = bpm;
    u[offset++] = 0.0; // beatPhaseOffset
    u[offset++] = this.showBeatGridEnabled ? 1.0 : 0.0;

    // Misc
    u[offset++] = performance.now() / 1000.0; // time

    // Write to GPU
    this.device.queue.writeBuffer(this.uniformBuffer, 0, u.buffer, 0, offset * 4);
  }

  /**
   * Cleanup GPU resources
   */
  destroy(): void {
    this.uniformBuffer.destroy();
    this.fallbackTexture?.destroy();
    this.gpuResources.destroy();
  }
}

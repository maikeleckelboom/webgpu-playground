/**
 * WebGPU Runtime Manager
 * Manages GPU device, context, and shared resources
 */

import type { VisualContext, Dimensions } from '../types/visual-component.ts';
import { type VisualTheme, DEFAULT_THEME } from '../types/audio-state.ts';

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
    // Request adapter
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('WebGPU not supported: No adapter available');
    }

    // Request device
    this.device = await adapter.requestDevice({
      requiredFeatures: [],
      requiredLimits: {},
    });

    void this.device.lost.then((info) => {
      console.error('WebGPU device lost:', info.message);
    });

    // Configure canvas context
    this.context = this.canvas.getContext('webgpu');
    if (!this.context) {
      throw new Error('Failed to get WebGPU canvas context');
    }

    this.format = navigator.gpu.getPreferredCanvasFormat();

    // CRITICAL: Don't configure context here if canvas has zero dimensions
    // The context will be configured properly in resize() after UI is visible
    const rect = this.canvas.getBoundingClientRect();
    console.log('[GPURuntime] Initialize - canvas dimensions:', {
      clientWidth: this.canvas.clientWidth,
      clientHeight: this.canvas.clientHeight,
      rectWidth: rect.width,
      rectHeight: rect.height,
    });

    // Only configure if we have non-zero dimensions
    if (rect.width > 0 && rect.height > 0) {
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'premultiplied',
      });
    } else {
      console.warn('[GPURuntime] Skipping initial context configuration - canvas has zero dimensions');
    }

    // Create shared resources
    this.createSharedResources();

    // Initial resize - only if canvas is visible
    if (rect.width > 0 && rect.height > 0) {
      this.resize(rect.width, rect.height, window.devicePixelRatio);
    } else {
      // Set placeholder dimensions - will be updated when resize() is called after UI is shown
      this.dimensions = {
        width: 1,
        height: 1,
        dpr: window.devicePixelRatio || 1,
        physicalWidth: 1,
        physicalHeight: 1,
      };
      this.canvas.width = 1;
      this.canvas.height = 1;
    }
  }

  private createSharedResources(): void {
    if (!this.device) {throw new Error('Device not initialized');}

    // Shared uniform buffer (time, deltaTime, resolution)
    // Layout: vec4<f32> time_delta_res (time, dt, width, height)
    this.sharedUniformBuffer = this.device.createBuffer({
      size: 16, // 4 floats
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'Shared Uniforms',
    });

    // Shared bind group layout
    this.sharedBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Shared Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    // Shared bind group
    this.sharedBindGroup = this.device.createBindGroup({
      label: 'Shared Bind Group',
      layout: this.sharedBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.sharedUniformBuffer },
        },
      ],
    });
  }

  resize(width: number, height: number, dpr: number): void {
    console.log('[GPURuntime] resize() called:', { width, height, dpr });

    if (width <= 0 || height <= 0) {
      console.error('[GPURuntime] Invalid resize dimensions!', { width, height });
      return;
    }

    this.dimensions = {
      width,
      height,
      dpr,
      physicalWidth: Math.floor(width * dpr),
      physicalHeight: Math.floor(height * dpr),
    };

    this.canvas.width = this.dimensions.physicalWidth;
    this.canvas.height = this.dimensions.physicalHeight;

    console.log('[GPURuntime] Canvas physical size set to:', {
      width: this.canvas.width,
      height: this.canvas.height,
    });

    // ALWAYS reconfigure context to ensure it matches canvas size
    if (this.context && this.device) {
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'premultiplied',
      });
      console.log('[GPURuntime] WebGPU context configured successfully');
    } else {
      console.error('[GPURuntime] Cannot configure context - missing context or device!');
    }
  }

  updateSharedUniforms(time: number, deltaTime: number): void {
    if (!this.device || !this.sharedUniformBuffer) {return;}

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
    if (!this.device) {throw new Error('Device not initialized');}
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
}

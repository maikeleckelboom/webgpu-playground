/**
 * WebGPU Runtime Manager
 * Manages GPU device, context, and shared resources
 */

import type { VisualContext, SharedUniforms, Dimensions } from '../types/visual-component.ts';
import { VisualTheme, DEFAULT_THEME } from '../types/audio-state.ts';

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
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) {
      throw new Error('WebGPU not supported: No adapter available');
    }

    // Request device
    this.device = await adapter.requestDevice({
      requiredFeatures: [],
      requiredLimits: {},
    });

    this.device.lost.then((info) => {
      console.error('WebGPU device lost:', info.message);
    });

    // Configure canvas context
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

    // Create shared resources
    this.createSharedResources();

    // Initial resize
    this.resize(this.canvas.clientWidth, this.canvas.clientHeight, window.devicePixelRatio);
  }

  private createSharedResources(): void {
    if (!this.device) throw new Error('Device not initialized');

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
    this.dimensions = {
      width,
      height,
      dpr,
      physicalWidth: Math.floor(width * dpr),
      physicalHeight: Math.floor(height * dpr),
    };

    this.canvas.width = this.dimensions.physicalWidth;
    this.canvas.height = this.dimensions.physicalHeight;

    // Reconfigure context if needed
    if (this.context && this.device) {
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'premultiplied',
      });
    }
  }

  updateSharedUniforms(time: number, deltaTime: number): void {
    if (!this.device || !this.sharedUniformBuffer) return;

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
    if (!this.device) throw new Error('Device not initialized');
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

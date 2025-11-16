/**
 * Channel Meters Component
 * WebGPU-based vertical meter visualization with peak hold
 */

import type { VisualComponent, VisualContext, Dimensions } from '../types/visual-component.ts';
import type { AudioVisualState, ChannelMeter } from '../types/audio-state.ts';
import metersShaderCode from '../shaders/meters.wgsl?raw';

const METER_UNIFORMS_SIZE = 16; // 4 floats
const CHANNEL_DATA_SIZE = 32; // 8 floats per channel

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
  private peakHoldDuration = 2.0; // seconds

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

    // Update uniform buffer
    const uniformData = new Float32Array([
      this.dimensions.physicalWidth,
      this.dimensions.physicalHeight,
      this.channelCount,
      0, // padding
    ]);
    this.device.queue.writeBuffer(this.resources.uniformBuffer, 0, uniformData);

    // Update channel data with peak hold logic
    const channelData = new Float32Array(8 * this.channelCount);

    for (let i = 0; i < this.channelCount; i++) {
      let meter: ChannelMeter;

      if (i < audio.decks.length) {
        // Use deck meter data (simplified - in real app, decks would have meters)
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

      // Update peak hold
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
      channelData[i * 8 + 6] = 0; // padding
      channelData[i * 8 + 7] = 0; // padding
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

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
      // Theme is used internally but exposed through getContext after init
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

      // Get the last call (after resize)
      const lastCallIndex = writeBufferSpy.mock.calls.length - 1;
      const callArgs = writeBufferSpy.mock.calls[lastCallIndex];
      const data = callArgs[2] as Float32Array;

      expect(data[0]).toBe(0); // time
      expect(data[1]).toBeCloseTo(0.016, 4); // deltaTime (floating point precision)
      expect(data[2]).toBe(3840); // physicalWidth
      expect(data[3]).toBe(2160); // physicalHeight
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

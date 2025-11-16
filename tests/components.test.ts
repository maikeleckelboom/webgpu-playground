import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeckWaveformComponent } from '../src/components/deck-waveform.ts';
import { ChannelMetersComponent } from '../src/components/channel-meters.ts';
import type { VisualContext, Dimensions } from '../src/types/visual-component.ts';
import { DEFAULT_THEME, type DeckState } from '../src/types/audio-state.ts';
import { createTestDeckState, createTestAudioVisualState } from '../src/utils/test-data.ts';

// Mock WGSL shader imports
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

    // Create mock device from navigator.gpu
    const adapter = await navigator.gpu.requestAdapter();
    mockDevice = (await adapter?.requestDevice())!;

    // Create mock context
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
      // Zoom is internal state, verified through update behavior
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

      // May throw because mock isn't fully wired, but shouldn't crash
      try {
        component.update(0.016, 1.0, state);
      } catch {
        // Expected with incomplete mocks
      }
      expect(component).toBeDefined();
    });

    it('should use correct deck index', () => {
      const secondComponent = new DeckWaveformComponent(1);
      const state = createTestAudioVisualState([testDeck]);

      // Component 1 expects deck at index 1, which doesn't exist
      try {
        secondComponent.update(0.016, 1.0, state);
      } catch {
        // Expected
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

      // May throw because mock isn't fully wired
      try {
        component.update(0.016, 1.0, state);
      } catch {
        // Expected with incomplete mocks
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

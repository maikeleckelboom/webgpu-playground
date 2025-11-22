/**
 * GPU resource plumbing tests.
 * Uses mock GPUDevice to verify resource creation without real WebGPU.
 */

import { describe, it, expect, vi } from 'vitest';
import { createMockGPUDevice } from '../setup.ts';
import {
  createAmplitudeTexture,
  createBandTexture,
  createBindGroupLayout,
  createUniformBuffer,
  createAllLODResources,
} from '../../src/waveform/gpu-resources.ts';
import { createSyntheticWaveform } from '../../src/waveform/test-harness.ts';
import type { WaveformLOD } from '../../src/waveform/types.ts';

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
            height: 3, // bandCount
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
            // Uniform buffer
            expect.objectContaining({ binding: 0, buffer: expect.any(Object) }),
            // Primary amplitude texture
            expect.objectContaining({ binding: 1, texture: expect.any(Object) }),
            // Primary band texture
            expect.objectContaining({ binding: 2, texture: expect.any(Object) }),
            // Secondary amplitude texture
            expect.objectContaining({ binding: 3, texture: expect.any(Object) }),
            // Secondary band texture
            expect.objectContaining({ binding: 4, texture: expect.any(Object) }),
            // Sampler
            expect.objectContaining({ binding: 5, sampler: expect.any(Object) }),
          ]),
        })
      );
    });

    it('should have 6 binding entries', () => {
      const device = createMockGPUDevice();

      createBindGroupLayout(device);

      const call = vi.mocked(device.createBindGroupLayout).mock.calls[0];
      expect(call).toBeDefined();
      if (call && call[0]) {
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
          size: 80, // 20 floats * 4 bytes = 80 bytes
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
      const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

      const resources = createAllLODResources(device, pyramid, layout, uniformBuffer, sampler);

      // Should create resources for each LOD
      expect(resources.length).toBe(pyramid.lods.length);
    });

    it('should create amplitude and band textures for each LOD', () => {
      const device = createMockGPUDevice();
      const pyramid = createSyntheticWaveform(60, 44100, 128, 3);

      const layout = createBindGroupLayout(device);
      const uniformBuffer = createUniformBuffer(device);
      const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

      vi.clearAllMocks();

      createAllLODResources(device, pyramid, layout, uniformBuffer, sampler);

      // Should call createTexture twice per LOD (amplitude + bands)
      const expectedTextureCalls = pyramid.lods.length * 2;
      expect(device.createTexture).toHaveBeenCalledTimes(expectedTextureCalls);
    });

    it('should create bind group for each LOD', () => {
      const device = createMockGPUDevice();
      const pyramid = createSyntheticWaveform(60, 44100, 128, 3);

      const layout = createBindGroupLayout(device);
      const uniformBuffer = createUniformBuffer(device);
      const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

      vi.clearAllMocks();

      createAllLODResources(device, pyramid, layout, uniformBuffer, sampler);

      // Should create one bind group per LOD
      expect(device.createBindGroup).toHaveBeenCalledTimes(pyramid.lods.length);
    });

    it('should return correct structure for each resource', () => {
      const device = createMockGPUDevice();
      const pyramid = createSyntheticWaveform(60, 44100, 128, 3);

      const layout = createBindGroupLayout(device);
      const uniformBuffer = createUniformBuffer(device);
      const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

      const resources = createAllLODResources(device, pyramid, layout, uniformBuffer, sampler);

      // Each resource should have amplitudeTexture, bandTexture, and bindGroup
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

      // Clear all previous calls
      vi.clearAllMocks();

      // Create all resources in order (as the component does)
      const layout = createBindGroupLayout(device);
      const uniformBuffer = createUniformBuffer(device);
      const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
      const lodResources = createAllLODResources(device, pyramid, layout, uniformBuffer, sampler);

      // Verify the setup process
      expect(device.createBindGroupLayout).toHaveBeenCalledTimes(1);
      expect(device.createBuffer).toHaveBeenCalledTimes(1);
      expect(device.createSampler).toHaveBeenCalledTimes(1);
      expect(device.createTexture).toHaveBeenCalledTimes(pyramid.lods.length * 2);
      expect(device.createBindGroup).toHaveBeenCalledTimes(pyramid.lods.length);

      // Verify resource count
      expect(lodResources.length).toBe(7); // Default pyramid has 7 LODs
    });
  });
});

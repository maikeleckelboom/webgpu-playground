/**
 * Pure logic tests for LOD selection math.
 * These tests run in Node environment without WebGPU.
 */

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

            // At zoom 1.0: 10 seconds visible
            // 10 seconds * 44100 samples/sec / 1000 pixels = 441 samples/pixel
            expect(result).toBeCloseTo(441, 1);
        });

        it('should show more detail at higher zoom', () => {
            const viewWidth = 1000;
            const sampleRate = 44100;

            const zoom1 = calculateSamplesPerPixel(viewWidth, sampleRate, 1.0);
            const zoom2 = calculateSamplesPerPixel(viewWidth, sampleRate, 2.0);

            // Higher zoom = fewer samples per pixel (more detail)
            expect(zoom2).toBeLessThan(zoom1);
            expect(zoom2).toBeCloseTo(zoom1 / 2, 1);
        });

        it('should show less detail at lower zoom', () => {
            const viewWidth = 1000;
            const sampleRate = 44100;

            const zoom1 = calculateSamplesPerPixel(viewWidth, sampleRate, 1.0);
            const zoom05 = calculateSamplesPerPixel(viewWidth, sampleRate, 0.5);

            // Lower zoom = more samples per pixel (less detail)
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

            // Target 500 samples/pixel should select LOD with 512 samples/pixel (index 2)
            const index = selectLODIndex(pyramid, 500);
            expect(index).toBe(2);
        });

        it('should select first LOD for very high detail request', () => {
            const pyramid = createTestPyramid();

            // Target 100 samples/pixel should select first LOD (128 samples/pixel)
            const index = selectLODIndex(pyramid, 100);
            expect(index).toBe(0);
        });

        it('should select last LOD for very low detail request', () => {
            const pyramid = createTestPyramid();

            // Target 2000 samples/pixel should select last LOD (1024 samples/pixel)
            const index = selectLODIndex(pyramid, 2000);
            expect(index).toBe(3);
        });

        it('should prefer exact match if available', () => {
            const pyramid = createTestPyramid();

            // Target exactly 256 samples/pixel should select index 1
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

            // Target exactly 256 samples/pixel
            // Should bracket between 128 (index 0) and 256 (index 1)
            const blend = calculateLODBlend(pyramid, 256);

            expect(blend.primaryIndex).toBe(0);
            expect(blend.secondaryIndex).toBe(1);
            // With exact match on the upper bound, blend factor should be 1.0
            expect(blend.blendFactor).toBeCloseTo(1.0, 1);
        });

        it('should blend between two LODs for intermediate target', () => {
            const pyramid = createTestPyramid();

            // Target between 256 and 512 should blend those two LODs
            const blend = calculateLODBlend(pyramid, 384);

            expect(blend.primaryIndex).toBe(1);
            expect(blend.secondaryIndex).toBe(2);
            expect(blend.blendFactor).toBeGreaterThan(0);
            expect(blend.blendFactor).toBeLessThan(1);
        });

        it('should clamp to first LOD for very high detail', () => {
            const pyramid = createTestPyramid();

            // Target less than first LOD
            const blend = calculateLODBlend(pyramid, 64);

            expect(blend.primaryIndex).toBe(0);
            expect(blend.secondaryIndex).toBe(0);
            expect(blend.blendFactor).toBe(0);
        });

        it('should clamp to last LOD for very low detail', () => {
            const pyramid = createTestPyramid();

            // Target more than last LOD
            const blend = calculateLODBlend(pyramid, 2048);

            expect(blend.primaryIndex).toBe(3);
            expect(blend.secondaryIndex).toBe(3);
            expect(blend.blendFactor).toBe(0);
        });

        it('should use logarithmic blending for perceptual smoothness', () => {
            const pyramid = createTestPyramid();

            // Geometric mean between 256 and 512 is sqrt(256 * 512) = 362.04
            const geometricMean = Math.sqrt(256 * 512);
            const blend = calculateLODBlend(pyramid, geometricMean);

            // With log-based blending, geometric mean should give ~0.5 blend factor
            expect(blend.blendFactor).toBeCloseTo(0.5, 1);
        });
    });

    describe('splitPlayheadSamples', () => {
        it('should split small sample counts correctly', () => {
            const samples = 1000;
            const {high, low} = splitPlayheadSamples(samples);

            // Reconstruct original value
            const reconstructed = high * 65536 + low;
            expect(reconstructed).toBe(samples);
        });

        it('should split large sample counts correctly', () => {
            // 5 minutes at 44.1kHz = 13,230,000 samples
            const samples = 13230000;
            const {high, low} = splitPlayheadSamples(samples);

            // Reconstruct original value
            const reconstructed = high * 65536 + low;
            expect(reconstructed).toBe(samples);
        });

        it('should maintain precision for very large values', () => {
            // 1 hour at 44.1kHz = 158,760,000 samples
            const samples = 158760000;
            const {high, low} = splitPlayheadSamples(samples);

            // Reconstruct original value
            const reconstructed = high * 65536 + low;
            expect(reconstructed).toBe(samples);
        });

        it('should have low component less than split factor', () => {
            const samples = 1000000;
            const {low} = splitPlayheadSamples(samples);

            // Low component should always be less than 65536
            expect(low).toBeLessThan(65536);
            expect(low).toBeGreaterThanOrEqual(0);
        });
    });
});

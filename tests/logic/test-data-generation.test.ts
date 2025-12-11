/**
 * Pure logic tests for test data generation.
 * Ensures deterministic output for consistent testing.
 */

import {describe, expect, it} from 'vitest';
import {createSyntheticWaveform} from '../../src/waveform/test-harness.ts';

describe('Test Data Generation', () => {
    describe('createSyntheticWaveform', () => {
        it('should generate deterministic waveform data', () => {
            // Generate twice with same parameters
            const waveform1 = createSyntheticWaveform(60, 44100, 128, 3);
            const waveform2 = createSyntheticWaveform(60, 44100, 128, 3);

            // Should have identical structure
            expect(waveform1.totalSamples).toBe(waveform2.totalSamples);
            expect(waveform1.bandConfig.bandCount).toBe(waveform2.bandConfig.bandCount);
            expect(waveform1.lods.length).toBe(waveform2.lods.length);

            // Check first LOD data is identical
            const lod1 = waveform1.lods[0];
            const lod2 = waveform2.lods[0];

            expect(lod1.lengthInPixels).toBe(lod2.lengthInPixels);

            // Sample a few data points
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

            // Should have 7 LODs by default
            expect(waveform.lods.length).toBe(7);

            // LODs should be ordered from high detail to low detail
            const samplesPerPixelValues = waveform.lods.map((lod) => lod.samplesPerPixel);
            expect(samplesPerPixelValues).toEqual([128, 256, 512, 1024, 2048, 4096, 8192]);
        });

        it('should create correct amplitude array sizes', () => {
            const waveform = createSyntheticWaveform(60, 44100, 128, 3);

            for (const lod of waveform.lods) {
                // Amplitude should have lengthInPixels elements
                expect(lod.amplitude.length).toBe(lod.lengthInPixels);

                // All values should be in valid range [0, 1]
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
                // Band energies should have lengthInPixels * bandCount elements
                expect(lod.bandEnergies.length).toBe(lod.lengthInPixels * bandCount);

                // All values should be in valid range [0, 1]
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

            // Check first LOD has correct band energy size
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

            // Use the lowest detail LOD for pattern inspection
            const lod = waveform.lods[waveform.lods.length - 1];

            if (lod) {
                // Should have variation (not all zeros)
                const hasVariation =
                    Array.from(lod.amplitude).some((val) => val > 0.5) &&
                    Array.from(lod.amplitude).some((val) => val < 0.3);

                expect(hasVariation).toBe(true);

                // Should have a track structure (intro, buildup, drop, etc.)
                // Check that middle of track (drop) has higher amplitude than start (intro)
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

                // Extract individual band energies
                const lowBand: number[] = [];
                const midBand: number[] = [];
                const highBand: number[] = [];

                for (let i = 0; i < lod.lengthInPixels; i++) {
                    lowBand.push(lod.bandEnergies[i * bandCount + 0] ?? 0);
                    midBand.push(lod.bandEnergies[i * bandCount + 1] ?? 0);
                    highBand.push(lod.bandEnergies[i * bandCount + 2] ?? 0);
                }

                // All bands should have some energy
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

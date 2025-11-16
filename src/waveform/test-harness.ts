/**
 * Test harness for the standalone deck waveform component.
 * Creates synthetic waveform data and demonstrates the component API.
 */

import type {
  WaveformPyramid,
  WaveformLOD,
  WaveformBandConfig,
  DeckTransportState,
} from './types.ts';

import { createDeckWaveform } from './deck-waveform.ts';

// =============================================================================
// Synthetic Data Generation
// =============================================================================

/**
 * Generate synthetic band energies that simulate a beat pattern.
 * Creates low-frequency emphasis on beats, mid on off-beats, high on transients.
 */
function generateSyntheticBandEnergies(
  lengthInPixels: number,
  bandCount: number,
  samplesPerPixel: number,
  sampleRate: number,
  bpm: number
): Float32Array {
  const bandEnergies = new Float32Array(lengthInPixels * bandCount);

  const samplesPerBeat = (sampleRate * 60) / bpm;
  const _pixelsPerBeat = samplesPerBeat / samplesPerPixel; // Kept for future beat grid rendering

  for (let pixelIdx = 0; pixelIdx < lengthInPixels; pixelIdx++) {
    const samplePosition = pixelIdx * samplesPerPixel;
    const beatPhase = (samplePosition % samplesPerBeat) / samplesPerBeat;

    // Low frequency: strong on downbeats
    const low = Math.pow(Math.max(0, 1.0 - beatPhase * 4.0), 2.0) * 0.9;

    // Mid frequency: syncopated pattern
    const midPhase = beatPhase * 2.0;
    const mid = Math.pow(Math.sin(midPhase * Math.PI), 2) * 0.7;

    // High frequency: hi-hats on 8th notes
    const highPhase = beatPhase * 4.0;
    const high = Math.pow(Math.max(0, Math.sin(highPhase * Math.PI * 2)), 3) * 0.8;

    if (bandCount >= 3) {
      bandEnergies[pixelIdx * bandCount + 0] = low;
      bandEnergies[pixelIdx * bandCount + 1] = mid;
      bandEnergies[pixelIdx * bandCount + 2] = high;

      // Fill additional bands if present
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

/**
 * Generate synthetic amplitude data that represents a typical EDM track pattern.
 * Includes intro, buildup, drop, breakdown, and outro sections.
 */
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

    // Ensure we don't go beyond the track
    if (samplePosition >= totalSamples) {
      amplitude[pixelIdx] = 0;
      continue;
    }

    const currentBeat = samplePosition / samplesPerBeat;
    const beatPhase = (samplePosition % samplesPerBeat) / samplesPerBeat;

    // Track structure (4-minute EDM track @ 128 BPM = 512 beats)
    let sectionAmplitude = 0.0;
    const progressRatio = currentBeat / beatsTotal;

    if (progressRatio < 0.05) {
      // Intro fade-in
      sectionAmplitude = progressRatio / 0.05;
    } else if (progressRatio < 0.25) {
      // Build-up
      sectionAmplitude = 0.6 + (progressRatio - 0.05) * 2.0;
    } else if (progressRatio < 0.5) {
      // First drop
      sectionAmplitude = 1.0;
    } else if (progressRatio < 0.6) {
      // Breakdown
      sectionAmplitude = 0.4;
    } else if (progressRatio < 0.85) {
      // Second drop
      sectionAmplitude = 1.0;
    } else {
      // Outro fade-out
      sectionAmplitude = Math.max(0, 1.0 - (progressRatio - 0.85) / 0.15);
    }

    // Add beat transients
    const beatTransient = Math.pow(Math.max(0, 1.0 - beatPhase * 8.0), 2.0);
    const transientLevel = 0.3 * beatTransient;

    // Add some noise/variation
    const noise = (Math.sin(pixelIdx * 0.1) * 0.5 + 0.5) * 0.1;

    amplitude[pixelIdx] = Math.min(1.0, sectionAmplitude * 0.8 + transientLevel + noise);
  }

  return amplitude;
}

/**
 * Create a single LOD with synthetic data.
 */
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

/**
 * Create a complete WaveformPyramid with multiple LODs.
 */
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

  // Create LODs at different resolutions
  // From high detail (few samples per pixel) to low detail (many samples per pixel)
  const lodConfigs = [
    128,    // Very high detail (transient-level)
    256,    // High detail
    512,    // Medium-high detail
    1024,   // Medium detail
    2048,   // Medium-low detail
    4096,   // Low detail (overview)
    8192,   // Very low detail
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

// =============================================================================
// Test Harness Main Entry
// =============================================================================

interface TestHarnessState {
  waveform: ReturnType<typeof createDeckWaveform>;
  transport: DeckTransportState;
  isPlaying: boolean;
  animationFrameId: number;
  lastTime: number;
  sampleRate: number;
  totalSamples: number;
}

/**
 * Initialize and run the test harness.
 */
export function runTestHarness(
  canvas: HTMLCanvasElement,
  device: GPUDevice
): TestHarnessState {
  // Create synthetic waveform data (4-minute track @ 128 BPM, 3 bands)
  const pyramid = createSyntheticWaveform(240, 44100, 128, 3);

  // Create the waveform component
  const waveform = createDeckWaveform({
    device,
    canvas,
    waveform: pyramid,
  });

  // Initial resize
  const dpr = window.devicePixelRatio ?? 1;
  const rect = canvas.getBoundingClientRect();
  waveform.resize(rect.width, rect.height, dpr);

  // Initial transport state
  const transport: DeckTransportState = {
    playheadSamples: 0,
    rate: 1.0,
    bpm: 128,
    beatPhaseOffset: 0,
  };

  waveform.updateTransport(transport);

  // State object
  const state: TestHarnessState = {
    waveform,
    transport,
    isPlaying: false,
    animationFrameId: 0,
    lastTime: performance.now() / 1000,
    sampleRate: pyramid.bandConfig.sampleRate,
    totalSamples: pyramid.totalSamples,
  };

  // Start render loop
  const renderLoop = (): void => {
    const currentTime = performance.now() / 1000;
    const dt = currentTime - state.lastTime;
    state.lastTime = currentTime;

    // Update playhead if playing
    if (state.isPlaying) {
      const newPlayhead =
        state.transport.playheadSamples + dt * state.sampleRate * state.transport.rate;

      // Loop back to start when reaching end
      state.transport = {
        ...state.transport,
        playheadSamples: newPlayhead % state.totalSamples,
      };

      waveform.updateTransport(state.transport);
    }

    // Render frame
    waveform.frame(dt, currentTime);

    // Schedule next frame
    state.animationFrameId = requestAnimationFrame(renderLoop);
  };

  state.animationFrameId = requestAnimationFrame(renderLoop);

  return state;
}

/**
 * Toggle playback state.
 */
export function togglePlayback(state: TestHarnessState): void {
  // eslint-disable-next-line no-param-reassign
  state.isPlaying = !state.isPlaying;
}

/**
 * Set zoom level.
 */
export function setZoomLevel(state: TestHarnessState, zoom: number): void {
  state.waveform.setZoom(zoom);
}

/**
 * Seek to a specific position (0-1 range).
 */
export function seekToPosition(state: TestHarnessState, position: number): void {
  const newPlayhead = position * state.totalSamples;
  // eslint-disable-next-line no-param-reassign
  state.transport = {
    ...state.transport,
    playheadSamples: newPlayhead,
  };
  state.waveform.updateTransport(state.transport);
}

/**
 * Set playback rate.
 */
export function setPlaybackRate(state: TestHarnessState, rate: number): void {
  // eslint-disable-next-line no-param-reassign
  state.transport = {
    ...state.transport,
    rate,
  };
  state.waveform.updateTransport(state.transport);
}

/**
 * Set beat phase offset (0..1).
 * This shifts the beat grid alignment to match the actual track's first downbeat.
 */
export function setBeatPhaseOffset(state: TestHarnessState, offset: number): void {
  // Clamp to valid range [0, 1)
  const normalizedOffset = ((offset % 1) + 1) % 1;
  // eslint-disable-next-line no-param-reassign
  state.transport = {
    ...state.transport,
    beatPhaseOffset: normalizedOffset,
  };
  state.waveform.updateTransport(state.transport);
}

/**
 * Clean up the test harness.
 */
export function destroyTestHarness(state: TestHarnessState): void {
  cancelAnimationFrame(state.animationFrameId);
  state.waveform.destroy();
}

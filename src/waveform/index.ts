/**
 * WebGPU Deck Waveform Component
 *
 * A reusable, standalone WebGPU-based waveform visualization component
 * featuring centered playhead rendering and multi-band frequency coloring.
 */

// Public API
export { createDeckWaveform } from './deck-waveform.ts';

// Types
export type {
  // Core data model
  WaveformBandConfig,
  WaveformLOD,
  WaveformPyramid,
  DeckTransportState,

  // Component API
  DeckWaveformOptions,
  DeckWaveform,

  // Factory function type
  CreateDeckWaveform,
} from './types.ts';

// Test harness utilities (optional)
export {
  createSyntheticWaveform,
  runTestHarness,
  togglePlayback,
  setZoomLevel,
  seekToPosition,
  setPlaybackRate,
  destroyTestHarness,
} from './test-harness.ts';

// GPU resource utilities (advanced usage)
export {
  selectLODIndex,
  calculateSamplesPerPixel,
} from './gpu-resources.ts';

/**
 * Type definitions for the standalone WebGPU deck waveform component.
 * These types define the contract for waveform data and component API.
 */

// =============================================================================
// Waveform Data Model
// =============================================================================

export interface WaveformBandConfig {
  readonly bandCount: number;       // e.g. 3 (low/mid/high), 8, or 16
  readonly sampleRate: number;      // source audio sample rate
}

/**
 * One level-of-detail (LOD) slice of the waveform analysis.
 * Each "pixel" is a small time window; amplitude & bandEnergies are already aggregated.
 */
export interface WaveformLOD {
  readonly samplesPerPixel: number; // how many audio samples collapsed into one visual "column"
  readonly lengthInPixels: number;  // number of columns in this LOD

  /**
   * Amplitude per column, linear 0..1 (or pre-shaped by analyser).
   * Length MUST be lengthInPixels.
   */
  readonly amplitude: Float32Array;

  /**
   * Band energies per column.
   * Layout: interleaved by band:
   *   index = pixelIndex * bandCount + bandIndex
   * Length MUST be lengthInPixels * bandCount.
   * Values are typically 0..1 (already normalized/clipped).
   */
  readonly bandEnergies: Float32Array;
}

/**
 * Multi-resolution waveform representation for a single track.
 */
export interface WaveformPyramid {
  readonly totalSamples: number;                  // full track length in samples
  readonly bandConfig: WaveformBandConfig;
  readonly lods: readonly WaveformLOD[];         // sorted from highest detail to lowest
}

/**
 * Real-time transport information for one deck.
 * This is updated by the audio engine and fed into the visual component.
 */
export interface DeckTransportState {
  readonly playheadSamples: number;  // can grow large; treat precision carefully
  readonly rate: number;             // playback rate (1.0 = "normal speed")
  readonly bpm: number;              // for future grid/beat-aware visuals
}

// =============================================================================
// Component API Types
// =============================================================================

export interface DeckWaveformOptions {
  readonly device: GPUDevice;              // already created WebGPU device
  readonly canvas: HTMLCanvasElement;      // canvas to own and render into
  readonly waveform: WaveformPyramid;      // static waveform data for the track
}

export interface DeckWaveform {
  /** Update transport state (e.g. from AudioWorklet / shared memory snapshot). */
  updateTransport(state: DeckTransportState): void;

  /** Set a zoom factor; you define the mapping to samplesPerPixel / LOD. */
  setZoom(zoom: number): void;

  /** Handle canvas resize including device pixel ratio. */
  resize(width: number, height: number, dpr: number): void;

  /** Called from requestAnimationFrame: dt in seconds, time in seconds. */
  frame(dt: number, time: number): void;

  /** Free GPU resources, stop using canvas. */
  destroy(): void;
}

// =============================================================================
// Internal GPU Types
// =============================================================================

/**
 * GPU-side uniform buffer layout.
 * Must match the WGSL struct WaveUniforms exactly.
 *
 * Note: playheadSamples is split into high/low components for better precision
 * when dealing with long tracks (>5min at 44.1kHz = >13M samples).
 * f32 only has 24 bits of mantissa, so we split into two floats.
 */
export interface WaveUniformsData {
  viewWidth: number;
  viewHeight: number;
  playheadSamplesHigh: number;  // High-order component (floor division by 2^16)
  playheadSamplesLow: number;   // Low-order component (remainder)
  sampleRate: number;
  rate: number;                 // playback rate
  zoomLevel: number;            // dimensionless zoom factor
  samplesPerPixel: number;      // current LOD's samples per pixel
  lodLengthInPixels: number;
  totalSamples: number;         // total track length for boundary clamping
  bandCount: number;
  waveformCenterY: number;      // vertical center of waveform (0..1)
  waveformMaxHeight: number;    // max vertical extent (0..1)
  time: number;                 // current time in seconds
  // Additional padding to reach 16-byte alignment (64 bytes total = 16 floats)
}

/**
 * Per-LOD GPU resources (textures for amplitude and band energies).
 */
export interface LODGPUResources {
  readonly amplitudeTexture: GPUTexture;
  readonly bandTexture: GPUTexture;
  readonly bindGroup: GPUBindGroup;
}

/**
 * Factory function type for creating the deck waveform component.
 */
export type CreateDeckWaveform = (options: DeckWaveformOptions) => DeckWaveform;

/**
 * Stem-Aware Deck HUD - Type Definitions
 *
 * These interfaces define the DATA CONTRACT between:
 * - Audio analysis libraries (FFT, beat detection, stem separation) - can be WASM plugins
 * - WebGPU rendering system (consumes this data to draw visuals)
 *
 * The rendering system doesn't care HOW data is generated, only that it matches these formats.
 */

// ============================================================================
// CORE DATA CONTRACTS (What the GPU expects)
// ============================================================================

/**
 * Stem types - standard taxonomy
 */
export type StemType = 'drums' | 'bass' | 'vocals' | 'other' | 'master';

/**
 * Stem identifier (alias for StemType)
 */
export type StemId = StemType;

/**
 * Band identifier (numeric index into frequency bands)
 */
export type BandId = number;

/**
 * Single LOD level waveform data
 *
 * This is the fundamental unit - GPU renderer needs this format.
 * Audio analysis libraries must output data matching this structure.
 */
export interface WaveformLODData {
  /** Samples averaged per visual pixel at this LOD level */
  readonly samplesPerPixel: number;

  /** Number of visual columns in this LOD */
  readonly lengthInPixels: number;

  /**
   * Amplitude envelope: min/max pairs
   * Length: lengthInPixels * 2
   * Format: [min0, max0, min1, max1, ...]
   * Range: [-1.0, 1.0] normalized
   */
  readonly amplitude: Float32Array;

  /**
   * Band energies: interleaved by band
   * Length: lengthInPixels * bandCount
   * Format: [b0_0, b1_0, ..., bN_0, b0_1, b1_1, ..., bN_1, ...]
   * Range: [0.0, 1.0] normalized RMS energy
   */
  readonly bandEnergies: Float32Array;

  /**
   * Optional: RMS energy per window
   * Length: lengthInPixels
   */
  readonly rms?: Float32Array;

  /**
   * Optional: Spectral centroid (brightness measure)
   * Length: lengthInPixels
   */
  readonly spectralCentroid?: Float32Array;
}

/**
 * Multi-resolution waveform pyramid for a single stem
 *
 * Contains 7 LOD levels for smooth zooming
 */
export interface StemWaveformPyramid {
  /** Which stem this represents */
  readonly stemType: StemType;

  /** Total audio samples in source */
  readonly totalSamples: number;

  /** Audio sample rate (e.g., 44100) */
  readonly sampleRate: number;

  /** LOD levels: [64, 128, 256, 512, 1024, 2048, 4096] samples per pixel */
  readonly lods: readonly WaveformLODData[];

  /** Number of frequency bands */
  readonly bandCount: number;
}

/**
 * Complete multi-stem track
 *
 * This is what the renderer receives after audio analysis is complete.
 */
export interface MultiStemTrack {
  readonly id: string;
  readonly totalSamples: number;
  readonly sampleRate: number;
  readonly duration: number; // seconds

  /**
   * Per-stem waveform pyramids
   *
   * Keys: 'drums', 'bass', 'vocals', 'other'
   * If stems not available, only 'master' will be present
   */
  readonly stems: ReadonlyMap<StemType, StemWaveformPyramid>;

  /**
   * Master mix (always present as fallback)
   */
  readonly master: StemWaveformPyramid;

  // Metadata
  readonly trackTitle: string;
  readonly trackArtist: string;
  readonly trackKey?: string;
  readonly bpm?: number;
}

// ============================================================================
// BAND CONFIGURATION (Pluggable)
// ============================================================================

/**
 * Frequency range definition
 */
export interface FrequencyRange {
  readonly min: number; // Hz
  readonly max: number; // Hz
  readonly name: string; // Display name
}

/**
 * Multi-band configuration
 *
 * This tells the audio analyzer HOW to split frequencies.
 * The renderer just needs to know bandCount.
 */
export interface MultiBandConfig {
  readonly bandCount: number; // 3, 8, or 16
  readonly sampleRate: number;
  readonly frequencyRanges: readonly FrequencyRange[];
}

// Preset configurations
export const BANDS_3: MultiBandConfig = {
  bandCount: 3,
  sampleRate: 44100,
  frequencyRanges: [
    { min: 20, max: 250, name: 'Low' },
    { min: 250, max: 4000, name: 'Mid' },
    { min: 4000, max: 20000, name: 'High' }
  ]
};

export const BANDS_8: MultiBandConfig = {
  bandCount: 8,
  sampleRate: 44100,
  frequencyRanges: [
    { min: 20, max: 60, name: 'Sub-bass' },
    { min: 60, max: 250, name: 'Bass' },
    { min: 250, max: 500, name: 'Low-mid' },
    { min: 500, max: 2000, name: 'Mid' },
    { min: 2000, max: 4000, name: 'Upper-mid' },
    { min: 4000, max: 6000, name: 'Presence' },
    { min: 6000, max: 12000, name: 'Brilliance' },
    { min: 12000, max: 20000, name: 'Air' }
  ]
};

export const BANDS_16: MultiBandConfig = {
  bandCount: 16,
  sampleRate: 44100,
  frequencyRanges: [
    { min: 20, max: 40, name: 'Sub 1' },
    { min: 40, max: 80, name: 'Sub 2' },
    { min: 80, max: 160, name: 'Bass 1' },
    { min: 160, max: 320, name: 'Bass 2' },
    { min: 320, max: 640, name: 'Low-mid 1' },
    { min: 640, max: 1280, name: 'Low-mid 2' },
    { min: 1280, max: 2560, name: 'Mid 1' },
    { min: 2560, max: 5120, name: 'Mid 2' },
    { min: 5120, max: 6400, name: 'Upper-mid' },
    { min: 6400, max: 8000, name: 'Presence 1' },
    { min: 8000, max: 10000, name: 'Presence 2' },
    { min: 10000, max: 12000, name: 'Brilliance 1' },
    { min: 12000, max: 14000, name: 'Brilliance 2' },
    { min: 14000, max: 16000, name: 'Air 1' },
    { min: 16000, max: 18000, name: 'Air 2' },
    { min: 18000, max: 20000, name: 'Air 3' }
  ]
};

// ============================================================================
// STEM PLAYBACK STATE (Renderer Control Knobs)
// ============================================================================

/**
 * Visual blend modes for stem compositing
 */
export type StemBlendMode = 'additive' | 'screen' | 'overlay' | 'max';

/**
 * Stem layout modes
 */
export type StemLayoutMode = 'overlay' | 'stacked' | 'focus' | 'compare';

/**
 * Per-stem visual state (control knobs)
 */
export interface StemVisualState {
  readonly stemType: StemType;
  readonly isSolo: boolean;
  readonly isMuted: boolean;
  readonly gain: number; // 0.0 - 2.0
  readonly opacity: number; // 0.0 - 1.0
  readonly color: { r: number; g: number; b: number }; // Base tint
}

/**
 * Complete stem deck visual configuration
 */
export interface StemDeckVisualConfig {
  /** Active stems to render */
  readonly activeStems: Set<StemType>;

  /** Per-stem visual states */
  readonly stemStates: ReadonlyMap<StemType, StemVisualState>;

  /** Layout mode */
  readonly layoutMode: StemLayoutMode;

  /** Blend mode */
  readonly blendMode: StemBlendMode;

  /** Number of bands to render */
  readonly bandCount: number;

  /** Show beat grid overlay */
  readonly showBeatGrid: boolean;

  /** Show cue point markers */
  readonly showCuePoints: boolean;
}

// ============================================================================
// BEAT GRID DATA (From external beat detection)
// ============================================================================

/**
 * Beat grid information
 *
 * External beat detection library outputs this.
 */
export interface BeatGridData {
  readonly bpm: number;
  readonly beatPhaseOffset: number; // [0, 1) - where first beat lands
  readonly timeSignature: { numerator: number; denominator: number }; // e.g., 4/4

  /** Optional: explicit beat positions in samples */
  readonly beatPositions?: readonly number[];

  /** Optional: downbeat (bar start) positions */
  readonly barPositions?: readonly number[];
}

// ============================================================================
// CUE POINTS & MARKERS (User/auto-generated)
// ============================================================================

export type CueType = 'hot' | 'loop_in' | 'loop_out' | 'load' | 'section' | 'custom';

export interface CuePoint {
  readonly id: string;
  readonly samplePosition: number;
  readonly type: CueType;
  readonly label: string;
  readonly color: { r: number; g: number; b: number };
}

export interface SectionMarker {
  readonly id: string;
  readonly startSample: number;
  readonly endSample: number;
  readonly label: string; // "Intro", "Verse", "Drop", etc.
  readonly color: { r: number; g: number; b: number };
}

export interface LoopRegion {
  readonly inPoint: number; // sample position
  readonly outPoint: number; // sample position
  readonly isActive: boolean;
}

// ============================================================================
// TRANSPORT STATE (Playback position/tempo)
// ============================================================================

export interface DeckTransportState {
  readonly playheadSamples: number; // Current position
  readonly rate: number; // Playback rate (1.0 = normal)
  readonly isPlaying: boolean;
  readonly isSlipMode: boolean;
  readonly slipPlayheadSamples: number;

  // Beat-aware state (from BeatGridData)
  readonly beatPhase: number; // [0, 1) within current beat
  readonly barIndex: number; // Current bar number
  readonly beatInBar: number; // [0, N-1] beat within bar
}

// ============================================================================
// COMPLETE DECK STATE (Everything the renderer needs)
// ============================================================================

export interface StemDeckState {
  readonly id: string;

  /** Audio data */
  readonly track: MultiStemTrack;

  /** Transport/playback */
  readonly transport: DeckTransportState;

  /** Visual configuration */
  readonly visual: StemDeckVisualConfig;

  /** Beat grid */
  readonly beatGrid?: BeatGridData;

  /** Cue points */
  readonly cuePoints: readonly CuePoint[];

  /** Section markers */
  readonly sections: readonly SectionMarker[];

  /** Loop region */
  readonly loop?: LoopRegion;

  /** Zoom level (1.0 = default, 2.0 = 2x zoomed) */
  readonly zoom: number;

  /** Metadata */
  readonly trackTitle: string;
  readonly trackArtist: string;
}

// ============================================================================
// PLUGIN INTERFACE (For external audio analysis)
// ============================================================================

/**
 * Audio analysis plugin interface
 *
 * External libraries (WASM FFT, beat detection, stem separation) implement this.
 * The renderer doesn't care about implementation, just that output matches the contract.
 */
export interface AudioAnalysisPlugin {
  readonly name: string;
  readonly version: string;

  /**
   * Analyze PCM audio and produce waveform pyramid
   */
  analyze(
    pcmData: Float32Array,
    sampleRate: number,
    config: MultiBandConfig
  ): Promise<StemWaveformPyramid>;

  /**
   * Detect beats and tempo
   */
  detectBeats?(
    pcmData: Float32Array,
    sampleRate: number
  ): Promise<BeatGridData>;

  /**
   * Separate audio into stems
   */
  separateStems?(
    pcmData: Float32Array,
    sampleRate: number
  ): Promise<Map<StemType, Float32Array>>;
}

/**
 * Plugin registry
 */
export interface PluginRegistry {
  registerAnalyzer(plugin: AudioAnalysisPlugin): void;
  getAnalyzer(name: string): AudioAnalysisPlugin | undefined;
  listAnalyzers(): readonly string[];
}

// ============================================================================
// GPU RESOURCE HANDLES (What renderer creates internally)
// ============================================================================

/**
 * GPU texture handles for a single stem LOD level
 *
 * Internal to renderer - not part of public API
 */
export interface StemLODTextures {
  readonly amplitudeTexture: GPUTexture;
  readonly bandsTexture: GPUTexture;
}

/**
 * GPU resources for one stem (all LOD levels)
 */
export interface StemGPUResources {
  readonly stemType: StemType;
  readonly lodTextures: readonly StemLODTextures[];
  readonly bindGroup: GPUBindGroup;
}

// ============================================================================
// KNOB CONTROL VALUES (For UI sliders/controls)
// ============================================================================

/**
 * User-facing control knob values
 *
 * UI widgets bind to these, renderer reads from them.
 */
export interface WaveformKnobs {
  // Color controls
  readonly brightness: number; // 0.0 - 2.0
  readonly contrast: number; // 0.0 - 2.0
  readonly saturation: number; // 0.0 - 2.0

  // Band gains (per frequency band)
  readonly bandGains: readonly number[]; // Length = bandCount, range 0.0 - 2.0

  // Waveform shape
  readonly waveformHeight: number; // 0.1 - 1.0
  readonly waveformSharpness: number; // 0.0 - 1.0 (anti-alias amount)

  // Grid
  readonly beatGridIntensity: number; // 0.0 - 1.0
  readonly showBarLines: boolean;
}

export interface StemKnobs {
  // Per-stem knobs
  readonly drums: WaveformKnobs;
  readonly bass: WaveformKnobs;
  readonly vocals: WaveformKnobs;
  readonly other: WaveformKnobs;

  // Global
  readonly masterBrightness: number;
  readonly blendMode: StemBlendMode;
}

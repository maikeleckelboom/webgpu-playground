/**
 * Core audio visualization state types
 * These types define the contract between the audio engine and the visualization system
 */

// =============================================================================
// Waveform Analysis Types
// =============================================================================

export interface WaveformBandConfig {
  readonly bandCount: number; // e.g., 3 (low/mid/high), 8, or 16
  readonly sampleRate: number;
  readonly frequencyRanges: readonly { min: number; max: number }[];
}

export interface WaveformLOD {
  readonly samplesPerPixel: number;
  readonly lengthInPixels: number;
  // Amplitude envelope per pixel (min/max pairs for each pixel)
  readonly amplitude: Float32Array; // length = lengthInPixels * 2 (min, max)
  // Band energies per pixel, interleaved: [b0_p0, b1_p0, b2_p0, b0_p1, ...]
  readonly bandEnergies: Float32Array; // length = lengthInPixels * bandCount
}

export interface WaveformPyramid {
  readonly totalSamples: number;
  readonly sampleRate: number;
  readonly lods: readonly WaveformLOD[];
  readonly bands: WaveformBandConfig;
}

// =============================================================================
// Deck Transport & State
// =============================================================================

export interface DeckTransportState {
  readonly playheadSamples: number; // Current position in samples (may be large)
  readonly rate: number; // Playback rate (1.0 = normal, 2.0 = double speed)
  readonly bpm: number; // Beats per minute
  readonly beatPhase: number; // Current beat phase [0, 1)
  readonly barIndex: number; // Current bar number
  readonly beatInBar: number; // Beat within current bar [0, 3] for 4/4
  readonly isPlaying: boolean;
  readonly isSlipMode: boolean;
  readonly slipPlayheadSamples: number; // Original timeline position during slip
}

export interface LoopState {
  readonly active: boolean;
  readonly inSample: number;
  readonly outSample: number;
}

export interface CuePoint {
  readonly id: string;
  readonly samplePosition: number;
  readonly color: readonly [number, number, number]; // RGB [0-255]
  readonly label: string;
}

export interface SectionMarker {
  readonly startSample: number;
  readonly endSample: number;
  readonly type: 'intro' | 'verse' | 'chorus' | 'breakdown' | 'drop' | 'outro' | 'bridge';
  readonly label: string;
}

export interface DeckState {
  readonly id: string;
  readonly transport: DeckTransportState;
  readonly loop: LoopState;
  readonly cuePoints: readonly CuePoint[];
  readonly sections: readonly SectionMarker[];
  readonly waveform: WaveformPyramid;
  readonly trackTitle: string;
  readonly trackArtist: string;
  readonly trackKey: string;
  readonly trackDurationSamples: number;
}

// =============================================================================
// Meter & Analysis Types
// =============================================================================

export interface ChannelMeter {
  readonly rms: number; // RMS level [0, 1]
  readonly peak: number; // Peak level [0, 1]
  readonly peakHold: number; // Peak hold level [0, 1]
  readonly lufs: number; // Loudness units (dB)
  readonly lowEnergy: number; // Low band energy [0, 1]
  readonly midEnergy: number; // Mid band energy [0, 1]
  readonly highEnergy: number; // High band energy [0, 1]
}

export interface MasterMeter extends ChannelMeter {
  readonly leftPeak: number;
  readonly rightPeak: number;
  readonly correlation: number; // Stereo correlation [-1, 1]
}

// =============================================================================
// Complete Audio Visual State
// =============================================================================

export interface AudioVisualState {
  readonly time: number; // Current time in seconds (monotonic)
  readonly deltaTime: number; // Time since last frame
  readonly decks: readonly DeckState[];
  readonly master: MasterMeter;
  readonly crossfaderPosition: number; // [-1, 1] where -1 is deck A, 1 is deck B
}

// =============================================================================
// Visual Component Configuration
// =============================================================================

export interface VisualTheme {
  readonly backgroundColor: readonly [number, number, number, number];
  readonly waveformColors: {
    readonly low: readonly [number, number, number];
    readonly mid: readonly [number, number, number];
    readonly high: readonly [number, number, number];
  };
  readonly playheadColor: readonly [number, number, number, number];
  readonly beatGridColor: readonly [number, number, number, number];
  readonly beatGridStrongColor: readonly [number, number, number, number];
  readonly loopColor: readonly [number, number, number, number];
}

export const DEFAULT_THEME: VisualTheme = {
  backgroundColor: [13 / 255, 13 / 255, 18 / 255, 1.0],
  waveformColors: {
    low: [255 / 255, 100 / 255, 50 / 255], // Warm red/orange
    mid: [100 / 255, 255 / 255, 100 / 255], // Green
    high: [100 / 255, 200 / 255, 255 / 255], // Cyan
  },
  playheadColor: [1.0, 1.0, 1.0, 0.9],
  beatGridColor: [0.3, 0.3, 0.4, 0.5],
  beatGridStrongColor: [0.5, 0.5, 0.6, 0.8],
  loopColor: [0.2, 0.6, 0.2, 0.3],
};

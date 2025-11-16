/**
 * Visual component interface and context types
 * Defines the contract for all WebGPU visual components
 */

import type { AudioVisualState, VisualTheme } from './audio-state.ts';

// =============================================================================
// WebGPU Context and Shared Resources
// =============================================================================

export interface Dimensions {
  readonly width: number; // Logical width
  readonly height: number; // Logical height
  readonly dpr: number; // Device pixel ratio
  readonly physicalWidth: number; // Physical width (width * dpr)
  readonly physicalHeight: number; // Physical height (height * dpr)
}

export interface SharedUniforms {
  readonly time: number;
  readonly deltaTime: number;
  readonly resolution: readonly [number, number];
  readonly theme: VisualTheme;
}

export interface VisualContext {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly theme: VisualTheme;
  readonly sharedUniformBuffer: GPUBuffer;
  readonly sharedBindGroupLayout: GPUBindGroupLayout;
  readonly sharedBindGroup: GPUBindGroup;
}

// =============================================================================
// Visual Component Interface
// =============================================================================

export interface VisualComponent {
  readonly id: string;

  /**
   * Initialize GPU resources (pipelines, buffers, textures)
   * Called once after component creation
   */
  initialize(device: GPUDevice, ctx: VisualContext): Promise<void> | void;

  /**
   * Handle canvas resize
   * Called when the canvas size changes
   */
  resize(dim: Dimensions): void;

  /**
   * Update component state based on audio state
   * Called once per frame before encode
   */
  update(dt: number, time: number, audio: AudioVisualState): void;

  /**
   * Encode GPU commands for rendering
   * Called once per frame to render the component
   */
  encode(encoder: GPUCommandEncoder, view: GPUTextureView): void;

  /**
   * Clean up GPU resources
   * Called when component is destroyed
   */
  destroy(): void;
}

// =============================================================================
// Component-Specific Props
// =============================================================================

export interface DeckWaveformProps {
  readonly deckIndex: number;
  readonly showBeatGrid: boolean;
  readonly showCuePoints: boolean;
  readonly showLoopRegion: boolean;
  readonly showSlipGhost: boolean;
}

export interface WaveformKnobState {
  readonly lowGain: number; // [0, 2]
  readonly midGain: number; // [0, 2]
  readonly highGain: number; // [0, 2]
  readonly brightness: number; // [0, 2]
  readonly contrast: number; // [0, 2]
  readonly saturation: number; // [0, 2]
}

export interface MeterProps {
  readonly channelCount: number;
  readonly showPeakHold: boolean;
  readonly showSpectralBands: boolean;
}

export interface OverviewProps {
  readonly deckIndex: number;
  readonly showSections: boolean;
  readonly showCuePoints: boolean;
}

// =============================================================================
// Deck Waveform Controller Interface
// =============================================================================

export interface DeckWaveformController {
  setZoom(zoom: number): void;
  setKnobState(state: Partial<WaveformKnobState>): void;
  getKnobState(): WaveformKnobState;
  setShowBeatGrid(show: boolean): void;
  setShowCuePoints(show: boolean): void;
  setShowLoopRegion(show: boolean): void;
}

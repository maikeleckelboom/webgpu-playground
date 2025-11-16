# WebGPU DJ Waveform Visualization Suite

A professional-grade, real-time audio visualization system built entirely with WebGPU and TypeScript. This project implements DJ-style deck waveforms with frequency-colored bands, similar to those found in Serato DJ Pro, Traktor, and Engine DJ.

## Features

### Core Components

- **Real-Time Deck Waveform** - Horizontal scrolling waveform with center-fixed playhead
  - Frequency-colored bands (low/mid/high)
  - Multi-resolution LOD (Level of Detail) system
  - Beat grid overlay
  - Loop region visualization
  - Smooth zoom from transient-level to full-track view

- **Track Overview** - Compact full-track waveform
  - Shows entire track at a glance
  - Playhead position indicator
  - Played/unplayed section distinction
  - Loop region highlighting

- **Channel Meters** - Vertical bar meters with peak hold
  - RMS and peak level display
  - Per-band spectral energy (low/mid/high)
  - Color-coded levels (green → yellow → red)
  - Clipping indicators

- **Control Knobs** - WebGPU-rendered parameter controls
  - SDF-based circular knobs
  - Per-band gain control
  - Brightness/contrast/saturation adjustments

## Architecture

```
src/
├── types/
│   ├── audio-state.ts       # Core data types (WaveformPyramid, DeckState, etc.)
│   └── visual-component.ts  # Component interfaces and GPU context types
├── core/
│   └── gpu-runtime.ts       # WebGPU device/context management
├── components/
│   ├── deck-waveform.ts     # Main waveform visualization
│   ├── track-overview.ts    # Mini waveform timeline
│   └── channel-meters.ts    # Level meters with spectral bands
├── shaders/
│   ├── waveform.wgsl        # Frequency-colored waveform shader
│   ├── overview.wgsl        # Track overview shader
│   ├── knobs.wgsl           # SDF-based knob rendering
│   └── meters.wgsl          # Channel meter shader
├── utils/
│   └── test-data.ts         # Synthetic data generator for testing
└── main.ts                  # Application entry point
```

## Technical Highlights

### GPU Data Model

The system uses a pyramid of pre-computed waveform data:

```typescript
interface WaveformPyramid {
  totalSamples: number;
  sampleRate: number;
  lods: WaveformLOD[];        // Multiple resolutions
  bands: WaveformBandConfig;  // Frequency band configuration
}

interface WaveformLOD {
  samplesPerPixel: number;
  lengthInPixels: number;
  amplitude: Float32Array;    // min/max pairs per pixel
  bandEnergies: Float32Array; // Interleaved low/mid/high per pixel
}
```

### Shader Strategy

- **Texture-based rendering**: Waveform data uploaded as 1D textures (RG32Float for amplitude, RGBA32Float for bands)
- **Center-playhead mapping**: Fragment shader computes sample position relative to center playhead
- **High-precision playhead**: Uses split high/low floats for sample-accurate positioning
- **Band color mapping**: Normalized band energies mapped to warm (low) → green (mid) → cyan (high)

### Performance Considerations

- LOD selection based on zoom level to optimize GPU sampling
- Single render pass for waveform + overlays
- Shared uniform buffers across components
- Smooth interpolation via GPU sampler (linear filtering)

## Getting Started

### Prerequisites

- Modern browser with WebGPU support (Chrome 113+, Edge 113+)
- Node.js 18+

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Opens development server at `http://localhost:3000`

### Build

```bash
npm run build
```

### Type Checking

```bash
npm run typecheck
```

## Usage

### Basic Interaction

- **Mouse Wheel**: Zoom in/out (centered on playhead)
- **Click on Waveform**: Seek to position
- **Sliders**: Adjust zoom and band gains
- **Play/Pause**: Toggle playback simulation
- **Loop**: Toggle loop region

### Integrating with Real Audio

The visualization system expects pre-analyzed data. To integrate with a real audio engine:

1. **Implement FFT analysis** to compute band energies
2. **Generate LOD pyramid** with downsampled amplitude/band data
3. **Update transport state** each frame with real playhead position

```typescript
// Example integration
const deckState: DeckState = {
  id: 'deck-a',
  transport: {
    playheadSamples: audioContext.currentTime * sampleRate,
    rate: 1.0,
    bpm: analyzedBPM,
    // ... other transport info
  },
  waveform: precomputedPyramid,
  // ... other state
};
```

## Future Enhancements

### Planned Features

1. **Geometry-based waveform rendering** - Instanced quads for better antialiasing
2. **Compute shader LOD generation** - GPU-accelerated downsampling
3. **Slip mode ghost waveform** - Overlay showing original timeline
4. **Cue point markers** - Colored vertical indicators with labels
5. **Stacked multi-deck view** - Compare waveforms across decks
6. **Spectral landscape** - 3D energy heightfield visualization

### Performance Optimizations

- Pack multiple LODs into single texture atlas
- Batch marker rendering into single instanced draw
- Implement viewport culling for off-screen elements
- Add GPU-side beat detection

## Dependencies

- **@webgpu/types**: TypeScript definitions for WebGPU API
- **TypeScript**: Strict mode, no `any`
- **Vite**: Fast build tooling with hot reload

## Browser Support

WebGPU is currently supported in:
- Chrome 113+ (stable)
- Edge 113+ (stable)
- Firefox Nightly (experimental)
- Safari Technology Preview (experimental)

Check [caniuse.com/webgpu](https://caniuse.com/webgpu) for latest support status.

## License

MIT

## Acknowledgments

Inspired by the waveform visualizations in:
- Serato DJ Pro
- Native Instruments Traktor
- Denon Engine DJ
- Rekordbox

Built with modern WebGPU for performance and visual quality that rivals native applications.

/**
 * Main Application Entry Point
 * WebGPU DJ Waveform Visualization Demo
 */

import { GPURuntime } from './core/gpu-runtime.ts';
import { DeckWaveformComponent } from './components/deck-waveform.ts';
import { ChannelMetersComponent } from './components/channel-meters.ts';
import {
  createTestDeckState,
  createTestAudioVisualState,
  updateTransportPlayback,
} from './utils/test-data.ts';
import type { DeckState, AudioVisualState } from './types/audio-state.ts';

class DJVisualizationApp {
  private runtime: GPURuntime | null = null;
  private waveformComponent: DeckWaveformComponent | null = null;
  private metersComponent: ChannelMetersComponent | null = null;

  private deckState: DeckState;
  private audioState: AudioVisualState;

  private isPlaying = false;
  private loopActive = false;
  private animationFrameId = 0;
  private lastTime = 0;

  private deckCanvas: HTMLCanvasElement;
  private metersCanvas: HTMLCanvasElement;

  constructor() {
    // Get canvas elements
    const deckCanvas = document.getElementById('deck-a') as HTMLCanvasElement | null;
    const metersCanvas = document.getElementById('meters') as HTMLCanvasElement | null;

    if (!deckCanvas || !metersCanvas) {
      throw new Error('Canvas elements not found');
    }

    this.deckCanvas = deckCanvas;
    this.metersCanvas = metersCanvas;

    // Create test deck state
    this.deckState = createTestDeckState({
      durationSeconds: 240, // 4 minute track
      sampleRate: 44100,
      bpm: 128,
      key: 'Am',
      title: 'Test Track',
      artist: 'Test Artist',
    });

    this.audioState = createTestAudioVisualState([this.deckState]);
  }

  async initialize(): Promise<void> {
    // Check WebGPU support
    if (!navigator.gpu) {
      this.showError('WebGPU is not supported in your browser. Please use Chrome 113+ or Edge 113+.');
      return;
    }

    try {
      // Initialize deck waveform runtime
      this.runtime = new GPURuntime({ canvas: this.deckCanvas });
      await this.runtime.initialize();

      const ctx = this.runtime.getContext();

      // Create and initialize waveform component
      this.waveformComponent = new DeckWaveformComponent(0);
      await this.waveformComponent.initialize(this.runtime.getDevice(), ctx);

      // Create meters runtime (separate canvas)
      const metersRuntime = new GPURuntime({ canvas: this.metersCanvas });
      await metersRuntime.initialize();

      this.metersComponent = new ChannelMetersComponent(2);
      await this.metersComponent.initialize(metersRuntime.getDevice(), metersRuntime.getContext());

      // Set up event handlers
      this.setupEventHandlers();

      // Handle resize
      this.handleResize();
      window.addEventListener('resize', () => { this.handleResize(); });

      // Start render loop
      this.lastTime = performance.now() / 1000;
      this.render();

      // Update info display
      this.updateInfoDisplay();

      console.log('WebGPU DJ Visualization initialized successfully');
    } catch (error) {
      console.error('Failed to initialize WebGPU:', error);
      this.showError(`Failed to initialize WebGPU: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private setupEventHandlers(): void {
    // Zoom control
    const zoomSlider = document.getElementById('zoom-a') as HTMLInputElement | null;
    if (zoomSlider && this.waveformComponent) {
      zoomSlider.addEventListener('input', () => {
        const zoom = parseFloat(zoomSlider.value);
        this.waveformComponent?.setZoom(zoom);
      });
    }

    // Band gain controls
    const lowGainSlider = document.getElementById('low-gain-a') as HTMLInputElement | null;
    const midGainSlider = document.getElementById('mid-gain-a') as HTMLInputElement | null;
    const highGainSlider = document.getElementById('high-gain-a') as HTMLInputElement | null;

    if (lowGainSlider) {
      lowGainSlider.addEventListener('input', () => {
        this.waveformComponent?.setKnobState({ lowGain: parseFloat(lowGainSlider.value) });
      });
    }

    if (midGainSlider) {
      midGainSlider.addEventListener('input', () => {
        this.waveformComponent?.setKnobState({ midGain: parseFloat(midGainSlider.value) });
      });
    }

    if (highGainSlider) {
      highGainSlider.addEventListener('input', () => {
        this.waveformComponent?.setKnobState({ highGain: parseFloat(highGainSlider.value) });
      });
    }

    // Play button
    const playButton = document.getElementById('play-a') as HTMLButtonElement | null;
    if (playButton) {
      playButton.addEventListener('click', () => {
        this.isPlaying = !this.isPlaying;
        playButton.textContent = this.isPlaying ? 'Pause' : 'Play';
        playButton.classList.toggle('active', this.isPlaying);
      });
    }

    // Loop button
    const loopButton = document.getElementById('loop-a') as HTMLButtonElement | null;
    if (loopButton) {
      loopButton.addEventListener('click', () => {
        this.loopActive = !this.loopActive;
        this.deckState = {
          ...this.deckState,
          loop: {
            ...this.deckState.loop,
            active: this.loopActive,
          },
        };
        loopButton.classList.toggle('active', this.loopActive);
      });
    }

    // Mouse wheel zoom
    this.deckCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomSlider = document.getElementById('zoom-a') as HTMLInputElement | null;
      if (zoomSlider && this.waveformComponent) {
        const currentZoom = parseFloat(zoomSlider.value);
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(10, currentZoom * delta));
        zoomSlider.value = newZoom.toString();
        this.waveformComponent.setZoom(newZoom);
      }
    });

    // Click to seek
    this.deckCanvas.addEventListener('click', (e) => {
      const rect = this.deckCanvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const centerX = rect.width / 2;
      const offsetPixels = clickX - centerX;

      // Calculate sample offset based on zoom
      const zoomSlider = document.getElementById('zoom-a') as HTMLInputElement | null;
      const zoom = zoomSlider ? parseFloat(zoomSlider.value) : 1;
      const baseSamplesPerPixel = (this.deckState.waveform.sampleRate * 10) / rect.width;
      const samplesPerPixel = baseSamplesPerPixel / zoom;

      const sampleOffset = offsetPixels * samplesPerPixel;
      const newPlayhead = Math.max(
        0,
        Math.min(
          this.deckState.waveform.totalSamples,
          this.deckState.transport.playheadSamples + sampleOffset
        )
      );

      this.deckState = {
        ...this.deckState,
        transport: {
          ...this.deckState.transport,
          playheadSamples: newPlayhead,
        },
      };
    });
  }

  private handleResize(): void {
    if (!this.runtime || !this.waveformComponent) {return;}

    const dpr = window.devicePixelRatio || 1;

    // Resize deck canvas
    const deckRect = this.deckCanvas.getBoundingClientRect();
    this.runtime.resize(deckRect.width, deckRect.height, dpr);
    this.waveformComponent.resize(this.runtime.getDimensions());

    // Resize meters canvas
    const metersRect = this.metersCanvas.getBoundingClientRect();
    this.metersCanvas.width = metersRect.width * dpr;
    this.metersCanvas.height = metersRect.height * dpr;

    if (this.metersComponent) {
      this.metersComponent.resize({
        width: metersRect.width,
        height: metersRect.height,
        dpr,
        physicalWidth: metersRect.width * dpr,
        physicalHeight: metersRect.height * dpr,
      });
    }
  }

  private render(): void {
    const currentTime = performance.now() / 1000;
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    // Update deck state if playing
    if (this.isPlaying) {
      this.deckState = updateTransportPlayback(this.deckState, deltaTime, this.isPlaying);
    }

    // Update audio visual state
    this.audioState = {
      ...this.audioState,
      time: currentTime,
      deltaTime,
      decks: [this.deckState],
    };

    // Update and render waveform
    if (this.runtime && this.waveformComponent) {
      this.runtime.updateSharedUniforms(currentTime, deltaTime);

      this.waveformComponent.update(deltaTime, currentTime, this.audioState);

      const texture = this.runtime.getCurrentTexture();
      if (texture) {
        const encoder = this.runtime.getDevice().createCommandEncoder();
        this.waveformComponent.encode(encoder, texture.createView());
        this.runtime.getDevice().queue.submit([encoder.finish()]);
      }
    }

    // Update and render meters (using its own runtime - simplified for demo)
    if (this.metersComponent) {
      this.metersComponent.update(deltaTime, currentTime, this.audioState);
    }

    // Update info display
    if (this.isPlaying) {
      this.updateInfoDisplay();
    }

    // Schedule next frame
    this.animationFrameId = requestAnimationFrame(() => { this.render(); });
  }

  private updateInfoDisplay(): void {
    const info = document.getElementById('info-a');
    if (!info) {return;}

    const playheadSeconds = this.deckState.transport.playheadSamples / this.deckState.waveform.sampleRate;
    const totalSeconds = this.deckState.waveform.totalSamples / this.deckState.waveform.sampleRate;

    const formatTime = (seconds: number): string => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    info.textContent = `${formatTime(playheadSeconds)} / ${formatTime(totalSeconds)} | ${this.deckState.transport.bpm} BPM | Bar ${this.deckState.transport.barIndex + 1} Beat ${this.deckState.transport.beatInBar + 1}`;
  }

  private showError(message: string): void {
    const errorDiv = document.getElementById('error');
    if (errorDiv) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = message;
    }

    // Hide deck containers
    const deckContainer = document.getElementById('deck-a-container');
    if (deckContainer) {
      deckContainer.style.display = 'none';
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrameId);
    this.waveformComponent?.destroy();
    this.metersComponent?.destroy();
    this.runtime?.destroy();
  }
}

// Initialize application
const app = new DJVisualizationApp();
app.initialize().catch(console.error);

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  app.destroy();
});

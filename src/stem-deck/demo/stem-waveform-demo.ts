/**
 * Stem Waveform Demo
 *
 * Minimal demo harness that:
 * - Initializes WebGPU
 * - Generates synthetic multi-stem track
 * - Creates StemWaveformComponent
 * - Runs 60fps animation loop with moving playhead
 * - Provides simple UI controls
 */

import { StemWaveformComponent } from '../stem-waveform-component.js';
import { generateStemDeckState } from '../test-data-generator.js';
import { createStemDeckGPUResources } from '../gpu-resources.js';
import type { StemId, StemBlendMode } from '../types.js';

/**
 * Demo application state
 */
class StemWaveformDemo {
  private component: StemWaveformComponent | null = null;
  private isPlaying = false;
  private playheadFrame = 0;
  private lastFrameTime = 0;
  private totalSamples = 0;
  private sampleRate = 44100;

  async initialize(): Promise<void> {
    // Check WebGPU support
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported in this browser');
    }

    // Get canvas
    const canvas = document.getElementById('waveform-canvas') as HTMLCanvasElement;
    if (!canvas) {
      throw new Error('Canvas element not found');
    }

    // Request WebGPU adapter and device
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to get WebGPU adapter');
    }

    const device = await adapter.requestDevice();

    // Generate synthetic track
    console.log('Generating synthetic multi-stem track...');
    const deckState = generateStemDeckState({
      durationSeconds: 180, // 3 minutes
      sampleRate: 44100,
      bandCount: 8,
      bpm: 128,
      includeDrums: true,
      includeBass: true,
      includeVocals: true,
      includeOther: true,
      trackTitle: 'Synthetic Test Track',
      trackArtist: 'Stem Deck Demo'
    });

    this.totalSamples = deckState.track.totalSamples;
    this.sampleRate = deckState.track.sampleRate;

    console.log('Creating GPU resources...');
    const gpuResources = createStemDeckGPUResources({
      device,
      track: deckState.track
    });

    console.log('Initializing component...');
    this.component = await StemWaveformComponent.create({
      canvas,
      device,
      gpuResources,
      track: deckState.track,
      initialVisualConfig: deckState.visual,
      onScrub: (frame) => {
        this.playheadFrame = frame;
        console.log(`Scrubbed to ${(frame / this.sampleRate).toFixed(2)}s`);
      }
    });

    // Setup UI controls
    this.setupUIControls();

    // Setup canvas resize
    this.resizeCanvas(canvas);
    window.addEventListener('resize', () => this.resizeCanvas(canvas));

    console.log('Demo initialized successfully');
  }

  /**
   * Resize canvas to fill container
   */
  private resizeCanvas(canvas: HTMLCanvasElement): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    this.component?.resize(canvas.width, canvas.height);
  }

  /**
   * Setup UI controls
   */
  private setupUIControls(): void {
    // Play/pause button
    const playButton = document.getElementById('play-button') as HTMLButtonElement;
    playButton?.addEventListener('click', () => {
      this.isPlaying = !this.isPlaying;
      playButton.textContent = this.isPlaying ? 'Pause' : 'Play';
    });

    // Zoom slider
    const zoomSlider = document.getElementById('zoom-slider') as HTMLInputElement;
    const zoomValue = document.getElementById('zoom-value') as HTMLSpanElement;
    zoomSlider?.addEventListener('input', () => {
      const zoom = parseFloat(zoomSlider.value);
      const framesPerPixel = (this.sampleRate * 10) / (800 * zoom); // 10s at zoom=1
      this.component?.setZoom(framesPerPixel);
      zoomValue.textContent = zoom.toFixed(2) + 'x';
    });

    // Blend mode selector
    const blendModeSelect = document.getElementById('blend-mode') as HTMLSelectElement;
    blendModeSelect?.addEventListener('change', () => {
      this.component?.setBlendMode(blendModeSelect.value as StemBlendMode);
    });

    // Beat grid toggle
    const beatGridCheckbox = document.getElementById('beat-grid-toggle') as HTMLInputElement;
    beatGridCheckbox?.addEventListener('change', () => {
      this.component?.showBeatGrid(beatGridCheckbox.checked);
    });

    // Per-stem controls
    this.setupStemControl('drums');
    this.setupStemControl('bass');
    this.setupStemControl('vocals');
    this.setupStemControl('other');
  }

  /**
   * Setup controls for a single stem
   */
  private setupStemControl(stem: StemId): void {
    // Gain slider
    const gainSlider = document.getElementById(`${stem}-gain`) as HTMLInputElement;
    const gainValue = document.getElementById(`${stem}-gain-value`) as HTMLSpanElement;
    gainSlider?.addEventListener('input', () => {
      const gain = parseFloat(gainSlider.value);
      this.component?.setStemGain(stem, gain);
      gainValue.textContent = gain.toFixed(2);
    });

    // Opacity slider
    const opacitySlider = document.getElementById(`${stem}-opacity`) as HTMLInputElement;
    const opacityValue = document.getElementById(`${stem}-opacity-value`) as HTMLSpanElement;
    opacitySlider?.addEventListener('input', () => {
      const opacity = parseFloat(opacitySlider.value);
      this.component?.setStemOpacity(stem, opacity);
      opacityValue.textContent = opacity.toFixed(2);
    });

    // Mute button
    const muteButton = document.getElementById(`${stem}-mute`) as HTMLButtonElement;
    let isMuted = false;
    muteButton?.addEventListener('click', () => {
      isMuted = !isMuted;
      this.component?.muteStem(stem, isMuted);
      muteButton.textContent = isMuted ? 'Unmute' : 'Mute';
      muteButton.classList.toggle('active', isMuted);
    });

    // Solo button
    const soloButton = document.getElementById(`${stem}-solo`) as HTMLButtonElement;
    let isSolo = false;
    soloButton?.addEventListener('click', () => {
      isSolo = !isSolo;
      this.component?.soloStem(isSolo ? stem : null);
      soloButton.textContent = isSolo ? 'Unsolo' : 'Solo';
      soloButton.classList.toggle('active', isSolo);

      // Clear other solo buttons
      if (isSolo) {
        for (const otherStem of ['drums', 'bass', 'vocals', 'other'] as StemId[]) {
          if (otherStem !== stem) {
            const otherSoloButton = document.getElementById(`${otherStem}-solo`) as HTMLButtonElement;
            otherSoloButton?.classList.remove('active');
            otherSoloButton.textContent = 'Solo';
          }
        }
      }
    });
  }

  /**
   * Start animation loop
   */
  start(): void {
    const animate = (time: number) => {
      // Calculate delta time
      const deltaTime = this.lastFrameTime > 0 ? (time - this.lastFrameTime) / 1000 : 0;
      this.lastFrameTime = time;

      // Update playhead if playing
      if (this.isPlaying) {
        this.playheadFrame += deltaTime * this.sampleRate;

        // Loop at end
        if (this.playheadFrame >= this.totalSamples) {
          this.playheadFrame = 0;
        }
      }

      // Update component
      this.component?.setPlayheadFrame(this.playheadFrame);

      // Render
      this.component?.renderFrame();

      // Update time display
      const timeDisplay = document.getElementById('time-display');
      if (timeDisplay) {
        const currentTime = this.playheadFrame / this.sampleRate;
        const totalTime = this.totalSamples / this.sampleRate;
        timeDisplay.textContent = `${this.formatTime(currentTime)} / ${this.formatTime(totalTime)}`;
      }

      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }

  /**
   * Format time in MM:SS
   */
  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

// Initialize and start demo when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDemo);
} else {
  initDemo();
}

async function initDemo() {
  try {
    const demo = new StemWaveformDemo();
    await demo.initialize();
    demo.start();
  } catch (error) {
    console.error('Failed to initialize demo:', error);
    const errorDiv = document.getElementById('error-message');
    if (errorDiv) {
      errorDiv.textContent = `Error: ${error}`;
      errorDiv.style.display = 'block';
    }
  }
}

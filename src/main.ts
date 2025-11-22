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
  buildWaveformPyramidFromPCM,
} from './utils/test-data.ts';
import type { DeckState, AudioVisualState } from './types/audio-state.ts';
import { debugCanvasPixels } from './utils/debug-readback.ts';

interface GPUInfo {
  adapter: GPUAdapterInfo;
  features: string[];
  limits: Record<string, number>;
}

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

  // FPS tracking
  private frameCount = 0;
  private lastFPSUpdate = 0;
  private currentFPS = 0;

  // GPU Info
  private gpuInfo: GPUInfo | null = null;

  // Debug tracking
  private hasRunFirstFrameDebug = false;

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
      durationSeconds: 10, // Short test track to fit GPU texture limits
      sampleRate: 44100,
      bpm: 128,
      key: 'Am',
      title: 'Synthetic Wave',
      artist: 'WebGPU Demo',
    });

    this.audioState = createTestAudioVisualState([this.deckState]);

    // Update track info display
    this.updateTrackInfo();
  }

  async initialize(): Promise<void> {
    this.updateStatus('Checking WebGPU support...');

    // Check WebGPU support
    if (!navigator.gpu) {
      this.showError(
        'WebGPU is not supported in your browser.<br><br>' +
        'Please use <a href="https://www.google.com/chrome/" target="_blank">Chrome 113+</a> or ' +
        '<a href="https://www.microsoft.com/edge" target="_blank">Edge 113+</a> with WebGPU enabled.<br><br>' +
        'You can check WebGPU support at <a href="https://webgpureport.org" target="_blank">webgpureport.org</a>'
      );
      return;
    }

    try {
      this.updateStatus('Requesting GPU adapter...');

      // Request adapter first to get info
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });

      if (!adapter) {
        throw new Error('No WebGPU adapter found. Your GPU may not support WebGPU.');
      }

      // Get adapter info (requestAdapterInfo may not be available in all versions)
      let adapterInfo: GPUAdapterInfo;
      if ('requestAdapterInfo' in adapter && typeof adapter.requestAdapterInfo === 'function') {
        adapterInfo = await (adapter as GPUAdapter & { requestAdapterInfo: () => Promise<GPUAdapterInfo> }).requestAdapterInfo();
      } else {
        // Fallback for older WebGPU implementations
        adapterInfo = {
          vendor: '',
          architecture: '',
          device: '',
          description: '',
        } as unknown as GPUAdapterInfo;
      }
      this.gpuInfo = {
        adapter: adapterInfo,
        features: Array.from(adapter.features),
        limits: this.extractLimits(adapter.limits),
      };

      this.updateStatus('Initializing GPU device...');

      // Initialize deck waveform runtime
      this.runtime = new GPURuntime({ canvas: this.deckCanvas });
      await this.runtime.initialize();

      const ctx = this.runtime.getContext();

      this.updateStatus('Creating waveform component...');

      // Create and initialize waveform component
      this.waveformComponent = new DeckWaveformComponent(0);
      await this.waveformComponent.initialize(this.runtime.getDevice(), ctx);

      this.updateStatus('Creating meters component...');

      // Create meters runtime (separate canvas)
      const metersRuntime = new GPURuntime({ canvas: this.metersCanvas });
      await metersRuntime.initialize();

      this.metersComponent = new ChannelMetersComponent(2);
      await this.metersComponent.initialize(metersRuntime.getDevice(), metersRuntime.getContext());

      // Set up event handlers
      this.setupEventHandlers();
      this.setupKeyboardShortcuts();

      // Handle resize
      this.handleResize();
      window.addEventListener('resize', () => {
        this.handleResize();
      });

      // Show main UI
      this.showMainUI();

      // Start render loop
      this.lastTime = performance.now() / 1000;
      this.lastFPSUpdate = performance.now();
      this.render();

      // Update info display
      this.updateInfoDisplay();

      // Update GPU stats display
      this.updateGPUStats();

      console.log('WebGPU DJ Visualization initialized successfully', this.gpuInfo);
    } catch (error) {
      console.error('Failed to initialize WebGPU:', error);
      this.showError(
        `Failed to initialize WebGPU:<br><br>${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private extractLimits(limits: GPUSupportedLimits): Record<string, number> {
    const result: Record<string, number> = {};
    const keys = [
      'maxTextureDimension2D',
      'maxTextureArrayLayers',
      'maxBindGroups',
      'maxUniformBufferBindingSize',
      'maxStorageBufferBindingSize',
    ];

    for (const key of keys) {
      const value = limits[key as keyof GPUSupportedLimits];
      if (typeof value === 'number') {
        result[key] = value;
      }
    }

    return result;
  }

  private updateStatus(text: string): void {
    const statusText = document.getElementById('status-text');
    const loadingText = document.querySelector('.loading-text');

    if (statusText) {
      statusText.textContent = text;
    }
    if (loadingText) {
      loadingText.textContent = text;
    }
  }

  private showMainUI(): void {
    // Hide loading, show main UI
    const loading = document.getElementById('loading');
    const deckContainer = document.getElementById('deck-a-container');
    const metersContainer = document.getElementById('meters-container');
    const gpuStats = document.getElementById('gpu-stats');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    if (loading) {
      loading.style.display = 'none';
    }
    if (deckContainer) {
      deckContainer.style.display = 'block';
    }
    if (metersContainer) {
      metersContainer.style.display = 'block';
    }
    if (gpuStats) {
      gpuStats.style.display = 'block';
    }
    if (statusDot) {
      statusDot.classList.add('ready');
    }
    if (statusText) {
      statusText.textContent = 'Ready';
    }
  }

  private updateTrackInfo(): void {
    const titleEl = document.getElementById('track-title');
    const artistEl = document.getElementById('track-artist');

    if (titleEl) {
      titleEl.textContent = this.deckState.trackTitle || 'Unknown Track';
    }
    if (artistEl) {
      artistEl.textContent = this.deckState.trackArtist || 'Unknown Artist';
    }
  }

  private updateGPUStats(): void {
    const gpuInfoEl = document.getElementById('gpu-info');

    if (gpuInfoEl && this.gpuInfo) {
      const info = this.gpuInfo.adapter;
      const gpuName = info.device || info.description || 'Unknown GPU';
      gpuInfoEl.textContent = gpuName.length > 30 ? gpuName.slice(0, 30) + '...' : gpuName;
    }
  }

  private setupEventHandlers(): void {
    // Zoom control with value display
    const zoomSlider = document.getElementById('zoom-a') as HTMLInputElement | null;
    const zoomValue = document.getElementById('zoom-value');

    if (zoomSlider && this.waveformComponent) {
      zoomSlider.addEventListener('input', () => {
        const zoom = parseFloat(zoomSlider.value);
        this.waveformComponent?.setZoom(zoom);
        if (zoomValue) {
          zoomValue.textContent = `${zoom.toFixed(1)}x`;
        }
      });
    }

    // Band gain controls with value displays
    const lowGainSlider = document.getElementById('low-gain-a') as HTMLInputElement | null;
    const midGainSlider = document.getElementById('mid-gain-a') as HTMLInputElement | null;
    const highGainSlider = document.getElementById('high-gain-a') as HTMLInputElement | null;

    const lowValue = document.getElementById('low-value');
    const midValue = document.getElementById('mid-value');
    const highValue = document.getElementById('high-value');

    if (lowGainSlider) {
      lowGainSlider.addEventListener('input', () => {
        const value = parseFloat(lowGainSlider.value);
        this.waveformComponent?.setKnobState({ lowGain: value });
        if (lowValue) lowValue.textContent = value.toFixed(1);
      });
    }

    if (midGainSlider) {
      midGainSlider.addEventListener('input', () => {
        const value = parseFloat(midGainSlider.value);
        this.waveformComponent?.setKnobState({ midGain: value });
        if (midValue) midValue.textContent = value.toFixed(1);
      });
    }

    if (highGainSlider) {
      highGainSlider.addEventListener('input', () => {
        const value = parseFloat(highGainSlider.value);
        this.waveformComponent?.setKnobState({ highGain: value });
        if (highValue) highValue.textContent = value.toFixed(1);
      });
    }

    // Play button
    const playButton = document.getElementById('play-a') as HTMLButtonElement | null;
    if (playButton) {
      playButton.addEventListener('click', () => {
        this.togglePlay();
      });
    }

    // Loop button
    const loopButton = document.getElementById('loop-a') as HTMLButtonElement | null;
    if (loopButton) {
      loopButton.addEventListener('click', () => {
        this.toggleLoop();
      });
    }

    // Reset button
    const resetButton = document.getElementById('reset-a') as HTMLButtonElement | null;
    if (resetButton) {
      resetButton.addEventListener('click', () => {
        this.resetPlayhead();
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

        const zoomValue = document.getElementById('zoom-value');
        if (zoomValue) {
          zoomValue.textContent = `${newZoom.toFixed(1)}x`;
        }
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

      this.updateInfoDisplay();
    });

    // File upload handler
    const trackUpload = document.getElementById('track-upload') as HTMLInputElement | null;
    if (trackUpload) {
      trackUpload.addEventListener('change', () => {
        this.handleTrackUpload(trackUpload.files);
      });
    }
  }

  private async handleTrackUpload(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) {return;}

    const file = files[0];
    console.log('[DJVisualizationApp] Loading track:', file.name);

    try {
      // Update track info display
      const titleEl = document.getElementById('track-title');
      const artistEl = document.getElementById('track-artist');
      if (titleEl) {
        titleEl.textContent = file.name.replace(/\.[^/.]+$/, ''); // Remove extension
      }
      if (artistEl) {
        artistEl.textContent = 'Loading...';
      }

      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // Decode audio using Web Audio API
      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      console.log('[DJVisualizationApp] Audio decoded:', {
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        numberOfChannels: audioBuffer.numberOfChannels,
        length: audioBuffer.length,
      });

      // Convert to mono Float32Array
      const monoData = this.extractMonoChannel(audioBuffer);

      // Build waveform pyramid from PCM data
      const newWaveform = buildWaveformPyramidFromPCM(monoData, audioBuffer.sampleRate);

      console.log('[DJVisualizationApp] Waveform pyramid built:', {
        totalSamples: newWaveform.totalSamples,
        lodCount: newWaveform.lods.length,
        firstLodLength: newWaveform.lods[0]?.lengthInPixels,
      });

      // Update deck state with new waveform
      this.deckState = {
        ...this.deckState,
        waveform: newWaveform,
        trackTitle: file.name.replace(/\.[^/.]+$/, ''),
        trackArtist: 'User Uploaded',
        trackDurationSamples: newWaveform.totalSamples,
        transport: {
          ...this.deckState.transport,
          playheadSamples: 0,
          barIndex: 0,
          beatInBar: 0,
          beatPhase: 0,
        },
      };

      // Mark waveform as dirty so component re-uploads
      if (this.waveformComponent) {
        this.waveformComponent.markWaveformDirty();
      }

      // Update audio state
      this.audioState = {
        ...this.audioState,
        decks: [this.deckState],
      };

      // Update display
      if (artistEl) {
        artistEl.textContent = 'User Uploaded';
      }

      // Reset info panel styling (in case of previous error)
      const infoEl = document.getElementById('info-a');
      if (infoEl) {
        infoEl.style.color = '';
      }

      this.updateInfoDisplay();

      // Clean up
      await audioContext.close();

      console.log('[DJVisualizationApp] Track loaded successfully');
    } catch (error) {
      console.error('[DJVisualizationApp] Failed to load track:', error);

      const artistEl = document.getElementById('track-artist');
      if (artistEl) {
        artistEl.textContent = 'Load failed - check console';
      }

      const titleEl = document.getElementById('track-title');
      if (titleEl) {
        titleEl.textContent = 'Decoding Error';
      }

      // Show error in the info panel as well
      const infoEl = document.getElementById('info-a');
      if (infoEl) {
        infoEl.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        infoEl.style.color = 'var(--error)';
      }

      alert(`Failed to load audio file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private extractMonoChannel(audioBuffer: AudioBuffer): Float32Array {
    const length = audioBuffer.length;
    const monoData = new Float32Array(length);

    if (audioBuffer.numberOfChannels === 1) {
      // Already mono
      audioBuffer.copyFromChannel(monoData, 0);
    } else {
      // Mix down to mono (average of all channels)
      const numChannels = audioBuffer.numberOfChannels;
      const channelData: Float32Array[] = [];

      for (let i = 0; i < numChannels; i++) {
        channelData.push(audioBuffer.getChannelData(i));
      }

      for (let i = 0; i < length; i++) {
        let sum = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          sum += channelData[ch][i];
        }
        monoData[i] = sum / numChannels;
      }
    }

    return monoData;
  }

  private setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          this.togglePlay();
          break;
        case 'l':
          this.toggleLoop();
          break;
        case 'r':
          this.resetPlayhead();
          break;
        case 'd':
          // Debug: Read back pixels from GPU
          void this.debugReadbackPixels();
          break;
      }
    });
  }

  private async debugReadbackPixels(): Promise<void> {
    if (!this.runtime) {
      console.warn('[Debug] Cannot readback pixels: runtime not initialized');
      return;
    }

    const texture = this.runtime.getCurrentTexture();
    if (!texture) {
      console.warn('[Debug] Cannot readback pixels: no texture available');
      return;
    }

    const dims = this.runtime.getDimensions();

    console.log('[Debug] Canvas dimensions:', {
      clientWidth: this.deckCanvas.clientWidth,
      clientHeight: this.deckCanvas.clientHeight,
      canvasWidth: this.deckCanvas.width,
      canvasHeight: this.deckCanvas.height,
      physicalWidth: dims.physicalWidth,
      physicalHeight: dims.physicalHeight,
      dpr: dims.dpr,
    });

    console.log('[Debug] Triggering pixel readback...');
    console.log('[Debug] Press "d" key anytime to run this diagnostic again');

    await debugCanvasPixels(
      this.runtime.getDevice(),
      texture,
      dims.physicalWidth,
      dims.physicalHeight
    );
  }

  private togglePlay(): void {
    this.isPlaying = !this.isPlaying;

    const playButton = document.getElementById('play-a') as HTMLButtonElement | null;
    const playIcon = document.getElementById('play-icon');

    if (playButton) {
      playButton.classList.toggle('active', this.isPlaying);
      const buttonText = playButton.childNodes[1];
      if (buttonText) {
        buttonText.textContent = this.isPlaying ? ' Pause' : ' Play';
      }
    }

    if (playIcon) {
      playIcon.textContent = this.isPlaying ? '⏸' : '▶';
    }
  }

  private toggleLoop(): void {
    this.loopActive = !this.loopActive;
    this.deckState = {
      ...this.deckState,
      loop: {
        ...this.deckState.loop,
        active: this.loopActive,
      },
    };

    const loopButton = document.getElementById('loop-a') as HTMLButtonElement | null;
    if (loopButton) {
      loopButton.classList.toggle('active', this.loopActive);
    }
  }

  private resetPlayhead(): void {
    this.deckState = {
      ...this.deckState,
      transport: {
        ...this.deckState.transport,
        playheadSamples: 0,
        barIndex: 0,
        beatInBar: 0,
      },
    };
    this.updateInfoDisplay();
  }

  private handleResize(): void {
    if (!this.runtime || !this.waveformComponent) {
      return;
    }

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

    // Update FPS counter
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFPSUpdate >= 1000) {
      this.currentFPS = this.frameCount;
      this.frameCount = 0;
      this.lastFPSUpdate = now;

      const fpsEl = document.getElementById('fps');
      if (fpsEl) {
        fpsEl.textContent = this.currentFPS.toString();
      }
    }

    // Auto-debug: Run pixel readback after 60 frames (1 second at 60fps) to verify rendering
    if (!this.hasRunFirstFrameDebug && this.frameCount === 60) {
      this.hasRunFirstFrameDebug = true;
      console.log('[Debug] Running automatic first-frame pixel analysis...');
      console.log('[Debug] Press "D" key anytime to run diagnostics again');
      void this.debugReadbackPixels();
    }

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
    this.animationFrameId = requestAnimationFrame(() => {
      this.render();
    });
  }

  private updateInfoDisplay(): void {
    const info = document.getElementById('info-a');
    if (!info) {
      return;
    }

    const playheadSeconds =
      this.deckState.transport.playheadSamples / this.deckState.waveform.sampleRate;
    const totalSeconds =
      this.deckState.waveform.totalSamples / this.deckState.waveform.sampleRate;

    const formatTime = (seconds: number): string => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const loopIndicator = this.loopActive ? ' | LOOP' : '';

    info.textContent =
      `${formatTime(playheadSeconds)} / ${formatTime(totalSeconds)} | ` +
      `${this.deckState.transport.bpm} BPM | ` +
      `Bar ${this.deckState.transport.barIndex + 1} Beat ${this.deckState.transport.beatInBar + 1}` +
      loopIndicator;
  }

  private showError(message: string): void {
    const errorDiv = document.getElementById('error');
    const errorMessage = document.getElementById('error-message');
    const loading = document.getElementById('loading');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    if (errorDiv) {
      errorDiv.style.display = 'block';
    }

    if (errorMessage) {
      errorMessage.innerHTML = message;
    }

    if (loading) {
      loading.style.display = 'none';
    }

    if (statusDot) {
      statusDot.classList.add('error');
    }

    if (statusText) {
      statusText.textContent = 'Error';
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

// Initialize application when DOM is ready
function initApp(): void {
  const app = new DJVisualizationApp();
  app.initialize().catch(console.error);

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    app.destroy();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

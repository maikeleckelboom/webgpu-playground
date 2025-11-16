/**
 * Demo application entry point for the standalone deck waveform component.
 * This creates a complete interactive demo with controls for zoom, playback, and seeking.
 */

import {
  runTestHarness,
  togglePlayback,
  setZoomLevel,
  seekToPosition,
  setPlaybackRate,
  destroyTestHarness,
} from './test-harness.ts';

// =============================================================================
// Demo Application
// =============================================================================

async function initializeDemo(): Promise<void> {
  const statusEl = document.getElementById('status');
  const canvasEl = document.getElementById('waveform-canvas') as HTMLCanvasElement | null;

  if (!canvasEl) {
    throw new Error('Canvas element not found');
  }

  const updateStatus = (text: string): void => {
    if (statusEl) {
      statusEl.textContent = text;
    }
  };

  try {
    updateStatus('Checking WebGPU support...');

    // Check WebGPU support
    if (!navigator.gpu) {
      throw new Error(
        'WebGPU is not supported in your browser. ' +
          'Please use Chrome 113+ or Edge 113+ with WebGPU enabled.'
      );
    }

    updateStatus('Requesting GPU adapter...');

    // Request adapter
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      throw new Error('No WebGPU adapter found. Your GPU may not support WebGPU.');
    }

    updateStatus('Creating GPU device...');

    // Request device
    const device = await adapter.requestDevice({
      label: 'deck-waveform-demo',
    });

    updateStatus('Initializing waveform component...');

    // Initialize the test harness
    const state = runTestHarness(canvasEl, device);

    updateStatus('Ready');

    // Set up UI controls
    setupControls(state, canvasEl);
    setupKeyboardShortcuts(state);
    setupResizeHandler(state, canvasEl);

    // Update info display
    updateInfoDisplay(state);
    setInterval(() => {
      updateInfoDisplay(state);
    }, 100);

    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
      destroyTestHarness(state);
      device.destroy();
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    updateStatus(`Error: ${errorMessage}`);
    console.error('Failed to initialize demo:', error);
  }
}

function setupControls(
  state: ReturnType<typeof runTestHarness>,
  canvas: HTMLCanvasElement
): void {
  // Play/Pause button
  const playBtn = document.getElementById('play-btn');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      togglePlayback(state);
      playBtn.textContent = state.isPlaying ? '⏸ Pause' : '▶ Play';
    });
  }

  // Zoom slider
  const zoomSlider = document.getElementById('zoom-slider') as HTMLInputElement | null;
  const zoomValue = document.getElementById('zoom-value');
  if (zoomSlider) {
    zoomSlider.addEventListener('input', () => {
      const zoom = parseFloat(zoomSlider.value);
      setZoomLevel(state, zoom);
      if (zoomValue) {
        zoomValue.textContent = `${zoom.toFixed(1)}x`;
      }
    });

    // Mouse wheel zoom on canvas
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const currentZoom = parseFloat(zoomSlider.value);
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(10, currentZoom * delta));
      zoomSlider.value = newZoom.toString();
      setZoomLevel(state, newZoom);
      if (zoomValue) {
        zoomValue.textContent = `${newZoom.toFixed(1)}x`;
      }
    });
  }

  // Speed slider
  const speedSlider = document.getElementById('speed-slider') as HTMLInputElement | null;
  const speedValue = document.getElementById('speed-value');
  if (speedSlider) {
    speedSlider.addEventListener('input', () => {
      const speed = parseFloat(speedSlider.value);
      setPlaybackRate(state, speed);
      if (speedValue) {
        speedValue.textContent = `${speed.toFixed(1)}x`;
      }
    });
  }

  // Seek slider
  const seekSlider = document.getElementById('seek-slider') as HTMLInputElement | null;
  if (seekSlider) {
    seekSlider.addEventListener('input', () => {
      const position = parseFloat(seekSlider.value);
      seekToPosition(state, position);
    });

    // Update seek slider during playback
    setInterval(() => {
      const position = state.transport.playheadSamples / state.totalSamples;
      seekSlider.value = position.toString();
    }, 50);
  }

  // Click to seek on canvas
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const centerX = rect.width / 2;
    const offsetPixels = clickX - centerX;

    // Calculate sample offset based on current zoom and LOD
    const zoomValue = parseFloat(
      (document.getElementById('zoom-slider') as HTMLInputElement | null)?.value ?? '1'
    );
    const baseSamplesPerPixel = (state.sampleRate * 10) / rect.width;
    const samplesPerPixel = baseSamplesPerPixel / zoomValue;

    const sampleOffset = offsetPixels * samplesPerPixel;
    const newPlayhead = Math.max(
      0,
      Math.min(state.totalSamples, state.transport.playheadSamples + sampleOffset)
    );

    // eslint-disable-next-line no-param-reassign
    state.transport = {
      ...state.transport,
      playheadSamples: newPlayhead,
    };
    state.waveform.updateTransport(state.transport);
  });

  // Reset button
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      seekToPosition(state, 0);
    });
  }
}

function setupKeyboardShortcuts(
  state: ReturnType<typeof runTestHarness>
): void {
  document.addEventListener('keydown', (e) => {
    // Ignore if typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    switch (e.key) {
      case ' ': {
        e.preventDefault();
        togglePlayback(state);
        const playBtn = document.getElementById('play-btn');
        if (playBtn) {
          playBtn.textContent = state.isPlaying ? '⏸ Pause' : '▶ Play';
        }
        break;
      }
      case 'Home':
        e.preventDefault();
        seekToPosition(state, 0);
        break;
      case 'End':
        e.preventDefault();
        seekToPosition(state, 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seekToPosition(state, Math.max(0, state.transport.playheadSamples / state.totalSamples - 0.05));
        break;
      case 'ArrowRight':
        e.preventDefault();
        seekToPosition(
          state,
          Math.min(1, state.transport.playheadSamples / state.totalSamples + 0.05)
        );
        break;
    }
  });
}

function setupResizeHandler(
  state: ReturnType<typeof runTestHarness>,
  canvas: HTMLCanvasElement
): void {
  const handleResize = (): void => {
    const dpr = window.devicePixelRatio ?? 1;
    const rect = canvas.getBoundingClientRect();
    state.waveform.resize(rect.width, rect.height, dpr);
  };

  window.addEventListener('resize', handleResize);

  // Initial resize
  handleResize();
}

function updateInfoDisplay(
  state: ReturnType<typeof runTestHarness>
): void {
  const infoEl = document.getElementById('info');
  if (!infoEl) {
    return;
  }

  const playheadSeconds = state.transport.playheadSamples / state.sampleRate;
  const totalSeconds = state.totalSamples / state.sampleRate;

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const currentBeat = (playheadSeconds * state.transport.bpm) / 60;
  const bar = Math.floor(currentBeat / 4) + 1;
  const beat = Math.floor(currentBeat % 4) + 1;

  infoEl.textContent =
    `${formatTime(playheadSeconds)} / ${formatTime(totalSeconds)} | ` +
    `${state.transport.bpm} BPM | ` +
    `Bar ${bar} Beat ${beat}`;
}

// =============================================================================
// Entry Point
// =============================================================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeDemo().catch((err: unknown) => {
      console.error(err);
    });
  });
} else {
  initializeDemo().catch((err: unknown) => {
    console.error(err);
  });
}

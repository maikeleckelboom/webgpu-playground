/**
 * Browser-based behavior tests for waveform component.
 * Runs in real Chromium with WebGPU support.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { page } from 'vitest/browser';
import {
  createWaveformTestHandle,
  seekAndRender,
  setZoomAndRender,
  destroyTestHandle,
  type WaveformTestHandle,
} from './test-harness.ts';

describe('Waveform Component Behavior', () => {
  let handle: WaveformTestHandle;

  beforeEach(async () => {
    // Create a fresh test root for each test
    const root = document.createElement('div');
    root.id = 'test-root';
    document.body.appendChild(root);

    handle = await createWaveformTestHandle(root, {
      durationSeconds: 60,
      sampleRate: 44100,
      bpm: 128,
      bandCount: 3,
      canvasWidth: 1280,
      canvasHeight: 256,
      initialPlayheadFrame: 0,
      initialZoom: 512,
    });
  });

  afterEach(() => {
    if (handle) {
      destroyTestHandle(handle);
    }

    // Clean up test root
    const root = document.getElementById('test-root');
    if (root) {
      root.remove();
    }
  });

  it('should create canvas element', async () => {
    const canvas = await page.getByTestId('waveform-canvas');
    expect(canvas).toBeDefined();
  });

  it('should render without throwing errors', async () => {
    // If we got here, rendering succeeded in beforeEach
    expect(handle.waveform).toBeDefined();
  });

  it('should update playhead position', async () => {
    // Seek to middle of track
    const middleFrame = handle.totalSamples / 2;
    seekAndRender(handle, middleFrame);

    // Should not throw
    expect(handle.waveform).toBeDefined();
  });

  it('should handle zoom changes', async () => {
    // Try different zoom levels
    const zoomLevels = [256, 512, 1024, 2048];

    for (const zoom of zoomLevels) {
      setZoomAndRender(handle, zoom);
      // Should not throw
      expect(handle.waveform).toBeDefined();
    }
  });

  it('should handle seeking to start of track', async () => {
    seekAndRender(handle, 0);
    expect(handle.waveform).toBeDefined();
  });

  it('should handle seeking to end of track', async () => {
    seekAndRender(handle, handle.totalSamples - 1);
    expect(handle.waveform).toBeDefined();
  });

  it('should handle multiple rapid zoom changes', async () => {
    // Simulate rapid zooming (e.g., mouse wheel)
    for (let i = 0; i < 10; i++) {
      const zoom = 256 * Math.pow(2, i % 4);
      setZoomAndRender(handle, zoom);
    }

    expect(handle.waveform).toBeDefined();
  });

  it('should handle multiple rapid seek operations', async () => {
    // Simulate scrubbing
    const samples = handle.totalSamples;

    for (let i = 0; i < 10; i++) {
      const position = (samples / 10) * i;
      seekAndRender(handle, position);
    }

    expect(handle.waveform).toBeDefined();
  });

  it('should maintain canvas size', async () => {
    const canvas = await page.getByTestId('waveform-canvas');
    const element = canvas.element() as HTMLCanvasElement;

    expect(element.width).toBe(1280);
    expect(element.height).toBe(256);
  });
});

describe('Waveform Component Edge Cases', () => {
  it('should handle very short track', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const handle = await createWaveformTestHandle(root, {
      durationSeconds: 1, // Very short
      sampleRate: 44100,
      bpm: 128,
      bandCount: 3,
    });

    expect(handle.waveform).toBeDefined();

    destroyTestHandle(handle);
    root.remove();
  });

  it('should handle very long track', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const handle = await createWaveformTestHandle(root, {
      durationSeconds: 3600, // 1 hour
      sampleRate: 44100,
      bpm: 128,
      bandCount: 3,
    });

    expect(handle.waveform).toBeDefined();

    destroyTestHandle(handle);
    root.remove();
  });

  it('should handle single band', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const handle = await createWaveformTestHandle(root, {
      durationSeconds: 60,
      sampleRate: 44100,
      bpm: 128,
      bandCount: 1, // Single band
    });

    expect(handle.waveform).toBeDefined();

    destroyTestHandle(handle);
    root.remove();
  });

  it('should handle many bands', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const handle = await createWaveformTestHandle(root, {
      durationSeconds: 60,
      sampleRate: 44100,
      bpm: 128,
      bandCount: 16, // Many bands
    });

    expect(handle.waveform).toBeDefined();

    destroyTestHandle(handle);
    root.remove();
  });

  it('should handle extreme zoom in', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const handle = await createWaveformTestHandle(root, {
      durationSeconds: 60,
      sampleRate: 44100,
      bpm: 128,
      bandCount: 3,
      initialZoom: 64, // Very high zoom
    });

    expect(handle.waveform).toBeDefined();

    destroyTestHandle(handle);
    root.remove();
  });

  it('should handle extreme zoom out', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const handle = await createWaveformTestHandle(root, {
      durationSeconds: 60,
      sampleRate: 44100,
      bpm: 128,
      bandCount: 3,
      initialZoom: 16384, // Very low zoom
    });

    expect(handle.waveform).toBeDefined();

    destroyTestHandle(handle);
    root.remove();
  });
});

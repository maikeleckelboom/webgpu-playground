/**
 * Visual regression tests for waveform component.
 * Uses screenshot comparison to detect visual changes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import {
  createWaveformTestHandle,
  seekAndRender,
  setZoomAndRender,
  destroyTestHandle,
  type WaveformTestHandle,
} from './test-harness.ts';

describe('Waveform Visual Regression', () => {
  let handle: WaveformTestHandle;
  let root: HTMLElement;

  beforeEach(async () => {
    // Create a fresh test root for each test
    root = document.createElement('div');
    root.id = 'test-root';
    root.style.width = '1280px';
    root.style.height = '256px';
    document.body.appendChild(root);

    // Use deterministic settings for visual consistency
    handle = await createWaveformTestHandle(root, {
      durationSeconds: 60,
      sampleRate: 44100,
      bpm: 128,
      bandCount: 3,
      canvasWidth: 1280,
      canvasHeight: 256,
      initialPlayheadFrame: 44100 * 30, // 30 seconds in
      initialZoom: 512,
    });

    // Wait for any async rendering
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterEach(() => {
    if (handle) {
      destroyTestHandle(handle);
    }

    if (root && root.parentNode) {
      root.remove();
    }
  });

  it('should match default deck view screenshot', async () => {
    const canvas = await page.getByTestId('waveform-canvas');
    await expect.element(canvas).toMatchScreenshot('waveform-default');
  });

  it('should match playhead at start screenshot', async () => {
    seekAndRender(handle, 0);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const canvas = await page.getByTestId('waveform-canvas');
    await expect.element(canvas).toMatchScreenshot('waveform-start');
  });

  it('should match playhead at end screenshot', async () => {
    seekAndRender(handle, handle.totalSamples - 44100); // 1 second before end
    await new Promise((resolve) => setTimeout(resolve, 50));

    const canvas = await page.getByTestId('waveform-canvas');
    await expect.element(canvas).toMatchScreenshot('waveform-end');
  });

  it('should match high zoom screenshot', async () => {
    setZoomAndRender(handle, 128); // Very high zoom
    await new Promise((resolve) => setTimeout(resolve, 50));

    const canvas = await page.getByTestId('waveform-canvas');
    await expect.element(canvas).toMatchScreenshot('waveform-zoom-high');
  });

  it('should match low zoom screenshot', async () => {
    setZoomAndRender(handle, 4096); // Very low zoom
    await new Promise((resolve) => setTimeout(resolve, 50));

    const canvas = await page.getByTestId('waveform-canvas');
    await expect.element(canvas).toMatchScreenshot('waveform-zoom-low');
  });

  it('should match different playhead positions', async () => {
    // Test at 25% through track
    seekAndRender(handle, Math.floor(handle.totalSamples * 0.25));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const canvas = await page.getByTestId('waveform-canvas');
    await expect.element(canvas).toMatchScreenshot('waveform-position-25');
  });

  it('should maintain visual consistency across re-renders', async () => {
    // Render multiple times with same state
    for (let i = 0; i < 3; i++) {
      seekAndRender(handle, 44100 * 30);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    const canvas = await page.getByTestId('waveform-canvas');
    await expect.element(canvas).toMatchScreenshot('waveform-stable');
  });
});

describe('Waveform Visual Edge Cases', () => {
  it('should render single band correctly', async () => {
    const root = document.createElement('div');
    root.style.width = '1280px';
    root.style.height = '256px';
    document.body.appendChild(root);

    const handle = await createWaveformTestHandle(root, {
      durationSeconds: 60,
      sampleRate: 44100,
      bpm: 128,
      bandCount: 1,
      canvasWidth: 1280,
      canvasHeight: 256,
      initialPlayheadFrame: 44100 * 30,
      initialZoom: 512,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const canvas = await page.getByTestId('waveform-canvas');
    await expect.element(canvas).toMatchScreenshot('waveform-single-band');

    destroyTestHandle(handle);
    root.remove();
  });

  it('should render many bands correctly', async () => {
    const root = document.createElement('div');
    root.style.width = '1280px';
    root.style.height = '256px';
    document.body.appendChild(root);

    const handle = await createWaveformTestHandle(root, {
      durationSeconds: 60,
      sampleRate: 44100,
      bpm: 128,
      bandCount: 8,
      canvasWidth: 1280,
      canvasHeight: 256,
      initialPlayheadFrame: 44100 * 30,
      initialZoom: 512,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const canvas = await page.getByTestId('waveform-canvas');
    await expect.element(canvas).toMatchScreenshot('waveform-many-bands');

    destroyTestHandle(handle);
    root.remove();
  });

  it('should render small canvas correctly', async () => {
    const root = document.createElement('div');
    root.style.width = '640px';
    root.style.height = '128px';
    document.body.appendChild(root);

    const handle = await createWaveformTestHandle(root, {
      durationSeconds: 60,
      sampleRate: 44100,
      bpm: 128,
      bandCount: 3,
      canvasWidth: 640,
      canvasHeight: 128,
      initialPlayheadFrame: 44100 * 30,
      initialZoom: 512,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const canvas = await page.getByTestId('waveform-canvas');
    await expect.element(canvas).toMatchScreenshot('waveform-small-canvas');

    destroyTestHandle(handle);
    root.remove();
  });

  it('should render large canvas correctly', async () => {
    const root = document.createElement('div');
    root.style.width = '2560px';
    root.style.height = '512px';
    document.body.appendChild(root);

    const handle = await createWaveformTestHandle(root, {
      durationSeconds: 60,
      sampleRate: 44100,
      bpm: 128,
      bandCount: 3,
      canvasWidth: 2560,
      canvasHeight: 512,
      initialPlayheadFrame: 44100 * 30,
      initialZoom: 512,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const canvas = await page.getByTestId('waveform-canvas');
    await expect.element(canvas).toMatchScreenshot('waveform-large-canvas');

    destroyTestHandle(handle);
    root.remove();
  });
});

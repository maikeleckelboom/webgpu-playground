/**
 * Test harness for browser-based WebGPU waveform tests.
 * Provides deterministic setup without animation loops for stable testing.
 */

import {createDeckWaveform} from '../../src/waveform/deck-waveform.ts';
import {createSyntheticWaveform} from '../../src/waveform/test-harness.ts';
import type {DeckTransportState, DeckWaveform} from '../../src/waveform/types.ts';

export interface WaveformTestHandle {
    readonly canvas: HTMLCanvasElement;
    readonly waveform: DeckWaveform;
    readonly sampleRate: number;
    readonly totalSamples: number;
}

export interface TestHarnessOptions {
    durationSeconds?: number;
    sampleRate?: number;
    bpm?: number;
    bandCount?: number;
    canvasWidth?: number;
    canvasHeight?: number;
    initialPlayheadFrame?: number;
    initialZoom?: number;
}

/**
 * Create a deterministic waveform test setup.
 * No animation loops - all rendering is explicit via renderFrame().
 */
export async function createWaveformTestHandle(
    root: HTMLElement,
    options: TestHarnessOptions = {}
): Promise<WaveformTestHandle> {
    const {
        durationSeconds = 60,
        sampleRate = 44100,
        bpm = 128,
        bandCount = 3,
        canvasWidth = 1280,
        canvasHeight = 256,
        initialPlayheadFrame = 0,
        initialZoom = 512,
    } = options;

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.dataset.testid = 'waveform-canvas';
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    root.appendChild(canvas);

    // Get WebGPU adapter and device
    if (!navigator.gpu) {
        throw new Error('WebGPU is not supported in this environment');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error('Failed to get WebGPU adapter');
    }

    const device = await adapter.requestDevice();

    // Generate deterministic test waveform (seeded by parameters)
    const pyramid = createSyntheticWaveform(durationSeconds, sampleRate, bpm, bandCount);

    // Create the waveform component
    const waveform = createDeckWaveform({
        device,
        canvas,
        waveform: pyramid,
    });

    // Initial resize with dpr
    const dpr = window.devicePixelRatio;
    waveform.resize(canvasWidth, canvasHeight, dpr);

    // Set initial state
    waveform.setZoom(initialZoom);

    const transport: DeckTransportState = {
        playheadSamples: initialPlayheadFrame,
        rate: 1.0,
        bpm,
        beatPhaseOffset: 0,
    };

    waveform.updateTransport(transport);

    // Render initial frame
    waveform.frame(0, 0);

    return {
        canvas,
        waveform,
        sampleRate,
        totalSamples: pyramid.totalSamples,
    };
}

/**
 * Helper to update playhead and render a single frame.
 */
export function seekAndRender(
    handle: WaveformTestHandle,
    playheadSamples: number,
    bpm = 128
): void {
    const transport: DeckTransportState = {
        playheadSamples,
        rate: 1.0,
        bpm,
        beatPhaseOffset: 0,
    };

    handle.waveform.updateTransport(transport);
    handle.waveform.frame(0, 0);
}

/**
 * Helper to set zoom and render a single frame.
 */
export function setZoomAndRender(handle: WaveformTestHandle, zoom: number): void {
    handle.waveform.setZoom(zoom);
    handle.waveform.frame(0, 0);
}

/**
 * Cleanup the test harness.
 */
export function destroyTestHandle(handle: WaveformTestHandle): void {
    handle.waveform.destroy();
    handle.canvas.remove();
}

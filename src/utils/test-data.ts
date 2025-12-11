/**
 * Test Data Generator
 * Creates synthetic waveform and audio state data for testing
 */

import type {
    AudioVisualState,
    CuePoint,
    DeckState,
    DeckTransportState,
    LoopState,
    MasterMeter,
    SectionMarker,
    WaveformBandConfig,
    WaveformLOD,
    WaveformPyramid,
} from "../types/audio-state.ts";

export interface TestTrackConfig {
    durationSeconds: number;
    sampleRate: number;
    bpm: number;
    key: string;
    title: string;
    artist: string;
}

/**
 * GPU-safe upper bound for a single 1D waveform texture.
 *
 * Most desktop/mobile GPUs expose maxTextureDimension2D >= 8192.
 * The WebGPU upload path assumes a 1×N texture per LOD, so we keep
 * lengthInPixels <= this value to avoid allocation failures.
 */
const MAX_WAVEFORM_TEXTURE_WIDTH = 8192;

/**
 * Base samples-per-pixel ladder. Actual LOD set is derived per track
 * and filtered to respect MAX_WAVEFORM_TEXTURE_WIDTH.
 */
const BASE_SAMPLES_PER_PIXEL_LEVELS: readonly number[] = [
    64,
    128,
    256,
    512,
    1024,
    2048,
    4096,
];

/**
 * Compute a GPU-safe set of LOD samples-per-pixel levels for a given track.
 *
 * Rules:
 * - Only keep levels whose lengthInPixels <= MAX_WAVEFORM_TEXTURE_WIDTH.
 * - If none qualify (extremely long track), synthesize a single level with
 *   samplesPerPixel chosen so that lengthInPixels ~= MAX_WAVEFORM_TEXTURE_WIDTH.
 */
function computeLodSamplesPerPixel(totalSamples: number): number[] {
    const levels: number[] = [];

    for (const spp of BASE_SAMPLES_PER_PIXEL_LEVELS) {
        const lengthInPixels = Math.ceil(totalSamples / spp);
        if (lengthInPixels <= MAX_WAVEFORM_TEXTURE_WIDTH) {
            levels.push(spp);
        }
    }

    if (levels.length === 0) {
        const minSamplesPerPixel = Math.ceil(
            totalSamples / MAX_WAVEFORM_TEXTURE_WIDTH,
        );
        levels.push(minSamplesPerPixel);
    }

    return levels;
}

export function generateTestWaveform(config: TestTrackConfig): WaveformPyramid {
    const totalSamples = Math.floor(config.durationSeconds * config.sampleRate);

    const bandConfig: WaveformBandConfig = {
        bandCount: 3,
        sampleRate: config.sampleRate,
        frequencyRanges: [
            {min: 20, max: 250}, // Low
            {min: 250, max: 4000}, // Mid
            {min: 4000, max: 20000}, // High
        ],
    };

    const lods: WaveformLOD[] = [];
    const lodSamplesPerPixel = computeLodSamplesPerPixel(totalSamples);

    for (const samplesPerPixel of lodSamplesPerPixel) {
        const lengthInPixels = Math.ceil(totalSamples / samplesPerPixel);

        const amplitude = new Float32Array(lengthInPixels * 2);
        const bandEnergies = new Float32Array(lengthInPixels * 3);

        const samplesPerBeat = (config.sampleRate * 60) / config.bpm;
        const samplesPerBar = samplesPerBeat * 4;

        for (let i = 0; i < lengthInPixels; i += 1) {
            const samplePos = i * samplesPerPixel;
            const timeSeconds = samplePos / config.sampleRate;
            const beatPos = samplePos / samplesPerBeat;
            const barPos = samplePos / samplesPerBar;

            const section = getTrackSection(timeSeconds, config.durationSeconds);
            const beatPhase = beatPos % 1;
            void barPos;

            let baseAmplitude = 0.3;

            if (beatPhase < 0.1) {
                baseAmplitude += 0.4 * (1.0 - beatPhase / 0.1);
            }

            switch (section) {
                case "intro":
                    baseAmplitude *= 0.6;
                    break;
                case "breakdown":
                    baseAmplitude *= 0.4;
                    break;
                case "drop":
                    baseAmplitude *= 1.2;
                    break;
                case "outro":
                    baseAmplitude *= 0.5;
                    break;
            }

            const noise = (Math.random() - 0.5) * 0.1;
            baseAmplitude = Math.max(0.1, Math.min(1.0, baseAmplitude + noise));

            const variation = Math.random() * 0.1;
            amplitude[i * 2 + 0] = baseAmplitude * (1 - variation); // min
            amplitude[i * 2 + 1] = baseAmplitude; // max

            let lowEnergy = 0.3;
            let midEnergy = 0.3;
            let highEnergy = 0.2;

            if (beatPhase < 0.15) {
                lowEnergy += 0.5 * (1.0 - beatPhase / 0.15);
            }

            if (Math.abs(beatPhase - 0.5) < 0.1) {
                highEnergy += 0.3;
            }

            switch (section) {
                case "intro":
                    lowEnergy *= 0.5;
                    highEnergy *= 1.2;
                    break;
                case "breakdown":
                    lowEnergy *= 0.3;
                    midEnergy *= 1.3;
                    highEnergy *= 0.8;
                    break;
                case "drop":
                    lowEnergy *= 1.4;
                    midEnergy *= 1.2;
                    highEnergy *= 1.1;
                    break;
            }

            const totalEnergy = lowEnergy + midEnergy + highEnergy;
            const norm = totalEnergy > 0 ? 3 / totalEnergy : 0;

            bandEnergies[i * 3 + 0] = Math.min(
                1.0,
                lowEnergy * norm * (0.9 + Math.random() * 0.2),
            );
            bandEnergies[i * 3 + 1] = Math.min(
                1.0,
                midEnergy * norm * (0.9 + Math.random() * 0.2),
            );
            bandEnergies[i * 3 + 2] = Math.min(
                1.0,
                highEnergy * norm * (0.9 + Math.random() * 0.2),
            );
        }

        lods.push({
            samplesPerPixel,
            lengthInPixels,
            amplitude,
            bandEnergies,
        });
    }

    return {
        totalSamples,
        sampleRate: config.sampleRate,
        lods,
        bands: bandConfig,
    };
}

function getTrackSection(
    timeSeconds: number,
    durationSeconds: number,
): "intro" | "verse" | "breakdown" | "drop" | "outro" {
    const progress = timeSeconds / durationSeconds;

    if (progress < 0.1) {return "intro";}
    if (progress < 0.3) {return "verse";}
    if (progress < 0.4) {return "breakdown";}
    if (progress < 0.7) {return "drop";}
    if (progress < 0.85) {return "breakdown";}
    return "outro";
}

export function generateTestCuePoints(config: TestTrackConfig): CuePoint[] {
    const samplesPerBeat = (config.sampleRate * 60) / config.bpm;
    const samplesPerBar = samplesPerBeat * 4;
    const totalBars = Math.floor(
        (config.durationSeconds * config.sampleRate) / samplesPerBar,
    );

    const cuePoints: CuePoint[] = [];

    const cueLocations = [
        {bar: 0, label: "Intro", color: [255, 200, 50] as const},
        {
            bar: Math.floor(totalBars * 0.1),
            label: "Verse",
            color: [50, 200, 255] as const,
        },
        {
            bar: Math.floor(totalBars * 0.3),
            label: "Breakdown",
            color: [200, 100, 255] as const,
        },
        {
            bar: Math.floor(totalBars * 0.4),
            label: "Drop",
            color: [255, 50, 50] as const,
        },
        {
            bar: Math.floor(totalBars * 0.7),
            label: "Break 2",
            color: [200, 100, 255] as const,
        },
        {
            bar: Math.floor(totalBars * 0.85),
            label: "Outro",
            color: [100, 255, 100] as const,
        },
    ];

    for (let i = 0; i < cueLocations.length; i += 1) {
        cuePoints.push({
            id: `cue-${i}`,
            samplePosition: cueLocations[i].bar * samplesPerBar,
            color: cueLocations[i].color,
            label: cueLocations[i].label,
        });
    }

    return cuePoints;
}

export function generateTestSections(config: TestTrackConfig): SectionMarker[] {
    const totalSamples = config.durationSeconds * config.sampleRate;

    return [
        {
            startSample: 0,
            endSample: totalSamples * 0.1,
            type: "intro",
            label: "Intro",
        },
        {
            startSample: totalSamples * 0.1,
            endSample: totalSamples * 0.3,
            type: "verse",
            label: "Verse",
        },
        {
            startSample: totalSamples * 0.3,
            endSample: totalSamples * 0.4,
            type: "breakdown",
            label: "Breakdown",
        },
        {
            startSample: totalSamples * 0.4,
            endSample: totalSamples * 0.7,
            type: "drop",
            label: "Drop",
        },
        {
            startSample: totalSamples * 0.7,
            endSample: totalSamples * 0.85,
            type: "breakdown",
            label: "Breakdown 2",
        },
        {
            startSample: totalSamples * 0.85,
            endSample: totalSamples,
            type: "outro",
            label: "Outro",
        },
    ];
}

export function createTestDeckState(config: TestTrackConfig): DeckState {
    const waveform = generateTestWaveform(config);
    const samplesPerBeat = (config.sampleRate * 60) / config.bpm;
    const samplesPerBar = samplesPerBeat * 4;

    const transport: DeckTransportState = {
        playheadSamples: 0,
        rate: 1.0,
        bpm: config.bpm,
        beatPhase: 0,
        barIndex: 0,
        beatInBar: 0,
        isPlaying: false,
        isSlipMode: false,
        slipPlayheadSamples: 0,
    };

    const loop: LoopState = {
        active: false,
        inSample: samplesPerBar * 8,
        outSample: samplesPerBar * 16,
    };

    return {
        id: "deck-a",
        transport,
        loop,
        cuePoints: generateTestCuePoints(config),
        sections: generateTestSections(config),
        waveform,
        trackTitle: config.title,
        trackArtist: config.artist,
        trackKey: config.key,
        trackDurationSamples: waveform.totalSamples,
    };
}

export function createTestAudioVisualState(
    decks: DeckState[],
): AudioVisualState {
    const master: MasterMeter = {
        rms: 0.5,
        peak: 0.7,
        peakHold: 0.75,
        lufs: -14,
        lowEnergy: 0.4,
        midEnergy: 0.5,
        highEnergy: 0.3,
        leftPeak: 0.68,
        rightPeak: 0.72,
        correlation: 0.95,
    };

    return {
        time: 0,
        deltaTime: 0,
        decks,
        master,
        crossfaderPosition: 0,
    };
}

export function updateTransportPlayback(
    state: DeckState,
    deltaTime: number,
    isPlaying: boolean,
): DeckState {
    if (!isPlaying) {return state;}

    const newPlayhead =
        state.transport.playheadSamples +
        state.waveform.sampleRate * deltaTime * state.transport.rate;

    const samplesPerBeat = (state.waveform.sampleRate * 60) / state.transport.bpm;
    const samplesPerBar = samplesPerBeat * 4;
    const beatPosition = newPlayhead / samplesPerBeat;
    const barPosition = newPlayhead / samplesPerBar;

    const newTransport: DeckTransportState = {
        ...state.transport,
        playheadSamples: newPlayhead % state.waveform.totalSamples,
        beatPhase: beatPosition % 1,
        barIndex: Math.floor(barPosition),
        beatInBar: Math.floor(beatPosition % 4),
        isPlaying,
    };

    return {
        ...state,
        transport: newTransport,
    };
}

/**
 * Build a WaveformPyramid from raw PCM audio data.
 * Placeholder band model – can be swapped for real FFT-based analyzer later.
 */
export function buildWaveformPyramidFromPCM(
    pcmData: Float32Array,
    sampleRate: number,
): WaveformPyramid {
    const totalSamples = pcmData.length;

    const bandConfig: WaveformBandConfig = {
        bandCount: 3,
        sampleRate,
        frequencyRanges: [
            {min: 20, max: 250},
            {min: 250, max: 4000},
            {min: 4000, max: 20000},
        ],
    };

    const lods: WaveformLOD[] = [];
    const lodSamplesPerPixel = computeLodSamplesPerPixel(totalSamples);

    for (const samplesPerPixel of lodSamplesPerPixel) {
        const lengthInPixels = Math.ceil(totalSamples / samplesPerPixel);

        const amplitude = new Float32Array(lengthInPixels * 2);
        const bandEnergies = new Float32Array(lengthInPixels * 3);

        for (let i = 0; i < lengthInPixels; i += 1) {
            const startSample = i * samplesPerPixel;
            const endSample = Math.min(startSample + samplesPerPixel, totalSamples);

            let minVal = 0;
            let maxVal = 0;
            let sumSquares = 0;
            let sampleCount = 0;

            for (let j = startSample; j < endSample; j += 1) {
                const sample = pcmData[j];
                if (sample < minVal) {minVal = sample;}
                if (sample > maxVal) {maxVal = sample;}
                sumSquares += sample * sample;
                sampleCount += 1;
            }

            amplitude[i * 2 + 0] = Math.abs(minVal);
            amplitude[i * 2 + 1] = maxVal;

            const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;

            let zeroCrossings = 0;
            let highPassEnergy = 0;
            let lowPassEnergy = 0;

            for (let j = startSample + 1; j < endSample; j += 1) {
                const curr = pcmData[j];
                const prev = pcmData[j - 1];

                if ((curr >= 0 && prev < 0) || (curr < 0 && prev >= 0)) {
                    zeroCrossings += 1;
                }

                const highPass = curr - prev;
                highPassEnergy += highPass * highPass;
                lowPassEnergy += Math.abs(curr) * Math.abs(curr);
            }

            const blockSize = endSample - startSample;
            const zeroCrossingRate =
                blockSize > 0 ? zeroCrossings / blockSize : 0;

            const totalEnergy = rms + 0.001;

            let lowEnergy = rms * (1.0 - zeroCrossingRate * 2);
            let midEnergy = rms * 0.5;
            let highEnergy = rms * zeroCrossingRate * 3;

            const denom = maxVal + Math.abs(minVal) + 0.001;
            const peakiness = denom > 0 ? (maxVal - Math.abs(minVal)) / denom : 0;
            lowEnergy += Math.abs(peakiness) * rms * 0.3;

            lowEnergy = Math.max(0, Math.min(1, lowEnergy / totalEnergy));
            midEnergy = Math.max(0, Math.min(1, midEnergy / totalEnergy));
            highEnergy = Math.max(0, Math.min(1, highEnergy / totalEnergy));

            bandEnergies[i * 3 + 0] = lowEnergy;
            bandEnergies[i * 3 + 1] = midEnergy;
            bandEnergies[i * 3 + 2] = highEnergy;
        }

        lods.push({
            samplesPerPixel,
            lengthInPixels,
            amplitude,
            bandEnergies,
        });
    }

    return {
        totalSamples,
        sampleRate,
        lods,
        bands: bandConfig,
    };
}

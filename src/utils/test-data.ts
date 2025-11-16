/**
 * Test Data Generator
 * Creates synthetic waveform and audio state data for testing
 */

import type {
  WaveformPyramid,
  WaveformLOD,
  WaveformBandConfig,
  DeckState,
  DeckTransportState,
  LoopState,
  CuePoint,
  SectionMarker,
  AudioVisualState,
  MasterMeter,
} from '../types/audio-state.ts';

export interface TestTrackConfig {
  durationSeconds: number;
  sampleRate: number;
  bpm: number;
  key: string;
  title: string;
  artist: string;
}

export function generateTestWaveform(config: TestTrackConfig): WaveformPyramid {
  const totalSamples = Math.floor(config.durationSeconds * config.sampleRate);

  const bandConfig: WaveformBandConfig = {
    bandCount: 3,
    sampleRate: config.sampleRate,
    frequencyRanges: [
      { min: 20, max: 250 }, // Low
      { min: 250, max: 4000 }, // Mid
      { min: 4000, max: 20000 }, // High
    ],
  };

  // Generate multiple LODs
  const lods: WaveformLOD[] = [];
  const lodSamplesPerPixel = [64, 128, 256, 512, 1024, 2048, 4096];

  for (const samplesPerPixel of lodSamplesPerPixel) {
    const lengthInPixels = Math.ceil(totalSamples / samplesPerPixel);

    // Generate amplitude envelope (min/max pairs)
    const amplitude = new Float32Array(lengthInPixels * 2);

    // Generate band energies (interleaved: low, mid, high for each pixel)
    const bandEnergies = new Float32Array(lengthInPixels * 3);

    // Simulate a realistic EDM track structure
    const samplesPerBeat = (config.sampleRate * 60) / config.bpm;
    const samplesPerBar = samplesPerBeat * 4;

    for (let i = 0; i < lengthInPixels; i++) {
      const samplePos = i * samplesPerPixel;
      const timeSeconds = samplePos / config.sampleRate;
      const beatPos = samplePos / samplesPerBeat;
      const barPos = samplePos / samplesPerBar;

      // Simulate track sections
      const section = getTrackSection(timeSeconds, config.durationSeconds);

      // Generate amplitude based on section and beat
      const beatPhase = beatPos % 1;
      const barPhase = barPos % 1;

      let baseAmplitude = 0.3;

      // Add kick drum transients on beats
      if (beatPhase < 0.1) {
        baseAmplitude += 0.4 * (1.0 - beatPhase / 0.1);
      }

      // Section-based amplitude variation
      switch (section) {
        case 'intro':
          baseAmplitude *= 0.6;
          break;
        case 'breakdown':
          baseAmplitude *= 0.4;
          break;
        case 'drop':
          baseAmplitude *= 1.2;
          break;
        case 'outro':
          baseAmplitude *= 0.5;
          break;
      }

      // Add some randomness
      const noise = (Math.random() - 0.5) * 0.1;
      baseAmplitude = Math.max(0.1, Math.min(1.0, baseAmplitude + noise));

      // Min and max amplitude
      const variation = Math.random() * 0.1;
      amplitude[i * 2 + 0] = baseAmplitude * (1 - variation); // min
      amplitude[i * 2 + 1] = baseAmplitude; // max

      // Generate band energies based on section and beat
      let lowEnergy = 0.3;
      let midEnergy = 0.3;
      let highEnergy = 0.2;

      // Kick drum increases low energy
      if (beatPhase < 0.15) {
        lowEnergy += 0.5 * (1.0 - beatPhase / 0.15);
      }

      // Hi-hats on off-beats increase high energy
      if (Math.abs(beatPhase - 0.5) < 0.1) {
        highEnergy += 0.3;
      }

      // Section variations
      switch (section) {
        case 'intro':
          lowEnergy *= 0.5;
          highEnergy *= 1.2;
          break;
        case 'breakdown':
          lowEnergy *= 0.3;
          midEnergy *= 1.3;
          highEnergy *= 0.8;
          break;
        case 'drop':
          lowEnergy *= 1.4;
          midEnergy *= 1.2;
          highEnergy *= 1.1;
          break;
      }

      // Normalize and add noise
      const totalEnergy = lowEnergy + midEnergy + highEnergy;
      bandEnergies[i * 3 + 0] = Math.min(1.0, (lowEnergy / totalEnergy) * 3 * (0.9 + Math.random() * 0.2));
      bandEnergies[i * 3 + 1] = Math.min(1.0, (midEnergy / totalEnergy) * 3 * (0.9 + Math.random() * 0.2));
      bandEnergies[i * 3 + 2] = Math.min(1.0, (highEnergy / totalEnergy) * 3 * (0.9 + Math.random() * 0.2));
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
  durationSeconds: number
): 'intro' | 'verse' | 'breakdown' | 'drop' | 'outro' {
  const progress = timeSeconds / durationSeconds;

  if (progress < 0.1) return 'intro';
  if (progress < 0.3) return 'verse';
  if (progress < 0.4) return 'breakdown';
  if (progress < 0.7) return 'drop';
  if (progress < 0.85) return 'breakdown';
  return 'outro';
}

export function generateTestCuePoints(config: TestTrackConfig): CuePoint[] {
  const samplesPerBeat = (config.sampleRate * 60) / config.bpm;
  const samplesPerBar = samplesPerBeat * 4;
  const totalBars = Math.floor((config.durationSeconds * config.sampleRate) / samplesPerBar);

  const cuePoints: CuePoint[] = [];

  // Add cue points at significant locations
  const cueLocations = [
    { bar: 0, label: 'Intro', color: [255, 200, 50] as const },
    { bar: Math.floor(totalBars * 0.1), label: 'Verse', color: [50, 200, 255] as const },
    { bar: Math.floor(totalBars * 0.3), label: 'Breakdown', color: [200, 100, 255] as const },
    { bar: Math.floor(totalBars * 0.4), label: 'Drop', color: [255, 50, 50] as const },
    { bar: Math.floor(totalBars * 0.7), label: 'Break 2', color: [200, 100, 255] as const },
    { bar: Math.floor(totalBars * 0.85), label: 'Outro', color: [100, 255, 100] as const },
  ];

  for (let i = 0; i < cueLocations.length; i++) {
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
      type: 'intro',
      label: 'Intro',
    },
    {
      startSample: totalSamples * 0.1,
      endSample: totalSamples * 0.3,
      type: 'verse',
      label: 'Verse',
    },
    {
      startSample: totalSamples * 0.3,
      endSample: totalSamples * 0.4,
      type: 'breakdown',
      label: 'Breakdown',
    },
    {
      startSample: totalSamples * 0.4,
      endSample: totalSamples * 0.7,
      type: 'drop',
      label: 'Drop',
    },
    {
      startSample: totalSamples * 0.7,
      endSample: totalSamples * 0.85,
      type: 'breakdown',
      label: 'Breakdown 2',
    },
    {
      startSample: totalSamples * 0.85,
      endSample: totalSamples,
      type: 'outro',
      label: 'Outro',
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
    id: 'deck-a',
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

export function createTestAudioVisualState(decks: DeckState[]): AudioVisualState {
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
  isPlaying: boolean
): DeckState {
  if (!isPlaying) return state;

  const newPlayhead = state.transport.playheadSamples + state.waveform.sampleRate * deltaTime * state.transport.rate;

  // Calculate beat info
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

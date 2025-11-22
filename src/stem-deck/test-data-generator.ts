/**
 * Test Data Generator for Stem-Aware Deck
 *
 * Generates synthetic waveform data matching the plugin interface contracts.
 * This allows development/testing of the GPU renderer without real audio analysis.
 *
 * When real plugins are ready (FFT, beat detection, stem separation via WASM),
 * this generator can be replaced without touching the renderer.
 */

import type {
  StemType,
  WaveformLODData,
  StemWaveformPyramid,
  MultiStemTrack,
  MultiBandConfig,
  BeatGridData,
  CuePoint,
  SectionMarker,
  StemDeckState,
  DeckTransportState,
  StemDeckVisualConfig,
  StemVisualState,
  WaveformKnobs,
  BANDS_8
} from './types.js';

// ============================================================================
// LOD LEVEL DEFINITIONS
// ============================================================================

const LOD_SAMPLES_PER_PIXEL = [64, 128, 256, 512, 1024, 2048, 4096] as const;

// ============================================================================
// SYNTHETIC WAVEFORM GENERATION
// ============================================================================

/**
 * Generate synthetic waveform LOD data
 *
 * Creates realistic-looking amplitude and band energy data with:
 * - Varied dynamics (quiet/loud sections)
 * - Frequency-dependent energy (bass-heavy vs treble-heavy)
 * - Transients and sustained sections
 */
function generateSyntheticLOD(
  totalSamples: number,
  samplesPerPixel: number,
  bandCount: number,
  stemType: StemType,
  seed: number = 0
): WaveformLODData {
  const lengthInPixels = Math.ceil(totalSamples / samplesPerPixel);

  const amplitude = new Float32Array(lengthInPixels * 2);
  const bandEnergies = new Float32Array(lengthInPixels * bandCount);
  const rms = new Float32Array(lengthInPixels);

  // Seeded random for reproducibility
  let randomState = seed;
  const random = () => {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 0xffffffff;
  };

  // Stem-specific characteristics
  const stemProfile = getStemProfile(stemType);

  for (let i = 0; i < lengthInPixels; i++) {
    const progress = i / lengthInPixels;

    // Create structure: intro (0-20%), build (20-40%), peak (40-80%), outro (80-100%)
    let sectionEnergy = 1.0;
    if (progress < 0.2) {
      sectionEnergy = 0.3 + progress * 2.0; // Build up
    } else if (progress > 0.8) {
      sectionEnergy = 1.0 - (progress - 0.8) * 3.0; // Fade out
    } else if (progress > 0.4 && progress < 0.8) {
      sectionEnergy = 1.0; // Peak energy
    } else {
      sectionEnergy = 0.6 + Math.sin(progress * Math.PI * 4) * 0.2;
    }

    sectionEnergy = Math.max(0.1, Math.min(1.0, sectionEnergy));

    // Add transients (kicks, snares, vocal hits)
    const transientProbability = stemProfile.transientDensity;
    const hasTransient = random() < transientProbability / (samplesPerPixel / 64);
    const transientBoost = hasTransient ? 1.5 : 1.0;

    // Base amplitude with randomness
    const baseAmp = sectionEnergy * stemProfile.baseAmplitude * transientBoost;
    const noise = (random() - 0.5) * 0.2;

    const minVal = -baseAmp + noise;
    const maxVal = baseAmp + noise;

    amplitude[i * 2 + 0] = Math.max(-1.0, Math.min(0.0, minVal));
    amplitude[i * 2 + 1] = Math.max(0.0, Math.min(1.0, maxVal));

    // RMS
    rms[i] = baseAmp * 0.7;

    // Band energies (frequency-dependent)
    for (let band = 0; band < bandCount; band++) {
      const bandWeight = stemProfile.bandWeights[band] || 0.33;
      const bandNoise = (random() - 0.5) * 0.1;

      let bandEnergy = sectionEnergy * bandWeight * transientBoost + bandNoise;
      bandEnergy = Math.max(0.0, Math.min(1.0, bandEnergy));

      bandEnergies[i * bandCount + band] = bandEnergy;
    }
  }

  return {
    samplesPerPixel,
    lengthInPixels,
    amplitude,
    bandEnergies,
    rms
  };
}

/**
 * Stem profiles define frequency and dynamic characteristics
 */
interface StemProfile {
  baseAmplitude: number;
  transientDensity: number; // 0.0 - 1.0
  bandWeights: number[]; // Weight per band (8 bands assumed)
}

function getStemProfile(stemType: StemType): StemProfile {
  switch (stemType) {
    case 'drums':
      return {
        baseAmplitude: 0.8,
        transientDensity: 0.8, // Lots of transients
        bandWeights: [
          0.9, // Sub-bass (kick)
          0.85, // Bass (kick fundamental)
          0.4, // Low-mid
          0.5, // Mid (snare body)
          0.6, // Upper-mid (snare snap)
          0.5, // Presence
          0.7, // Brilliance (hihat)
          0.6 // Air (cymbals)
        ]
      };

    case 'bass':
      return {
        baseAmplitude: 0.7,
        transientDensity: 0.3, // Some plucks
        bandWeights: [
          1.0, // Sub-bass
          0.95, // Bass
          0.6, // Low-mid (harmonics)
          0.3, // Mid
          0.1, // Upper-mid
          0.05, // Presence
          0.02, // Brilliance
          0.01 // Air
        ]
      };

    case 'vocals':
      return {
        baseAmplitude: 0.6,
        transientDensity: 0.5, // Consonants
        bandWeights: [
          0.1, // Sub-bass
          0.2, // Bass
          0.4, // Low-mid
          0.8, // Mid (vowels)
          0.9, // Upper-mid (clarity)
          1.0, // Presence (sibilance)
          0.7, // Brilliance
          0.4 // Air (breath)
        ]
      };

    case 'other':
      return {
        baseAmplitude: 0.5,
        transientDensity: 0.4,
        bandWeights: [
          0.3, // Sub-bass
          0.4, // Bass
          0.6, // Low-mid
          0.7, // Mid
          0.7, // Upper-mid
          0.6, // Presence
          0.5, // Brilliance
          0.4 // Air
        ]
      };

    case 'master':
    default:
      return {
        baseAmplitude: 0.8,
        transientDensity: 0.6,
        bandWeights: [0.7, 0.75, 0.6, 0.7, 0.7, 0.65, 0.6, 0.5] // Balanced
      };
  }
}

/**
 * Generate complete waveform pyramid for a stem
 */
export function generateStemPyramid(
  totalSamples: number,
  sampleRate: number,
  bandCount: number,
  stemType: StemType,
  seed: number = 0
): StemWaveformPyramid {
  const lods: WaveformLODData[] = [];

  for (const samplesPerPixel of LOD_SAMPLES_PER_PIXEL) {
    const lod = generateSyntheticLOD(
      totalSamples,
      samplesPerPixel,
      bandCount,
      stemType,
      seed + samplesPerPixel
    );
    lods.push(lod);
  }

  return {
    stemType,
    totalSamples,
    sampleRate,
    lods,
    bandCount
  };
}

// ============================================================================
// MULTI-STEM TRACK GENERATION
// ============================================================================

export interface GenerateTrackOptions {
  durationSeconds?: number;
  sampleRate?: number;
  bandCount?: number;
  includeDrums?: boolean;
  includeBass?: boolean;
  includeVocals?: boolean;
  includeOther?: boolean;
  bpm?: number;
  trackTitle?: string;
  trackArtist?: string;
  seed?: number;
}

/**
 * Generate a complete multi-stem track with realistic test data
 */
export function generateMultiStemTrack(
  options: GenerateTrackOptions = {}
): MultiStemTrack {
  const {
    durationSeconds = 180, // 3 minutes default
    sampleRate = 44100,
    bandCount = 8,
    includeDrums = true,
    includeBass = true,
    includeVocals = true,
    includeOther = true,
    bpm = 128,
    trackTitle = 'Test Track',
    trackArtist = 'Synthetic Artist',
    seed = 12345
  } = options;

  const totalSamples = Math.floor(durationSeconds * sampleRate);
  const stems = new Map<StemType, StemWaveformPyramid>();

  // Generate master (always present)
  const master = generateStemPyramid(totalSamples, sampleRate, bandCount, 'master', seed);

  // Generate individual stems
  if (includeDrums) {
    stems.set('drums', generateStemPyramid(totalSamples, sampleRate, bandCount, 'drums', seed + 1));
  }
  if (includeBass) {
    stems.set('bass', generateStemPyramid(totalSamples, sampleRate, bandCount, 'bass', seed + 2));
  }
  if (includeVocals) {
    stems.set('vocals', generateStemPyramid(totalSamples, sampleRate, bandCount, 'vocals', seed + 3));
  }
  if (includeOther) {
    stems.set('other', generateStemPyramid(totalSamples, sampleRate, bandCount, 'other', seed + 4));
  }

  return {
    id: `track_${Date.now()}`,
    totalSamples,
    sampleRate,
    duration: durationSeconds,
    stems,
    master,
    trackTitle,
    trackArtist,
    bpm
  };
}

// ============================================================================
// BEAT GRID GENERATION
// ============================================================================

export function generateBeatGrid(
  totalSamples: number,
  sampleRate: number,
  bpm: number,
  timeSignature: { numerator: number; denominator: number } = { numerator: 4, denominator: 4 }
): BeatGridData {
  const samplesPerBeat = (sampleRate * 60) / bpm;
  const beatCount = Math.floor(totalSamples / samplesPerBeat);

  const beatPositions: number[] = [];
  const barPositions: number[] = [];

  for (let i = 0; i < beatCount; i++) {
    const samplePos = Math.floor(i * samplesPerBeat);
    beatPositions.push(samplePos);

    // Mark bar starts (downbeats)
    if (i % timeSignature.numerator === 0) {
      barPositions.push(samplePos);
    }
  }

  return {
    bpm,
    beatPhaseOffset: 0.0,
    timeSignature,
    beatPositions,
    barPositions
  };
}

// ============================================================================
// CUE POINTS & MARKERS
// ============================================================================

export function generateCuePoints(
  totalSamples: number,
  beatGrid: BeatGridData
): CuePoint[] {
  const cues: CuePoint[] = [];

  // Add cue at first downbeat
  if (beatGrid.barPositions && beatGrid.barPositions.length > 0) {
    cues.push({
      id: 'cue_intro',
      samplePosition: beatGrid.barPositions[0],
      type: 'load',
      label: 'Intro',
      color: { r: 0.0, g: 1.0, b: 0.0 }
    });
  }

  // Add cue at 25% (verse start)
  if (beatGrid.barPositions && beatGrid.barPositions.length > 4) {
    const verseBar = Math.floor(beatGrid.barPositions.length * 0.25);
    cues.push({
      id: 'cue_verse',
      samplePosition: beatGrid.barPositions[verseBar],
      type: 'hot',
      label: 'Verse',
      color: { r: 1.0, g: 1.0, b: 0.0 }
    });
  }

  // Add cue at 50% (drop)
  if (beatGrid.barPositions && beatGrid.barPositions.length > 8) {
    const dropBar = Math.floor(beatGrid.barPositions.length * 0.5);
    cues.push({
      id: 'cue_drop',
      samplePosition: beatGrid.barPositions[dropBar],
      type: 'hot',
      label: 'Drop',
      color: { r: 1.0, g: 0.0, b: 0.0 }
    });
  }

  // Add cue at 75% (breakdown)
  if (beatGrid.barPositions && beatGrid.barPositions.length > 12) {
    const breakdownBar = Math.floor(beatGrid.barPositions.length * 0.75);
    cues.push({
      id: 'cue_breakdown',
      samplePosition: beatGrid.barPositions[breakdownBar],
      type: 'hot',
      label: 'Breakdown',
      color: { r: 0.0, g: 0.5, b: 1.0 }
    });
  }

  return cues;
}

export function generateSectionMarkers(
  totalSamples: number,
  beatGrid: BeatGridData
): SectionMarker[] {
  if (!beatGrid.barPositions || beatGrid.barPositions.length < 4) {
    return [];
  }

  const sections: SectionMarker[] = [];
  const totalBars = beatGrid.barPositions.length;

  // Intro (0-25%)
  sections.push({
    id: 'section_intro',
    startSample: beatGrid.barPositions[0],
    endSample: beatGrid.barPositions[Math.floor(totalBars * 0.25)],
    label: 'Intro',
    color: { r: 0.3, g: 0.6, b: 1.0 }
  });

  // Verse (25-50%)
  sections.push({
    id: 'section_verse',
    startSample: beatGrid.barPositions[Math.floor(totalBars * 0.25)],
    endSample: beatGrid.barPositions[Math.floor(totalBars * 0.5)],
    label: 'Verse',
    color: { r: 0.6, g: 1.0, b: 0.3 }
  });

  // Drop (50-75%)
  sections.push({
    id: 'section_drop',
    startSample: beatGrid.barPositions[Math.floor(totalBars * 0.5)],
    endSample: beatGrid.barPositions[Math.floor(totalBars * 0.75)],
    label: 'Drop',
    color: { r: 1.0, g: 0.3, b: 0.3 }
  });

  // Outro (75-100%)
  sections.push({
    id: 'section_outro',
    startSample: beatGrid.barPositions[Math.floor(totalBars * 0.75)],
    endSample: totalSamples,
    label: 'Outro',
    color: { r: 1.0, g: 0.8, b: 0.3 }
  });

  return sections;
}

// ============================================================================
// DEFAULT VISUAL CONFIGURATION
// ============================================================================

export function createDefaultStemVisualState(stemType: StemType): StemVisualState {
  const colors: Record<StemType, { r: number; g: number; b: number }> = {
    drums: { r: 1.0, g: 0.2, b: 0.2 }, // Red
    bass: { r: 0.2, g: 0.5, b: 1.0 }, // Blue
    vocals: { r: 1.0, g: 0.8, b: 0.2 }, // Yellow
    other: { r: 0.5, g: 1.0, b: 0.5 }, // Green
    master: { r: 0.8, g: 0.8, b: 0.8 } // Gray
  };

  return {
    stemType,
    isSolo: false,
    isMuted: false,
    gain: 1.0,
    opacity: 1.0,
    color: colors[stemType]
  };
}

export function createDefaultVisualConfig(
  activeStems: StemType[] = ['drums', 'bass', 'vocals', 'other']
): StemDeckVisualConfig {
  const stemStates = new Map<StemType, StemVisualState>();

  for (const stem of activeStems) {
    stemStates.set(stem, createDefaultStemVisualState(stem));
  }

  return {
    activeStems: new Set(activeStems),
    stemStates,
    layoutMode: 'overlay',
    blendMode: 'additive',
    bandCount: 8,
    showBeatGrid: true,
    showCuePoints: true
  };
}

// ============================================================================
// COMPLETE DECK STATE GENERATION
// ============================================================================

export function generateStemDeckState(options: GenerateTrackOptions = {}): StemDeckState {
  const track = generateMultiStemTrack(options);
  const beatGrid = generateBeatGrid(track.totalSamples, track.sampleRate, track.bpm || 128);
  const cuePoints = generateCuePoints(track.totalSamples, beatGrid);
  const sections = generateSectionMarkers(track.totalSamples, beatGrid);

  const activeStems: StemType[] = [];
  if (options.includeDrums !== false) activeStems.push('drums');
  if (options.includeBass !== false) activeStems.push('bass');
  if (options.includeVocals !== false) activeStems.push('vocals');
  if (options.includeOther !== false) activeStems.push('other');

  const visual = createDefaultVisualConfig(activeStems);

  const transport: DeckTransportState = {
    playheadSamples: 0,
    rate: 1.0,
    isPlaying: false,
    isSlipMode: false,
    slipPlayheadSamples: 0,
    beatPhase: 0.0,
    barIndex: 0,
    beatInBar: 0
  };

  return {
    id: `deck_${Date.now()}`,
    track,
    transport,
    visual,
    beatGrid,
    cuePoints,
    sections,
    loop: undefined,
    zoom: 1.0,
    trackTitle: track.trackTitle,
    trackArtist: track.trackArtist
  };
}

// ============================================================================
// MOCK PLUGIN IMPLEMENTATION (Optional - for testing plugin interface)
// ============================================================================

import type { AudioAnalysisPlugin } from './types.js';

export class MockAudioAnalyzer implements AudioAnalysisPlugin {
  readonly name = 'mock-analyzer';
  readonly version = '1.0.0';

  async analyze(
    pcmData: Float32Array,
    sampleRate: number,
    config: MultiBandConfig
  ): Promise<StemWaveformPyramid> {
    const totalSamples = pcmData.length;
    return generateStemPyramid(totalSamples, sampleRate, config.bandCount, 'master');
  }

  async detectBeats(pcmData: Float32Array, sampleRate: number): Promise<BeatGridData> {
    return generateBeatGrid(pcmData.length, sampleRate, 128);
  }

  async separateStems(
    pcmData: Float32Array,
    sampleRate: number
  ): Promise<Map<StemType, Float32Array>> {
    // Mock: just return copies of the original
    const stems = new Map<StemType, Float32Array>();
    stems.set('drums', new Float32Array(pcmData));
    stems.set('bass', new Float32Array(pcmData));
    stems.set('vocals', new Float32Array(pcmData));
    stems.set('other', new Float32Array(pcmData));
    return stems;
  }
}

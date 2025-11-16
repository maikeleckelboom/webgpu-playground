import { describe, it, expect } from 'vitest';
import {
  generateTestWaveform,
  generateTestCuePoints,
  generateTestSections,
  createTestDeckState,
  createTestAudioVisualState,
  updateTransportPlayback,
  type TestTrackConfig,
} from '../src/utils/test-data.ts';

describe('Test Data Generator', () => {
  const defaultConfig: TestTrackConfig = {
    durationSeconds: 180, // 3 minutes
    sampleRate: 44100,
    bpm: 128,
    key: '8B',
    title: 'Test Track',
    artist: 'Test Artist',
  };

  describe('generateTestWaveform', () => {
    it('should generate waveform pyramid with correct total samples', () => {
      const waveform = generateTestWaveform(defaultConfig);
      const expectedSamples = Math.floor(defaultConfig.durationSeconds * defaultConfig.sampleRate);

      expect(waveform.totalSamples).toBe(expectedSamples);
      expect(waveform.sampleRate).toBe(defaultConfig.sampleRate);
    });

    it('should generate multiple LOD levels', () => {
      const waveform = generateTestWaveform(defaultConfig);

      expect(waveform.lods.length).toBe(7);
      expect(waveform.lods[0].samplesPerPixel).toBe(64);
      expect(waveform.lods[6].samplesPerPixel).toBe(4096);
    });

    it('should create valid amplitude data', () => {
      const waveform = generateTestWaveform(defaultConfig);
      const lod = waveform.lods[0];

      // Check amplitude array size
      expect(lod.amplitude.length).toBe(lod.lengthInPixels * 2);

      // Check amplitude values are in valid range
      for (let i = 0; i < lod.lengthInPixels; i++) {
        const min = lod.amplitude[i * 2];
        const max = lod.amplitude[i * 2 + 1];

        expect(min).toBeGreaterThanOrEqual(0);
        expect(min).toBeLessThanOrEqual(1);
        expect(max).toBeGreaterThanOrEqual(min);
        expect(max).toBeLessThanOrEqual(1);
      }
    });

    it('should create valid band energies', () => {
      const waveform = generateTestWaveform(defaultConfig);
      const lod = waveform.lods[0];

      // Check band energies array size
      expect(lod.bandEnergies.length).toBe(lod.lengthInPixels * 3);

      // Check band energy values
      for (let i = 0; i < lod.lengthInPixels; i++) {
        const low = lod.bandEnergies[i * 3];
        const mid = lod.bandEnergies[i * 3 + 1];
        const high = lod.bandEnergies[i * 3 + 2];

        expect(low).toBeGreaterThanOrEqual(0);
        expect(low).toBeLessThanOrEqual(1);
        expect(mid).toBeGreaterThanOrEqual(0);
        expect(mid).toBeLessThanOrEqual(1);
        expect(high).toBeGreaterThanOrEqual(0);
        expect(high).toBeLessThanOrEqual(1);
      }
    });

    it('should configure 3-band frequency analysis', () => {
      const waveform = generateTestWaveform(defaultConfig);

      expect(waveform.bands.bandCount).toBe(3);
      expect(waveform.bands.sampleRate).toBe(defaultConfig.sampleRate);
      expect(waveform.bands.frequencyRanges).toHaveLength(3);
      expect(waveform.bands.frequencyRanges[0]).toEqual({ min: 20, max: 250 });
      expect(waveform.bands.frequencyRanges[1]).toEqual({ min: 250, max: 4000 });
      expect(waveform.bands.frequencyRanges[2]).toEqual({ min: 4000, max: 20000 });
    });

    it('should have decreasing pixel counts for higher LODs', () => {
      const waveform = generateTestWaveform(defaultConfig);

      for (let i = 1; i < waveform.lods.length; i++) {
        const prevLod = waveform.lods[i - 1];
        const currentLod = waveform.lods[i];

        expect(currentLod.samplesPerPixel).toBeGreaterThan(prevLod.samplesPerPixel);
        expect(currentLod.lengthInPixels).toBeLessThan(prevLod.lengthInPixels);
      }
    });

    it('should handle short duration tracks', () => {
      const shortConfig = { ...defaultConfig, durationSeconds: 10 };
      const waveform = generateTestWaveform(shortConfig);

      expect(waveform.totalSamples).toBe(441000); // 10 * 44100
      expect(waveform.lods.length).toBe(7);
    });

    it('should handle different sample rates', () => {
      const highSampleRateConfig = { ...defaultConfig, sampleRate: 96000 };
      const waveform = generateTestWaveform(highSampleRateConfig);

      expect(waveform.sampleRate).toBe(96000);
      expect(waveform.totalSamples).toBe(180 * 96000);
    });
  });

  describe('generateTestCuePoints', () => {
    it('should generate cue points at track sections', () => {
      const cuePoints = generateTestCuePoints(defaultConfig);

      expect(cuePoints.length).toBe(6);
      expect(cuePoints[0].label).toBe('Intro');
      expect(cuePoints[1].label).toBe('Verse');
      expect(cuePoints[2].label).toBe('Breakdown');
      expect(cuePoints[3].label).toBe('Drop');
      expect(cuePoints[4].label).toBe('Break 2');
      expect(cuePoints[5].label).toBe('Outro');
    });

    it('should have unique IDs', () => {
      const cuePoints = generateTestCuePoints(defaultConfig);
      const ids = cuePoints.map((cp) => cp.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(cuePoints.length);
    });

    it('should have valid colors', () => {
      const cuePoints = generateTestCuePoints(defaultConfig);

      for (const cue of cuePoints) {
        expect(cue.color).toHaveLength(3);
        for (const channel of cue.color) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
    });

    it('should have increasing sample positions', () => {
      const cuePoints = generateTestCuePoints(defaultConfig);

      for (let i = 1; i < cuePoints.length; i++) {
        expect(cuePoints[i].samplePosition).toBeGreaterThan(cuePoints[i - 1].samplePosition);
      }
    });

    it('should align to bar boundaries', () => {
      const cuePoints = generateTestCuePoints(defaultConfig);
      const samplesPerBeat = (defaultConfig.sampleRate * 60) / defaultConfig.bpm;
      const samplesPerBar = samplesPerBeat * 4;

      for (const cue of cuePoints) {
        const barPosition = cue.samplePosition / samplesPerBar;
        // Should be at exact bar boundary
        expect(barPosition % 1).toBeCloseTo(0, 5);
      }
    });
  });

  describe('generateTestSections', () => {
    it('should generate 6 sections', () => {
      const sections = generateTestSections(defaultConfig);
      expect(sections).toHaveLength(6);
    });

    it('should cover entire track duration', () => {
      const sections = generateTestSections(defaultConfig);
      const totalSamples = defaultConfig.durationSeconds * defaultConfig.sampleRate;

      expect(sections[0].startSample).toBe(0);
      expect(sections[sections.length - 1].endSample).toBe(totalSamples);
    });

    it('should have contiguous sections', () => {
      const sections = generateTestSections(defaultConfig);

      for (let i = 1; i < sections.length; i++) {
        expect(sections[i].startSample).toBe(sections[i - 1].endSample);
      }
    });

    it('should have valid section types', () => {
      const sections = generateTestSections(defaultConfig);
      const validTypes = ['intro', 'verse', 'chorus', 'breakdown', 'drop', 'outro', 'bridge'];

      for (const section of sections) {
        expect(validTypes).toContain(section.type);
      }
    });

    it('should include all expected section types', () => {
      const sections = generateTestSections(defaultConfig);
      const types = sections.map((s) => s.type);

      expect(types).toContain('intro');
      expect(types).toContain('verse');
      expect(types).toContain('breakdown');
      expect(types).toContain('drop');
      expect(types).toContain('outro');
    });
  });

  describe('createTestDeckState', () => {
    it('should create complete deck state', () => {
      const deckState = createTestDeckState(defaultConfig);

      expect(deckState.id).toBe('deck-a');
      expect(deckState.transport).toBeDefined();
      expect(deckState.loop).toBeDefined();
      expect(deckState.cuePoints).toBeDefined();
      expect(deckState.sections).toBeDefined();
      expect(deckState.waveform).toBeDefined();
    });

    it('should set track metadata correctly', () => {
      const deckState = createTestDeckState(defaultConfig);

      expect(deckState.trackTitle).toBe(defaultConfig.title);
      expect(deckState.trackArtist).toBe(defaultConfig.artist);
      expect(deckState.trackKey).toBe(defaultConfig.key);
      expect(deckState.trackDurationSamples).toBe(deckState.waveform.totalSamples);
    });

    it('should initialize transport at beginning', () => {
      const deckState = createTestDeckState(defaultConfig);

      expect(deckState.transport.playheadSamples).toBe(0);
      expect(deckState.transport.rate).toBe(1.0);
      expect(deckState.transport.bpm).toBe(defaultConfig.bpm);
      expect(deckState.transport.beatPhase).toBe(0);
      expect(deckState.transport.barIndex).toBe(0);
      expect(deckState.transport.beatInBar).toBe(0);
      expect(deckState.transport.isPlaying).toBe(false);
    });

    it('should set loop to 8 bars', () => {
      const deckState = createTestDeckState(defaultConfig);
      const samplesPerBeat = (defaultConfig.sampleRate * 60) / defaultConfig.bpm;
      const samplesPerBar = samplesPerBeat * 4;

      expect(deckState.loop.active).toBe(false);
      expect(deckState.loop.inSample).toBe(samplesPerBar * 8);
      expect(deckState.loop.outSample).toBe(samplesPerBar * 16);
    });

    it('should include generated waveform', () => {
      const deckState = createTestDeckState(defaultConfig);

      expect(deckState.waveform.totalSamples).toBeGreaterThan(0);
      expect(deckState.waveform.lods.length).toBe(7);
    });

    it('should include cue points', () => {
      const deckState = createTestDeckState(defaultConfig);

      expect(deckState.cuePoints.length).toBe(6);
    });

    it('should include sections', () => {
      const deckState = createTestDeckState(defaultConfig);

      expect(deckState.sections.length).toBe(6);
    });
  });

  describe('createTestAudioVisualState', () => {
    it('should create state with provided decks', () => {
      const deck = createTestDeckState(defaultConfig);
      const state = createTestAudioVisualState([deck]);

      expect(state.decks).toHaveLength(1);
      expect(state.decks[0]).toBe(deck);
    });

    it('should initialize timing at zero', () => {
      const deck = createTestDeckState(defaultConfig);
      const state = createTestAudioVisualState([deck]);

      expect(state.time).toBe(0);
      expect(state.deltaTime).toBe(0);
    });

    it('should initialize master meter', () => {
      const deck = createTestDeckState(defaultConfig);
      const state = createTestAudioVisualState([deck]);

      expect(state.master.rms).toBe(0.5);
      expect(state.master.peak).toBe(0.7);
      expect(state.master.peakHold).toBe(0.75);
      expect(state.master.lufs).toBe(-14);
      expect(state.master.lowEnergy).toBe(0.4);
      expect(state.master.midEnergy).toBe(0.5);
      expect(state.master.highEnergy).toBe(0.3);
      expect(state.master.leftPeak).toBe(0.68);
      expect(state.master.rightPeak).toBe(0.72);
      expect(state.master.correlation).toBe(0.95);
    });

    it('should center crossfader', () => {
      const deck = createTestDeckState(defaultConfig);
      const state = createTestAudioVisualState([deck]);

      expect(state.crossfaderPosition).toBe(0);
    });

    it('should handle multiple decks', () => {
      const deckA = createTestDeckState({ ...defaultConfig, title: 'Track A' });
      const deckB = createTestDeckState({ ...defaultConfig, title: 'Track B' });
      const state = createTestAudioVisualState([deckA, deckB]);

      expect(state.decks).toHaveLength(2);
      expect(state.decks[0].trackTitle).toBe('Track A');
      expect(state.decks[1].trackTitle).toBe('Track B');
    });
  });

  describe('updateTransportPlayback', () => {
    it('should not update when not playing', () => {
      const deck = createTestDeckState(defaultConfig);
      const updated = updateTransportPlayback(deck, 0.016, false);

      expect(updated.transport.playheadSamples).toBe(0);
      expect(updated).toBe(deck);
    });

    it('should advance playhead when playing', () => {
      const deck = createTestDeckState(defaultConfig);
      const deltaTime = 0.016; // 16ms
      const updated = updateTransportPlayback(deck, deltaTime, true);

      const expectedAdvance = deck.waveform.sampleRate * deltaTime;
      expect(updated.transport.playheadSamples).toBeCloseTo(expectedAdvance, 0);
    });

    it('should update beat phase', () => {
      const deck = createTestDeckState(defaultConfig);
      const updated = updateTransportPlayback(deck, 0.1, true); // 100ms

      expect(updated.transport.beatPhase).toBeGreaterThan(0);
      expect(updated.transport.beatPhase).toBeLessThan(1);
    });

    it('should update bar index', () => {
      const deck = createTestDeckState(defaultConfig);
      // Advance by more than one bar
      const samplesPerBeat = (deck.waveform.sampleRate * 60) / defaultConfig.bpm;
      const samplesPerBar = samplesPerBeat * 4;
      const timeForTwoBars = (samplesPerBar * 2) / deck.waveform.sampleRate;

      const updated = updateTransportPlayback(deck, timeForTwoBars, true);

      expect(updated.transport.barIndex).toBe(2);
    });

    it('should update beat in bar', () => {
      const deck = createTestDeckState(defaultConfig);
      // Advance by 2.5 beats
      const samplesPerBeat = (deck.waveform.sampleRate * 60) / defaultConfig.bpm;
      const timeForTwoAndHalfBeats = (samplesPerBeat * 2.5) / deck.waveform.sampleRate;

      const updated = updateTransportPlayback(deck, timeForTwoAndHalfBeats, true);

      expect(updated.transport.beatInBar).toBe(2);
    });

    it('should loop around track duration', () => {
      const deck = createTestDeckState(defaultConfig);
      // Advance beyond track duration
      const timeForLoop = deck.waveform.totalSamples / deck.waveform.sampleRate + 1;

      const updated = updateTransportPlayback(deck, timeForLoop, true);

      expect(updated.transport.playheadSamples).toBeLessThan(deck.waveform.totalSamples);
      expect(updated.transport.playheadSamples).toBeGreaterThan(0);
    });

    it('should respect playback rate', () => {
      const deck = createTestDeckState(defaultConfig);
      const modifiedDeck = {
        ...deck,
        transport: { ...deck.transport, rate: 2.0 },
      };

      const normalUpdate = updateTransportPlayback(deck, 0.1, true);
      const doubleSpeedUpdate = updateTransportPlayback(modifiedDeck, 0.1, true);

      expect(doubleSpeedUpdate.transport.playheadSamples).toBeCloseTo(
        normalUpdate.transport.playheadSamples * 2,
        0
      );
    });

    it('should set isPlaying flag', () => {
      const deck = createTestDeckState(defaultConfig);
      const updated = updateTransportPlayback(deck, 0.016, true);

      expect(updated.transport.isPlaying).toBe(true);
    });

    it('should preserve other deck state', () => {
      const deck = createTestDeckState(defaultConfig);
      const updated = updateTransportPlayback(deck, 0.016, true);

      expect(updated.id).toBe(deck.id);
      expect(updated.loop).toBe(deck.loop);
      expect(updated.cuePoints).toBe(deck.cuePoints);
      expect(updated.sections).toBe(deck.sections);
      expect(updated.waveform).toBe(deck.waveform);
      expect(updated.trackTitle).toBe(deck.trackTitle);
    });
  });
});

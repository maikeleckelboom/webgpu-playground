/**
 * Real-time Deck Waveform Component
 * Flagship WebGPU component for DJ-style waveform visualization
 * FIXED: Added texture size validation to prevent 0×0 textures
 */

import type {
    DeckWaveformController,
    Dimensions,
    VisualComponent,
    VisualContext,
    WaveformKnobState,
} from '../types/visual-component.ts';
import type {AudioVisualState, DeckState, WaveformPyramid} from '../types/audio-state.ts';
import waveformShaderCode from '../shaders/waveform.wgsl?raw';

// GPU Buffer alignments
const _UNIFORM_ALIGNMENT = 16;
const WAVEFORM_UNIFORMS_SIZE = 128; // 32 floats * 4 bytes

interface WaveformGPUResources {
    pipeline: GPURenderPipeline;
    uniformBuffer: GPUBuffer;
    amplitudeTexture: GPUTexture;
    bandsTexture: GPUTexture;
    sampler: GPUSampler;
    bindGroup: GPUBindGroup;
    bindGroupLayout: GPUBindGroupLayout;
}

export class DeckWaveformComponent implements VisualComponent, DeckWaveformController {
    readonly id: string;

    private device: GPUDevice | null = null;
    private ctx: VisualContext | null = null;
    private resources: WaveformGPUResources | null = null;
    private dimensions: Dimensions = {
        width: 800,
        height: 200,
        dpr: 1,
        physicalWidth: 800,
        physicalHeight: 200,
    };

    private deckIndex: number;
    private zoom = 1.0; // Zoom factor (higher = more zoomed in)
    private knobState: WaveformKnobState = {
        lowGain: 1.0,
        midGain: 1.0,
        highGain: 1.0,
        brightness: 1.0,
        contrast: 1.0,
        saturation: 1.0,
    };

    private showBeatGrid = true;
    private _showCuePoints = true;
    private _showLoopRegion = true;

    private currentDeckState: DeckState | null = null;
    private waveformUploaded = false;
    private currentLODIndex = 0;
    private hasLoggedFirstFrame = false;
    private waveformDirty = false;

    constructor(deckIndex: number) {
        this.id = `deck-waveform-${deckIndex}`;
        this.deckIndex = deckIndex;
    }

    async initialize(device: GPUDevice, ctx: VisualContext): Promise<void> {
        this.device = device;
        this.ctx = ctx;

        // Create shader module
        const shaderModule = device.createShaderModule({
            label: 'Waveform Shader',
            code: waveformShaderCode,
        });

        // Create bind group layout
        const bindGroupLayout = device.createBindGroupLayout({
            label: 'Waveform Bind Group Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {type: 'uniform'},
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {sampleType: 'unfilterable-float'},
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {sampleType: 'unfilterable-float'},
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {type: 'non-filtering'},
                },
            ],
        });

        // Create pipeline layout
        const pipelineLayout = device.createPipelineLayout({
            label: 'Waveform Pipeline Layout',
            bindGroupLayouts: [ctx.sharedBindGroupLayout, bindGroupLayout],
        });

        // Create render pipeline
        const pipeline = device.createRenderPipeline({
            label: 'Waveform Render Pipeline',
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{format: ctx.format}],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });

        // Create uniform buffer
        const uniformBuffer = device.createBuffer({
            label: 'Waveform Uniforms',
            size: WAVEFORM_UNIFORMS_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create placeholder textures (will be replaced when waveform is loaded)
        // FIXED: Use at least 1×1 size instead of potential 0×0
        const amplitudeTexture = device.createTexture({
            label: 'Amplitude Texture',
            size: [1, 1],
            format: 'rg32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        const bandsTexture = device.createTexture({
            label: 'Bands Texture',
            size: [1, 1],
            format: 'rgba32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        // Create sampler
        const sampler = device.createSampler({
            label: 'Waveform Sampler',
            magFilter: 'nearest',
            minFilter: 'nearest',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        // Create bind group
        const bindGroup = device.createBindGroup({
            label: 'Waveform Bind Group',
            layout: bindGroupLayout,
            entries: [
                {binding: 0, resource: {buffer: uniformBuffer}},
                {binding: 1, resource: amplitudeTexture.createView()},
                {binding: 2, resource: bandsTexture.createView()},
                {binding: 3, resource: sampler},
            ],
        });

        this.resources = {
            pipeline,
            uniformBuffer,
            amplitudeTexture,
            bandsTexture,
            sampler,
            bindGroup,
            bindGroupLayout,
        };
    }

    resize(dim: Dimensions): void {
        this.dimensions = dim;
    }

    update(_dt: number, _time: number, audio: AudioVisualState): void {
        if (!this.device || !this.resources || !this.ctx) {
            return;
        }

        // Get deck state
        const deckState = audio.decks[this.deckIndex];
        if (!deckState) {
            return;
        }

        this.currentDeckState = deckState;

        // Select appropriate LOD based on zoom FIRST
        const newLODIndex = this.selectLOD(deckState.waveform);
        const lodChanged = newLODIndex !== this.currentLODIndex;
        this.currentLODIndex = newLODIndex;

        // Upload waveform data if not done yet, marked dirty, or LOD changed
        if ((!this.waveformUploaded || this.waveformDirty || lodChanged) && deckState.waveform) {
            if (deckState.waveform.lods.length > 0 && deckState.waveform.totalSamples > 0) {
                this.uploadWaveformData(deckState.waveform);
                this.waveformUploaded = true;
                this.waveformDirty = false;
            }
        }

        // Update uniforms
        this.updateUniforms(deckState);
    }

    // Mark waveform as needing re-upload (called when new track is loaded)
    markWaveformDirty(): void {
        this.waveformDirty = true;
        this.waveformUploaded = false;
    }

    encode(encoder: GPUCommandEncoder, view: GPUTextureView): void {
        if (!this.resources || !this.ctx) {
            console.warn('[DeckWaveformComponent] encode() skipped: resources or ctx is null');
            return;
        }

        // Log first frame in development to prove render is being called
        if (!this.hasLoggedFirstFrame) {
            console.log('[DeckWaveformComponent] First render frame', {
                hasTextures: Boolean(this.resources.amplitudeTexture && this.resources.bandsTexture),
                waveformUploaded: this.waveformUploaded,
                dimensions: this.dimensions,
                hasSharedBindGroup: Boolean(this.ctx.sharedBindGroup),
                hasWaveformBindGroup: Boolean(this.resources.bindGroup),
            });
            this.hasLoggedFirstFrame = true;
        }

        const renderPass = encoder.beginRenderPass({
            label: 'Waveform Render Pass',
            colorAttachments: [
                {
                    view,
                    loadOp: 'clear',
                    storeOp: 'store',
                    // Clear to same color as shader gradient top (dark blue) - ensures non-black even if shader fails
                    clearValue: {r: 0.05, g: 0.06, b: 0.12, a: 1.0},
                },
            ],
        });

        renderPass.setPipeline(this.resources.pipeline);
        renderPass.setBindGroup(0, this.ctx.sharedBindGroup);
        renderPass.setBindGroup(1, this.resources.bindGroup);
        renderPass.draw(6); // Full-screen quad

        renderPass.end();
    }

    destroy(): void {
        if (this.resources) {
            this.resources.uniformBuffer.destroy();
            this.resources.amplitudeTexture.destroy();
            this.resources.bandsTexture.destroy();
        }
    }

    // Controller interface
    setZoom(zoom: number): void {
        this.zoom = Math.max(0.1, Math.min(100.0, zoom));
    }

    setKnobState(state: Partial<WaveformKnobState>): void {
        this.knobState = {...this.knobState, ...state};
    }

    getKnobState(): WaveformKnobState {
        return {...this.knobState};
    }

    setShowBeatGrid(show: boolean): void {
        this.showBeatGrid = show;
    }

    setShowCuePoints(show: boolean): void {
        this._showCuePoints = show;
    }

    setShowLoopRegion(show: boolean): void {
        this._showLoopRegion = show;
    }

    private selectLOD(pyramid: WaveformPyramid): number {
        // Calculate desired samples per pixel based on zoom
        const desiredSamplesPerPixel = this.getBaseSamplesPerPixel() / this.zoom;

        // Find the LOD with the closest samples per pixel
        let bestIndex = 0;
        let bestDiff = Math.abs(pyramid.lods[0].samplesPerPixel - desiredSamplesPerPixel);

        for (let i = 1; i < pyramid.lods.length; i++) {
            const diff = Math.abs(pyramid.lods[i].samplesPerPixel - desiredSamplesPerPixel);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestIndex = i;
            }
        }

        return bestIndex;
    }

    private getBaseSamplesPerPixel(): number {
        // Base case: show about 10 seconds of audio across the view
        if (!this.currentDeckState) {
            return 441;
        }
        return (this.currentDeckState.waveform.sampleRate * 10) / this.dimensions.physicalWidth;
    }

    private uploadWaveformData(pyramid: WaveformPyramid): void {
        if (!this.device || !this.resources) {
            return;
        }

        // Validate pyramid data
        if (pyramid.lods.length === 0) {
            console.error('[DeckWaveformComponent] No LODs in waveform pyramid');
            return;
        }

        // Use the currently selected LOD index (based on zoom level)
        const lodIndex = Math.min(
            Math.max(0, this.currentLODIndex),
            pyramid.lods.length - 1
        );
        const lod = pyramid.lods[lodIndex];

        // FIXED: Validate LOD data and clamp dimensions
        if (!lod || lod.lengthInPixels === 0) {
            console.error('[DeckWaveformComponent] Invalid LOD data', {lodIndex, lod});
            return;
        }

        // FIXED: Clamp texture dimensions to at least 1×1
        const safeWidth = Math.max(1, lod.lengthInPixels);

        console.log('[DeckWaveformComponent] Uploading waveform data', {
            lodIndex,
            lengthInPixels: lod.lengthInPixels,
            safeWidth,
            samplesPerPixel: lod.samplesPerPixel,
            totalSamples: pyramid.totalSamples,
            amplitudeLength: lod.amplitude.length,
            bandEnergiesLength: lod.bandEnergies.length,
            bandCount: pyramid.bands.bandCount,
        });

        // Destroy old textures
        this.resources.amplitudeTexture.destroy();
        this.resources.bandsTexture.destroy();

        // FIXED: Create new amplitude texture with safe dimensions
        const amplitudeTexture = this.device.createTexture({
            label: 'Amplitude Texture',
            size: [safeWidth, 1],
            format: 'rg32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        // Validate amplitude data size
        const expectedAmplitudeSize = lod.lengthInPixels * 2;
        if (lod.amplitude.length !== expectedAmplitudeSize) {
            console.warn('[DeckWaveformComponent] Amplitude data size mismatch', {
                expected: expectedAmplitudeSize,
                actual: lod.amplitude.length,
            });
        }

        // Upload amplitude data - only if we have valid data
        if (lod.lengthInPixels > 0 && lod.amplitude.length >= expectedAmplitudeSize) {
            const amplitudeData = new Float32Array(safeWidth * 2);
            for (let i = 0; i < lod.lengthInPixels; i++) {
                amplitudeData[i * 2 + 0] = lod.amplitude[i * 2 + 0] ?? 0; // min
                amplitudeData[i * 2 + 1] = lod.amplitude[i * 2 + 1] ?? 0; // max
            }

            this.device.queue.writeTexture(
                {texture: amplitudeTexture},
                amplitudeData,
                {bytesPerRow: safeWidth * 8}, // 2 floats * 4 bytes
                {width: safeWidth, height: 1}
            );
        }

        // FIXED: Create bands texture with safe dimensions
        const bandsTexture = this.device.createTexture({
            label: 'Bands Texture',
            size: [safeWidth, 1],
            format: 'rgba32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        // Convert band energies to RGBA format
        const bandCount = pyramid.bands.bandCount;

        // Validate band data
        const expectedBandSize = lod.lengthInPixels * bandCount;
        if (lod.bandEnergies.length !== expectedBandSize) {
            console.warn('[DeckWaveformComponent] Band energies size mismatch', {
                expected: expectedBandSize,
                actual: lod.bandEnergies.length,
            });
        }

        // Upload band data - only if we have valid data
        if (lod.lengthInPixels > 0 && lod.bandEnergies.length >= expectedBandSize) {
            const bandsRGBA = new Float32Array(safeWidth * 4);
            for (let i = 0; i < lod.lengthInPixels; i++) {
                // Assuming interleaved band data: [low_0, mid_0, high_0, low_1, mid_1, high_1, ...]
                bandsRGBA[i * 4 + 0] = lod.bandEnergies[i * bandCount + 0] || 0;
                bandsRGBA[i * 4 + 1] = lod.bandEnergies[i * bandCount + 1] || 0;
                bandsRGBA[i * 4 + 2] = lod.bandEnergies[i * bandCount + 2] || 0;
                bandsRGBA[i * 4 + 3] = 1.0;
            }

            this.device.queue.writeTexture(
                {texture: bandsTexture},
                bandsRGBA,
                {bytesPerRow: safeWidth * 16}, // 4 floats * 4 bytes
                {width: safeWidth, height: 1}
            );
        }

        // Recreate bind group with new textures
        this.resources.amplitudeTexture = amplitudeTexture;
        this.resources.bandsTexture = bandsTexture;
        this.resources.bindGroup = this.device.createBindGroup({
            label: 'Waveform Bind Group',
            layout: this.resources.bindGroupLayout,
            entries: [
                {binding: 0, resource: {buffer: this.resources.uniformBuffer}},
                {binding: 1, resource: amplitudeTexture.createView()},
                {binding: 2, resource: bandsTexture.createView()},
                {binding: 3, resource: this.resources.sampler},
            ],
        });

        console.log('[DeckWaveformComponent] Waveform data uploaded successfully');
    }

    private updateUniforms(deckState: DeckState): void {
        if (!this.device || !this.resources) {
            return;
        }

        // Bounds check LOD index
        const lodIndex = Math.min(
            Math.max(0, this.currentLODIndex),
            deckState.waveform.lods.length - 1
        );
        const lod = deckState.waveform.lods[lodIndex];

        if (!lod) {
            console.error('[DeckWaveformComponent] LOD not found at index', lodIndex);
            return;
        }

        // Split playhead into high/low for precision
        const playheadHigh = Math.floor(deckState.transport.playheadSamples / 16777216);
        const playheadLow = deckState.transport.playheadSamples % 16777216;

        const uniformData = new Float32Array([
            // Playhead and sample info
            playheadHigh,
            playheadLow,
            deckState.waveform.sampleRate,
            deckState.waveform.totalSamples,

            // Zoom and view
            this.getBaseSamplesPerPixel() / this.zoom,
            this.dimensions.physicalWidth,
            this.dimensions.physicalHeight,
            this.currentLODIndex,

            // LOD info
            lod.samplesPerPixel,
            lod.lengthInPixels,
            deckState.waveform.bands.bandCount,
            0, // padding

            // Visual settings
            this.knobState.brightness,
            this.knobState.contrast,
            this.knobState.saturation,
            0, // padding

            // Band gains
            this.knobState.lowGain,
            this.knobState.midGain,
            this.knobState.highGain,
            0, // padding

            // Loop region
            deckState.loop.active ? 1.0 : 0.0,
            deckState.loop.inSample,
            deckState.loop.outSample,
            this.showBeatGrid ? 1.0 : 0.0,

            // Beat grid
            deckState.transport.bpm,
            deckState.transport.beatPhase,
            0, // padding
            0, // padding
        ]);

        // Log uniform values once after waveform upload for debugging
        if (this.waveformUploaded && !this.hasLoggedFirstFrame) {
            console.log('[DeckWaveformComponent] Uniform values being set:', {
                playheadSamples: deckState.transport.playheadSamples,
                playheadHigh,
                playheadLow,
                sampleRate: deckState.waveform.sampleRate,
                totalSamples: deckState.waveform.totalSamples,
                viewWidth: this.dimensions.physicalWidth,
                viewHeight: this.dimensions.physicalHeight,
                samplesPerPixel: this.getBaseSamplesPerPixel() / this.zoom,
                lodIndex: this.currentLODIndex,
                lodSamplesPerPixel: lod.samplesPerPixel,
                lodLengthInPixels: lod.lengthInPixels,
                bandCount: deckState.waveform.bands.bandCount,
            });
        }

        this.device.queue.writeBuffer(this.resources.uniformBuffer, 0, uniformData);
    }
}

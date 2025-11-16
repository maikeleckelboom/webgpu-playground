import { vi } from 'vitest';

// Mock WebGPU API for testing environments that don't support it
const createMockGPUDevice = (): GPUDevice => {
  const mockBuffer: GPUBuffer = {
    size: 0,
    usage: 0,
    mapState: 'unmapped',
    label: '',
    getMappedRange: vi.fn(),
    unmap: vi.fn(),
    destroy: vi.fn(),
    mapAsync: vi.fn().mockResolvedValue(undefined),
  } as unknown as GPUBuffer;

  const mockTexture: GPUTexture = {
    width: 0,
    height: 0,
    depthOrArrayLayers: 1,
    mipLevelCount: 1,
    sampleCount: 1,
    dimension: '2d',
    format: 'rgba8unorm',
    usage: 0,
    label: '',
    createView: vi.fn().mockReturnValue({
      label: '',
    } as GPUTextureView),
    destroy: vi.fn(),
  } as unknown as GPUTexture;

  const mockSampler: GPUSampler = {
    label: '',
  } as GPUSampler;

  const mockBindGroupLayout: GPUBindGroupLayout = {
    label: '',
  } as GPUBindGroupLayout;

  const mockBindGroup: GPUBindGroup = {
    label: '',
  } as GPUBindGroup;

  const mockPipelineLayout: GPUPipelineLayout = {
    label: '',
  } as GPUPipelineLayout;

  const mockShaderModule: GPUShaderModule = {
    label: '',
    getCompilationInfo: vi.fn().mockResolvedValue({ messages: [] }),
  } as unknown as GPUShaderModule;

  const mockRenderPipeline: GPURenderPipeline = {
    label: '',
    getBindGroupLayout: vi.fn().mockReturnValue(mockBindGroupLayout),
  } as unknown as GPURenderPipeline;

  const mockRenderPassEncoder: GPURenderPassEncoder = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
    setViewport: vi.fn(),
    setScissorRect: vi.fn(),
    setBlendConstant: vi.fn(),
    setStencilReference: vi.fn(),
    beginOcclusionQuery: vi.fn(),
    endOcclusionQuery: vi.fn(),
    executeBundles: vi.fn(),
    insertDebugMarker: vi.fn(),
    popDebugGroup: vi.fn(),
    pushDebugGroup: vi.fn(),
    setVertexBuffer: vi.fn(),
    setIndexBuffer: vi.fn(),
    drawIndexed: vi.fn(),
    drawIndirect: vi.fn(),
    drawIndexedIndirect: vi.fn(),
    label: '',
  } as unknown as GPURenderPassEncoder;

  const mockCommandEncoder: GPUCommandEncoder = {
    beginRenderPass: vi.fn().mockReturnValue(mockRenderPassEncoder),
    finish: vi.fn().mockReturnValue({} as GPUCommandBuffer),
    copyBufferToBuffer: vi.fn(),
    copyBufferToTexture: vi.fn(),
    copyTextureToBuffer: vi.fn(),
    copyTextureToTexture: vi.fn(),
    clearBuffer: vi.fn(),
    resolveQuerySet: vi.fn(),
    insertDebugMarker: vi.fn(),
    popDebugGroup: vi.fn(),
    pushDebugGroup: vi.fn(),
    beginComputePass: vi.fn(),
    writeTimestamp: vi.fn(),
    label: '',
  } as unknown as GPUCommandEncoder;

  const mockQueue: GPUQueue = {
    submit: vi.fn(),
    writeBuffer: vi.fn(),
    writeTexture: vi.fn(),
    onSubmittedWorkDone: vi.fn().mockResolvedValue(undefined),
    copyExternalImageToTexture: vi.fn(),
    label: '',
  } as unknown as GPUQueue;

  const device: GPUDevice = {
    features: new Set(),
    limits: {
      maxTextureDimension1D: 8192,
      maxTextureDimension2D: 8192,
      maxTextureDimension3D: 2048,
      maxTextureArrayLayers: 256,
      maxBindGroups: 4,
      maxBindingsPerBindGroup: 1000,
      maxDynamicUniformBuffersPerPipelineLayout: 8,
      maxDynamicStorageBuffersPerPipelineLayout: 4,
      maxSampledTexturesPerShaderStage: 16,
      maxSamplersPerShaderStage: 16,
      maxStorageBuffersPerShaderStage: 8,
      maxStorageTexturesPerShaderStage: 4,
      maxUniformBuffersPerShaderStage: 12,
      maxUniformBufferBindingSize: 65536,
      maxStorageBufferBindingSize: 134217728,
      minUniformBufferOffsetAlignment: 256,
      minStorageBufferOffsetAlignment: 256,
      maxVertexBuffers: 8,
      maxBufferSize: 268435456,
      maxVertexAttributes: 16,
      maxVertexBufferArrayStride: 2048,
      maxInterStageShaderComponents: 60,
      maxInterStageShaderVariables: 16,
      maxColorAttachments: 8,
      maxColorAttachmentBytesPerSample: 32,
      maxComputeWorkgroupStorageSize: 16384,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupSizeX: 256,
      maxComputeWorkgroupSizeY: 256,
      maxComputeWorkgroupSizeZ: 64,
      maxComputeWorkgroupsPerDimension: 65535,
    },
    queue: mockQueue,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    lost: new Promise(() => {}),
    label: '',
    destroy: vi.fn(),
    createBuffer: vi.fn().mockReturnValue(mockBuffer),
    createTexture: vi.fn().mockReturnValue(mockTexture),
    createSampler: vi.fn().mockReturnValue(mockSampler),
    createBindGroupLayout: vi.fn().mockReturnValue(mockBindGroupLayout),
    createPipelineLayout: vi.fn().mockReturnValue(mockPipelineLayout),
    createBindGroup: vi.fn().mockReturnValue(mockBindGroup),
    createShaderModule: vi.fn().mockReturnValue(mockShaderModule),
    createComputePipeline: vi.fn(),
    createRenderPipeline: vi.fn().mockReturnValue(mockRenderPipeline),
    createComputePipelineAsync: vi.fn(),
    createRenderPipelineAsync: vi.fn(),
    createCommandEncoder: vi.fn().mockReturnValue(mockCommandEncoder),
    createRenderBundleEncoder: vi.fn(),
    createQuerySet: vi.fn(),
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn().mockResolvedValue(null),
    onuncapturederror: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn().mockReturnValue(true),
    importExternalTexture: vi.fn(),
  } as unknown as GPUDevice;

  return device;
};

const createMockGPUAdapter = (): GPUAdapter => {
  const adapter: GPUAdapter = {
    features: new Set(),
    limits: {
      maxTextureDimension1D: 8192,
      maxTextureDimension2D: 8192,
      maxTextureDimension3D: 2048,
      maxTextureArrayLayers: 256,
      maxBindGroups: 4,
      maxBindingsPerBindGroup: 1000,
      maxDynamicUniformBuffersPerPipelineLayout: 8,
      maxDynamicStorageBuffersPerPipelineLayout: 4,
      maxSampledTexturesPerShaderStage: 16,
      maxSamplersPerShaderStage: 16,
      maxStorageBuffersPerShaderStage: 8,
      maxStorageTexturesPerShaderStage: 4,
      maxUniformBuffersPerShaderStage: 12,
      maxUniformBufferBindingSize: 65536,
      maxStorageBufferBindingSize: 134217728,
      minUniformBufferOffsetAlignment: 256,
      minStorageBufferOffsetAlignment: 256,
      maxVertexBuffers: 8,
      maxBufferSize: 268435456,
      maxVertexAttributes: 16,
      maxVertexBufferArrayStride: 2048,
      maxInterStageShaderComponents: 60,
      maxInterStageShaderVariables: 16,
      maxColorAttachments: 8,
      maxColorAttachmentBytesPerSample: 32,
      maxComputeWorkgroupStorageSize: 16384,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupSizeX: 256,
      maxComputeWorkgroupSizeY: 256,
      maxComputeWorkgroupSizeZ: 64,
      maxComputeWorkgroupsPerDimension: 65535,
    },
    info: {
      vendor: 'test',
      architecture: 'test',
      device: 'test',
      description: 'test',
      toJSON: () => ({}),
    },
    isFallbackAdapter: false,
    requestDevice: vi.fn().mockResolvedValue(createMockGPUDevice()),
    requestAdapterInfo: vi.fn().mockResolvedValue({
      vendor: 'test',
      architecture: 'test',
      device: 'test',
      description: 'test',
      toJSON: () => ({}),
    }),
  } as unknown as GPUAdapter;

  return adapter;
};

const createMockGPUCanvasContext = (): GPUCanvasContext => {
  const context: GPUCanvasContext = {
    canvas: document.createElement('canvas'),
    configure: vi.fn(),
    unconfigure: vi.fn(),
    getCurrentTexture: vi.fn().mockReturnValue({
      width: 800,
      height: 600,
      depthOrArrayLayers: 1,
      mipLevelCount: 1,
      sampleCount: 1,
      dimension: '2d',
      format: 'bgra8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      label: '',
      createView: vi.fn().mockReturnValue({
        label: '',
      } as GPUTextureView),
      destroy: vi.fn(),
    } as unknown as GPUTexture),
  } as unknown as GPUCanvasContext;

  return context;
};

// Mock navigator.gpu
const mockGPU: GPU = {
  requestAdapter: vi.fn().mockResolvedValue(createMockGPUAdapter()),
  getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
  wgslLanguageFeatures: new Set(),
} as unknown as GPU;

Object.defineProperty(global.navigator, 'gpu', {
  value: mockGPU,
  writable: true,
  configurable: true,
});

// Mock canvas getContext for WebGPU
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (
  contextId: string,
  options?: unknown
): RenderingContext | null {
  if (contextId === 'webgpu') {
    return createMockGPUCanvasContext() as unknown as RenderingContext;
  }
  return originalGetContext.call(
    this,
    contextId,
    options as CanvasRenderingContext2DSettings
  );
};

// Mock GPUTextureUsage flags
Object.defineProperty(global, 'GPUTextureUsage', {
  value: {
    COPY_SRC: 0x01,
    COPY_DST: 0x02,
    TEXTURE_BINDING: 0x04,
    STORAGE_BINDING: 0x08,
    RENDER_ATTACHMENT: 0x10,
  },
  writable: false,
});

Object.defineProperty(global, 'GPUBufferUsage', {
  value: {
    MAP_READ: 0x0001,
    MAP_WRITE: 0x0002,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    INDEX: 0x0010,
    VERTEX: 0x0020,
    UNIFORM: 0x0040,
    STORAGE: 0x0080,
    INDIRECT: 0x0100,
    QUERY_RESOLVE: 0x0200,
  },
  writable: false,
});

Object.defineProperty(global, 'GPUShaderStage', {
  value: {
    VERTEX: 0x1,
    FRAGMENT: 0x2,
    COMPUTE: 0x4,
  },
  writable: false,
});

// Export mock creators for tests that need custom mocks
export {
  createMockGPUDevice,
  createMockGPUAdapter,
  createMockGPUCanvasContext,
  mockGPU,
};

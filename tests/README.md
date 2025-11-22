# WebGPU Renderer Test Suite

Comprehensive testing infrastructure for the WebGPU waveform renderer, organized in layers.

## ⚠️ Important: Browser Test Requirements

**WebGPU browser tests require a real GPU environment:**
- ❌ **Headless Chromium** typically doesn't support WebGPU (`navigator.gpu` is null)
- ✅ **Headed browser** works on local machines with display (`headless: false`)
- ✅ **GPU-enabled CI** runners (GitHub Actions with GPU)
- ✅ **Node tests** (logic + GPU plumbing) run everywhere without GPU

**Current test status:**
- ✅ **38 node tests passing** (logic + GPU resource plumbing with mocks)
- ⏸️ **Browser tests pending** - requires local environment with GPU + display
- 📝 **Test structure complete** - harness and tests are ready to run

**To run browser tests locally:**
```bash
# Set headless: false in vitest.browser.config.ts (already configured)
npm run test:behavior     # Opens Chromium window
npm run test:visual       # Opens Chromium window + takes screenshots
```

## Test Architecture

### 1. Pure Logic Tests (Node Environment)

**Location:** `tests/logic/`
**Run with:** `npm run test:logic`

Tests deterministic math and data generation without GPU:

- LOD selection algorithms (`lod-selection.test.ts`)
  - `calculateSamplesPerPixel` - zoom to samples-per-pixel math
  - `selectLODIndex` - choosing the best LOD for a target detail level
  - `calculateLODBlend` - smooth blending between LOD levels
  - `splitPlayheadSamples` - precision handling for large sample counts

- Test data generation (`test-data-generation.test.ts`)
  - Deterministic waveform synthesis
  - Correct array sizes and structures
  - Realistic beat patterns and frequency distributions

### 2. GPU Plumbing Tests (Node with Mocks)

**Location:** `tests/gpu-plumbing/`
**Run with:** `npm run test:gpu-plumbing`

Tests GPU resource creation with fake GPUDevice:

- Texture creation (`resource-creation.test.ts`)
  - Amplitude textures (r16float, correct dimensions)
  - Band energy textures (2D layout, multiple bands)
  - Texture usage flags (TEXTURE_BINDING | COPY_DST)

- Bind group layouts
  - Correct number of bindings (6 total)
  - Proper binding types (uniform, textures, sampler)

- Resource management
  - Creating resources for all LODs
  - Correct resource counts
  - Integration testing of full setup

**Why mock GPU?** Fast, deterministic, no hardware dependencies. Just verifies you're calling the API correctly.

### 3. Behavior Tests (Real Browser + WebGPU)

**Location:** `tests/browser/*behavior*.browser.test.ts`
**Run with:** `npm run test:behavior`

Tests actual component behavior in Chromium with real WebGPU:

- Component lifecycle
  - Canvas creation
  - Rendering without errors
  - Cleanup on destroy

- Interaction handling
  - Seeking to different positions
  - Zoom level changes
  - Rapid interactions (scrubbing, zooming)

- Edge cases
  - Very short/long tracks
  - Single vs. many bands
  - Extreme zoom levels

**Environment:** Runs in headless Chromium via Playwright provider.

### 4. Visual Regression Tests (Real Browser + Screenshots)

**Location:** `tests/browser/*visual*.browser.test.ts`
**Run with:** `npm run test:visual`

Screenshot-based regression testing:

- Canonical states
  - Default view
  - Start, middle, end positions
  - High/low zoom levels

- Visual consistency
  - Multiple re-renders produce identical output
  - Different canvas sizes
  - Different band counts

- Edge cases
  - Single band visualization
  - Many bands (8+)
  - Small/large canvases

**How it works:**
1. First run creates reference screenshots in `__screenshots__/`
2. Subsequent runs compare against references using pixelmatch
3. Threshold: 0.2, max 200 mismatched pixels (configurable in `vitest.browser.config.ts`)

**CI considerations:** Lock OS and browser version for pixel-perfect consistency.

## Running Tests

### All Tests
```bash
npm test                    # All tests in workspace (node + browser)
npm run test:run           # All tests, exit on completion
npm run test:all           # Lint + typecheck + tests + e2e
```

### By Layer
```bash
npm run test:logic         # Pure logic (fast, ~seconds)
npm run test:gpu-plumbing  # GPU resource mocking (fast)
npm run test:behavior      # Real WebGPU behavior (medium, ~10s)
npm run test:visual        # Visual regression (slow, ~30s)
```

### By Environment
```bash
npm run test:node          # All node tests (logic + plumbing)
npm run test:browser       # All browser tests (behavior + visual)
```

### Development
```bash
npm run test:ui            # Vitest UI for all tests
```

## Test Harness

**Location:** `tests/browser/test-harness.ts`

Simplified test harness without animation loops for deterministic testing:

```typescript
const handle = await createWaveformTestHandle(root, {
  durationSeconds: 60,
  sampleRate: 44100,
  bpm: 128,
  bandCount: 3,
  canvasWidth: 1280,
  canvasHeight: 256,
  initialPlayheadFrame: 0,
  initialZoom: 512,
});

// Explicit rendering (no requestAnimationFrame)
seekAndRender(handle, 44100 * 30);  // Seek to 30 seconds
setZoomAndRender(handle, 1024);     // Change zoom

// Cleanup
destroyTestHandle(handle);
```

**Key differences from production harness:**
- No animation loop
- All rendering is explicit via `frame()` calls
- Deterministic state for stable screenshots

## Configuration Files

- `vitest.config.ts` - Node tests (jsdom environment)
- `vitest.browser.config.ts` - Browser tests (Playwright provider)
- `vitest.workspace.ts` - Workspace combining both configs
- `tests/setup.ts` - Mock GPU device for node tests

## WebGPU & Playwright Gotchas

### Headless GPU Support
Recent Chromium headless has real GPU path enabled. If `navigator.gpu` is undefined:

```typescript
// In vitest.browser.config.ts
browser: {
  provider: 'playwright',
  providerOptions: {
    launch: {
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan,UseSkiaRenderer',
      ],
    },
  },
}
```

### Determinism
- Use seeded test data generators
- Avoid time-based animations in tests
- Explicitly control render timing
- Lock browser version in CI

### Visual Test Stability
- Set fixed canvas dimensions
- Control device pixel ratio
- Wait for render completion before screenshots
- Use consistent test data (same seed)

## Debugging

### Failed Visual Tests
When a visual test fails:

1. Check `__screenshots__/` for diff images
2. Review what changed visually
3. If change is intentional, update reference:
   ```bash
   rm -rf __screenshots__/
   npm run test:visual
   ```
4. Commit new references to version control

### WebGPU Errors
If browser tests fail with WebGPU errors:

1. Run with headed browser: `vitest --config vitest.browser.config.ts --browser.headless=false`
2. Check browser console for GPU validation errors
3. Verify WebGPU is supported: `navigator.gpu !== undefined`

### Performance
- Node tests: <1s
- Browser behavior: ~5-10s
- Visual regression: ~20-30s (screenshot overhead)

Total suite runtime: ~30-40s

## CI Integration

Recommended CI setup:

```yaml
- name: Install dependencies
  run: npm ci

- name: Install Playwright browsers
  run: npx playwright install chromium

- name: Run tests
  run: npm run test:all

- name: Upload screenshots on failure
  if: failure()
  uses: actions/upload-artifact@v3
  with:
    name: screenshots-diff
    path: __screenshots__/
```

## Philosophy

**Test layers match reality:**
1. Math is math → test it fast (node)
2. GPU setup is plumbing → mock it (node + fakes)
3. Rendering is behavior → test it real (browser)
4. Pixels are proof → screenshot it (visual regression)

**When to skip tests:**
- Refactoring internals? Logic tests should still pass.
- Shader changes? Visual tests will catch regressions.
- New feature? Add behavior test first, visual test after stabilization.

**Goal:** Know immediately when you've broken the pretty blue squiggles, not during a live set.

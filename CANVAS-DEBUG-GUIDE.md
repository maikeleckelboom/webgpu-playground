# Canvas Rendering Debug Guide

## The Problem: Canvas is Black

If you're seeing a **pure black canvas** when data is being processed, this guide will help you diagnose the issue.

## What SHOULD You See?

The shader (`src/shaders/waveform.wgsl`) **unconditionally** renders:

1. **Dark blue/purple gradient background** - NOT pure black
2. **White vertical line** at the center (playhead marker)
3. **Horizontal gray line** at the vertical center

**If you see pure black (RGB 0,0,0), the shader is NOT executing.**

---

## Step-by-Step Debugging

### 1. Check Browser Console

Open DevTools Console (F12) and look for these log messages:

```
✅ Expected logs when working:
[DeckWaveformComponent] Uploading waveform data
[DeckWaveformComponent] Waveform data uploaded successfully
[DeckWaveformComponent] First render frame
[DeckWaveformComponent] Uniform values being set

❌ Missing logs indicate:
- Component not initializing
- update() or encode() not being called
- Data not being uploaded
```

### 2. Verify Canvas Element

Run this in the browser console:

```javascript
const canvas = document.getElementById('deck-a');
console.log('Canvas element:', canvas);
console.log('Canvas dimensions:', {
  clientWidth: canvas?.clientWidth,
  clientHeight: canvas?.clientHeight,
  width: canvas?.width,
  height: canvas?.height,
  visible: canvas?.getBoundingClientRect()
});
```

**Common issues:**
- Canvas is 0x0 → CSS/layout problem
- Canvas not in DOM → Initialization failed
- Canvas has dimensions but black → WebGPU rendering issue

### 3. Use Built-in Pixel Readback (NEW!)

**Press the `D` key** while the app is running to trigger pixel analysis.

This will:
- Read actual pixel values from the GPU
- Show RGB values at key positions
- Tell you if canvas is truly black or has rendering

**Expected output:**
```
[Debug] Pixel Analysis:
  ✅ Pixels show variation (X unique colors) - rendering is working!

OR

  ❌ All sampled pixels are pure black (0,0,0) - shader not rendering
```

### 4. Enable Shader Debug Modes

Edit `src/shaders/waveform.wgsl` line 71 and change the DEBUG_MODE:

```wgsl
// Original (line 71):
const DEBUG_MODE: u32 = 0u;

// Try these debug modes:
const DEBUG_MODE: u32 = 1u;  // Show raw amplitude as grayscale
const DEBUG_MODE: u32 = 2u;  // Show band energies as RGB colors
const DEBUG_MODE: u32 = 3u;  // Show texture sampling pattern
```

Each mode will display different data:
- **Mode 1**: Grayscale waveform (tests amplitude texture)
- **Mode 2**: RGB colored bands (tests band texture)
- **Mode 3**: Color gradient (tests texture coordinate calculation)

### 5. Check WebGPU Device State

```javascript
// In console:
const canvas = document.getElementById('deck-a');
const ctx = canvas.getContext('webgpu');
console.log('WebGPU Context:', ctx);
console.log('Context configured:', ctx !== null);

// Check if device is lost
navigator.gpu.requestAdapter().then(adapter =>
  adapter.requestDevice().then(device => {
    device.lost.then(info => {
      console.error('Device lost:', info);
    });
    console.log('Device:', device);
  })
);
```

### 6. Verify Render Loop is Running

```javascript
let frameCount = 0;
const original = window.requestAnimationFrame;
window.requestAnimationFrame = function(callback) {
  frameCount++;
  if (frameCount % 60 === 0) {
    console.log(`✅ Frame ${frameCount} - render loop active`);
  }
  return original.call(window, callback);
};
```

---

## Common Issues & Solutions

### Issue: Canvas is 0x0 pixels

**Cause:** CSS layout problem
**Solution:** Check parent container has width/height, canvas CSS is not `display: none`

### Issue: Canvas has size but is pure black

**Causes:**
1. WebGPU commands not submitting
2. Shader compilation error (check console for errors)
3. Texture not bound correctly
4. Clear color overriding render

**Solutions:**
1. Check console for WebGPU errors
2. Use pixel readback (press `D`) to verify
3. Enable shader debug mode
4. Check `encode()` method is being called (should see "First render frame" log)

### Issue: Console shows "Uploading waveform" but still black

**Cause:** Shader not executing or texture binding issue

**Debug:**
1. Press `D` to read pixels
2. Enable DEBUG_MODE = 2u to see raw band colors
3. Check that `encode()` is being called every frame

### Issue: Expected gradient but seeing solid color

**Cause:** Uniform values incorrect or shader sampling wrong position

**Solutions:**
1. Check uniform log output (should appear once)
2. Verify LOD data is uploaded (check console for upload confirmation)
3. Try DEBUG_MODE = 3u to visualize texture coordinates

---

## Quick Reference: Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `L` | Toggle Loop |
| `R` | Reset Playhead |
| **`D`** | **Debug: Read GPU pixels** |

---

## Architecture Overview

```
main.ts render() loop
  ↓
GPURuntime.updateSharedUniforms()
  ↓
DeckWaveformComponent.update()  ← Uploads waveform data, updates uniforms
  ↓
GPURuntime.getCurrentTexture()
  ↓
DeckWaveformComponent.encode()  ← Records GPU commands
  ↓
queue.submit()                  ← Executes on GPU
  ↓
Canvas displays result
```

**Breakpoint locations for debugging:**
- `src/main.ts:664` - Component update
- `src/main.ts:669` - Component encode
- `src/components/deck-waveform.ts:452` - Encode method entry
- `src/components/deck-waveform.ts:470` - Render pass begin

---

## Expected Pixel Values

If rendering is working, pixel readback should show:

| Location | Expected RGB | What it means |
|----------|--------------|---------------|
| Background | (12-20, 10-15, 20-30) | Dark blue/purple gradient |
| Center vertical line | (255, 255, 255) | White playhead marker |
| Center horizontal | (76-102, 76-102, 102-127) | Gray center guide |
| Waveform area | Varies (colored) | Actual audio visualization |

**If all pixels are (0, 0, 0):**
- Render pass is clearing to black (incorrect)
- Shader not executing
- Commands not being submitted

**If all pixels are (12, 15, 30) or similar:**
- Background rendering ✅
- Waveform data not rendering ❌
- Check texture upload and binding

---

## Still Stuck?

1. **Take a screenshot** of the console output
2. **Press D** and screenshot the pixel analysis
3. **Check** if FPS counter is updating (proves render loop works)
4. **Try** different DEBUG_MODE values in shader
5. **Verify** WebGPU support: https://webgpureport.org

## Developer Notes

- The shader has defensive code to ALWAYS render something (not black)
- Pixel readback utility is in `src/utils/debug-readback.ts`
- All rendering logs are prefixed with `[DeckWaveformComponent]`
- The clear color in encode() is set to dark blue (r: 0.05, g: 0.06, b: 0.12)

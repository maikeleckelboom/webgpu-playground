# Quick Debugging Checklist: Black Canvas Issue

## ✅ Immediate Actions

1. **Open Browser Console** (F12)
   - Look for red errors
   - Check for `[DeckWaveformComponent]` logs

2. **Wait 1 second, then check console**
   - Automatic pixel analysis runs after 60 frames
   - Look for: `[Debug] Pixel Analysis:`

3. **Press `D` key**
   - Runs manual pixel readback
   - Shows actual RGB values from GPU

## 🔍 What the Pixel Analysis Tells You

### ✅ GOOD - Rendering is working:
```
✅ Pixels show variation (X unique colors) - rendering is working!
```
→ Shader is executing, data is rendering

### ❌ BAD - Shader not running:
```
❌ All sampled pixels are pure black (0,0,0)
```
→ Shader not executing OR commands not submitted

### ⚠️ PARTIAL - Background only:
```
⚠️ All pixels are the same color (12,15,30)
```
→ Background renders, but waveform data not showing

## 🛠️ Quick Fixes

### If ALL pixels are black (0,0,0):

1. **Check canvas size:**
   ```javascript
   // In console:
   document.getElementById('deck-a').getBoundingClientRect()
   ```
   - Should show width/height > 0

2. **Check WebGPU errors in console**
   - Look for red errors about shaders, textures, or bindings

3. **Verify encode() is called:**
   - Should see: `[DeckWaveformComponent] First render frame`

### If background shows but no waveform:

1. **Check data upload:**
   ```
   [DeckWaveformComponent] Uploading waveform data
   [DeckWaveformComponent] Waveform data uploaded successfully
   ```

2. **Try debug mode in shader:**
   - Edit `src/shaders/waveform.wgsl` line 71
   - Change to: `const DEBUG_MODE: u32 = 2u;`
   - Rebuild and reload

### If render loop not running:

1. **Check FPS counter** in top-right
   - Should show 60 (or close)
   - If 0, render loop isn't running

2. **Check for errors** during initialization
   - Look for WebGPU adapter/device errors

## 📊 Expected Values Reference

| What | RGB Range | Meaning |
|------|-----------|---------|
| Background | (12-20, 10-15, 20-30) | Dark blue/purple gradient ✅ |
| Center line | (255, 255, 255) | White playhead ✅ |
| Pure black | (0, 0, 0) | NOT rendering ❌ |

## 🎯 Debug Keyboard Shortcuts

- `D` = Run pixel diagnostics
- `Space` = Play/pause
- `L` = Toggle loop
- `R` = Reset playhead

## 📝 Report Issue

If still stuck, gather this info:

1. Screenshot of console output
2. Output of pixel analysis (press `D`)
3. Browser and version
4. GPU (shown in top-right of UI)

## 🔗 More Details

See `CANVAS-DEBUG-GUIDE.md` for comprehensive debugging guide.

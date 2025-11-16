// =============================================================================
// WebGPU Knob Rendering Shader
// SDF-based circular knobs for band controls
// =============================================================================

struct KnobUniforms {
  viewWidth: f32,
  viewHeight: f32,
  knobCount: f32,
  selectedKnob: f32,
};

struct KnobData {
  value: f32,      // 0.0 to 1.0
  minValue: f32,
  maxValue: f32,
  _padding: f32,
  color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: KnobUniforms;
@group(0) @binding(1) var<storage, read> knobs: array<KnobData>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0)
  );

  var uv = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0)
  );

  var output: VertexOutput;
  output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  output.uv = uv[vertexIndex];
  return output;
}

// Signed distance function for circle
fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}

// Signed distance function for arc
fn sdArc(p: vec2<f32>, startAngle: f32, endAngle: f32, radius: f32, thickness: f32) -> f32 {
  let angle = atan2(p.y, p.x);
  let inArc = angle >= startAngle && angle <= endAngle;
  let dist = abs(length(p) - radius) - thickness;
  return select(1000.0, dist, inArc);
}

// Draw a single knob
fn drawKnob(uv: vec2<f32>, center: vec2<f32>, radius: f32, value: f32, color: vec3<f32>, isSelected: bool) -> vec3<f32> {
  let p = uv - center;
  let dist = length(p);

  var result = vec3<f32>(0.0);

  // Outer ring (background)
  let outerRing = sdCircle(p, radius);
  if (outerRing < 0.0 && outerRing > -2.0) {
    result = vec3<f32>(0.15, 0.15, 0.2);
  }

  // Inner circle (knob body)
  let innerCircle = sdCircle(p, radius * 0.8);
  if (innerCircle < 0.0) {
    let gradient = 1.0 - (innerCircle / (radius * 0.8)) * 0.3;
    result = vec3<f32>(0.25, 0.25, 0.3) * gradient;

    // Add subtle lighting
    let lightDir = normalize(vec2<f32>(-0.3, -0.5));
    let normalAngle = atan2(p.y, p.x);
    let lightDot = dot(normalize(p), lightDir);
    result = result + vec3<f32>(0.1) * max(0.0, lightDot);
  }

  // Value arc
  let startAngle = -2.356; // -135 degrees
  let endAngle = 2.356;    // 135 degrees
  let valueAngle = startAngle + value * (endAngle - startAngle);

  let arcRadius = radius * 0.9;
  let arcThickness = 3.0;

  // Background arc
  let angle = atan2(p.y, p.x);
  let distFromArc = abs(dist - arcRadius);
  if (distFromArc < arcThickness && angle >= startAngle && angle <= endAngle) {
    result = vec3<f32>(0.1, 0.1, 0.15);
  }

  // Value arc (colored)
  if (distFromArc < arcThickness && angle >= startAngle && angle <= valueAngle) {
    result = color;
  }

  // Indicator line
  let indicatorAngle = valueAngle;
  let indicatorDir = vec2<f32>(cos(indicatorAngle), sin(indicatorAngle));
  let projLen = dot(p, indicatorDir);
  let perpDist = length(p - indicatorDir * projLen);

  if (projLen > radius * 0.3 && projLen < radius * 0.75 && perpDist < 2.0) {
    result = vec3<f32>(0.9, 0.9, 0.95);
  }

  // Selection highlight
  if (isSelected && outerRing < 0.0 && outerRing > -4.0) {
    result = mix(result, color, 0.5);
  }

  return result;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let screenPos = vec2<f32>(
    input.uv.x * uniforms.viewWidth,
    input.uv.y * uniforms.viewHeight
  );

  var color = vec3<f32>(0.08, 0.08, 0.1);

  let knobRadius = 25.0;
  let knobSpacing = 80.0;
  let startX = (uniforms.viewWidth - (uniforms.knobCount - 1.0) * knobSpacing) * 0.5;
  let centerY = uniforms.viewHeight * 0.5;

  let knobCountInt = i32(uniforms.knobCount);
  for (var i = 0; i < knobCountInt; i = i + 1) {
    let knobData = knobs[i];
    let centerX = startX + f32(i) * knobSpacing;
    let center = vec2<f32>(centerX, centerY);

    let dist = length(screenPos - center);
    if (dist < knobRadius * 1.5) {
      let isSelected = f32(i) == uniforms.selectedKnob;
      let knobColor = drawKnob(screenPos, center, knobRadius, knobData.value, knobData.color.rgb, isSelected);
      color = knobColor;
    }
  }

  return vec4<f32>(color, 1.0);
}

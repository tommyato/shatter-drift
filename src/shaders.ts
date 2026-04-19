export const PLASMA_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPosition;

uniform float uTime;

void main() {
  vUv = uv;
  vec3 displaced = position;

  float wave = sin(position.y * 2.0 + uTime * 1.5) * 0.02;
  displaced.z += wave;

  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const PLASMA_OBSTACLE_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec3 vWorldPosition;

uniform float uTime;
uniform vec3 uBaseColor;
uniform vec3 uEdgeColor;
uniform vec3 uAccentColor;
uniform float uOpacity;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i + vec2(0.0, 0.0)), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = p * 2.02 + vec2(19.7, -11.3);
    amplitude *= 0.5;
  }
  return value;
}

mat2 rot(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

void main() {
  vec2 p = vUv * vec2(3.0, 2.0);

  float flowA = fbm(p + vec2(0.0, uTime * 0.72));
  float flowB = fbm((p + vec2(4.3, -2.1)) * rot(-0.2) - vec2(uTime * 0.4, -uTime * 0.28));
  float band = fbm(p * 2.2 + vec2(flowA * 2.4, flowB * 1.8));
  float heat = clamp(flowA * 0.55 + flowB * 0.4 + band * 0.65, 0.0, 1.0);

  float centerWeight = smoothstep(0.88, 0.08, abs(vUv.y - 0.5) * 2.0);
  float turbulence = sin((flowA + flowB + band) * 10.0 - uTime * 3.6) * 0.5 + 0.5;

  vec3 color = mix(uBaseColor * 0.55, uEdgeColor, heat);
  color = mix(color, uAccentColor, turbulence * 0.25 + centerWeight * 0.18);
  color += uEdgeColor * centerWeight * 0.48;

  float edgeDist = min(vUv.y, 1.0 - vUv.y);
  float edgeGlow = pow(1.0 - clamp(edgeDist * 4.0, 0.0, 1.0), 2.4);
  color += uEdgeColor * edgeGlow * 0.3;

  float alpha = uOpacity * (0.55 + heat * 0.2 + centerWeight * 0.15);

  gl_FragColor = vec4(color, alpha);
}
`;

export const SHARD_PLASMA_VERTEX = /* glsl */ `
varying vec3 vWorldPosition;

uniform float uTime;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const SHARD_PLASMA_FRAGMENT = /* glsl */ `
precision highp float;

varying vec3 vWorldPosition;

uniform float uTime;
uniform vec3 uBaseColor;
uniform vec3 uEdgeColor;
uniform float uOpacity;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i + vec2(0.0, 0.0)), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = p * 2.02 + vec2(19.7, -11.3);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 p = vWorldPosition.xy * 1.5;

  float flow = fbm(p + vec2(0.0, uTime * 0.8));
  float heat = clamp(flow * 0.7 + 0.3, 0.0, 1.0);

  vec3 color = mix(uBaseColor * 0.6, uEdgeColor, heat);
  color += uEdgeColor * 0.3;

  gl_FragColor = vec4(color, uOpacity);
}
`;

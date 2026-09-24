/** GLSL for world geometry (GLSL ES 3.0, used with RawShaderMaterial). */

export const terrainVertex = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform sampler2D uAnim;

in vec3 position;
in vec2 uv;
in float tex;
in vec4 light;
in vec4 color;

out vec2 vUv;
flat out float vLayer;
out vec4 vLight;
out vec3 vTint;
out float vDist;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  int anim = int(color.a * 255.0 + 0.5);
  if (anim == 1 || anim == 2) {
    // Leaves and plants sway gently; plants only move at their tips.
    float t = uTime * 1.7 + world.x * 0.37 + world.z * 0.29 + world.y * 0.13;
    float amp = anim == 1 ? 0.025 : 0.07;
    world.x += sin(t) * amp;
    world.z += cos(t * 0.83) * amp;
  } else if (anim == 3) {
    world.y += sin(uTime * 1.3 + world.x * 0.7 + world.z * 0.5) * 0.025 - 0.03;
  }
  float frames = texelFetch(uAnim, ivec2(int(tex + 0.5), 0), 0).r * 255.0;
  float layer = tex;
  if (frames > 1.5) layer += mod(floor(uTime * 8.0), floor(frames + 0.5));
  vLayer = layer;
  vUv = uv;
  vLight = light;
  vTint = color.rgb;
  vec4 view = viewMatrix * world;
  vDist = length(view.xyz);
  gl_Position = projectionMatrix * view;
}
`;

export const terrainFragment = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray uTextures;
uniform float uAlphaTest;
uniform float uDaylight;
uniform vec3 uSkyLight;
uniform vec3 uBlockLight;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uMinLight;

in vec2 vUv;
flat in float vLayer;
in vec4 vLight;
in vec3 vTint;
in float vDist;

out vec4 fragColor;

void main() {
  vec4 texel = texture(uTextures, vec3(vUv, vLayer));
  if (texel.a < uAlphaTest) discard;
  float sky = pow(vLight.x * uDaylight, 1.4);
  float blk = pow(vLight.y, 1.3);
  vec3 lightColor = max(uSkyLight * sky, uBlockLight * blk);
  lightColor = max(lightColor, vec3(uMinLight));
  float ao = mix(0.42, 1.0, vLight.z);
  vec3 rgb = texel.rgb * vTint * lightColor * ao * vLight.w;
  float fog = smoothstep(uFogNear, uFogFar, vDist);
  fragColor = vec4(mix(rgb, uFogColor, fog), texel.a);
}
`;

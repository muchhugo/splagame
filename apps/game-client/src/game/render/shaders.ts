import { Effect } from '@babylonjs/core';

/**
 * Shaders próprios do cenário e do céu. Padrões procedurais (terracota,
 * tijolo, madeira, azulejo, pedra, telha, latão, muro caiado) + tinta vinda do
 * atlas lógico, com borda orgânica, relevo e brilho moderado.
 */

const COMMON = /* glsl */ `
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1.0,0.0)),f.x), mix(hash21(i+vec2(0.0,1.0)),hash21(i+vec2(1.0,1.0)),f.x), f.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
`;

Effect.ShadersStore['borrifoLevelVertexShader'] = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec2 uv2;
attribute vec4 color;
attribute vec4 rect;
attribute vec3 tang;
attribute vec3 bitang;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUV;
varying vec2 vUV2;
varying vec4 vColor;
varying vec4 vRect;
varying vec3 vT;
varying vec3 vB;
void main(void){
  vec4 wp = world * vec4(position, 1.0);
  vPos = wp.xyz;
  vNormal = normalize(mat3(world) * normal);
  vUV = uv; vUV2 = uv2; vColor = color; vRect = rect; vT = tang; vB = bitang;
  gl_Position = viewProjection * wp;
}
`;

Effect.ShadersStore['borrifoLevelFragmentShader'] = /* glsl */ `
precision highp float;
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUV;
varying vec2 vUV2;
varying vec4 vColor;
varying vec4 vRect;
varying vec3 vT;
varying vec3 vB;
uniform sampler2D atlas;
uniform vec2 atlasTexel;
uniform vec3 cameraPosition;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 skyColor;
uniform vec3 groundColor;
uniform vec3 fogColor;
uniform float fogDensity;
uniform vec3 team0;
uniform vec3 team1;
uniform float patterns;
uniform float time;
${COMMON}

vec3 surfaceAlbedo(int m, vec2 uv, vec3 base, out float gloss){
  gloss = 0.12;
  if (m == 0) { // terracota em ladrilhos de 1 m
    vec2 g = fract(uv); vec2 id = floor(uv);
    float e = min(min(g.x, 1.0-g.x), min(g.y, 1.0-g.y));
    float grout = smoothstep(0.015, 0.04, e);
    vec3 tile = base * (0.86 + 0.22*hash21(id)) * (0.92 + 0.16*fbm(uv*3.1));
    gloss = 0.18;
    return mix(base*0.55, tile, grout);
  }
  if (m == 1) { // tijolo
    vec2 b = uv / vec2(0.46, 0.2); b.x += 0.5*mod(floor(b.y), 2.0);
    vec2 g = fract(b); float e = min(min(g.x,1.0-g.x)*0.46, min(g.y,1.0-g.y)*0.2);
    float mortar = smoothstep(0.008, 0.02, e);
    vec3 brick = base * (0.8 + 0.3*hash21(floor(b))) * (0.9 + 0.15*fbm(uv*6.0));
    return mix(vec3(0.78,0.72,0.64), brick, mortar);
  }
  if (m == 2) { // madeira em tábuas
    float p = uv.y / 0.3; float id = floor(p); float fp = fract(p);
    float seam = smoothstep(0.0, 0.06, fp) * smoothstep(1.0, 0.94, fp);
    float grain = fbm(vec2(uv.x*0.9 + id*7.0, uv.y*22.0));
    vec3 w = base * (0.78 + 0.3*hash21(vec2(id, 3.0))) * (0.82 + 0.3*grain);
    gloss = 0.22;
    return mix(base*0.4, w, seam);
  }
  if (m == 3) { // azulejo esmaltado (não pintável)
    vec2 g = fract(uv / 0.3) - 0.5; float r = length(g);
    float petal = abs(cos(atan(g.y, g.x)*2.0)) * 0.34;
    float motif = smoothstep(0.02, 0.0, abs(r - petal) - 0.02) + smoothstep(0.08, 0.06, r);
    float border = smoothstep(0.44, 0.47, max(abs(g.x), abs(g.y)));
    vec3 white = vec3(0.93, 0.92, 0.88);
    vec3 blue = vec3(0.13, 0.25, 0.55);
    gloss = 0.85;
    return mix(white, blue, clamp(motif + border, 0.0, 1.0));
  }
  if (m == 4) { // pedra em lajes
    vec2 p = uv / 0.95; vec2 id = floor(p); vec2 g = fract(p);
    float e = min(min(g.x,1.0-g.x), min(g.y,1.0-g.y));
    float joint = smoothstep(0.01, 0.035, e);
    vec3 s = base * (0.85 + 0.2*hash21(id)) * (0.85 + 0.25*fbm(uv*2.3));
    return mix(base*0.5, s, joint);
  }
  if (m == 5) { // telha de barro
    vec2 p = vec2(uv.x/0.22, uv.y/0.3); float row = floor(p.y);
    float sc = abs(fract(p.x + 0.5*mod(row,2.0)) - 0.5);
    float shade = 0.75 + 0.35*smoothstep(0.0, 0.5, fract(p.y)) - sc*0.2;
    gloss = 0.3;
    return base * shade * (0.9 + 0.2*hash21(vec2(floor(p.x), row)));
  }
  if (m == 6) { gloss = 0.7; return base * (0.85 + 0.2*fbm(uv*8.0)); }
  // m == 7: muro caiado com faixa pintada na base
  vec3 lime = base * (0.9 + 0.12*fbm(uv*1.7));
  float band = step(vPos.y, 0.7) * step(0.02, vPos.y);
  vec3 bandCol = vec3(0.55, 0.32, 0.22);
  return mix(lime, bandCol, band*0.85);
}

float cov(vec2 p){ return 0.0; }

void main(void){
  int m = int(floor(vColor.a * 8.0 + 0.5));
  float gloss;
  vec3 albedo = surfaceAlbedo(m, vUV, vColor.rgb, gloss);
  vec3 N = normalize(vNormal);
  vec2 auv = clamp(vUV2, vRect.xy, vRect.zw);
  vec4 s0 = texture2D(atlas, auv);
  float sunVis = s0.b;
  float ao = s0.a;
  if (vRect.x >= 0.0 && vRect.z > vRect.x) {
    vec2 dx = vec2(atlasTexel.x*0.55, 0.0);
    vec2 dy = vec2(0.0, atlasTexel.y*0.55);
    vec2 sa = texture2D(atlas, clamp(auv+dx, vRect.xy, vRect.zw)).rg;
    vec2 sb = texture2D(atlas, clamp(auv-dx, vRect.xy, vRect.zw)).rg;
    vec2 sc = texture2D(atlas, clamp(auv+dy, vRect.xy, vRect.zw)).rg;
    vec2 sd = texture2D(atlas, clamp(auv-dy, vRect.xy, vRect.zw)).rg;
    vec2 c = (s0.rg*2.0 + sa + sb + sc + sd) / 6.0;
    float n = fbm(vUV*3.3 + vPos.y*0.7) - 0.5;
    float c0 = smoothstep(0.42, 0.58, c.r + n*0.3);
    float c1 = smoothstep(0.42, 0.58, c.g + n*0.3);
    float paint = max(c0, c1);
    if (paint > 0.001) {
      vec3 tc = c0 >= c1 ? team0 : team1;
      // padrões de acessibilidade: listras (equipe 0) e pontos (equipe 1)
      if (patterns > 0.5) {
        if (c0 >= c1) tc *= 0.86 + 0.18*step(0.5, fract((vPos.x + vPos.z + vPos.y)*2.2));
        else tc *= 1.0 - 0.22*step(length(fract(vUV*3.2) - 0.5), 0.2);
      }
      float body = 0.9 + 0.12*fbm(vUV*7.0 + 3.0);
      // relevo: gradiente da cobertura ao longo das tangentes da face
      float gU = (sa.r + sa.g) - (sb.r + sb.g);
      float gV = (sc.r + sc.g) - (sd.r + sd.g);
      vec3 Np = normalize(N - (vT*gU + vB*gV) * 0.9 * paint);
      float rim = smoothstep(0.35, 0.95, paint) - smoothstep(0.95, 1.0, paint);
      albedo = mix(albedo, tc * body * (1.0 - rim*0.15), paint);
      gloss = mix(gloss, 0.78, paint);
      N = Np;
    }
  }
  vec3 L = normalize(-sunDir);
  float ndl = max(dot(N, L), 0.0);
  vec3 amb = mix(groundColor, skyColor, N.y*0.5 + 0.5) * (0.3 + 0.7*ao);
  vec3 col = albedo * (amb + sunColor * ndl * sunVis * 1.05);
  vec3 V = normalize(cameraPosition - vPos);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), mix(10.0, 110.0, gloss)) * gloss * sunVis;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0) * gloss * 0.3;
  col += sunColor * spec * 0.9 + skyColor * fres * ao;
  float d = length(cameraPosition - vPos);
  float f = 1.0 - exp(-pow(d*fogDensity, 1.4));
  col = mix(col, fogColor, clamp(f, 0.0, 0.9));
  gl_FragColor = vec4(col, 1.0);
}
`;

Effect.ShadersStore['borrifoSkyVertexShader'] = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main(void){ vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }
`;

Effect.ShadersStore['borrifoSkyFragmentShader'] = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 skyTop;
uniform vec3 skyHorizon;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float time;
${COMMON}
void main(void){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(skyHorizon, skyTop, smoothstep(-0.02, 0.55, h));
  vec3 L = normalize(-sunDir);
  float s = max(dot(d, L), 0.0);
  col += sunColor * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.28);
  // nuvens estilizadas
  if (d.y > 0.02) {
    vec2 p = d.xz / (d.y + 0.25) * 1.6 + vec2(time*0.004, 0.0);
    float c = smoothstep(0.52, 0.78, fbm(p*1.3) + fbm(p*3.1)*0.25);
    vec3 cloud = mix(vec3(1.0, 0.93, 0.86), sunColor, 0.25) * (0.9 + 0.1*s);
    col = mix(col, cloud, c * smoothstep(0.02, 0.2, d.y) * 0.85);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SHADERS_READY = true;

import { Effect } from '@babylonjs/core';

/**
 * Shaders próprios do cenário e do céu (direção de arte cartoon):
 * - luz em duas faixas suaves com sombras de matiz frio (nunca preto);
 * - padrões limpos (poucas linhas, variação por peça, sem ruído realista);
 * - acabamento por estilo de peça usando coordenadas locais da face
 *   (moldura e marca em caixotes, faixa de borda em plataformas, chanfro);
 * - tinta úmida: brilho recortado, reflexo de céu e borda com espessura.
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
attribute vec4 fx;
attribute vec2 st;
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
varying vec4 vFx;
varying vec2 vSt;
void main(void){
  vec4 wp = world * vec4(position, 1.0);
  vPos = wp.xyz;
  vNormal = normalize(mat3(world) * normal);
  vUV = uv; vUV2 = uv2; vColor = color; vRect = rect; vT = tang; vB = bitang; vFx = fx; vSt = st;
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
varying vec4 vFx;
varying vec2 vSt;
uniform sampler2D atlas;
uniform vec2 atlasTexel;
uniform vec3 cameraPosition;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 skyColor;
uniform vec3 groundColor;
uniform vec3 shadowTint;
uniform vec3 fogColor;
uniform float fogDensity;
uniform vec3 team0;
uniform vec3 team1;
uniform float patterns;
uniform float time;
${COMMON}

// distância até a borda da face (metros) e coordenadas locais
float edgeDist(){ vec2 m = vFx.xy * vFx.zw; return min(min(m.x, vFx.z - m.x), min(m.y, vFx.w - m.y)); }

vec3 surfaceAlbedo(int m, vec2 uv, vec3 base, out float gloss){
  gloss = 0.08;
  if (m == 0) { // lajota clara em placas grandes
    vec2 g = fract(uv / 1.5); vec2 id = floor(uv / 1.5);
    float e = min(min(g.x, 1.0-g.x), min(g.y, 1.0-g.y)) * 1.5;
    float grout = smoothstep(0.02, 0.05, e);
    vec3 tile = base * (0.94 + 0.1*hash21(id));
    return mix(base*0.78, tile, grout);
  }
  if (m == 1) { // tijolo simples
    vec2 b = uv / vec2(0.55, 0.26); b.x += 0.5*mod(floor(b.y), 2.0);
    vec2 g = fract(b); float e = min(min(g.x,1.0-g.x)*0.55, min(g.y,1.0-g.y)*0.26);
    float mortar = smoothstep(0.01, 0.025, e);
    vec3 brick = base * (0.9 + 0.14*hash21(floor(b)));
    return mix(vec3(0.95,0.88,0.8), brick, mortar);
  }
  if (m == 2) { // madeira em tábuas largas
    float p = uv.y / 0.32; float id = floor(p); float fp = fract(p);
    float seam = smoothstep(0.0, 0.05, fp) * smoothstep(1.0, 0.95, fp);
    vec3 w = base * (0.88 + 0.16*hash21(vec2(id, 3.0)));
    w *= 0.95 + 0.06*sin(uv.x*3.0 + id*2.1);
    gloss = 0.12;
    return mix(base*0.55, w, seam);
  }
  if (m == 3) { // azulejo esmaltado (NÃO pintável): leitura clara por padrão e brilho
    vec2 g = fract(uv / 0.4) - 0.5; float r = length(g);
    float petal = abs(cos(atan(g.y, g.x)*2.0)) * 0.3;
    float motif = smoothstep(0.03, 0.0, abs(r - petal) - 0.02) + smoothstep(0.09, 0.07, r);
    float border = smoothstep(0.44, 0.47, max(abs(g.x), abs(g.y)));
    gloss = 0.7;
    return mix(vec3(0.97, 0.96, 0.93), vec3(0.16, 0.33, 0.75), clamp(motif + border, 0.0, 1.0));
  }
  if (m == 4) { // pedra em blocos
    vec2 p = uv / vec2(1.2, 0.6); p.x += 0.5*mod(floor(p.y), 2.0); vec2 id = floor(p); vec2 g = fract(p);
    float e = min(min(g.x,1.0-g.x)*1.2, min(g.y,1.0-g.y)*0.6);
    float joint = smoothstep(0.012, 0.03, e);
    return mix(base*0.72, base * (0.92 + 0.12*hash21(id)), joint);
  }
  if (m == 5) { // telha de barro
    vec2 p = vec2(uv.x/0.28, uv.y/0.34); float row = floor(p.y);
    float sc = abs(fract(p.x + 0.5*mod(row,2.0)) - 0.5);
    gloss = 0.15;
    return base * (0.82 + 0.28*smoothstep(0.0, 0.6, fract(p.y)) - sc*0.18);
  }
  if (m == 6) { gloss = 0.6; return base; }
  if (m == 8) { // reboco pintado: liso, leve ondulação de desempenadeira
    float n = vnoise(uv * 1.7) * 0.06 + vnoise(uv * 7.0) * 0.03;
    return base * (0.95 + n);
  }
  if (m == 9) { // ladrilho hidráulico: placas de 0,5 m com quarto de círculo em dois tons
    vec2 g = fract(uv / 0.5); vec2 id = floor(uv / 0.5);
    float flip = mod(id.x + id.y, 2.0);
    vec2 q = flip > 0.5 ? g : 1.0 - g;
    float arc = smoothstep(0.02, 0.0, abs(length(q) - 0.62) - 0.07);
    float dotc = smoothstep(0.16, 0.13, length(g - 0.5));
    float grout = smoothstep(0.0, 0.03, min(min(g.x, 1.0-g.x), min(g.y, 1.0-g.y)));
    vec3 accent = vec3(0.86, 0.42, 0.32);
    // contraste baixo: o piso não pode competir com a tinta das equipes
    vec3 c = mix(base, accent, arc * 0.32);
    c = mix(c, vec3(0.2, 0.48, 0.5), dotc * 0.28);
    return mix(base * 0.72, c, grout);
  }
  if (m == 10) { // pastilha de piscina: grade miúda clara, brilho de esmalte
    vec2 g = fract(uv / 0.2); vec2 id = floor(uv / 0.2);
    float grout = smoothstep(0.0, 0.08, min(min(g.x, 1.0-g.x), min(g.y, 1.0-g.y)));
    vec3 tile = base * (0.93 + 0.12 * hash21(id));
    gloss = 0.55;
    return mix(vec3(0.94, 0.97, 0.98), tile, grout);
  }
  if (m == 11) { // cimento queimado: liso com pintas
    float sp = step(0.94, hash21(floor(uv * 14.0)));
    return base * (0.97 + vnoise(uv * 2.2) * 0.05 - sp * 0.06);
  }
  // 7: muro caiado com faixa de mural colorida
  vec3 lime = base;
  float band = step(vPos.y, 0.9) * step(0.02, vPos.y);
  float k = floor((vUV.x) / 2.4);
  vec3 muralA = vec3(0.35, 0.72, 0.66), muralB = vec3(0.96, 0.72, 0.3), muralC = vec3(0.86, 0.45, 0.55);
  vec3 mural = mod(k, 3.0) < 1.0 ? muralA : mod(k, 3.0) < 2.0 ? muralB : muralC;
  float wave = step(vPos.y, 0.62 + 0.12*sin(vUV.x*2.6));
  vec3 bandCol = mix(vec3(0.62, 0.42, 0.34), mural, wave);
  float cap = step(3.75, vPos.y);
  return mix(mix(lime, bandCol, band), vec3(0.8, 0.5, 0.36), cap);
}

// acabamento por estilo da peça (vSt.x) e tipo de face (vSt.y: 0 topo, 1 lateral, 2 base)
vec3 styleFinish(vec3 col, int sty, int face, inout float gloss){
  vec2 m = vFx.xy * vFx.zw;
  float ed = edgeDist();
  // chanfro sugerido: realce claro nas bordas superiores, escurece a base (contato)
  if (face == 0) col *= 1.0 + 0.16 * (1.0 - smoothstep(0.0, 0.07, ed));
  if (face == 1) {
    col *= mix(0.8, 1.0, smoothstep(0.0, 0.45, m.y));
    col *= 1.0 + 0.14 * (1.0 - smoothstep(0.0, 0.06, vFx.w - m.y));
  }
  if (sty == 1) { // caixote: moldura, travessa diagonal e marca carimbada
    float frame = 1.0 - smoothstep(0.1, 0.12, ed);
    vec2 c = vFx.xy - 0.5;
    float diag = 1.0 - smoothstep(0.035, 0.05, abs(c.x - c.y) * min(vFx.z, vFx.w));
    col = mix(col, col * 0.62, max(frame, diag * (1.0 - frame)) * (face == 1 ? 1.0 : 0.6));
    float r = length(c * vec2(vFx.z, vFx.w) / min(vFx.z, vFx.w));
    float ring = smoothstep(0.02, 0.0, abs(r - 0.2) - 0.03);
    float drop = smoothstep(0.012, 0.0, length(c * vec2(1.0, 0.8)) - 0.09);
    if (face == 1) col = mix(col, vec3(0.28, 0.16, 0.12), (ring + drop) * 0.55);
  }
  if (sty == 5 || sty == 6 || sty == 12) { // plataformas e rampas: faixa clara na borda (leitura da queda)
    if (face == 0) col = mix(col, vec3(0.98, 0.9, 0.62), (1.0 - smoothstep(0.18, 0.22, ed)) * 0.85);
  }
  if (sty == 2 && face == 1) { // varal: ripas verticais
    float slat = smoothstep(0.02, 0.06, abs(fract(m.x / 0.5) - 0.5));
    col *= mix(0.78, 1.0, slat);
  }
  if (sty == 18 && face == 1) { // cobogó: relevo de blocos vazados (sombreado, sem transparência)
    vec2 c = fract(m / 0.4) - 0.5;
    float hole = smoothstep(0.2, 0.17, max(abs(c.x), abs(c.y)));
    float ring = smoothstep(0.03, 0.0, abs(length(c) - 0.13) - 0.02);
    col = mix(col, col * 0.62, hole * 0.8);
    col = mix(col, col * 1.08, ring * hole);
  }
  if (sty == 19 && face == 1) { // oficina/prédio: rodapé e friso no alto
    float foot = step(m.y, 0.35);
    float trim = smoothstep(0.12, 0.1, abs(m.y - (vFx.w - 0.3)));
    col = mix(col, col * 0.7, foot * 0.7);
    col = mix(col, vec3(0.98, 0.95, 0.88), trim * 0.8);
  }
  if (sty == 20) { // jardineira: terra/folhas no topo, borda clara na lateral
    if (face == 0) col = mix(vec3(0.34, 0.6, 0.32), vec3(0.46, 0.72, 0.36), vnoise(m * 3.0));
    else col *= mix(0.85, 1.0, smoothstep(0.0, 0.1, vFx.w - m.y));
  }
  if (sty == 21 && face == 1) col *= 0.9; // degrau: espelho mais escuro que o piso
  if (sty == 22 && face == 1) { // torre: faixas verticais
    float st = step(0.5, fract(m.x / 0.75));
    col = mix(col, vec3(0.36, 0.78, 0.82), st * 0.55);
  }
  if ((sty == 23 || sty == 25) && face == 1) { // balcão/espreguiçadeira: tábuas
    float slat = smoothstep(0.02, 0.05, abs(fract(m.x / 0.3) - 0.5));
    col *= mix(0.8, 1.0, slat);
  }
  if (sty == 24 && face == 1) { // geladeira: porta e puxador
    float seam = smoothstep(0.02, 0.0, abs(m.y - vFx.w * 0.62));
    float handle = step(abs(m.x - 0.15), 0.03) * step(abs(m.y - vFx.w * 0.75), 0.18);
    col = mix(col, col * 0.7, max(seam, handle));
  }
  if (sty == 26 && face == 1) { // engradado plástico: vazados
    vec2 c = fract(m / vec2(0.18, 0.2)) - 0.5;
    col = mix(col, col * 0.6, smoothstep(0.3, 0.26, max(abs(c.x), abs(c.y))));
  }
  if (sty == 27 && face == 1) { // toboágua: ondas
    float w = smoothstep(0.08, 0.0, abs(fract(m.y / 0.6 + sin(m.x * 1.6) * 0.12) - 0.5) - 0.1);
    col = mix(col, vec3(0.98, 0.97, 0.94), w * 0.7);
  }
  if (sty == 28 && face == 0) { // fundo da piscina: raias escuras a cada 2,5 m
    float lane = smoothstep(0.12, 0.08, abs(mod(vPos.z + 1.25, 2.5) - 1.25));
    col = mix(col, vec3(0.1, 0.34, 0.5), lane * 0.7);
  }
  if (sty == 29 && face == 0) col = vec3(0.97, 0.97, 0.95); // borda da piscina (pedra clara)
  if (sty == 30) { // boia: listras
    float st = step(0.5, fract((m.x + m.y) / 0.8));
    col = mix(col, vec3(0.98, 0.97, 0.94), st * 0.8);
  }
  return col;
}

void main(void){
  int m = int(floor(vColor.a * 16.0 + 0.5));
  int sty = int(floor(vSt.x + 0.5));
  int face = int(floor(vSt.y + 0.5));
  float gloss;
  vec3 albedo = surfaceAlbedo(m, vUV, vColor.rgb, gloss);
  albedo = styleFinish(albedo, sty, face, gloss);
  vec3 N = normalize(vNormal);
  vec2 auv = clamp(vUV2, vRect.xy, vRect.zw);
  vec4 s0 = texture2D(atlas, auv);
  // sombra pré-calculada recortada (borda suave, estilo desenho)
  float sunVis = smoothstep(0.3, 0.62, s0.b);
  float ao = mix(0.55, 1.0, s0.a);
  float paint = 0.0;
  vec3 paintCol = vec3(0.0);
  float wet = 0.0;
  if (vRect.x >= 0.0 && vRect.z > vRect.x) {
    vec2 dx = vec2(atlasTexel.x*0.55, 0.0);
    vec2 dy = vec2(0.0, atlasTexel.y*0.55);
    vec2 sa = texture2D(atlas, clamp(auv+dx, vRect.xy, vRect.zw)).rg;
    vec2 sb = texture2D(atlas, clamp(auv-dx, vRect.xy, vRect.zw)).rg;
    vec2 sc = texture2D(atlas, clamp(auv+dy, vRect.xy, vRect.zw)).rg;
    vec2 sd = texture2D(atlas, clamp(auv-dy, vRect.xy, vRect.zw)).rg;
    vec2 c = (s0.rg*2.0 + sa + sb + sc + sd) / 6.0;
    // borda orgânica: ruído de baixa frequência + recorte (manchas reconhecíveis)
    float n = fbm(vUV*2.6 + vPos.y*0.7) - 0.5;
    float n2 = vnoise(vUV*9.0) - 0.5;
    float c0 = smoothstep(0.44, 0.56, c.r + n*0.34 + n2*0.08);
    float c1 = smoothstep(0.44, 0.56, c.g + n*0.34 + n2*0.08);
    paint = max(c0, c1);
    if (paint > 0.001) {
      vec3 tc = c0 >= c1 ? team0 : team1;
      if (patterns > 0.5) {
        if (c0 >= c1) tc *= 0.84 + 0.2*step(0.5, fract((vPos.x + vPos.z + vPos.y)*2.2));
        else tc *= 1.0 - 0.24*step(length(fract(vUV*3.2) - 0.5), 0.2);
      }
      float gU = (sa.r + sa.g) - (sb.r + sb.g);
      float gV = (sc.r + sc.g) - (sd.r + sd.g);
      // leve ondulação de superfície úmida
      vec2 rip = vec2(vnoise(vUV*3.0 + time*0.25), vnoise(vUV*3.0 - time*0.21)) - 0.5;
      vec3 Np = normalize(N - (vT*(gU + rip.x*0.18) + vB*(gV + rip.y*0.18)) * 1.1 * paint);
      float rim = smoothstep(0.3, 0.8, paint) - smoothstep(0.8, 1.0, paint);
      paintCol = tc * (1.0 - rim * 0.28);
      N = normalize(mix(N, Np, paint));
      wet = paint;
    }
  }
  vec3 L = normalize(-sunDir);
  float ndl = dot(N, L);
  // duas faixas suaves; sombra com matiz frio
  float lit = smoothstep(-0.06, 0.22, ndl) * sunVis;
  vec3 amb = mix(groundColor, skyColor, N.y*0.5 + 0.5);
  vec3 base = mix(albedo, paintCol, paint);
  vec3 shade = base * amb * shadowTint * ao;
  vec3 light = base * (sunColor * (0.95 + 0.08*smoothstep(0.6, 0.7, ndl)) + amb * 0.2) * mix(0.85, 1.0, ao);
  vec3 col = mix(shade, light, lit);
  // a tinta mantém a saturação mesmo na sombra (sombra da tinta = mesma cor, mais escura)
  vec3 paintShaded = paintCol * mix(0.72 * mix(vec3(0.9, 0.92, 1.0), vec3(1.0), 0.5), vec3(1.04), lit) * mix(0.85, 1.0, ao);
  col = mix(col, paintShaded, paint * 0.85);
  vec3 V = normalize(cameraPosition - vPos);
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  // brilho: fosco no cenário, recortado e forte na tinta úmida
  float specBase = pow(nh, 24.0) * gloss * 0.3;
  // reflexos pequenos e recortados, quebrados pela ondulação (aparência úmida sem estourar)
  float glint = smoothstep(0.45, 0.7, vnoise(vUV*6.0 + vec2(time*0.3, -time*0.2)));
  float specWet = smoothstep(0.975, 0.99, nh) * wet * (0.35 + 0.65*glint);
  col += sunColor * (specBase + specWet * 0.6) * lit;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  col += skyColor * fres * (wet * 0.14 + gloss * 0.06) * (1.0 - lit * 0.4);
  // perspectiva aérea: névoa clara e fria à distância
  float d = length(cameraPosition - vPos);
  float f = 1.0 - exp(-pow(d*fogDensity, 1.3));
  col = mix(col, fogColor, clamp(f, 0.0, 0.8));
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
  vec3 col = mix(skyHorizon, skyTop, smoothstep(-0.02, 0.5, h));
  vec3 L = normalize(-sunDir);
  float s = max(dot(d, L), 0.0);
  col += sunColor * (smoothstep(0.9975, 0.999, s) * 1.2 + pow(s, 10.0) * 0.18);
  // nuvens de desenho: bolhas com borda recortada e base sombreada
  if (d.y > 0.0) {
    vec2 p = d.xz / (d.y + 0.2) * 1.2 + vec2(time*0.005, 0.0);
    float v = fbm(p*1.1) + fbm(p*2.7)*0.3;
    float cloud = smoothstep(0.62, 0.68, v);
    float under = smoothstep(0.62, 0.82, v);
    vec3 cc = mix(vec3(0.82, 0.86, 0.96), vec3(1.0, 1.0, 1.0), under);
    col = mix(col, cc, cloud * smoothstep(0.0, 0.18, d.y));
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SHADERS_READY = true;

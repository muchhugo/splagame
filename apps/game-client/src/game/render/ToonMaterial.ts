import { Color3, Effect, Scene, ShaderMaterial, Vector3, VertexBuffer, type AbstractMesh, type SubMesh } from '../babylon';

/**
 * Cel shading suave para personagens, ferramentas e objetos de jogo:
 * duas faixas tonais com transição curta, sombra com matiz frio (não preta),
 * brilho especular recortado para o esmalte e luz de contorno discreta.
 */
Effect.ShadersStore['borrifoToonVertexShader'] = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vN;
varying vec3 vPos;
void main(void){
  vec4 wp = world * vec4(position, 1.0);
  vPos = wp.xyz;
  vN = normalize(mat3(world) * normal);
  gl_Position = viewProjection * wp;
}
`;

Effect.ShadersStore['borrifoToonFragmentShader'] = /* glsl */ `
precision highp float;
varying vec3 vN;
varying vec3 vPos;
uniform vec3 color;
uniform vec3 emissive;
uniform float alpha;
uniform float gloss;
uniform float soft;
uniform float flash;
uniform float sunVis;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 skyColor;
uniform vec3 groundColor;
uniform vec3 shadowTint;
uniform vec3 cameraPosition;
void main(void){
  vec3 N = normalize(vN);
  vec3 L = normalize(-sunDir);
  vec3 V = normalize(cameraPosition - vPos);
  float ndl = dot(N, L);
  // duas faixas: luz e sombra, com uma meia-luz estreita
  // 'soft' (pele): terminador mais largo e sombra mais clara; evita a "barba" de sombra no rosto
  float lit = smoothstep(-0.02 - soft * 0.55, 0.12 + soft * 0.25, ndl) * mix(0.35, 1.0, sunVis);
  float top = smoothstep(0.55, 0.62, ndl) * 0.08;
  vec3 amb = mix(groundColor, skyColor, N.y * 0.5 + 0.5);
  // sombra clara e fria: mantém a leitura do personagem mesmo contra o sol
  vec3 shade = color * (amb * shadowTint * 0.82 + vec3(0.16, 0.15, 0.18));
  vec3 light = color * (sunColor * (0.92 + top) + amb * 0.18);
  vec3 col = mix(mix(shade, light, soft * 0.4), light, lit);
  // brilho do esmalte: mancha recortada, só onde há luz
  vec3 H = normalize(L + V);
  float s = smoothstep(0.9, 0.94, dot(N, H)) * gloss * lit;
  col += sunColor * s * 0.55;
  // contorno de luz (rim) suave para separar do fundo
  float rim = smoothstep(0.62, 0.9, 1.0 - max(dot(N, V), 0.0));
  col += mix(skyColor, sunColor, 0.4) * rim * 0.22;
  col += emissive;
  col = mix(col, vec3(1.0, 0.97, 0.92), flash);
  gl_FragColor = vec4(col, alpha);
}
`;

export interface ToonLight {
  sunDir: Vector3;
  sunColor: Color3;
  skyColor: Color3;
  groundColor: Color3;
  shadowTint: Color3;
}

let sharedLight: ToonLight | null = null;
export function setToonLight(l: ToonLight) {
  sharedLight = l;
}

/** Estado por malha lido no bind (compartilhado por todas as malhas de um personagem). */
export interface ToonMeshState {
  flash: number;
  sunVis: number;
}

/** Material toon compartilhado por cena e chave (cores fixas: pele, cabelo, roupa neutra, equipe). */
export function sharedToon(scene: Scene, key: string, color: Color3, gloss = 0.6): ToonMaterial {
  const cache = ((scene as unknown as { __toon?: Map<string, ToonMaterial> }).__toon ??= new Map());
  let m = cache.get(key);
  if (!m || m.getScene() !== scene) {
    m = new ToonMaterial(`toon-${key}`, scene, color, gloss);
    cache.set(key, m);
    scene.onDisposeObservable.addOnce(() => cache.clear());
  }
  return m;
}

export class ToonMaterial extends ShaderMaterial {
  private _color: Color3;
  private _emissive = new Color3(0, 0, 0);
  private _flash = 0;
  private _sunVis = 1;
  private _gloss: number;
  /** 0 = recorte duro (padrão); 1 = pele (sombra suave e clara). */
  soft = 0;

  constructor(name: string, scene: Scene, color: Color3, gloss = 0.6) {
    super(name, scene, { vertex: 'borrifoToon', fragment: 'borrifoToon' }, {
      attributes: ['position', 'normal'],
      uniforms: ['world', 'viewProjection', 'color', 'emissive', 'alpha', 'gloss', 'soft', 'flash', 'sunVis', 'sunDir', 'sunColor', 'skyColor', 'groundColor', 'shadowTint', 'cameraPosition'],
    });
    this._color = color.clone();
    this._gloss = gloss;
    this.onBindObservable.add((mesh) => {
      const e = this.getEffect();
      if (!e) return;
      const l = sharedLight;
      // estado POR MALHA (lampejo de dano, luz do sol sob o personagem, esmaecimento): permite
      // compartilhar o mesmo material entre vários personagens sem um piscar pelo outro
      const per = (mesh?.metadata as { toon?: ToonMeshState } | null)?.toon;
      e.setColor3('color', this._color);
      e.setColor3('emissive', this._emissive);
      e.setFloat('alpha', this.alpha * (mesh ? mesh.visibility : 1));
      e.setFloat('gloss', this._gloss);
      e.setFloat('soft', this.soft);
      e.setFloat('flash', per ? per.flash : this._flash);
      e.setFloat('sunVis', per ? per.sunVis : this._sunVis);
      if (l) {
        e.setVector3('sunDir', l.sunDir);
        e.setColor3('sunColor', l.sunColor);
        e.setColor3('skyColor', l.skyColor);
        e.setColor3('groundColor', l.groundColor);
        e.setColor3('shadowTint', l.shadowTint);
      }
      const cam = scene.activeCamera;
      if (cam) e.setVector3('cameraPosition', cam.globalPosition);
    });
  }

  /**
   * Efeito pronto por configuração de malha (instâncias, cor por vértice, ossos). O
   * `ShaderMaterial` refaz a lista de defines e a junta numa string a CADA verificação,
   * para cada malha, a cada quadro (~50 KB/quadro com 16 personagens, medido em
   * `e2e/alocacoes.mjs`). Congelar o material não serve: ele é compartilhado entre
   * personagens com estado por malha no bind. Aqui a resposta fica guardada enquanto o
   * efeito da configuração continuar o mesmo e pronto.
   */
  private readyEffects: Array<unknown> = [];

  override isReady(mesh?: AbstractMesh, useInstances?: boolean, subMesh?: SubMesh): boolean {
    const key = (useInstances ? 1 : 0) | (mesh?.isVerticesDataPresent(VertexBuffer.ColorKind) ? 2 : 0) | (mesh?.useBones ? 4 : 0) | (mesh?.hasThinInstances ? 8 : 0);
    // o ShaderMaterial guarda o efeito no submesh (é lá que o Babylon olha)
    const dw = subMesh && this._storeEffectOnSubMeshes ? subMesh._drawWrapper : this._drawWrapper;
    const effect = dw.effect;
    if (effect && this.readyEffects[key] === effect && effect.isReady()) return true;
    const ok = super.isReady(mesh, useInstances, subMesh);
    this.readyEffects[key] = ok ? dw.effect : undefined;
    return ok;
  }

  override markDirty(forceMaterialDirty?: boolean): void {
    this.readyEffects.length = 0;
    super.markDirty(forceMaterialDirty);
  }

  get color() {
    return this._color;
  }
  set color(c: Color3) {
    this._color = c.clone();
  }
  setEmissive(c: Color3) {
    this._emissive = c.clone();
  }
  setFlash(f: number) {
    this._flash = f;
  }
  setSunVisibility(v: number) {
    this._sunVis = v;
  }
}

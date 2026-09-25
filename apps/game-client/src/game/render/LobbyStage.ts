import { Color3, FreeCamera, Mesh, MeshBuilder, Scene, TransformNode, Vector3 } from '../babylon';
import type { AppearanceId, TeamId, Vec3, WeaponId } from '@borrifo/game-contracts';
import type { MapSpec } from '@borrifo/game-content';
import type { PhysicsWorld } from '@borrifo/game-simulation';
import { CharacterView, type CharacterVisual } from './CharacterView';
import { sharedToon } from './ToonMaterial';
import { STAGE, findLobbySpot, type LobbySpot } from './lobbySpot';

/** Quem aparece no palco (dados públicos do lobby). */
export interface StagePlayer {
  playerId: number;
  team: TeamId;
  weaponId: WeaponId;
  appearance: AppearanceId;
  ready: boolean;
  isBot: boolean;
  isHost: boolean;
}

/** 'sala' = grupo inteiro; 'vitrine' = close no próprio personagem (ferramenta e visual). */
export type StageMode = 'sala' | 'vitrine';
/** Onde a interface deixa espaço para a cena: à direita (desktop) ou em cima (celular em pé). */
export type StageFraming = 'direita' | 'topo';

export interface StageTag {
  playerId: number;
  x: number;
  y: number;
  /** Distância da câmera (para ordenar e escalar). */
  dist: number;
}

/** Vagas de uma turma (x para fora a partir do centro, z para o fundo), em múltiplos da meia largura. */
const SLOTS: Array<[number, number, number]> = [
  // x, z, giro extra (olham um pouco para o centro do grupo)
  [0.24, 0.0, 0.1],
  [0.53, 0.42, 0.2],
  [0.81, 0.86, 0.28],
  [0.4, 1.3, 0.12],
  [0.69, 1.7, 0.22],
];

interface Actor {
  view: CharacterView;
  key: string;
  p: StagePlayer;
  pos: Vec3;
  yaw: number;
  /** Reação a "pronto" (s restantes). */
  readyT: number;
  /** Mostrar a ferramenta depois de trocar (s restantes). */
  showT: number;
  /** "Pop" de escala ao trocar o visual. */
  pop: number;
  seen: boolean;
  ground?: number | null;
  groundAt?: Vec3;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * Palco do lobby dentro da própria arena: as duas turmas juntas num trecho livre do
 * mapa (achado por raycast), cada pessoa com o personagem, a ferramenta e o visual que
 * escolheu, em idle; quem fica pronto reage; a pessoa local fica sobre a tampa de lata
 * de tinta. A câmera faz um movimento lento e, na vitrine, fecha no próprio personagem,
 * que gira com arrasto ou analógico. Nada disso toca a simulação: é só apresentação.
 */
export class LobbyStage {
  readonly spot: LobbySpot;
  private root: TransformNode;
  private pedestal: TransformNode;
  private splats: Mesh[] = [];
  private actors = new Map<number, Actor>();
  private pending: { players: StagePlayer[]; myId: number } | null = null;
  private myId = 0;
  private myTeam: TeamId = 0;
  active = true;
  mode: StageMode = 'sala';
  framing: StageFraming = 'direita';
  /** Máximo de personagens por turma no palco (o painel lista todo mundo). */
  private _perTeam = 5;
  get perTeam() {
    return this._perTeam;
  }
  set perTeam(n: number) {
    if (n === this._perTeam) return;
    this._perTeam = n;
    // qualidade mudou: reaplica o elenco na hora
    if (this.pending) this.setPlayers(this.pending.players, this.pending.myId);
  }
  private yawUser = 0;
  private yawVel = 0;
  private introT = -1;
  private camPos: Vector3 | null = null;
  private camTgt: Vector3 | null = null;
  private t = 0;
  /** Quantos ficaram fora do palco por turma (a interface mostra "+N"). */
  hidden: [number, number] = [0, 0];

  constructor(
    private readonly scene: Scene,
    physics: PhysicsWorld,
    private readonly map: MapSpec,
    private colors: [Color3, Color3],
  ) {
    this.spot = findLobbySpot(physics, map);
    this.root = new TransformNode('palco', scene);
    this.pedestal = this.buildPedestal();
    this.buildSplats();
  }

  /* --------------------------- montagem --------------------------- */

  private buildPedestal(): TransformNode {
    const s = this.scene;
    const n = new TransformNode('tampa', s);
    n.parent = this.root;
    const metal = sharedToon(s, 'lata-metal', new Color3(0.72, 0.74, 0.78), 0.8);
    const rim = sharedToon(s, 'lata-aro', new Color3(0.46, 0.47, 0.52), 0.7);
    const lid = MeshBuilder.CreateCylinder('tampa-lata', { diameter: 1.35, height: 0.12, tessellation: 28 }, s);
    lid.material = metal;
    lid.parent = n;
    lid.position.y = 0.06;
    const ring = MeshBuilder.CreateTorus('tampa-aro', { diameter: 1.33, thickness: 0.07, tessellation: 28 }, s);
    ring.material = rim;
    ring.parent = n;
    ring.position.y = 0.12;
    const inner = MeshBuilder.CreateTorus('tampa-friso', { diameter: 0.95, thickness: 0.03, tessellation: 24 }, s);
    inner.material = rim;
    inner.parent = n;
    inner.position.y = 0.125;
    // respingo da cor da turma escorrendo pela borda
    const paint = MeshBuilder.CreateCylinder('tampa-tinta', { diameter: 0.8, height: 0.02, tessellation: 20 }, s);
    paint.parent = n;
    paint.position.set(0.12, 0.13, -0.05);
    paint.scaling.set(1.1, 1, 0.8);
    const drips: Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3 + 0.4;
      const dr = MeshBuilder.CreateCapsule('pingo', { radius: 0.045, height: 0.16 + (i % 3) * 0.05, tessellation: 8 }, s);
      dr.parent = n;
      dr.position.set(Math.cos(a) * 0.67, 0.07 - (i % 3) * 0.02, Math.sin(a) * 0.67);
      drips.push(dr);
    }
    n.metadata = { paint: [paint, ...drips] };
    return n;
  }

  private buildSplats() {
    // manchas de tinta sob cada turma (decalque plano, levemente acima do chão pintável)
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 3; i++) {
        const m = MeshBuilder.CreateDisc('mancha-palco', { radius: 1, tessellation: 22, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
        m.rotation.x = Math.PI / 2;
        m.parent = this.root;
        m.metadata = { side, i };
        this.splats.push(m);
      }
    }
  }

  setColors(colors: [Color3, Color3]) {
    this.colors = colors;
    for (const a of this.actors.values()) a.view.setTeamColor(colors[a.p.team]);
    this.paintProps();
  }

  private paintProps() {
    const { c, d, r, halfW } = this.spot;
    const other: TeamId = this.myTeam === 0 ? 1 : 0;
    const sideTeam = (side: number): TeamId => (side < 0 ? this.myTeam : other);
    for (const m of this.splats) {
      const { side, i } = m.metadata as { side: number; i: number };
      const team = sideTeam(side);
      const sm = sharedToon(this.scene, `palco-mancha-${team}`, this.colors[team].scale(0.92), 0.5);
      // o material compartilhado guarda a cor da primeira criação: reaplica a atual
      sm.color = this.colors[team].scale(0.92);
      m.material = sm;
      const u = side * halfW * (0.5 + [0, 0.18, -0.12][i]);
      const w = [0.7, 1.2, 0.3][i];
      m.position.set(c[0] + r[0] * u - d[0] * w, c[1] + 0.018 + i * 0.002, c[2] + r[1] * u - d[1] * w);
      const sc = halfW * [0.42, 0.3, 0.24][i];
      m.scaling.set(sc * 1.25, sc, 1);
      m.rotation.y = i * 0.9;
    }
    const mat = sharedToon(this.scene, `palco-tinta-${this.myTeam}`, this.colors[this.myTeam], 1);
    mat.color = this.colors[this.myTeam];
    for (const p of (this.pedestal.metadata as { paint: Mesh[] }).paint) p.material = mat;
  }

  /* --------------------------- elenco --------------------------- */

  /** Atualiza quem está no palco. Muda só o que mudou (troca de ferramenta ou visual recria o boneco). */
  setPlayers(players: StagePlayer[], myId: number) {
    this.pending = { players, myId };
    if (!this.active) return;
    const me = players.find((p) => p.playerId === myId);
    const teamChanged = me && me.team !== this.myTeam;
    this.myId = myId;
    if (me) this.myTeam = me.team;
    const rank = (p: StagePlayer) => (p.playerId === myId ? 0 : p.isBot ? 3 : p.ready ? 1 : 2);
    const chosen: StagePlayer[] = [];
    this.hidden = [0, 0];
    for (const team of [0, 1] as TeamId[]) {
      const list = players.filter((p) => p.team === team).sort((a, b) => rank(a) - rank(b) || a.playerId - b.playerId);
      // quem aparece depende da prioridade; a VAGA de cada um é estável (ficar pronto não
      // faz ninguém trocar de lugar): você na frente, o resto por ordem de chegada
      const visible = list.slice(0, this.perTeam).sort((a, b) => (a.playerId === myId ? -1 : b.playerId === myId ? 1 : 0) || (a.isBot === b.isBot ? a.playerId - b.playerId : a.isBot ? 1 : -1));
      chosen.push(...visible);
      this.hidden[team] = Math.max(0, list.length - this.perTeam);
    }
    for (const a of this.actors.values()) a.seen = false;
    const slotIdx: [number, number] = [0, 0];
    for (const p of chosen) {
      const key = `${p.team}|${p.weaponId}|${p.appearance}|${p.playerId === myId ? 1 : 0}`;
      let a = this.actors.get(p.playerId);
      const side = p.team === this.myTeam ? -1 : 1;
      const idx = slotIdx[side < 0 ? 0 : 1]++;
      const { pos, yaw } = this.slotPose(side, idx);
      if (a && a.key !== key) {
        const weaponChanged = a.p.weaponId !== p.weaponId;
        const lookChanged = a.p.appearance !== p.appearance;
        a.view.dispose();
        a.view = this.makeView(p);
        a.key = key;
        if (weaponChanged) a.showT = 1.1;
        if (lookChanged) a.pop = 1;
      } else if (!a) {
        a = { view: this.makeView(p), key, p, pos, yaw, readyT: 0, showT: 0, pop: 0, seen: true };
        this.actors.set(p.playerId, a);
      }
      if (p.ready && !a.p.ready && !p.isBot) a.readyT = 1.5;
      a.p = p;
      a.pos = pos;
      a.yaw = yaw;
      a.seen = true;
    }
    for (const [id, a] of this.actors) {
      if (a.seen) continue;
      a.view.dispose();
      this.actors.delete(id);
    }
    if (teamChanged || !this.splats[0].material) this.paintProps();
  }

  private makeView(p: StagePlayer): CharacterView {
    const v = new CharacterView(this.scene, 5000 + p.playerId, p.team, p.weaponId, this.colors[p.team], p.playerId === this.myId, false, p.appearance);
    v.hideMarker();
    return v;
  }

  /** Posição e rumo de uma vaga, olhando para a câmera. */
  private slotPose(side: number, idx: number): { pos: Vec3; yaw: number } {
    const { c, d, r, halfW } = this.spot;
    const [sx, sz, turn] = SLOTS[idx % SLOTS.length];
    const u = side * sx * halfW;
    const w = sz;
    const pos: Vec3 = [c[0] + r[0] * u - d[0] * w, c[1], c[2] + r[1] * u - d[1] * w];
    // de frente para a câmera (direção +d), um pouco virado para o meio do grupo
    const yaw = Math.atan2(d[0], d[1]) + side * turn;
    return { pos, yaw };
  }

  /* --------------------------- câmera --------------------------- */

  playIntro() {
    this.introT = 0;
    this.introStart = performance.now();
  }
  private introStart = 0;
  get introPlaying() {
    return this.introT >= 0;
  }
  skipIntro() {
    this.introT = -1;
  }

  /** Giro da vitrine (arrasto, toque ou analógico); inércia curta. */
  rotate(delta: number) {
    this.yawUser += delta;
    this.yawVel = delta * 8;
  }
  resetRotation() {
    this.yawUser = 0;
    this.yawVel = 0;
  }

  setMode(m: StageMode) {
    if (m === this.mode) return;
    this.mode = m;
    if (m === 'sala') this.resetRotation();
  }

  private myActor(): Actor | undefined {
    return this.actors.get(this.myId);
  }

  /** Enquadramento desejado (posição e alvo) para o modo atual. */
  private desiredCamera(cam: FreeCamera, aspect: number): { pos: Vector3; tgt: Vector3 } {
    const { c, d, r, camDist, halfW } = this.spot;
    const tanV = Math.tan(this.targetFov() / 2);
    const tanH = tanV * aspect;
    const me = this.myActor();
    let center: Vec3, dist: number, lift: number, look: number;
    if (this.mode === 'vitrine' && me) {
      center = me.pos;
      dist = STAGE.closeDist * (this.framing === 'topo' ? 1.45 : 1);
      // com o rodo (lâmina larga na altura do quadril), a câmera sobe e a lâmina fica abaixo do tronco
      const rodo = me.p.weaponId === 'rodo';
      lift = rodo ? 1.85 : 1.15;
      look = rodo ? 0.85 : 0.95;
    } else {
      center = c;
      const useful = this.framing === 'direita' ? 0.62 : 0.95;
      const width = this.framing === 'topo' ? halfW + 1 : halfW * 2 + 0.8;
      const fit = width / (2 * tanH * useful);
      dist = Math.min(this.spot.maxDist, Math.max(camDist, fit));
      lift = this.spot.camH;
      look = 1.0;
    }
    const visW = 2 * dist * tanH;
    const visH = 2 * dist * tanV;
    // desloca câmera e alvo juntos para o sujeito cair no espaço livre da interface
    const sx = this.framing === 'direita' ? -visW * 0.19 : 0;
    // celular em pé: o sujeito sobe para a faixa de cima (a folha ocupa a parte de baixo).
    // Só o ALVO desce (a câmera inclina); a câmera mantém a altura e nunca entra no chão.
    const sy = this.framing === 'topo' ? -visH * (this.mode === 'vitrine' ? 0.29 : 0.25) : 0;
    const sway = this.mode === 'sala' ? Math.sin(this.t * 0.39) * 0.35 : 0;
    const bob = Math.sin(this.t * 0.27) * 0.08;
    // celular em pé: o grupo prioriza a própria turma (lado esquerdo); tudo dentro da faixa
    // lateral validada pela busca do palco
    const favor = this.framing === 'topo' && this.mode === 'sala' ? -halfW * 0.45 : 0;
    const off = this.mode === 'vitrine' && me ? Math.max(STAGE.closeLat, Math.min(0, sx)) : Math.max(this.spot.latMin, Math.min(this.spot.latMax, favor + sx + sway));
    const tgt = new Vector3(center[0] + r[0] * off, center[1] + look + sy + bob, center[2] + r[1] * off);
    const pos = new Vector3(center[0] + d[0] * dist + r[0] * off, center[1] + lift + bob, center[2] + d[1] * dist + r[1] * off);
    return { pos, tgt };
  }

  /** Câmera da apresentação de abertura: sobrevoo que termina no enquadramento do grupo. */
  private introCamera(end: { pos: Vector3; tgt: Vector3 }): { pos: Vector3; tgt: Vector3 } {
    const T = 3.4;
    const k = smooth(Math.min(1, this.introT / T));
    const { c } = this.spot;
    const { min, max } = this.map.bounds;
    const mc = new Vector3((min[0] + max[0]) / 2, 1, (min[2] + max[2]) / 2);
    const rel = end.pos.subtract(new Vector3(c[0], c[1], c[2]));
    const a0 = Math.atan2(rel.x, rel.z) + 1.9;
    const R0 = Math.max(max[0] - min[0], max[2] - min[2]) * 0.55;
    const a = a0 + (Math.atan2(rel.x, rel.z) - a0) * k;
    const R = R0 + (Math.hypot(rel.x, rel.z) - R0) * k;
    const h = 16 + (rel.y - 16) * k;
    const pos = new Vector3(c[0] + Math.sin(a) * R, c[1] + h, c[2] + Math.cos(a) * R);
    const tgt = Vector3.Lerp(mc, end.tgt, smooth(Math.min(1, Math.max(0, (this.introT - 0.6) / (T - 0.6)))));
    return { pos, tgt };
  }

  /* --------------------------- quadro --------------------------- */

  update(dt: number, cam: FreeCamera, aspect: number, groundY: (p: Vec3) => number | null) {
    if (!this.active) return;
    this.t += dt;
    // inércia do giro da vitrine
    if (Math.abs(this.yawVel) > 1e-3) {
      this.yawUser += this.yawVel * dt;
      this.yawVel *= Math.exp(-dt * 7);
    }
    const me = this.myActor();
    this.pedestal.setEnabled(!!me);
    if (me) this.pedestal.position.set(me.pos[0], me.pos[1], me.pos[2]);

    for (const a of this.actors.values()) {
      a.readyT = Math.max(0, a.readyT - dt);
      a.showT = Math.max(0, a.showT - dt);
      a.pop = Math.max(0, a.pop - dt * 3);
      const isMe = a.p.playerId === this.myId;
      // na vitrine só a própria pessoa fica em cena (o resto do grupo não disputa o quadro)
      const shown = isMe || this.mode !== 'vitrine';
      a.view.root.setEnabled(shown);
      if (!shown) continue;
      const lift = isMe ? 0.13 : 0;
      // pulinho no começo da reação (pronto) ou da troca de ferramenta
      const hopT = a.readyT > 1.1 ? (1.5 - a.readyT) / 0.4 : a.showT > 0.75 ? (1.1 - a.showT) / 0.35 : -1;
      const hop = hopT >= 0 && hopT <= 1 ? Math.sin(hopT * Math.PI) * 0.32 : 0;
      const showing = a.showT > 0 && a.showT <= 0.75;
      // vitrine: três quartos (a ferramenta não tapa o corpo) + o giro de quem está vendo
      const yaw = a.yaw + (isMe && this.mode === 'vitrine' ? 0.55 + this.yawUser : 0);
      const vis: CharacterVisual = {
        pos: [a.pos[0], a.pos[1] + lift + hop, a.pos[2]],
        yaw,
        pitch: 0,
        speed: 0,
        vy: hop > 0 ? (hopT < 0.5 ? 2 : -2) : 0,
        grounded: hop <= 0.001,
        form: 0,
        submerged: false,
        climbing: false,
        firing: showing && a.p.weaponId === 'esguicho',
        charging: showing && a.p.weaponId === 'estilingue',
        charge: showing ? Math.min(1, (0.75 - a.showT) * 2) : 0,
        dragging: false,
        swinging: showing && a.p.weaponId === 'rodo' && a.showT > 0.3,
        alive: true,
        protected: false,
        hp: 100,
        ink: 80,
        inEnemyInk: false,
        travel: 0,
        celebrate: a.readyT > 0 && a.readyT <= 1.1 ? 1 : 0,
      };
      const cp = cam.position;
      a.view.camDist = Math.hypot(a.pos[0] - cp.x, a.pos[1] + 0.9 - cp.y, a.pos[2] - cp.z);
      a.view.nearFade = 1;
      // chão da vaga: um raycast por posição (o palco é estático), não um por quadro
      if (a.ground === undefined || a.groundAt !== a.pos) {
        a.ground = groundY(a.pos);
        a.groundAt = a.pos;
      }
      const g = a.ground;
      a.view.update(dt, vis, g === null ? a.pos[1] + lift : Math.max(g, a.pos[1] + lift), 1);
      const s = 1 + Math.sin(a.pop * Math.PI) * 0.12;
      a.view.root.scaling.set(s, 2 - s, s);
    }

    // câmera: persegue o enquadramento com amortecimento (reage suave a trocas de modo)
    let want = this.desiredCamera(cam, aspect);
    if (this.introT >= 0) {
      // relógio real: em máquina lenta o sobrevoo fica menos fluido, mas não mais longo
      this.introT = (performance.now() - this.introStart) / 1000;
      want = this.introCamera(want);
      if (this.introT > 3.4) this.introT = -1;
      this.camPos = want.pos.clone();
      this.camTgt = want.tgt.clone();
    } else if (!this.camPos || !this.camTgt) {
      this.camPos = want.pos.clone();
      this.camTgt = want.tgt.clone();
    } else {
      const k = 1 - Math.exp(-dt * (this.mode === 'vitrine' ? 3.2 : 2.2));
      this.camPos = Vector3.Lerp(this.camPos, want.pos, k);
      this.camTgt = Vector3.Lerp(this.camTgt, want.tgt, k);
    }
    cam.position.copyFrom(this.camPos);
    cam.setTarget(this.camTgt);
    // lente mais fechada que a da partida: enquadramento de apresentação
    cam.fov += (this.targetFov() - cam.fov) * Math.min(1, dt * 3);
  }

  private targetFov(): number {
    const deg = this.framing === 'topo' ? (this.mode === 'vitrine' ? 74 : 60) : this.mode === 'vitrine' ? 34 : 44;
    return (deg * Math.PI) / 180;
  }

  /** Cabeças projetadas na tela para as etiquetas (nome, avatar, pronto, fala). */
  tags(project: (p: Vec3) => [number, number] | null, cam: FreeCamera): StageTag[] {
    const out: StageTag[] = [];
    if (!this.active) return out;
    for (const a of this.actors.values()) {
      const isMe = a.p.playerId === this.myId;
      const head: Vec3 = [a.pos[0], a.pos[1] + (isMe ? 2.2 : 2.08), a.pos[2]];
      const sp = project(head);
      if (!sp) continue;
      const cp = cam.position;
      out.push({ playerId: a.p.playerId, x: sp[0], y: sp[1], dist: Math.hypot(head[0] - cp.x, head[1] - cp.y, head[2] - cp.z) });
    }
    return out;
  }

  /** Esconde e libera os bonecos (a rodada começou); o palco volta com setPlayers. */
  hide() {
    this.active = false;
    for (const a of this.actors.values()) a.view.dispose();
    this.actors.clear();
    this.root.setEnabled(false);
    this.pedestal.setEnabled(false);
    this.camPos = this.camTgt = null;
  }

  show() {
    if (this.active) return;
    this.active = true;
    this.root.setEnabled(true);
    if (this.pending) this.setPlayers(this.pending.players, this.pending.myId);
  }

  /** Posição atual da câmera do palco (para a transição continuar dela). */
  cameraPose(): { pos: Vector3; tgt: Vector3 } | null {
    return this.camPos && this.camTgt ? { pos: this.camPos.clone(), tgt: this.camTgt.clone() } : null;
  }

  activeMeshCount(): number {
    let n = 0;
    for (const a of this.actors.values()) n += a.view.activeMeshCount();
    return n;
  }

  dispose() {
    for (const a of this.actors.values()) a.view.dispose();
    this.actors.clear();
    this.root.dispose(false, true);
  }
}

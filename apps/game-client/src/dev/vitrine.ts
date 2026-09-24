/**
 * Vitrine de personagens, SÓ DE DESENVOLVIMENTO: `vitrine.html` não entra no build
 * (o Vite só empacota `index.html`). Mostra as 8 aparências lado a lado com o mesmo
 * CharacterView do jogo, em uma pose fixa, para capturas comparáveis e revisão.
 *   ?pose=parado|corrida|salto|disparo|pião|dano|vitoria|derrota|rodo|estilingue
 *   &giro=0..6.28 (ângulo da câmera)  &arma=esguicho|rodo|estilingue
 */
import { ArcRotateCamera, Color3, Color4, Engine, HemisphericLight, MeshBuilder, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { APPEARANCE_IDS, type WeaponId } from '@borrifo/game-contracts';
import { CharacterView, type CharacterVisual } from '../game/render/CharacterView';
import { setToonLight } from '../game/render/ToonMaterial';

const q = new URLSearchParams(location.search);
const pose = q.get('pose') ?? 'parado';
const giro = Number(q.get('giro') ?? 0);
const arma = (q.get('arma') ?? 'esguicho') as WeaponId;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.55, 0.78, 0.93, 1);
setToonLight({
  sunDir: new Vector3(-0.4, -1, 0.5).normalize(),
  sunColor: new Color3(1, 0.95, 0.85),
  skyColor: new Color3(0.8, 0.88, 0.95),
  groundColor: new Color3(0.5, 0.45, 0.42),
  shadowTint: new Color3(0.55, 0.5, 0.7),
});
new HemisphericLight('h', new Vector3(0, 1, 0), scene);
const chao = MeshBuilder.CreateGround('chao', { width: 30, height: 10 }, scene);
const cm = new StandardMaterial('chao', scene);
cm.diffuseColor = new Color3(0.93, 0.86, 0.74);
cm.specularColor = Color3.Black();
chao.material = cm;
const cam = new ArcRotateCamera('cam', -Math.PI / 2 + giro, 1.42, 11, new Vector3(0, 0.8, 0), scene);
cam.fov = 0.2;
scene.activeCamera = cam;

const teams: [Color3, Color3] = [Color3.FromHexString('#8b3dff'), Color3.FromHexString('#18b86b')];
const views = APPEARANCE_IDS.map((a, i) => {
  const team = (i % 2) as 0 | 1;
  const v = new CharacterView(scene, i + 1, team, arma, teams[team], false, false, a);
  return { v, x: (i - 3.5) * 1.0 };
});

function visual(x: number, t: number): CharacterVisual {
  const base: CharacterVisual = { pos: [x, 0, 0], yaw: Math.PI, pitch: 0, speed: 0, vy: 0, grounded: true, form: 0, submerged: false, climbing: false, firing: false, charging: false, charge: 0, dragging: false, swinging: false, alive: true, protected: false, hp: 100, ink: 0.7, inEnemyInk: false, travel: 0 };
  if (pose === 'corrida') Object.assign(base, { speed: 6.5 });
  if (pose === 'salto') Object.assign(base, { grounded: false, vy: 2, pos: [x, 0.5, 0] });
  if (pose === 'disparo') Object.assign(base, { firing: true });
  if (pose === 'pião') Object.assign(base, { form: 1, speed: 3 });
  if (pose === 'rodo') Object.assign(base, { dragging: true, speed: 3 });
  if (pose === 'estilingue') Object.assign(base, { charging: true, charge: 0.8 });
  if (pose === 'vitoria') base.celebrate = 1;
  if (pose === 'derrota') base.celebrate = -1;
  void t;
  return base;
}

let t = 0;
let hurtDone = false;
engine.runRenderLoop(() => {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
  t += dt;
  for (const { v, x } of views) {
    v.camDist = 8;
    const vis = visual(x, t);
    if (pose === 'dano' && !hurtDone && t > 0.6) vis.hp = 60;
    v.update(dt, vis, 0, 1);
  }
  if (pose === 'dano' && t > 0.6) hurtDone = true;
  scene.render();
});
(document.getElementById('info') as HTMLDivElement).textContent = `pose: ${pose} · ${APPEARANCE_IDS.join(' ')}`;
(window as unknown as { __vitrine: unknown }).__vitrine = { views: views.map((x) => x.v), ready: true };
addEventListener('resize', () => engine.resize());

// Dois navegadores na mesma sessão pelo servidor real: lobby compartilhado,
// partida, mesma tinta nas duas réplicas, recursos estáveis e pausa ao ocultar.
import { OUT, check, done, launch, openStandalone, watchErrors } from './lib.mjs';

const sid = `e2e-${Date.now().toString(36)}`;
const browser = await launch();
async function player(user) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  const errs = watchErrors(page, user);
  await openStandalone(page, user, sid);
  return { page, errs };
}
const A = await player('ana');
const B = await player('bruno');
await A.page.waitForFunction(() => window.__borrifo.uiStore.get().lobby.players.length === 2, null, { timeout: 20000 });
check(true, 'os dois humanos aparecem no mesmo lobby');
await B.page.click('text=Estou pronto');
await A.page.waitForFunction(() => { const l = window.__borrifo.uiStore.get().lobby; return l.players.every((p) => p.ready || p.playerId === l.hostPlayerId); }, null, { timeout: 10000 });
await A.page.click('text=Começar partida');
await Promise.all([A, B].map((x) => x.page.waitForFunction(() => window.__borrifo.uiStore.get().lobby.phase === 'running', null, { timeout: 60000 })));
check(true, 'anfitrião inicia e ambos entram na rodada');

const resources = (x) => x.page.evaluate(() => { const s = window.__borrifo.controller.runtime.scene; return { materials: s.materials.length, meshes: s.meshes.length, textures: s.textures.length }; });
const r0 = await resources(A);

const drive = async (x, yaw) => {
  await x.page.focus('canvas');
  await x.page.evaluate((y) => { const i = window.__borrifo.controller.runtime.input; i.yaw = y; i.pitch = 0.3; }, yaw);
  await x.page.keyboard.down('KeyW');
  await x.page.keyboard.down('KeyF');
};
await drive(A, Math.PI / 2);
await drive(B, -Math.PI / 2);
await A.page.waitForTimeout(6000);
for (const x of [A, B]) {
  await x.page.keyboard.up('KeyW');
}

// mesma tinta: compara o hash das réplicas quando as duas estão na mesma sequência
const view = (x) => x.page.evaluate(() => {
  const rt = window.__borrifo.controller.runtime;
  const o = rt.replica.state.owner;
  let h = 0;
  for (let i = 0; i < o.length; i++) h = (h * 31 + o[i] + 2) >>> 0;
  return { seq: rt.replica.state.paintSeq, hash: h, units: [...rt.replica.state.teamUnits], views: rt.views.size };
});
let same = null;
for (let i = 0; i < 80 && !same; i++) {
  const [va, vb] = await Promise.all([view(A), view(B)]);
  if (va.seq === vb.seq) same = { va, vb };
  else await A.page.waitForTimeout(25);
}
check(!!same, 'as duas réplicas alcançam a mesma sequência de tinta');
if (same) {
  console.log(`     seq ${same.va.seq} · unidades A ${same.va.units} · B ${same.vb.units}`);
  check(same.va.hash === same.vb.hash, 'hash da tinta idêntico nos dois navegadores');
  check(same.va.units[0] + same.va.units[1] > 0, 'houve tinta pintada');
}
await A.page.screenshot({ path: `${OUT}partida-A.png` });
await B.page.screenshot({ path: `${OUT}partida-B.png` });

// recursos: jogar mais 25 s não pode fazer materiais/malhas crescerem sem limite
await A.page.keyboard.down('KeyW');
await A.page.waitForTimeout(25000);
await A.page.keyboard.up('KeyW');
const r1 = await resources(A);
console.log(`     materiais ${r0.materials}→${r1.materials} · malhas ${r0.meshes}→${r1.meshes} · texturas ${r0.textures}→${r1.textures}`);
// pools limitados: feixes (10), miras (8), marcadores (8), materiais de objeto (5)
check(r1.materials - r0.materials <= 31, 'materiais limitados pelos pools');
check(r1.textures === r0.textures, 'nenhuma textura nova durante a partida');

// oculto/suspenso: não desenha a cena; ao voltar, desenha
const renders = (hidden) => A.page.evaluate(async (hidden) => {
  const rt = window.__borrifo.controller.runtime;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
  let n = 0;
  const o = rt.scene.onAfterRenderObservable.add(() => n++);
  await new Promise((r) => setTimeout(r, 2000));
  rt.scene.onAfterRenderObservable.remove(o);
  return n;
}, hidden);
check((await renders(true)) === 0, 'aba oculta não renderiza a cena');
check((await renders(false)) > 0, 'ao voltar, a renderização retoma');

for (const x of [A, B]) await x.page.keyboard.up('KeyF');
const errs = [...A.errs, ...B.errs];
check(errs.length === 0, `sem erros de página (${errs.slice(0, 3).join(' | ')})`);
await browser.close();
done();

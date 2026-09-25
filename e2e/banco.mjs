// Banco: quem entra com a partida em andamento assiste à rodada ao vivo como espectador
// (acompanha qualquer participante ou a visão geral) e joga a próxima rodada.
//   E2E_SWIFTSHADER=1 node e2e/banco.mjs
import { mkdirSync } from 'node:fs';
import { GAME_URL, OUT, check, done, launch, openStandalone, watchErrors } from './lib.mjs';

const DIR = `${OUT}capturas/menus/`;
mkdirSync(DIR, { recursive: true });
const browser = await launch();
const sid = `banco-${Date.now().toString(36)}`;
const open = async (user) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = watchErrors(page, user);
  await openStandalone(page, user, sid);
  await page.evaluate(() => window.__borrifo.controller.skipIntro());
  return { ctx, page, errs };
};

const A = await open('ana');
// quem vai entrar no meio já fica com a tela de entrada aberta (a cena demora a montar no SwiftShader)
const cctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const cpage = await cctx.newPage();
const cerrs = watchErrors(cpage, 'carla');
await cpage.goto(GAME_URL);
await cpage.waitForSelector('select');
await A.page.evaluate(() => window.__borrifo.controller.setOptions({ formation: 2 }));
await A.page.waitForFunction(() => window.__borrifo.uiStore.get().lobby.plan.teamSize === 2);
await A.page.click('text=Começar partida');
await A.page.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase !== 'lobby', null, { timeout: 60000 });

// ---------------------------------------------------------------- entra no meio (rodada já começou)
await cpage.selectOption('select', 'carla');
await cpage.fill('input', sid);
await cpage.click('button[type=submit]');
const C = { ctx: cctx, page: cpage, errs: cerrs };
const st = () =>
  C.page.evaluate(() => {
    const rt = window.__borrifo.controller.runtime;
    const h = window.__borrifo.__hud?.get?.() ?? null;
    const u = window.__borrifo.uiStore.get();
    return { screen: u.screen, spectating: rt?.spectating, target: rt?.specTarget ?? null, remotes: rt ? rt.interp.ids().length : 0, predictor: !!rt?.predictor, cam: rt ? [rt.rig.camera.position.x, rt.rig.camera.position.z] : null, h };
  });
await C.page.waitForFunction(() => window.__borrifo?.controller?.runtime?.spectating === true, null, { timeout: 60000 });
await C.page.waitForFunction(() => window.__borrifo.controller.runtime.interp.ids().length >= 4, null, { timeout: 20000 });
let s = await st();
check(s.screen === 'waiting' && s.spectating, 'quem entra com a partida em andamento vai para o banco');
check(!s.predictor, 'no banco não há personagem próprio nem previsão');
check(s.remotes >= 4, `assiste ao vivo: recebe os ${s.remotes} participantes`);
await C.page.waitForFunction(() => window.__borrifo.controller.runtime.specTarget !== null, null, { timeout: 8000 });
s = await st();
check(s.target !== null, 'a câmera acompanha alguém sozinha');
check(await C.page.isVisible('.bench'), 'faixa "No banco" com quem está sendo acompanhado');
check(await C.page.isVisible('.hud .timer') && !(await C.page.isVisible('.hud .reticle')), 'HUD do banco: tempo e placar, sem mira nem tanque');
const name1 = await C.page.textContent('.bench-name');
await C.page.keyboard.press('KeyE');
await C.page.waitForTimeout(400);
const name2 = await C.page.textContent('.bench-name');
check(name2 !== name1, `E troca quem é acompanhado (${name1} → ${name2})`);
await C.page.click('.bench button:has-text("Visão geral")');
await C.page.waitForTimeout(300);
check((await C.page.textContent('.bench-name')) === 'Visão geral', 'visão geral pelo botão');
await C.page.keyboard.press('KeyE');
await C.page.waitForTimeout(300);
check((await C.page.textContent('.bench-name')) !== 'Visão geral', 'E volta a acompanhar alguém');
// a câmera fica perto de quem é acompanhado (depois da mistura de entrada, ~1,4 s de jogo)
await C.page.waitForFunction(() => window.__borrifo.controller.runtime.cineFrom === null, null, { timeout: 15000 }).catch(() => null);
await C.page.waitForTimeout(600);
const near = await C.page.evaluate(() => {
  const rt = window.__borrifo.controller.runtime;
  const smp = rt.interp.latest(rt.specTarget);
  const c = rt.rig.camera.position;
  return Math.hypot(c.x - smp.pos[0], c.z - smp.pos[2]);
});
check(near < 8, `câmera atrás de quem é acompanhado (${near.toFixed(1)} m)`);
await C.page.screenshot({ path: `${DIR}11-banco.png` });

// entradas do banco não movem ninguém
const before = await A.page.evaluate(() => window.__borrifo.uiStore.get().lobby.players.length);
await C.page.keyboard.down('KeyW');
await C.page.waitForTimeout(600);
await C.page.keyboard.up('KeyW');
check((await C.page.evaluate(() => window.__borrifo.controller.runtime.predictor)) === null, 'teclas no banco não criam personagem');
check((await A.page.evaluate(() => window.__borrifo.uiStore.get().lobby.players.length)) === before, 'ninguém novo na rodada');
check(!(await C.page.evaluate(() => document.pointerLockElement !== null)), 'clicar no banco não trava o ponteiro');

// ---------------------------------------------------------------- próxima rodada: joga
await A.page.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'results', null, { timeout: 120000 });
await A.page.evaluate(() => window.__borrifo.controller.vote('rematch'));
await C.page.evaluate(() => window.__borrifo.controller.vote('rematch'));
await C.page.waitForFunction(() => window.__borrifo.controller.runtime?.predictor?.state.alive, null, { timeout: 60000 });
s = await st();
check(s.screen === 'match' && s.spectating === false && s.predictor, 'na revanche, quem estava no banco joga');
check(A.errs.length === 0 && C.errs.length === 0, `sem erros de página${[...A.errs, ...C.errs].length ? `: ${[...A.errs, ...C.errs].slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
done();

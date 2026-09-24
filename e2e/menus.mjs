// Navegação REAL pelos menus sobre a arena (lobby hub, vitrine, configurações e entrada
// na rodada), com dois navegadores na mesma sala e um celular emulado.
//   E2E_SWIFTSHADER=1 node e2e/menus.mjs
import { mkdirSync } from 'node:fs';
import { OUT, check, done, launch, openStandalone, watchErrors } from './lib.mjs';

const DIR = `${OUT}capturas/menus/`;
mkdirSync(DIR, { recursive: true });
const browser = await launch();
const sid = `menus-${Date.now().toString(36)}`;
const open = async (user, vp = { width: 1280, height: 720 }, extra = {}) => {
  const ctx = await browser.newContext({ viewport: vp, ...extra });
  const page = await ctx.newPage();
  const errs = watchErrors(page, user);
  await openStandalone(page, user, sid);
  return { ctx, page, errs };
};
const rt = (page, fn, arg) => page.evaluate(fn, arg);
const stage = (page) =>
  rt(page, () => {
    const s = window.__borrifo.controller.runtime.stage;
    const me = window.__borrifo.uiStore.get().welcome.playerId;
    const actors = [...s.actors.values()];
    const mine = s.actors.get(me);
    return { active: s.active, mode: s.mode, found: s.spot.found, n: actors.length, hidden: s.hidden, intro: s.introPlaying, yawUser: s.yawUser, myKey: mine?.key ?? null, myReady: mine?.readyT ?? 0, ids: actors.map((a) => a.p.playerId), meshes: s.activeMeshCount() };
  });

// ---------------------------------------------------------------- abertura
const A = await open('ana');
await A.page.waitForTimeout(400);
let st = await stage(A.page);
check(st.intro === true, 'abertura: sobrevoo curto ao entrar no lobby');
check(await A.page.isVisible('.intro-card'), 'abertura: cartaz com o nome do lugar');
await A.page.screenshot({ path: `${DIR}01-abertura.png` });
await A.page.keyboard.press('Space');
await A.page.waitForTimeout(900);
st = await stage(A.page);
check(st.intro === false && !(await A.page.isVisible('.intro-card')), 'qualquer tecla pula a abertura');
check(st.active && st.found, 'palco 3D ativo num trecho livre achado no mapa');
check(st.ids.includes(await rt(A.page, () => window.__borrifo.uiStore.get().welcome.playerId)), 'o próprio personagem está no palco');
check(await A.page.isVisible('.hub-panel') && await A.page.isVisible('.go-btn'), 'painel e ação principal entram depois da abertura');

// ---------------------------------------------------------------- Sala com duas pessoas
const B = await open('bruno');
await A.page.waitForFunction(() => window.__borrifo.uiStore.get().lobby.players.filter((p) => !p.isBot).length === 2);
await A.page.waitForTimeout(800);
st = await stage(A.page);
const bId = await rt(B.page, () => window.__borrifo.uiStore.get().welcome.playerId);
check(st.ids.includes(bId), 'quem entra aparece no palco de quem já estava');
await A.page.waitForFunction((id) => window.__borrifo.uiStore.get().lobby && document.querySelector(`.stag[data-player="${id}"]`), bId, { timeout: 5000 }).catch(() => null);
check(!!(await A.page.$(`.stag[data-player="${bId}"]`)), 'etiqueta com nome e avatar sobre o personagem de Bruno');
check(await A.page.isVisible(`.prow[data-player="${bId}"]`), 'Bruno também está na lista da sala (legibilidade)');
await B.page.keyboard.press('Space');
await B.page.waitForTimeout(600);
await B.page.click('text=Estou pronto');
await A.page.waitForFunction((id) => window.__borrifo.uiStore.get().lobby.players.find((p) => p.playerId === id)?.ready, bId);
const reacted = await rt(A.page, (id) => window.__borrifo.controller.runtime.stage.actors.get(id)?.readyT ?? 0, bId);
check(reacted > 0, `o personagem de Bruno reage ao ficar pronto (reação ${reacted.toFixed(2)} s)`);
check((await A.page.textContent('.dock-status')).includes('1 de 1'), 'contador de prontos na ação principal');
await A.page.screenshot({ path: `${DIR}02-sala-dois.png` });

// ---------------------------------------------------------------- Partida (anfitrião)
await A.page.click('[role=tab]:has-text("Partida")');
await A.page.click('.big-card:has-text("Correio do Ara")');
await A.page.waitForFunction(() => window.__borrifo.uiStore.get().lobby.mode === 'correio');
check((await A.page.textContent('.poster')).includes('Correio'), 'cartaz do topo mostra o modo escolhido');
await B.page.click('[role=tab]:has-text("Partida")');
check(await B.page.isDisabled('.big-card:has-text("Território")'), 'quem não organiza vê as opções, sem poder mudar');
await A.page.click('.big-card:has-text("Território")');
await A.page.screenshot({ path: `${DIR}03-partida.png` });

// ---------------------------------------------------------------- Você: vitrine com o personagem 3D
await A.page.click('[role=tab]:has-text("Você")');
await A.page.waitForTimeout(600);
st = await stage(A.page);
check(st.mode === 'vitrine', 'aba Você: câmera fecha no próprio personagem');
const keyBefore = st.myKey;
await A.page.click('.tool-tile:has-text("Estilingue")');
st = await stage(A.page);
check(st.myKey?.includes('estilingue'), 'trocar a ferramenta atualiza o modelo 3D na hora (antes da resposta do servidor)');
await A.page.waitForFunction(() => { const l = window.__borrifo.uiStore.get(); return l.lobby.players.find((p) => p.playerId === l.welcome.playerId)?.weaponId === 'estilingue'; });
check(true, 'o servidor confirma a ferramenta para todos');
check((await A.page.textContent('.td-name')).includes('Estilingue'), 'descrição e estatísticas acompanham a ferramenta');
await A.page.waitForFunction(() => document.querySelectorAll('.portrait img[src^="data:image/png"]').length >= 6, null, { timeout: 30000 }).catch(() => null);
const shots = await rt(A.page, () => document.querySelectorAll('.portrait img[src^="data:image/png"]').length);
check(shots >= 6, `miniaturas de base e cabelo renderizadas do próprio modelo 3D (${shots})`);
await A.page.click('button[aria-label="Coquinhos"]');
await A.page.click('button[aria-label="Acobreado"]');
st = await stage(A.page);
check(st.myKey !== keyBefore && /h3c3/.test(st.myKey ?? ''), `cabelo e cor mudam o modelo na hora (${st.myKey})`);
await B.page.waitForFunction((id) => /h3c3/.test(window.__borrifo.uiStore.get().lobby.players.find((p) => p.playerId === id)?.appearance ?? ''), await rt(A.page, () => window.__borrifo.uiStore.get().welcome.playerId), { timeout: 5000 });
check(true, 'a outra pessoa recebe o visual novo (sincronizado pelo servidor)');
const box = await A.page.locator('.turntable').boundingBox();
await A.page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
await A.page.mouse.down();
await A.page.mouse.move(box.x + box.width * 0.5 + 160, box.y + box.height * 0.4, { steps: 8 });
await A.page.mouse.up();
st = await stage(A.page);
check(Math.abs(st.yawUser) > 1, `arrastar gira o personagem (${st.yawUser.toFixed(2)} rad)`);
await A.page.waitForTimeout(1600);
await A.page.screenshot({ path: `${DIR}04-voce.png` });
await A.page.click('[role=tab]:has-text("Sala")');
await A.page.waitForTimeout(300);
check((await stage(A.page)).mode === 'sala', 'voltar para a Sala devolve o enquadramento do grupo');

// ---------------------------------------------------------------- configurações
await A.page.click('button[aria-label="Configurações"]');
await A.page.waitForSelector('.settings');
const cats = await rt(A.page, () => [...document.querySelectorAll('.set-tab')].map((b) => b.textContent));
check(cats.join('|') === 'Jogo|Gráficos|Áudio|Controles|Toque|Acessibilidade', `categorias: ${cats.join(' | ')}`);
for (const c of cats) {
  await A.page.click(`.set-tab:has-text("${c}")`);
  check((await A.page.textContent('.set-tab[aria-selected=true]')) === c && (await A.page.$$('.set-page .setting, .set-page button')).length > 0, `categoria ${c} abre com opções`);
}
await A.page.click('.set-tab:has-text("Toque")');
await A.page.locator('.setting:has-text("Tamanho dos botões") input').fill('1.2');
check((await rt(A.page, () => JSON.parse(localStorage.getItem('borrifo.settings.v2')).touchScale)) === 1.2, 'opção de toque salva nas preferências');
await A.page.screenshot({ path: `${DIR}05-configuracoes.png` });
await A.page.keyboard.press('Escape');
await A.page.waitForTimeout(300);
check(!(await A.page.isVisible('.settings')), 'Esc fecha as configurações');

// ---------------------------------------------------------------- lobby → partida
await A.page.click('text=Começar partida');
await A.page.waitForSelector('.hub.is-leaving', { timeout: 5000 }).catch(() => null);
check(!!(await A.page.$('.hub.is-leaving')) || (await rt(A.page, () => window.__borrifo.uiStore.get().lobby.phase)) !== 'lobby', 'a interface do lobby recolhe (não some de uma vez)');
await A.page.waitForSelector('.ri-map', { timeout: 15000 });
check(true, 'cartaz do mapa e do modo na entrada da rodada');
st = await stage(A.page);
check(st.active === false && st.n === 0, 'palco liberado ao começar (os bonecos do lobby saem de cena)');
await A.page.waitForSelector('.ri-teams', { timeout: 20000 });
check(await A.page.isVisible('.ri-count'), 'as duas turmas aparecem frente a frente na contagem');
await A.page.screenshot({ path: `${DIR}06-contagem.png` });
await A.page.waitForSelector('.go-splash', { timeout: 15000 });
await A.page.screenshot({ path: `${DIR}07-valendo.png` });
check(true, '"Valendo!" na largada');
await A.page.waitForTimeout(2500);
const fov = await rt(A.page, () => Math.round((window.__borrifo.controller.runtime.rig.camera.fov * 180) / Math.PI));
const want = await rt(A.page, () => JSON.parse(localStorage.getItem('borrifo.settings.v2') ?? '{}').fov ?? 72);
check(Math.abs(fov - want) <= 1, `câmera chega ao ombro com o campo de visão da partida (${fov}°)`);
check(!(await A.page.isVisible('.go-splash')), 'o "Valendo!" some e o controle fica com o jogador');

// ---------------------------------------------------------------- de volta ao lobby
await A.page.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'results', null, { timeout: 120000 });
await A.page.evaluate(() => window.__borrifo.controller.vote('lobby'));
await B.page.evaluate(() => window.__borrifo.controller.vote('lobby'));
await A.page.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'lobby', null, { timeout: 30000 });
await A.page.waitForTimeout(1500);
st = await stage(A.page);
const leftovers = await rt(A.page, () => window.__borrifo.controller.runtime.views.size);
check(st.active && st.n >= 2 && leftovers === 0, `de volta ao lobby: palco de novo, sem bonecos da rodada (${st.n} no palco, ${leftovers} da rodada)`);

// ---------------------------------------------------------------- 8 × 8: palco limitado, lista completa
await A.page.evaluate(() => window.__borrifo.controller.setOptions({ formation: 8 }));
await A.page.waitForFunction(() => window.__borrifo.uiStore.get().lobby.plan.teamSize === 8);
await A.page.waitForTimeout(1200);
st = await stage(A.page);
check(st.n <= 10 && st.hidden[0] + st.hidden[1] >= 6, `8 × 8: no palco ${st.n} personagens, ${st.hidden[0] + st.hidden[1]} só na lista`);
check((await A.page.$$('.prow')).length >= 16, 'a lista mostra os 16 (pessoas e bots)');
console.log(`malhas ativas do palco em 8 × 8: ${st.meshes}`);
await A.page.screenshot({ path: `${DIR}08-oito.png` });
check(A.errs.length === 0 && B.errs.length === 0, `sem erros de página${[...A.errs, ...B.errs].length ? `: ${[...A.errs, ...B.errs].slice(0, 3).join(' | ')}` : ''}`);
await B.ctx.close();
await A.ctx.close();

// ---------------------------------------------------------------- celular em pé
const C = await open('carla', { width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await C.page.evaluate(() => window.__borrifo.controller.skipIntro());
await C.page.waitForTimeout(1200);
check(await C.page.$('.hub.is-narrow'), 'celular: cena em cima, painel em folha embaixo');
await C.page.tap('[role=tab]:has-text("Você")');
await C.page.waitForTimeout(800);
const framing = await rt(C.page, () => window.__borrifo.controller.runtime.stage.framing);
check(framing === 'topo', 'celular: o personagem fica na faixa de cima');
const scrolls = await rt(C.page, () => { const r = document.querySelector('.customize.carousel .tool-row'); return r ? getComputedStyle(r).overflowX : ''; });
check(scrolls === 'auto', 'celular: ferramentas em carrossel horizontal');
await C.page.tap('.tool-tile:has-text("Rodo")');
await C.page.waitForTimeout(1500);
await C.page.screenshot({ path: `${DIR}09-celular-voce.png` });
await C.page.tap('.sheet-grip');
await C.page.waitForTimeout(600);
check(await C.page.$('.hub.sheet-closed'), 'celular: a folha recolhe para mostrar a cena');
await C.page.screenshot({ path: `${DIR}10-celular-folha.png` });
const btn = await C.page.locator('.go-btn').boundingBox();
check(btn && btn.y + btn.height > 844 - 120 && btn.height >= 56, 'celular: ação principal grande, ao alcance do polegar');
check(C.errs.length === 0, `celular sem erros de página${C.errs.length ? `: ${C.errs.slice(0, 3).join(' | ')}` : ''}`);
await C.ctx.close();

await browser.close();
done();

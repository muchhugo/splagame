// Voz — CONTRATO E INTERFACE, determinístico. O host de laboratório publica um
// VoiceState escolhido pelo teste (fixture de desenvolvimento `__labVoiceFixture`)
// pelo BRIDGE REAL; o jogo associa por userId e desenha lobby, placar e nomes.
// Isto testa a aplicação, NÃO prova detecção de fala nem áudio (ver e2e/voz.mjs).
// Não precisa de LiveKit. Duas contas DIFERENTES com o MESMO nome ("João").
import { HOST_URL, OUT, check, done, launch, watchErrors } from './lib.mjs';

const browser = await launch();
const SID = `vozui-${Date.now().toString(36)}`;
const HOST2 = HOST_URL.replace('localhost', '127.0.0.1');

async function openAs(origin, user) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await ctx.newPage();
  const errs = watchErrors(page, user);
  await page.goto(origin);
  await page.locator('aside[aria-label=Canal] select').selectOption(user);
  await page.waitForFunction((u) => document.body.innerText.includes('sessão de desenvolvimento: João') || document.body.innerText.includes(`sessão de desenvolvimento: ${u}`), user);
  await page.fill('input[aria-label="Id da sessão da Atividade"]', SID);
  await page.click('button:has-text("Abrir Borrifo")');
  const frame = await (await page.waitForSelector('.slot iframe')).contentFrame();
  await frame.waitForFunction(() => window.__borrifo?.uiStore.get().screen === 'lobby', null, { timeout: 120000 });
  return { page, frame, errs };
}

const A = await openAs(HOST_URL, 'joao-silva');
const B = await openAs(HOST2, 'joao-souza');
await A.frame.waitForFunction(() => window.__borrifo.uiStore.get().lobby.players.filter((p) => !p.isBot).length === 2, null, { timeout: 20000 });
const humans = await A.frame.evaluate(() => window.__borrifo.uiStore.get().lobby.players.filter((p) => !p.isBot).map((p) => ({ id: p.playerId, userId: p.userId, name: p.displayName })));
check(humans.length === 2 && humans.every((h) => h.name === 'João') && humans[0].userId !== humans[1].userId, `duas contas distintas com o mesmo nome (${humans.map((h) => `${h.name}/${h.userId}`).join(', ')})`);
const pid = Object.fromEntries(humans.map((h) => [h.userId, h.id]));

const part = (id, speaking, muted, isLocal = false, name = 'João') => ({ id: `lk-${id}`, userId: id, displayName: name, speaking, muted, isLocal });
const voice = (participants) => ({ available: true, reason: 'ok', connected: true, muted: true, scope: 'shared_call', participants });
const fixture = (v) => A.page.evaluate((x) => window.__labVoiceFixture(x), v);
const state = (where) => A.frame.evaluate((sel) => Object.fromEntries([...document.querySelectorAll(sel)].map((e) => [e.dataset.player, { speaking: e.dataset.speaking === 'true', muted: e.dataset.muted === 'true' }])), where);

// 1) só joao-souza fala → só o slot DELE acende, embora os nomes sejam iguais
await fixture(voice([part('joao-silva', false, true, true), part('joao-souza', true, false)]));
await A.frame.waitForFunction((id) => document.querySelector(`[data-player="${id}"]`)?.dataset.speaking === 'true', pid['joao-souza'], { timeout: 3000 });
let s = await state('.slot[data-player]');
check(s[pid['joao-souza']].speaking && !s[pid['joao-silva']].speaking, 'fala associada por userId: acende só joao-souza');
check(s[pid['joao-silva']].muted && !s[pid['joao-souza']].muted, 'mudo associado ao jogador certo');

// 2) saída suavizada: continua aceso logo depois de parar, apaga em seguida (sem piscar a cada pausa)
await fixture(voice([part('joao-silva', false, true, true), part('joao-souza', false, false)]));
await A.frame.waitForTimeout(120);
s = await state('.slot[data-player]');
check(s[pid['joao-souza']].speaking, 'segura o indicador por um instante depois da última fala (hold)');
await A.frame.waitForFunction((id) => document.querySelector(`[data-player="${id}"]`)?.dataset.speaking === 'false', pid['joao-souza'], { timeout: 2000 });
check(true, 'apaga depois do hold');

// 3) mudo desliga na hora, mesmo que o estado ainda diga speaking
await fixture(voice([part('joao-silva', false, true, true), part('joao-souza', true, true)]));
await A.frame.waitForTimeout(200);
s = await state('.slot[data-player]');
check(!s[pid['joao-souza']].speaking && s[pid['joao-souza']].muted, 'mudo nunca aparece como falando');

// 4) pessoa na chamada que não joga não vira jogador nem acende ninguém
await fixture(voice([part('joao-silva', false, true, true), part('joao-souza', false, false), part('carla', true, false, false, 'Carla ✨')]));
await A.frame.waitForTimeout(500);
s = await state('.slot[data-player]');
const players = await A.frame.evaluate(() => window.__borrifo.uiStore.get().lobby.players.filter((p) => !p.isBot).length);
check(players === 2 && Object.values(s).every((x) => !x.speaking), 'participante da chamada fora da partida não vira jogador nem indicador');

// 5) partida: o ponto do placar segue o mesmo vínculo
const click = (f, t) => f.evaluate((txt) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(txt))?.click(), t);
await click(B.frame, 'Estou pronto');
await A.frame.waitForTimeout(400);
await click(A.frame, 'Começar partida');
await A.frame.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'running', null, { timeout: 60000 });
await fixture(voice([part('joao-silva', true, false, true), part('joao-souza', false, false)]));
await A.frame.waitForFunction((id) => document.querySelector(`.roster [data-player="${id}"]`)?.dataset.speaking === 'true', pid['joao-silva'], { timeout: 3000 }).catch(() => {});
s = await state('.roster [data-player]');
check(s[pid['joao-silva']]?.speaking && !s[pid['joao-souza']]?.speaking, 'placar: acende o João certo (joao-silva) na partida');
await A.page.screenshot({ path: `${OUT}voz-interface-partida.png` });

// 6) voltar ao estado real e fechar: nada fica preso
await fixture(null);
await A.frame.waitForTimeout(600);
s = await state('.roster [data-player]');
check(Object.values(s).every((x) => !x.speaking), 'sem fixture, volta ao estado real (sem chamada: nenhum indicador)');
await A.page.click('button:has-text("Fechar Atividade")');
await A.page.waitForFunction(() => !document.querySelector('.slot iframe'));
check(true, 'fechar a Atividade com indicadores ativos não trava');
const errs = [...A.errs, ...B.errs];
check(errs.length === 0, `sem erros de página${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
done();

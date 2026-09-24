// Treino rápido numa partida real: começa sozinho na primeira rodada, não
// bloqueia, detecta as etapas pelo estado do jogo e troca o texto conforme o
// dispositivo. O controle é SIMULADO (navigator.getGamepads falso, ver
// e2e/gamepad.mjs) e o toque é o de um contexto Playwright com isMobile/hasTouch
// — nenhum dos dois é hardware real.
import { readFileSync } from 'node:fs';
import { OUT, check, done, launch, openStandalone, watchErrors } from './lib.mjs';

const src = readFileSync(new URL('./gamepad.mjs', import.meta.url), 'utf8');
const fakePadInit = new Function(src.slice(src.indexOf('function fakePadInit() {') + 'function fakePadInit() {'.length, src.indexOf('\nconst sid')).trim().replace(/\}$/, ''));
const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';

const browser = await launch();
const sid = `e2e-tut-${Date.now().toString(36)}`;
const ctx = await browser.newContext({ viewport: { width: 1100, height: 640 } });
await ctx.addInitScript(fakePadInit);
const page = await ctx.newPage();
const errs = watchErrors(page, 'ana');
await openStandalone(page, 'ana', sid);
await page.click('text=Começar partida');
await page.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'running', null, { timeout: 60000 });
await page.waitForSelector('.tutorial', { timeout: 15000 });
const card = async () => (await page.textContent('.tutorial')).replace(/\s+/g, ' ');
const title = () => page.textContent('.tutorial strong');
check(/Treino rápido · 1\/9/.test(await card()) && (await title()) === 'Andar', 'treino começa sozinho na primeira rodada (1/9: Andar)');
check(/W A S D/.test(await card()), 'teclado: "Ande com W A S D"');
check((await page.evaluate(() => window.__borrifo.uiStore.get().lobby.phase)) === 'running', 'a partida segue enquanto o treino aparece');

const press = async (btn, ms = 250) => {
  await page.evaluate((b) => window.__padSet(b, 1), btn);
  await page.waitForTimeout(ms);
  await page.evaluate((b) => window.__padSet(b, 0), btn);
  await page.waitForTimeout(250);
};
await page.evaluate((id) => window.__padConnect(id), XBOX);
await press(13);
check(/Ande com LS/.test(await card()), 'controle: o mesmo passo vira "Ande com LS"');
await page.evaluate(() => window.__padAxes([0.2, -1, 0, 0]));
await page.waitForFunction(() => document.querySelector('.tutorial strong')?.textContent === 'Olhar em volta', null, { timeout: 15000 }).catch(() => {});
await page.evaluate(() => window.__padAxes([0, 0, 0, 0]));
check((await title()) === 'Olhar em volta', 'andar de verdade conclui a etapa 1');
check(/Gire a câmera com RS/.test(await card()), 'etapa 2 com o glifo do analógico direito (RS)');
await page.evaluate(() => window.__padAxes([0, 0, 1, 0]));
await page.waitForFunction(() => document.querySelector('.tutorial strong')?.textContent === 'Usar a ferramenta', null, { timeout: 15000 }).catch(() => {});
await page.evaluate(() => window.__padAxes([0, 0, 0, 0]));
check((await title()) === 'Usar a ferramenta' && /Segure RT/.test(await card()), 'girar a câmera conclui a etapa 2; etapa 3 pede RT');
await page.evaluate(() => window.__padSet(7, 1));
await page.waitForFunction(() => document.querySelector('.tutorial strong')?.textContent === 'Pintar o chão', null, { timeout: 15000 }).catch(() => {});
check((await title()) === 'Pintar o chão', 'disparar conclui a etapa 3');
// olhar para o chão mantendo o disparo
await page.evaluate(() => { const i = window.__borrifo.controller.runtime.input; i.pitch = 0.6; });
await page.waitForFunction(() => document.querySelector('.tutorial strong')?.textContent === 'Forma Pião', null, { timeout: 15000 }).catch(() => {});
await page.evaluate(() => window.__padSet(7, 0));
check((await title()) === 'Forma Pião' && /LB/.test(await card()), 'pintar o chão conclui a etapa 4; etapa 5 pede LB');
await page.screenshot({ path: `${OUT}treino-controle.png` });
await page.evaluate(() => window.__padSet(4, 1));
await page.waitForFunction(() => document.querySelector('.tutorial strong')?.textContent === 'Recarregar', null, { timeout: 15000 }).catch(() => {});
check((await title()) === 'Recarregar', 'segurar LB (Forma Pião) conclui a etapa 5');
await page.evaluate(() => window.__padSet(4, 0));

// mouse: o texto volta para teclado; "Pular etapa" não precisa de nada além de um clique
await page.click('.tutorial >> text=Pular etapa');
check((await title()) === 'Mapa tático' && /Tab/.test(await card()), 'pular etapa → "Mapa tático", texto de teclado (Tab)');
for (let i = 0; i < 3 && (await title()) !== 'Moringa'; i++) {
  await page.focus('canvas');
  await page.keyboard.down('Tab');
  await page.waitForTimeout(600);
  await page.keyboard.up('Tab');
  await page.waitForFunction(() => document.querySelector('.tutorial strong')?.textContent === 'Moringa', null, { timeout: 4000 }).catch(() => {});
}
check((await title()) === 'Moringa', 'abrir o mapa (Tab) conclui a etapa 7');
await page.click('.tutorial >> text=Encerrar treino');
await page.waitForTimeout(300);
check(!(await page.$('.tutorial')), 'encerrar some com o cartão');
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('borrifo.settings.v2')).tutorialDone);
check(saved === 1, 'conclusão salva por versão (tutorialDone = 1)');
check((await page.evaluate(() => window.__borrifo.uiStore.get().notices.map((n) => n.text))).some((t) => t.startsWith('Treino encerrado')), 'aviso de treino encerrado');
check(errs.length === 0, `sem erros de página${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
await ctx.close();

// ---------------- toque (contexto móvel emulado)
const m = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const mp = await m.newPage();
const merrs = watchErrors(mp, 'bruno');
await openStandalone(mp, 'bruno', `${sid}-m`);
// tap (pointerType "touch"); um click do Playwright seria um evento de mouse e mudaria o dispositivo para teclado
await mp.tap('text=Começar partida');
await mp.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'running', null, { timeout: 60000 });
await mp.waitForSelector('.tutorial', { timeout: 15000 });
const mcard = (await mp.textContent('.tutorial')).replace(/\s+/g, ' ');
check(/Arraste o Analógico à esquerda/.test(mcard), `toque: "Arraste o Analógico à esquerda" (${mcard.slice(0, 70)}…)`);
check(!!(await mp.$('.touch .tsys button[aria-label="Mapa tático"]')), 'toque: botão de mapa na tela');
await mp.tap('.touch .tsys button[aria-label="Mapa tático"]');
await mp.waitForTimeout(400);
check((await mp.evaluate(() => window.__borrifo.uiStore.get().mapOpen)) === true, 'toque: botão Mapa abre o mapa tático');
await mp.screenshot({ path: `${OUT}treino-toque.png` });
const box = await mp.evaluate(() => { const r = document.querySelector('.tacmap .frame').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight }; });
check(box.top >= 0 && box.bottom <= box.h + 1, `toque: mapa cabe na tela deitada (${Math.round(box.top)}–${Math.round(box.bottom)} de ${box.h} px)`);
await mp.tap('.tacmap >> text=Fechar');
await mp.waitForTimeout(300);
check((await mp.evaluate(() => window.__borrifo.uiStore.get().mapOpen)) === false, 'toque: "Fechar" fecha o mapa');
check(merrs.length === 0, `toque: sem erros de página${merrs.length ? `: ${merrs.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
done();

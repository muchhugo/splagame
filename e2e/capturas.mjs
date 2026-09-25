// Capturas comparáveis do jogo EXECUTADO (não são imagens de conceito), para o
// antes/depois do marco visual. Desktop (1280×720) e celular EMULADO (Playwright
// isMobile/hasTouch, 844×390 deitado; em pé só a tela de girar o aparelho). SwiftShader: a imagem é
// fiel, a taxa de quadros não.
//
//   ROUND_DURATION_SECONDS=40 no servidor para chegar ao resultado rápido.
//   PREFIXO=antes node e2e/capturas.mjs
import { GAME_URL, OUT, launch, openStandalone, watchErrors } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const PREFIXO = process.env.PREFIXO ?? 'depois';
const DIR = `${OUT}capturas/${PREFIXO}/`;
mkdirSync(DIR, { recursive: true });
const browser = await launch();
const shot = (page, name) => page.screenshot({ path: `${DIR}${name}.png` });
const ui = (page) => page.evaluate(() => window.__borrifo.uiStore.get());

async function clickText(page, t) {
  await page.evaluate((txt) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(txt))?.click(), t);
}

async function fluxo(label, ctxOpts, user, modo = 'territorio') {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errs = watchErrors(page, label);
  await openStandalone(page, user, `cap-${label}-${Date.now().toString(36)}`);
  await page.waitForTimeout(900);
  await shot(page, `${label}-abertura`);
  await page.evaluate(() => window.__borrifo.controller.skipIntro());
  await page.waitForTimeout(1200);
  if (modo !== 'territorio') {
    await page.evaluate((m) => window.__borrifo.controller.setOptions({ mode: m }), modo);
    await page.waitForFunction((m) => window.__borrifo.uiStore.get().lobby?.mode === m, modo);
    await page.waitForTimeout(400);
  }
  await shot(page, `${label}-lobby`);
  // abas do lobby (partida e você: na aba Você a câmera fecha no próprio personagem)
  for (const t of ['Partida', 'Você']) {
    await page.click(`[role=tab]:has-text("${t}")`);
    await page.waitForTimeout(t === 'Você' ? 2200 : 500);
    await shot(page, `${label}-lobby-${t === 'Você' ? 'voce' : 'partida'}`);
  }
  await page.click('[role=tab]:has-text("Sala")');
  await page.waitForTimeout(800);
  // configurações (pelo menu)
  await page.evaluate(() => window.__borrifo.uiStore.set({ menuOpen: true }));
  await page.waitForTimeout(500);
  await shot(page, `${label}-menu`);
  await clickText(page, 'Configurações');
  await page.waitForTimeout(500);
  await shot(page, `${label}-configuracoes`);
  await page.evaluate(() => window.__borrifo.uiStore.set({ menuOpen: false, settingsOpen: false }));
  await page.waitForTimeout(300);
  await clickText(page, 'Começar partida');
  await page.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'running', null, { timeout: 90000 });
  await page.waitForTimeout(1800);
  await shot(page, `${label}-partida-treino`);
  // anda e pinta um pouco
  await page.evaluate(() => { const i = window.__borrifo.controller.runtime.input; i.pitch = 0.32; });
  if (!ctxOpts.hasTouch) {
    await page.focus('canvas');
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyF');
    await page.waitForTimeout(3500);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyF');
  } else {
    await page.evaluate(() => window.__borrifo.controller.runtime.input.setTouch(0, 1, true, false));
    await page.waitForTimeout(3500);
    await page.evaluate(() => window.__borrifo.controller.runtime.input.setTouch(0, 0, false, false));
  }
  await shot(page, `${label}-partida-hud`);
  // personagem de frente, pela câmera do jogo (modo de inspeção só de dev)
  await page.evaluate(() => {
    const rt = window.__borrifo.controller.runtime;
    const s = rt.predictor.state;
    rt.debugView = { pos: [s.pos[0], s.pos[1], s.pos[2]], yaw: s.yaw + Math.PI, pitch: 0.12 };
  });
  await page.waitForTimeout(900);
  await shot(page, `${label}-personagem-frente`);
  await page.evaluate(() => {
    const rt = window.__borrifo.controller.runtime;
    const s = rt.predictor.state;
    rt.debugView = { pos: [s.pos[0], s.pos[1], s.pos[2]], yaw: s.yaw + Math.PI * 0.75, pitch: 0.05 };
  });
  await page.waitForTimeout(700);
  await shot(page, `${label}-personagem-lado`);
  await page.evaluate(() => (window.__borrifo.controller.runtime.debugView = null));
  // mapa tático
  await page.evaluate(() => { const i = window.__borrifo.controller.runtime.input; i.toggleMap(); });
  await page.waitForTimeout(700);
  await shot(page, `${label}-mapa`);
  await page.evaluate(() => { const c = window.__borrifo.controller; c.runtime.input.closeMap(); window.__borrifo.uiStore.set({ mapOpen: false }); });
  // resultado
  await page.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'results', null, { timeout: 180000 });
  await page.waitForTimeout(2200);
  await shot(page, `${label}-resultado`);
  const u = await ui(page);
  console.log(label, 'fase', u.lobby.phase, 'tela', u.screen, 'erros', errs.length, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

const SO = process.env.SO ?? 'desktop,celular,desktop-correio,celular-correio';
const flows = {
  desktop: () => fluxo('desktop', { viewport: { width: 1280, height: 720 } }, 'ana'),
  celular: () => fluxo('celular', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, 'bruno'),
  'desktop-correio': () => fluxo('desktop-correio', { viewport: { width: 1280, height: 720 } }, 'davi', 'correio'),
  'celular-correio': () => fluxo('celular-correio', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, 'elis', 'correio'),
};
for (const k of SO.split(',')) await flows[k]();
// em pé: o jogo é só na horizontal; a captura mostra a tela que pede para girar
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  // a tela de girar cobre tudo, inclusive a entrada: só carrega a página
  await page.goto(GAME_URL);
  await page.waitForSelector('.rotate-screen', { timeout: 30000 });
  await page.waitForTimeout(400);
  await shot(page, 'celular-em-pe-girar');
  await ctx.close();
}
await browser.close();
console.log('capturas em', DIR);

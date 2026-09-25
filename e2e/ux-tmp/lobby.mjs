// node e2e/ux-tmp/lobby.mjs <vpkey>  — resiliente a recargas do Vite / reinício do servidor
import { launch, openStandalone, watchErrors, GAME_URL } from '../lib.mjs';
import { VPS, snap, log } from './ux-lib.mjs';

const key = process.argv[2] ?? 'd1280';
const F = `lobby-${key}`;
const vp = VPS[key];
const browser = await launch();
const sid = `ux-${key}-${Date.now().toString(36)}`;
const G = ['.stag', '.hub-top > *', '.stag, .hub-panel, .hub-dock, .hub-top', '.hub-dock > *', '.poster > *', '.hub-tools > *'];
const tap = (page, sel) => (vp.hasTouch ? page.tap(sel, { timeout: 10000 }) : page.click(sel, { timeout: 10000 }));
const scr = (p) => p.evaluate(() => window.__borrifo?.uiStore.get().screen).catch(() => null);

async function enter(page, user) {
  for (let i = 0; i < 6; i++) {
    try {
      await openStandalone(page, user, sid);
      await page.evaluate(() => window.__borrifo.controller.skipIntro());
      await page.waitForTimeout(1500);
      return;
    } catch (e) {
      log(F, `entrar ${user} falhou: ${e.message.split('\n')[0]}`);
      await page.waitForTimeout(4000);
    }
  }
}
async function step(name, fn) {
  for (let i = 0; i < 3; i++) {
    try {
      await fn();
      return;
    } catch (e) {
      log(F, `PASSO ${name} falhou (${i}): ${e.message.split('\n')[0]}`);
      await A.waitForTimeout(3000);
      if ((await scr(A)) !== 'lobby') await enter(A, 'ana');
      if (B && (await scr(B)) !== 'lobby') await enter(B, 'bruno');
      await A.keyboard.press('Escape').catch(() => {});
    }
  }
}

const ctxA = await browser.newContext(vp);
const A = await ctxA.newPage();
let B = null;
const errA = watchErrors(A, 'A');
await step('login', async () => {
  await A.goto(GAME_URL);
  await A.waitForSelector('select');
  await A.waitForTimeout(500);
  await snap(A, `${key}-00-login`, F, []);
  await A.selectOption('select', 'ana');
  await A.fill('input', sid);
  await A.click('button[type=submit]');
  await A.waitForTimeout(600);
  await snap(A, `${key}-01-boot`, F, []);
  await A.waitForFunction(() => window.__borrifo?.uiStore.get().screen === 'lobby', null, { timeout: 120000 });
  await A.waitForTimeout(1200);
  await snap(A, `${key}-02-intro`, F, ['.intro-card > *', '.stag']);
  await A.evaluate(() => window.__borrifo.controller.skipIntro());
  await A.waitForTimeout(2500);
  await snap(A, `${key}-03-sala-sozinho`, F, G);
});

const ctxB = await browser.newContext(vp);
B = await ctxB.newPage();
const errB = watchErrors(B, 'B');
await enter(B, 'bruno');
await step('sala2', async () => {
  await B.waitForTimeout(1000);
  await snap(A, `${key}-04-sala-host-2p`, F, G);
  await snap(B, `${key}-05-sala-naohost`, F, G);
  await tap(B, '.go-btn');
  await B.waitForTimeout(1500);
  await snap(B, `${key}-06-sala-naohost-pronto`, F, G);
  await snap(A, `${key}-07-sala-host-bpronto`, F, G);
});
await step('partida', async () => {
  await tap(A, '[role=tab]:has-text("Partida")');
  await A.waitForTimeout(1200);
  await snap(A, `${key}-08-partida-host`, F, ['.big-card', '.map-card', '.seg > *', '.options > *']);
  await A.evaluate(() => document.querySelector('.hub-body')?.scrollTo(0, 9999));
  await A.waitForTimeout(400);
  await snap(A, `${key}-08b-partida-host-fim`, F, []);
  await tap(B, '[role=tab]:has-text("Partida")');
  await B.waitForTimeout(1200);
  await snap(B, `${key}-09-partida-naohost`, F, []);
});
await step('voce', async () => {
  await tap(A, '[role=tab]:has-text("Você")');
  await A.waitForTimeout(3500);
  await snap(A, `${key}-10-voce`, F, ['.tool-tile', '.turn-hint, .hub-panel, .hub-dock, .hub-top', '.portrait']);
  await A.evaluate(() => document.querySelector('.hub-body')?.scrollTo(0, 9999));
  await A.waitForTimeout(400);
  await snap(A, `${key}-10b-voce-fim`, F, []);
  if (vp.hasTouch && (await A.$('.sheet-grip'))) {
    await A.tap('.sheet-grip');
    await A.waitForTimeout(800);
    await snap(A, `${key}-10c-voce-folha-fechada`, F, ['.turn-hint, .hub-panel, .hub-dock, .hub-top']);
    await A.tap('.sheet-grip');
    await A.waitForTimeout(500);
  }
  await tap(A, '[role=tab]:has-text("Sala")');
  await A.waitForTimeout(800);
});
await step('config', async () => {
  await tap(A, 'button[aria-label="Configurações"]');
  await A.waitForSelector('.settings', { timeout: 8000 });
  const cats = await A.evaluate(() => [...document.querySelectorAll('.set-tab')].map((b) => b.textContent));
  let i = 0;
  for (const c of cats) {
    await tap(A, `.set-tab:has-text("${c}")`);
    await A.waitForTimeout(500);
    await snap(A, `${key}-11-config-${i++}-${c}`, F, ['.set-page .setting', '.set-tabs > *', '.set-head > *']);
    await A.evaluate(() => document.querySelector('.set-page')?.scrollTo(0, 9999));
    await A.waitForTimeout(200);
    await A.screenshot({ path: `/tmp/claude-0/-home-user-splagame/99da03ea-b548-53d9-9f15-bb3c31d95516/scratchpad/ux/${key}-11-config-${i - 1}-${c}-fim.png` });
  }
  await A.keyboard.press('Escape');
  await A.waitForTimeout(500);
});
await step('menu', async () => {
  await A.evaluate(() => window.__borrifo.uiStore.set({ menuOpen: true, settingsOpen: false }));
  await A.waitForTimeout(600);
  await snap(A, `${key}-12-menu-lobby`, F, ['.menu > *']);
  await A.evaluate(() => window.__borrifo.uiStore.set({ menuOpen: false }));
  await A.waitForTimeout(400);
});
await step('8x8', async () => {
  await A.evaluate(() => { window.__borrifo.controller.setOptions({ formation: 8 }); window.__borrifo.controller.setBots(true); });
  await A.waitForFunction(() => window.__borrifo.uiStore.get().lobby.plan.teamSize === 8, null, { timeout: 10000 });
  await A.waitForTimeout(4000);
  await snap(A, `${key}-13-sala-8x8`, F, G);
  await A.evaluate(() => document.querySelector('.hub-body')?.scrollTo(0, 9999));
  await A.waitForTimeout(400);
  await snap(A, `${key}-13b-sala-8x8-fim`, F, []);
  await snap(B, `${key}-14-sala-8x8-naohost`, F, G);
});
await step('foco', async () => {
  await A.keyboard.press('Tab');
  await A.keyboard.press('Tab');
  await A.waitForTimeout(300);
  const focus = await A.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { el: e?.outerHTML.slice(0, 120), outline: cs.outline, shadow: cs.boxShadow }; });
  log(F, { focus });
  await snap(A, `${key}-15-foco`, F, []);
});
log(F, { errors: [...errA, ...errB].slice(0, 20) });
await browser.close();

// node e2e/ux-tmp/lobby.mjs <vpkey>
import { launch, openStandalone, watchErrors, GAME_URL } from '../lib.mjs';
import { VPS, snap, log } from './ux-lib.mjs';

const key = process.argv[2] ?? 'd1280';
const F = `lobby-${key}`;
const vp = VPS[key];
const browser = await launch();
const sid = `ux-${key}-${Date.now().toString(36)}`;
const G = ['.stag', '.hub-top > *', '.stag, .hub-panel, .hub-dock, .hub-top', '.hub-dock > *', '.poster > *', '.hub-tools > *'];
const tap = async (page, sel) => (vp.hasTouch ? page.tap(sel) : page.click(sel));

const ctxA = await browser.newContext(vp);
const A = await ctxA.newPage();
const errA = watchErrors(A, 'A');
await A.goto(GAME_URL);
await A.waitForSelector('select');
await A.waitForTimeout(500);
await snap(A, `${key}-00-login`, F, []);
await A.selectOption('select', 'ana');
await A.fill('input', sid);
await A.click('button[type=submit]');
await A.waitForTimeout(700);
await snap(A, `${key}-01-boot`, F, []);
await A.waitForFunction(() => window.__borrifo?.uiStore.get().screen === 'lobby', null, { timeout: 120000 });
await A.waitForTimeout(1200);
await snap(A, `${key}-02-intro`, F, ['.intro-card > *']);
await A.evaluate(() => window.__borrifo.controller.skipIntro());
await A.waitForTimeout(2500);
await snap(A, `${key}-03-sala-sozinho`, F, G);

const ctxB = await browser.newContext(vp);
const B = await ctxB.newPage();
const errB = watchErrors(B, 'B');
await openStandalone(B, 'bruno', sid);
await B.evaluate(() => window.__borrifo.controller.skipIntro());
await B.waitForTimeout(2500);
await snap(A, `${key}-04-sala-host-2p`, F, G);
await snap(B, `${key}-05-sala-naohost`, F, G);
await tap(B, '.go-btn');
await B.waitForTimeout(1500);
await snap(B, `${key}-06-sala-naohost-pronto`, F, G);
await snap(A, `${key}-07-sala-host-bpronto`, F, G);

await tap(A, '[role=tab]:has-text("Partida")');
await A.waitForTimeout(1200);
await snap(A, `${key}-08-partida-host`, F, ['.big-card', '.map-card', '.seg > *', '.options > *']);
await A.evaluate(() => document.querySelector('.hub-body')?.scrollTo(0, 9999));
await A.waitForTimeout(400);
await snap(A, `${key}-08b-partida-host-fim`, F, []);
await tap(B, '[role=tab]:has-text("Partida")');
await B.waitForTimeout(1200);
await snap(B, `${key}-09-partida-naohost`, F, []);

await tap(A, '[role=tab]:has-text("Você")');
await A.waitForTimeout(3500);
await snap(A, `${key}-10-voce`, F, ['.tool-tile', '.turn-hint, .hub-panel, .hub-dock, .hub-top', '.portrait']);
await A.evaluate(() => document.querySelector('.hub-body')?.scrollTo(0, 9999));
await A.waitForTimeout(400);
await snap(A, `${key}-10b-voce-fim`, F, []);
if (vp.hasTouch) {
  const grip = await A.$('.sheet-grip');
  if (grip) {
    await A.tap('.sheet-grip');
    await A.waitForTimeout(800);
    await snap(A, `${key}-10c-voce-folha-fechada`, F, ['.turn-hint, .hub-panel, .hub-dock, .hub-top']);
    await A.tap('.sheet-grip');
  }
}
await tap(A, '[role=tab]:has-text("Sala")');
await A.waitForTimeout(800);

// configurações
await tap(A, 'button[aria-label="Configurações"]');
await A.waitForSelector('.settings');
const cats = await A.evaluate(() => [...document.querySelectorAll('.set-tab')].map((b) => b.textContent));
let i = 0;
for (const c of cats) {
  await tap(A, `.set-tab:has-text("${c}")`);
  await A.waitForTimeout(500);
  await snap(A, `${key}-11-config-${i++}-${c}`, F, ['.set-page .setting', '.set-tabs > *', '.set-head > *']);
}
await A.keyboard.press('Escape');
await A.waitForTimeout(500);
// menu do lobby
await A.evaluate(() => window.__borrifo.uiStore.set({ menuOpen: true, settingsOpen: false }));
await A.waitForTimeout(600);
await snap(A, `${key}-12-menu-lobby`, F, ['.menu > *']);
await A.evaluate(() => window.__borrifo.uiStore.set({ menuOpen: false }));
await A.waitForTimeout(400);

// 8x8 com bots
await A.evaluate(() => { window.__borrifo.controller.setOptions({ formation: 8 }); window.__borrifo.controller.setBots(true); });
await A.waitForFunction(() => window.__borrifo.uiStore.get().lobby.plan.teamSize === 8);
await A.waitForTimeout(4000);
await snap(A, `${key}-13-sala-8x8`, F, G);
await A.evaluate(() => document.querySelector('.hub-body')?.scrollTo(0, 9999));
await A.waitForTimeout(400);
await snap(A, `${key}-13b-sala-8x8-fim`, F, []);
await B.waitForTimeout(1500);
await snap(B, `${key}-14-sala-8x8-naohost`, F, G);
// focus visibility
await A.keyboard.press('Tab');
await A.keyboard.press('Tab');
await A.waitForTimeout(300);
const focus = await A.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { el: e?.outerHTML.slice(0, 120), outline: cs.outline, shadow: cs.boxShadow }; });
log(F, { focus });
await snap(A, `${key}-15-foco`, F, []);
log(F, { errors: [...errA, ...errB] });
await browser.close();

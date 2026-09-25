// Vitrine dos personagens no jogo EXECUTADO: partida com bots (as 8 aparências
// aparecem entre jogador e bots), câmera de inspeção de dev (`debugView`) de frente
// e de lado para cada personagem. Também mede quantas malhas cada um ativa.
//   PREFIXO=depois node e2e/personagens.mjs  → e2e/out/capturas/<PREFIXO>/personagem-*.png
import { OUT, check, done, launch, openStandalone, watchErrors } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const DIR = `${OUT}capturas/${process.env.PREFIXO ?? 'depois'}/`;
mkdirSync(DIR, { recursive: true });
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 960, height: 720 } });
const page = await ctx.newPage();
const errs = watchErrors(page, 'personagens');
await openStandalone(page, 'ana', `pers-${Date.now().toString(36)}`);
// base 2, tom 3 para a jogadora local (o servidor valida e sincroniza)
await page.evaluate(() => window.__borrifo.controller.setAppearance('b2'));
await page.waitForFunction(() => window.__borrifo.uiStore.get().lobby.players.find((p) => p.playerId === window.__borrifo.uiStore.get().welcome.playerId)?.appearance === 'b2', null, { timeout: 5000 });
check(true, 'aparência escolhida volta do servidor no estado do lobby');
// 4 × 4 com bots: oito personagens com base, tom, cabelo e cor variados
await page.evaluate(() => window.__borrifo.controller.setOptions({ formation: 4 }));
await page.waitForFunction(() => window.__borrifo.uiStore.get().lobby.plan.teamSize === 4);
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Começar partida'))?.click());
await page.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'running', null, { timeout: 90000 });
await page.waitForTimeout(1500);

const roster = await page.evaluate(() => window.__borrifo.uiStore.get().lobby.players.map((p) => ({ id: p.playerId, a: p.appearance, bot: p.isBot, team: p.team })));
const looks = new Set(roster.map((p) => p.a));
check(looks.size >= 6, `aparências distintas na partida: ${[...looks].join(', ')}`);

for (const p of roster) {
  for (const [lado, dyaw, pitch] of [['frente', Math.PI, 0.1], ['lado', Math.PI * 0.62, 0.02]]) {
    await page.evaluate(([id, dy, pt]) => {
      const rt = window.__borrifo.controller.runtime;
      const view = rt.views.get(id);
      window.__alvo = view;
      rt.debugView = {
        get pos() { const q = view.root.position; return [q.x, q.y, q.z]; },
        get yaw() { return view.root.rotation.y + dy; },
        pitch: pt,
      };
    }, [p.id, dyaw, pitch]);
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${DIR}personagem-${p.a}-${p.bot ? 'bot' : 'local'}-${lado}.png` });
  }
}
// orçamento em regime: na troca de forma as duas formas ficam ligadas por ~0,15 s (até ~44
// malhas); três amostras espaçadas e o mínimo de cada personagem medem o estado estável
const samples = [];
for (let i = 0; i < 3; i++) {
  samples.push(await page.evaluate(() => [...window.__borrifo.controller.runtime.views.values()].map((v) => v.activeMeshCount())));
  await page.waitForTimeout(200);
}
const meshes = samples[0].map((_, i) => Math.min(...samples.map((s) => s[i] ?? Infinity)));
check(Math.max(...meshes) <= 40, `malhas ativas por personagem (em regime): ${meshes.join(', ')}`);
await page.evaluate(() => (window.__borrifo.controller.runtime.debugView = null));
check(errs.length === 0, `sem erros de página${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
done();

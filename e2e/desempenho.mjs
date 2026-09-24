// Medição de desempenho do CLIENTE executado (não é estimativa), comparável entre versões:
// partida standalone com bots, N rodadas seguidas (revanche), e por rodada:
//   - chamadas de desenho por quadro (contadas envolvendo drawElements/drawArrays do WebGL);
//   - intervalo entre quadros (p50/p95, ms) — com SwiftShader é CPU, NÃO representa GPU real;
//   - malhas na cena/ativas, materiais, texturas; heap JS (Chromium precise-memory-info).
// Sem GPU real, estes números servem para COMPARAR versões e cenários na mesma máquina.
//   E2E_GAME_URL=… ROTULO=depois CENARIOS=1x1,4x4,8x8 RODADAS=3 node e2e/desempenho.mjs
import { writeFileSync } from 'node:fs';
import { GAME_URL, OUT, launch, openStandalone, watchErrors } from './lib.mjs';

const ROTULO = process.env.ROTULO ?? 'depois';
const CENARIOS = (process.env.CENARIOS ?? '4x4,8x8').split(',');
const RODADAS = Number(process.env.RODADAS ?? 2);
const AMOSTRA_MS = Number(process.env.AMOSTRA_MS ?? 8000);

const counterInit = () => {
  const w = window;
  w.__draws = { frame: 0, frames: [], intervals: [], last: 0 };
  for (const proto of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype]) {
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = proto[fn];
      if (!orig) continue;
      proto[fn] = function (...a) {
        w.__draws.frame++;
        return orig.apply(this, a);
      };
    }
  }
  const tick = (t) => {
    const d = w.__draws;
    if (d.last) d.intervals.push(t - d.last);
    d.last = t;
    if (d.frame > 0) d.frames.push(d.frame);
    d.frame = 0;
    if (d.frames.length > 4000) d.frames.shift();
    if (d.intervals.length > 4000) d.intervals.shift();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const q = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10;
};

const browser = await launch();
const report = { rotulo: ROTULO, gpu: process.env.E2E_SWIFTSHADER === '1' ? 'SwiftShader (CPU)' : 'padrão do navegador', data: new Date().toISOString(), cenarios: [] };
for (const cen of CENARIOS) {
  const size = Number(cen.split('x')[0]);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(counterInit);
  const page = await ctx.newPage();
  const errs = watchErrors(page, cen);
  await openStandalone(page, 'ana', `perf-${cen}-${Date.now().toString(36)}`);
  // versões novas: formação fixa com bots; antigas (sem opções) ficam com o padrão delas
  const hasOptions = await page.evaluate(() => typeof window.__borrifo.controller.setOptions === 'function');
  if (hasOptions) {
    await page.evaluate((n) => window.__borrifo.controller.setOptions({ formation: n, map: 'toca-do-ara' }), size);
    await page.waitForFunction((n) => window.__borrifo.uiStore.get().lobby?.plan?.teamSize === n, size, { timeout: 5000 });
  }
  const rounds = [];
  for (let r = 0; r < RODADAS; r++) {
    if (r === 0) await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Começar partida'))?.click());
    else await page.evaluate(() => window.__borrifo.controller.vote('rematch'));
    await page.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'running', null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.__draws.frames.length = 0;
      window.__draws.intervals.length = 0;
    });
    await page.waitForTimeout(AMOSTRA_MS);
    const m = await page.evaluate(() => {
      const rt = window.__borrifo.controller.runtime;
      const sc = rt.scene;
      const lobby = window.__borrifo.uiStore.get().lobby;
      return {
        frames: window.__draws.frames.slice(),
        intervals: window.__draws.intervals.slice(),
        meshes: sc.meshes.length,
        activeMeshes: sc.getActiveMeshes().length,
        materials: sc.materials.length,
        textures: sc.textures.length,
        heapMB: performance.memory ? Math.round((performance.memory.usedJSHeapSize / 1048576) * 10) / 10 : null,
        players: lobby.players.filter((p) => p.inRound).length,
        mapa: lobby.map?.id ?? lobby.map?.name ?? '?',
      };
    });
    rounds.push({
      rodada: r + 1,
      jogadores: m.players,
      mapa: m.mapa,
      desenhosPorQuadro: { p50: q(m.frames, 0.5), p95: q(m.frames, 0.95) },
      intervaloQuadroMs: { p50: q(m.intervals, 0.5), p95: q(m.intervals, 0.95) },
      quadros: m.intervals.length,
      malhas: m.meshes,
      malhasAtivas: m.activeMeshes,
      materiais: m.materials,
      texturas: m.textures,
      heapMB: m.heapMB,
    });
    console.log(`${ROTULO} ${cen} rodada ${r + 1}: ${m.players} jogadores em ${m.mapa} · desenhos p50 ${q(m.frames, 0.5)} · quadro p50 ${q(m.intervals, 0.5)} ms · malhas ${m.meshes} · materiais ${m.materials} · heap ${m.heapMB} MB`);
    await page.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'results', null, { timeout: 300000 });
    await page.waitForTimeout(800);
  }
  report.cenarios.push({ cenario: cen, rodadas: rounds, erros: errs.slice(0, 5) });
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}desempenho-${ROTULO}.json`, JSON.stringify(report, null, 2));
console.log(`relatório em ${OUT}desempenho-${ROTULO}.json`);

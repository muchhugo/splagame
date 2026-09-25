// Perfil de ALOCAÇÕES no navegador durante a partida (antes de otimizar):
// amostragem de heap do V8 pelo DevTools (inclui objetos já coletados), 8 × 8 com bots,
// por N segundos. Agrupa os bytes alocados por função/arquivo e divide pelos quadros.
//   E2E_SWIFTSHADER=1 SEGUNDOS=10 SAIDA=e2e/out/alocacoes-antes.json node e2e/alocacoes.mjs
import { writeFileSync } from 'node:fs';
import { launch } from './lib.mjs';
import { startStack } from './stack.mjs';

const SEGUNDOS = Number(process.env.SEGUNDOS ?? 10);
const SAIDA = process.env.SAIDA ?? new URL('./out/alocacoes.json', import.meta.url).pathname;
const stack = await startStack({ serverPort: Number(process.env.PORTA_SERVIDOR ?? 2690), gamePort: Number(process.env.PORTA_JOGO ?? 5290) });
try {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await stack.serveCredentials(page);
  await page.goto(stack.gameUrl);
  await page.waitForSelector('select');
  await page.selectOption('select', 'ana');
  await page.fill('input', `aloc-${Date.now().toString(36)}`);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => window.__borrifo?.uiStore.get().screen === 'lobby', null, { timeout: 120000 });
  await page.evaluate(() => window.__borrifo.controller.skipIntro());
  await page.evaluate(() => window.__borrifo.controller.setOptions({ formation: 8 }));
  await page.waitForFunction(() => window.__borrifo.uiStore.get().lobby.plan.teamSize === 8);
  await page.click('text=Começar partida');
  await page.waitForFunction(() => window.__borrifo.controller.runtime?.predictor?.state.alive && window.__borrifo.uiStore.get().lobby?.phase === 'running', null, { timeout: 120000 });
  // anda e atira para ter HUD, efeitos e etiquetas em uso (sem teclas: pela entrada do runtime)
  await page.evaluate(() => document.querySelector('canvas')?.focus());
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const f0 = await page.evaluate(() => window.__borrifo.controller.runtime.frames + (window.__framesTotal ?? 0));
  await page.evaluate(() => {
    window.__rafCount = 0;
    const tick = () => {
      window.__rafCount++;
      window.__rafId = requestAnimationFrame(tick);
    };
    tick();
  });
  const effectsAt = () => page.evaluate(() => Object.keys(window.__borrifo.controller.runtime.scene.getEngine()._compiledEffects ?? {}));
  const fx0 = await effectsAt();
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const tStart = Date.now();
  let frames = 0;
  // o runtime zera `frames` a cada segundo (fps): soma por amostragem
  let lastFps = 0;
  const fpsSamples = [];
  while (Date.now() - tStart < SEGUNDOS * 1000) {
    await page.waitForTimeout(1000);
    lastFps = await page.evaluate(() => window.__borrifo.controller.runtime.fps);
    fpsSamples.push(lastFps);
    frames += lastFps;
    if ((Date.now() - tStart) % 3000 < 1000) await page.keyboard.press('Space');
  }
  const { profile } = await cdp.send('HeapProfiler.getSamplingProfile');
  const fx1 = await effectsAt();
  const compiledDuring = fx1.filter((k) => !fx0.includes(k));
  console.log(`shaders compilados durante a medição: ${compiledDuring.length}`);
  if (process.env.DETALHE) for (const k of compiledDuring) console.log('   ', k.slice(0, 160).replace(/\n/g, ' '));
  if (process.env.PERFIL_BRUTO) writeFileSync(process.env.PERFIL_BRUTO, JSON.stringify(profile));
  await cdp.send('HeapProfiler.stopSampling');
  await page.keyboard.up('KeyW');
  void f0;
  const bySite = new Map();
  let total = 0;
  const walk = (n, stack) => {
    const cf = n.callFrame;
    const file = (cf.url || '').replace(/^.*?\/(src|node_modules|@fs)\//, '$1/').replace(/\?.*$/, '');
    const site = `${cf.functionName || '(anônima)'} ${file}:${cf.lineNumber + 1}`;
    const self = n.selfSize ?? 0;
    if (self > 0) {
      total += self;
      // atribui ao quadro do NOSSO código mais próximo (src/…) para saber quem pediu a alocação
      const ours = [site, ...stack].find((s) => / src\//.test(s)) ?? site;
      const e = bySite.get(ours) ?? { bytes: 0, direct: 0, leaves: new Map() };
      e.bytes += self;
      if (ours === site) e.direct += self;
      e.leaves.set(site, (e.leaves.get(site) ?? 0) + self);
      bySite.set(ours, e);
    }
    for (const c of n.children ?? []) walk(c, [site, ...stack]);
  };
  walk(profile.head, []);
  const perFrame = (b) => Math.round(b / Math.max(1, frames));
  const top = [...bySite.entries()]
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 30)
    .map(([site, e]) => ({ site, kbTotal: Math.round(e.bytes / 1024), bytesPorQuadro: perFrame(e.bytes), diretoPct: Math.round((e.direct / e.bytes) * 100), onde: [...e.leaves.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l, b]) => `${perFrame(b)} B/q ${l}`) }));
  const out = { shadersCompiladosDuranteAMedicao: compiledDuring.length, data: new Date().toISOString(), gpu: process.env.E2E_SWIFTSHADER === '1' ? 'SwiftShader (CPU)' : 'padrão', segundos: SEGUNDOS, quadros: frames, fpsMedio: Math.round((frames / fpsSamples.length) * 10) / 10, alocadoKB: Math.round(total / 1024), bytesPorQuadro: perFrame(total), top };
  writeFileSync(SAIDA, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ quadros: out.quadros, fps: out.fpsMedio, alocadoKB: out.alocadoKB, bytesPorQuadro: out.bytesPorQuadro }));
  for (const t of top.slice(0, 22)) {
    console.log(`${String(t.bytesPorQuadro).padStart(7)} B/q ${String(t.kbTotal).padStart(6)} KB  ${t.site}`);
    if (process.env.DETALHE) for (const l of t.onde) console.log(`            ↳ ${l}`);
  }
  await browser.close();
} finally {
  stack.stop();
}

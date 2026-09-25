// Conta, durante a partida (8 × 8 com bots), quantas vezes o Babylon processa código de
// shader (compilação de uma variante nova) e de onde veio: material e malha. Também lista
// malhas criadas/removidas e as trocas de defines por submesh.
//   E2E_SWIFTSHADER=1 JANELA=25000 node e2e/shaders.mjs
import { launch } from './lib.mjs';
import { startStack } from './stack.mjs';
const stack = await startStack({ serverPort: 2691, gamePort: 5291 });
try {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await stack.serveCredentials(page);
  await page.goto(stack.gameUrl);
  await page.waitForSelector('select');
  await page.selectOption('select', 'ana');
  await page.fill('input', `fx-${Date.now().toString(36)}`);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => window.__borrifo?.uiStore.get().screen === 'lobby', null, { timeout: 120000 });
  await page.evaluate(() => window.__borrifo.controller.skipIntro());
  await page.evaluate(() => window.__borrifo.controller.setOptions({ formation: 8 }));
  await page.waitForFunction(() => window.__borrifo.uiStore.get().lobby.plan.teamSize === 8);
  await page.click('text=Começar partida');
  await page.waitForFunction(() => window.__borrifo.controller.runtime?.predictor?.state.alive && window.__borrifo.uiStore.get().lobby?.phase === 'running', null, { timeout: 120000 });
  await page.evaluate((j) => (window.__janela = j), Number(process.env.JANELA ?? 3000));
  page.on('console', (m) => /CRIADAS|REMOVIDAS|DIFS|PROCESSADOS/.test(m.text()) && console.log(m.text().slice(0, 900)));
  const r = await page.evaluate(async () => {
    const scene = window.__borrifo.controller.runtime.scene;
    const eng = scene.getEngine();
    const counts = {};
    let cur = null;
    const created = {};
    const disposed = {};
    const obsA = scene.onNewMeshAddedObservable.add((mm) => (created[mm.name] = (created[mm.name] ?? 0) + 1));
    const obsB = scene.onMeshRemovedObservable.add((mm) => (disposed[mm.name] = (disposed[mm.name] ?? 0) + 1));
    for (const m of scene.materials) {
      if (m.getClassName() === 'ShaderMaterial') {
        const o2 = m.isReady.bind(m);
        m.isReady = (mesh, inst, sm) => {
          cur = `${m.name} | ${mesh?.name}`;
          const before = sm?._drawWrapper?.defines ?? null;
          const r = o2(mesh, inst, sm);
          const after = sm?._drawWrapper?.defines ?? null;
          if (before !== after) {
            const b = new Set((before ?? '').split('\n')), a = new Set((after ?? '').split('\n'));
            const diff = `${[...a].filter((x) => !b.has(x)).join(',')} / -${[...b].filter((x) => !a.has(x)).join(',')} inst=${inst}`;
            window.__diffs = window.__diffs ?? {};
            window.__diffs[diff] = (window.__diffs[diff] ?? 0) + 1;
          }
          cur = null;
          return r;
        };
        continue;
      }
      if (m.getClassName() !== 'StandardMaterial') continue;
      const orig = m.isReadyForSubMesh.bind(m);
      m.isReadyForSubMesh = (mesh, sm, inst) => { cur = `${m.name} | ${mesh.name}`; const r = orig(mesh, sm, inst); cur = null; return r; };
    }
    // conta o passo caro (processar o código do shader) direto no protótipo do Effect
    const anyEffect = scene.materials.map((mm) => mm.getEffect?.()).find(Boolean);
    const EP = Object.getPrototypeOf(anyEffect);
    const procs = {};
    const origProc = EP._processShaderCodeAsync;
    EP._processShaderCodeAsync = function (...a) {
      const nm = typeof this.name === 'string' ? this.name : this.name?.vertex ?? this.name?.vertexElement ?? '?';
      const who = `${nm} <- ${cur ?? '(fora de isReady)'}`;
      procs[who] = (procs[who] ?? 0) + 1;
      return origProc.apply(this, a);
    };
    const oc = eng.createEffect.bind(eng);
    eng.createEffect = (base, attr, uni, samp, defines, ...rest) => {
      const bn = typeof base === 'string' ? base : base?.vertex ?? base?.vertexElement ?? base?.vertexSource?.slice?.(0, 30) ?? JSON.stringify(Object.keys(base ?? {}));
      const st = (new Error().stack ?? '').split('\n').slice(2, 7).map((l) => l.trim().replace(/\(.*\/(.*?)\?.*?:(\d+):\d+\)/, '($1:$2)')).join(' < ');
      const key = `${cur ?? '?'} :: ${bn} :: ${st}`;
      counts[key] = (counts[key] ?? 0) + 1;
      return oc(base, attr, uni, samp, defines, ...rest);
    };
    await new Promise((res) => setTimeout(res, Number(window.__janela ?? 3000)));
    scene.onNewMeshAddedObservable.remove(obsA);
    scene.onMeshRemovedObservable.remove(obsB);
    EP._processShaderCodeAsync = origProc;
    console.log('PROCESSADOS ' + JSON.stringify(procs) + ' cache ' + Object.keys(eng._compiledEffects ?? {}).length);
    console.log('DIFS ' + JSON.stringify(Object.entries(window.__diffs ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 8)));
    console.log('CRIADAS ' + JSON.stringify(Object.entries(created).sort((a, b) => b[1] - a[1]).slice(0, 12)));
    console.log('REMOVIDAS ' + JSON.stringify(Object.entries(disposed).sort((a, b) => b[1] - a[1]).slice(0, 12)));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => [k.split(' :: ').slice(0, 2).join(' :: '), n]);
  });
  for (const [k, n] of r) console.log(n, k);
  await browser.close();
} finally {
  stack.stop();
}

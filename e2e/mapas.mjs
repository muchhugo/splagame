// Capturas de revisão das 6 variantes (vitrine de DEV `mapas.html`, fora do build):
// visão geral alta e vistas no chão (base, centro, lateral) de cada mapa.
//   PREFIXO=depois node e2e/mapas.mjs → e2e/out/capturas/<PREFIXO>/mapa-<id>-<vista>.png
import { GAME_URL, OUT, check, done, launch, watchErrors } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const DIR = `${OUT}capturas/${process.env.PREFIXO ?? 'depois'}/`;
mkdirSync(DIR, { recursive: true });
const IDS = (process.env.MAPAS ?? 'toca-do-ara.compacto,toca-do-ara.padrao,toca-do-ara.ampliado,clube-da-mare.compacto,clube-da-mare.padrao,clube-da-mare.ampliado').split(',');
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = watchErrors(page, 'mapas');
for (const id of IDS) {
  await page.goto(`${GAME_URL}mapas.html?mapa=${id}`);
  await page.waitForFunction(() => window.__mapas?.ready, null, { timeout: 120000 });
  const m = await page.evaluate(() => window.__mapas.map);
  const L = m.bounds.max[0], W = m.bounds.max[2];
  const sp = m.spawns[0][0].pos;
  const views = {
    geral: [[-L * 0.55, L * 0.55, -W * 0.55], Math.PI / 4, 0.62],
    base: [[sp[0] + 1, sp[1], sp[2]], Math.PI / 2, 0.12],
    centro: [[m.objectives.capsule[0] - 6, Math.max(0, m.objectives.capsule[1]), m.objectives.capsule[2] - 2], Math.PI / 2 - 0.3, 0.18],
    lateral: [[-L * 0.45, 0, W * 0.6], Math.PI * 0.75, 0.15],
    // muro norte (mural da arara na Toca; muro do clube no Clube)
    muro: [[0, 1.2, W - 10], 0, -0.05],
  };
  for (const [nome, [pos, yaw, pitch]] of Object.entries(views)) {
    await page.evaluate(([p, y, pt]) => window.__mapas.view(p, y, pt), [pos, yaw, pitch]);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${DIR}mapa-${id}-${nome}.png` });
  }
  console.log(`ok   ${id} (${m.name}, ${m.variant})`);
}
check(errs.length === 0, `sem erros de página${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
done();

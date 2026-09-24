// Capturas da vitrine de personagens (página de DEV `vitrine.html`, fora do build).
// Uma imagem por pose e ângulo, com as 8 aparências lado a lado.
//   PREFIXO=depois node e2e/vitrine.mjs → e2e/out/capturas/<PREFIXO>/vitrine-<pose>-<ângulo>.png
import { GAME_URL, OUT, check, done, launch, watchErrors } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const DIR = `${OUT}capturas/${process.env.PREFIXO ?? 'depois'}/`;
mkdirSync(DIR, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 440 } });
const errs = watchErrors(page, 'vitrine');
const POSES = (process.env.POSES ?? 'parado,corrida,salto,disparo,pião,rodo,estilingue,dano,vitoria,derrota').split(',');
const ANGULOS = { frente: 0, lado: 1.3, costas: Math.PI };
for (const pose of POSES) {
  for (const [nome, giro] of Object.entries(ANGULOS)) {
    if (pose !== 'parado' && nome === 'costas') continue;
    const arma = pose === 'rodo' ? 'rodo' : pose === 'estilingue' ? 'estilingue' : 'esguicho';
    await page.goto(`${GAME_URL}vitrine.html?pose=${encodeURIComponent(pose)}&giro=${giro}&arma=${arma}`);
    await page.waitForFunction(() => window.__vitrine?.ready, null, { timeout: 60000 });
    await page.waitForTimeout(pose === 'dano' ? 750 : 1400);
    await page.screenshot({ path: `${DIR}vitrine-${pose}-${nome}.png` });
  }
}
const meshes = await page.evaluate(() => window.__vitrine.views.map((v) => v.activeMeshCount()));
console.log(`malhas ativas por personagem (esguicho, parado de costas): ${meshes.join(', ')}`);
check(errs.length === 0, `sem erros de página${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
done();

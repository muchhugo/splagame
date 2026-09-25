// Rede sob latência EMULADA: um proxy TCP entre o navegador e o servidor de partidas
// atrasa cada pedaço de dado nos dois sentidos (atraso de ida = RTT/2) com variação
// (jitter), sem reordenar: é TCP, então a "perda" aparece como atraso extra (rajadas
// de retransmissão), simulada aqui por picos ocasionais. Duas pessoas jogando;
// mede, em quem está do outro lado do proxy:
//   - correções da previsão local (quantas, tamanho p95/máximo, grandes > 2,5 m);
//   - interpolação dos remotos: % de quadros sem amostra nova ("fome" do buffer);
//   - RTT observado.
// Uso: E2E_SWIFTSHADER=1 CENARIOS=0,80,150 node e2e/rede-adversa.mjs
import net from 'node:net';
import { writeFileSync } from 'node:fs';
import { GAME_URL, OUT, check, done, launch, openStandalone, watchErrors } from './lib.mjs';

const SERVER = new URL(process.env.E2E_SERVER_URL ?? 'http://localhost:2567');
const CENARIOS = (process.env.CENARIOS ?? '0,80,150').split(',').map(Number);
const SEGUNDOS = Number(process.env.SEGUNDOS ?? 12);

/** Proxy com atraso: cada sentido é uma fila FIFO com horário de entrega não decrescente. */
function startProxy(rttMs, jitterMs, spikeProb) {
  const oneWay = rttMs / 2;
  const server = net.createServer((client) => {
    const upstream = net.connect(Number(SERVER.port), SERVER.hostname);
    const pipe = (from, to) => {
      let last = 0;
      from.on('data', (chunk) => {
        let d = oneWay + (Math.random() * 2 - 1) * jitterMs;
        if (Math.random() < spikeProb) d += 120 + Math.random() * 120; // "perda": retransmissão
        const at = Math.max(last, Date.now() + Math.max(0, d));
        last = at;
        setTimeout(() => to.writable && to.write(chunk), at - Date.now());
      });
      from.on('close', () => setTimeout(() => to.destroy(), oneWay + jitterMs + 50));
      from.on('error', () => to.destroy());
    };
    pipe(client, upstream);
    pipe(upstream, client);
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res(server)));
}

const q = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

const browser = await launch();
const report = { gpu: process.env.E2E_SWIFTSHADER === '1' ? 'SwiftShader (CPU)' : 'padrão', data: new Date().toISOString(), cenarios: [] };
for (const rtt of CENARIOS) {
  const jitter = rtt === 0 ? 0 : Math.round(rtt * 0.25);
  const spike = rtt === 0 ? 0 : 0.01;
  const proxy = await startProxy(rtt, jitter, spike);
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  const sid = `rede-${rtt}-${Date.now().toString(36)}`;
  const pages = [];
  for (const user of ['ana', 'bruno']) {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await ctx.newPage();
    // a credencial do host de laboratório diz onde fica o servidor: aponta para o proxy
    await page.route('**/api/lab/standalone-credential', async (route) => {
      const r = await route.fetch();
      const j = await r.json();
      await route.fulfill({ response: r, json: { ...j, gameServerUrl: proxyUrl } });
    });
    const errs = watchErrors(page, `${user}-${rtt}`);
    await openStandalone(page, user, sid);
    await page.evaluate(() => window.__borrifo.controller.skipIntro());
    pages.push({ ctx, page, errs, user });
  }
  const [A, B] = pages;
  await B.page.click('text=Estou pronto');
  await A.page.waitForFunction(() => window.__borrifo.uiStore.get().lobby.players.filter((p) => !p.isBot && p.ready).length >= 1, null, { timeout: 15000 });
  await A.page.click('text=Começar partida');
  for (const p of pages) await p.page.waitForFunction(() => window.__borrifo.controller.runtime?.predictor?.state.alive && window.__borrifo.uiStore.get().lobby?.phase === 'running', null, { timeout: 60000 });
  // zera as medições e joga: os dois andam em zigue-zague (troca de direção a cada 0,7 s)
  for (const p of pages)
    await p.page.evaluate(() => {
      const rt = window.__borrifo.controller.runtime;
      rt.predictor.corrections = 0;
      rt.predictor.bigCorrections = 0;
      rt.predictor.correctionLog.length = 0;
      rt.interp.sampled = 0;
      rt.interp.starved = 0;
      rt.interp.extrapolated = 0;
      window.__corr = [];
      window.__corrTimer = setInterval(() => window.__corr.push(...rt.predictor.correctionLog.splice(0)), 250);
      document.querySelector('canvas').focus();
    });
  const keys = ['KeyW', 'KeyA', 'KeyW', 'KeyD'];
  const t0 = Date.now();
  let k = 0;
  while (Date.now() - t0 < SEGUNDOS * 1000) {
    const key = keys[k++ % keys.length];
    await Promise.all(pages.map((p) => p.page.keyboard.down(key)));
    await A.page.waitForTimeout(700);
    await Promise.all(pages.map((p) => p.page.keyboard.up(key)));
  }
  const m = await A.page.evaluate(() => {
    const rt = window.__borrifo.controller.runtime;
    clearInterval(window.__corrTimer);
    window.__corr.push(...rt.predictor.correctionLog.splice(0));
    return { fps: rt.fps, corr: window.__corr, corrections: rt.predictor.corrections, big: rt.predictor.bigCorrections, sampled: rt.interp.sampled, starved: rt.interp.starved, extrap: rt.interp.extrapolated, delay: rt.interp.delayTicks, rtt: window.__borrifo.uiStore.get().rttMs };
  });
  const row = {
    rttAlvoMs: rtt,
    jitterMs: jitter,
    picosDeRetransmissao: spike,
    rttObservadoMs: m.rtt,
    fpsCliente: m.fps,
    reconciliacoes: m.corr.length,
    correcoesMaioresQue5cm: m.corrections,
    correcaoP95m: q(m.corr, 0.95),
    correcaoMaxm: m.corr.length ? Math.max(...m.corr) : 0,
    correcoesGrandes: m.big,
    // congelado: sem amostra além de 100 ms (a pose para); extrapolado: sem amostra, andando pela velocidade
    remotoCongeladoPct: m.sampled ? Math.round((m.starved / m.sampled) * 1000) / 10 : 0,
    remotoExtrapoladoPct: m.sampled ? Math.round((m.extrap / m.sampled) * 1000) / 10 : 0,
    atrasoDoBufferTicks: m.delay !== undefined ? Math.round(m.delay * 10) / 10 : null,
  };
  report.cenarios.push(row);
  console.log(JSON.stringify(row));
  check(row.correcoesGrandes === 0, `RTT ${rtt} ms: nenhuma correção grande (> 2,5 m) da previsão`);
  check(row.correcaoP95m < 0.1, `RTT ${rtt} ms: correção p95 abaixo de 10 cm (${row.correcaoP95m} m)`);
  check(row.remotoCongeladoPct < 5, `RTT ${rtt} ms: remotos quase nunca congelam (${row.remotoCongeladoPct}% dos quadros)`);
  check(pages.every((p) => p.errs.length === 0), `RTT ${rtt} ms: sem erros de página`);
  for (const p of pages) await p.ctx.close();
  proxy.close();
}
await browser.close();
writeFileSync(`${OUT}rede-adversa.json`, JSON.stringify(report, null, 2));
console.log(`relatório em ${OUT}rede-adversa.json (${GAME_URL})`);
done();

// Voz com MÍDIA SIMULADA pelo host: servidor LiveKit LOCAL (`livekit-server --dev`) e o
// microfone falso do Chromium alimentado por uma entrada REPRODUZÍVEL: "fala sintética"
// gerada por e2e/fala-sintetica.mjs (--use-file-for-fake-audio-capture). Valida o fluxo
// real da mídia: publicação → detecção de fala no SFU → estado do host → userId →
// bridge → jogo (lobby e placar), mudo, reabrir a Atividade e fechar sem sair da chamada.
// Nada de speaking=true injetado. NÃO é microfone físico, rede real ou LiveKit Cloud.
//
// Por que não o bipe padrão do Chromium: ver docs/testing.md (diagnóstico). O SFU decide
// "falando" pelo nível do cabeçalho RTP (≥ -35 dBov em ≥ 40% de cada janela de 400 ms), e
// com o bipe a decisão ficou bimodal por sessão (~95% ou ~0%) mesmo com o áudio chegando
// em nível alto. VOZ_ENTRADA=bipe reproduz esse comportamento para comparação.
//
// Requer o host com LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET do servidor local.
import { chromium } from 'playwright';
import { HOST_URL, OUT, check, done, watchErrors } from './lib.mjs';
import { escreverFalaSintetica } from './fala-sintetica.mjs';

const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
if (process.env.VOZ_ENTRADA !== 'bipe') args.push(`--use-file-for-fake-audio-capture=${escreverFalaSintetica(`${OUT}fala-sintetica.wav`)}`);
if (process.env.E2E_SWIFTSHADER === '1') args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
const SID = `voz-${Date.now().toString(36)}`;
const browser = await chromium.launch({ args, executablePath: process.env.E2E_CHROMIUM_PATH || undefined });

async function openAs(origin, user) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errs = watchErrors(page, user);
  await page.goto(origin);
  await page.locator('aside[aria-label=Canal] select').selectOption(user);
  await page.waitForFunction((u) => document.body.innerText.toLowerCase().includes(`sessão de desenvolvimento: ${u}`), user);
  await page.fill('input[aria-label="Id da sessão da Atividade"]', SID);
  await page.click('button:has-text("Abrir Borrifo")');
  const frame = await (await page.waitForSelector('.slot iframe')).contentFrame();
  await frame.waitForFunction(() => window.__borrifo?.uiStore.get().screen === 'lobby', null, { timeout: 120000 });
  return { page, frame, errs };
}

const A = await openAs(HOST_URL, 'ana');
const B = await openAs(HOST_URL.replace('localhost', '127.0.0.1'), 'bruno');
await A.frame.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.players.filter((p) => !p.isBot).length === 2, null, { timeout: 30000 }).catch(() => {});
const humans = await A.frame.evaluate(() => window.__borrifo.uiStore.get().lobby.players.filter((p) => !p.isBot).map((p) => p.displayName));
check(humans.length === 2, `os dois na mesma sala (${humans.join(', ')})`);
check(humans.includes('Aninha'), 'apelido da comunidade tem prioridade (Ana → "Aninha")');

// voz: nada ligado antes do gesto no host
check((await A.frame.evaluate(() => window.__borrifo.uiStore.get().voice.connected)) === false, 'o jogo não entra na chamada sozinho');
for (const x of [A, B]) {
  await x.page.click('button:has-text("Entrar na chamada")');
  await x.page.waitForSelector('button:has-text("Ativar microfone")', { timeout: 30000 });
}
check((await A.frame.evaluate(() => window.__borrifo.uiStore.get().voice.muted)) === true, 'ao entrar na chamada o microfone continua desligado');
await A.frame.waitForFunction(() => window.__borrifo.uiStore.get().voice.participants.length === 2, null, { timeout: 20000 }).catch(() => {});
const parts = await A.frame.evaluate(() => window.__borrifo.uiStore.get().voice.participants.map((p) => ({ u: p.userId, n: p.displayName, m: p.muted })));
check(parts.length === 2 && parts.every((p) => p.u), `participantes da chamada chegam ao jogo com userId (${JSON.stringify(parts)})`);
const brunoId = await A.frame.evaluate(() => window.__borrifo.uiStore.get().lobby.players.find((p) => p.userId === 'bruno')?.playerId);
const attr = (sel, k) => A.frame.evaluate(([q, key]) => document.querySelector(q)?.dataset[key] ?? null, [sel, k]);
check((await attr(`.slot[data-player="${brunoId}"]`, 'muted')) === 'true', 'lobby mostra Bruno com o microfone desligado');

// Bruno liga o microfone (fala sintética reproduzível) → Ana vê o indicador NO BRUNO
const waitSpeaking = (sel, ms = 25000) =>
  A.frame
    .waitForFunction((q) => document.querySelector(q)?.dataset.speaking === 'true', sel, { timeout: ms, polling: 100 })
    .then(() => true)
    .catch(() => false);
await B.page.click('button:has-text("Ativar microfone")');
const t0 = Date.now();
const sawSpeaking = await waitSpeaking(`.slot[data-player="${brunoId}"]`);
check(sawSpeaking, `Ana vê a fala de Bruno no lobby (${sawSpeaking ? `${Date.now() - t0} ms após ligar o microfone` : 'não apareceu em 25 s'})`);
await A.page.screenshot({ path: `${OUT}voz-lobby.png` });

// mudo pelo host: sinalização, não detecção — o indicador tem de mudar para "mudo"
await B.page.click('button:has-text("Silenciar microfone")');
const mutedOk = await A.frame
  .waitForFunction((q) => { const e = document.querySelector(q); return e?.dataset.muted === 'true' && e?.dataset.speaking === 'false'; }, `.slot[data-player="${brunoId}"]`, { timeout: 10000 })
  .then(() => true)
  .catch(() => false);
check(mutedOk, 'Bruno silenciou: Ana vê "mudo" e nenhum indicador de fala');
await B.page.click('button:has-text("Ativar microfone")');

// partida: indicador discreto no placar do topo (não posicional)
// o iframe do host recorta o lobby; o clique programático basta aqui (o foco do teste é a voz)
const clickText = (f, t) => f.evaluate((txt) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(txt))?.click(), t);
await clickText(B.frame, 'Estou pronto');
await A.frame.waitForFunction(() => { const l = window.__borrifo.uiStore.get().lobby; return l.players.every((p) => p.ready || p.playerId === l.hostPlayerId); }, null, { timeout: 15000 }).catch(() => {});
await clickText(A.frame, 'Começar partida');
await A.frame.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'running', null, { timeout: 60000 });
const hudSpeaking = await waitSpeaking(`.roster [data-player="${brunoId}"]`);
check(hudSpeaking, 'na partida, o ponto do Bruno no placar indica que ele está falando');
await A.page.screenshot({ path: `${OUT}voz-partida.png` });

// fechar a Atividade não tira ninguém da chamada; reabrir volta a mostrar a fala
await A.page.click('button:has-text("Fechar Atividade")');
await A.page.waitForFunction(() => !document.querySelector('.slot iframe'));
check((await A.page.locator('button:has-text("Ativar microfone"), button:has-text("Silenciar microfone")').count()) > 0, 'fechar a Atividade mantém Ana na chamada do host');
await A.page.click('button:has-text("Abrir Borrifo")');
A.frame = await (await A.page.waitForSelector('.slot iframe')).contentFrame();
await A.frame.waitForFunction(() => ['lobby', 'match', 'waiting'].includes(window.__borrifo?.uiStore.get().screen), null, { timeout: 120000 });
const reopened = await A.frame
  .waitForFunction(() => window.__borrifo.uiStore.get().voice.participants.some((p) => (p.userId ?? p.id) === 'bruno' && p.speaking), null, { timeout: 25000, polling: 100 })
  .then(() => true)
  .catch(() => false);
check(reopened, 'Atividade reaberta recebe de novo o estado de voz (Bruno falando)');
for (const x of [A, B]) {
  const leave = x.page.locator('button:has-text("Sair da chamada")');
  if (await leave.count()) await leave.click();
}
const allErrs = [...A.errs, ...B.errs].filter((e) => !/WebSocket|ICE|webrtc/i.test(e));
check(allErrs.length === 0, `sem erros de página${allErrs.length ? `: ${allErrs.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
done();

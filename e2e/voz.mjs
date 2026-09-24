// Voz de verdade pelo host: servidor LiveKit LOCAL (`livekit-server --dev`) e os
// dispositivos de mídia FALSOS do Chromium (--use-fake-device-for-media-stream:
// um tom sintético no lugar do microfone). Valida a cadeia host (LiveKit) →
// VoiceState → bridge → jogo: apelidos, mudo, indicador de fala no lobby e no
// HUD, microfone nunca ligado pelo jogo e fechar a Atividade sem sair da chamada.
// NÃO é teste com microfone físico, rede real ou LiveKit Cloud.
//
// Requer o host com LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET do servidor local.
import { chromium } from 'playwright';
import { OUT, check, done, watchErrors } from './lib.mjs';

const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
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

const A = await openAs('http://localhost:3000/', 'ana');
const B = await openAs('http://127.0.0.1:3000/', 'bruno');
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
check((await A.frame.locator('.slot .vbadge.muted').count()) >= 1, 'lobby mostra "microfone desligado" ao lado dos nomes');

// Bruno liga o microfone (tom sintético do Chromium) → Ana vê o indicador de fala
await B.page.click('button:has-text("Ativar microfone")');
const sawSpeaking = await A.frame
  .waitForFunction(() => document.querySelector('.slot .avatar.speaking') !== null, null, { timeout: 25000, polling: 100 })
  .then(() => true)
  .catch(() => false);
check(sawSpeaking, 'Ana vê o anel de fala no avatar de Bruno no lobby');
const speakerName = await A.frame.evaluate(() => document.querySelector('.slot .avatar.speaking')?.closest('.slot')?.querySelector('.name')?.textContent ?? '');
check(/Bruno/.test(speakerName), `o indicador está no Bruno ("${speakerName}")`);
await A.page.screenshot({ path: `${OUT}voz-lobby.png` });

// partida: indicador discreto no placar do topo (não posicional)
// o iframe do host recorta o lobby; o clique programático basta aqui (o foco do teste é a voz)
const clickText = (f, t) => f.evaluate((txt) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(txt))?.click(), t);
await clickText(B.frame, 'Estou pronto');
await A.frame.waitForFunction(() => { const l = window.__borrifo.uiStore.get().lobby; return l.players.every((p) => p.ready || p.playerId === l.hostPlayerId); }, null, { timeout: 15000 }).catch(() => {});
await clickText(A.frame, 'Começar partida');
await A.frame.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'running', null, { timeout: 60000 });
const hudSpeaking = await A.frame
  .waitForFunction(() => document.querySelector('.roster .dot.speaking') !== null, null, { timeout: 25000, polling: 100 })
  .then(() => true)
  .catch((e) => (console.log('     ', String(e).slice(0, 300)), false));
check(hudSpeaking, 'na partida, o ponto do Bruno no placar indica que ele está falando');
await A.page.screenshot({ path: `${OUT}voz-partida.png` });

// fechar a Atividade não tira ninguém da chamada
await A.page.click('button:has-text("Fechar Atividade")');
await A.page.waitForFunction(() => !document.querySelector('.slot iframe'));
check((await A.page.locator('button:has-text("Ativar microfone"), button:has-text("Silenciar microfone")').count()) > 0, 'fechar a Atividade mantém Ana na chamada do host');
for (const x of [A, B]) {
  const leave = x.page.locator('button:has-text("Sair da chamada")');
  if (await leave.count()) await leave.click();
}
const allErrs = [...A.errs, ...B.errs].filter((e) => !/WebSocket|ICE|webrtc/i.test(e));
check(allErrs.length === 0, `sem erros de página${allErrs.length ? `: ${allErrs.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
done();

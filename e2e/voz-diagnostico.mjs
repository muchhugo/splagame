// Diagnóstico da intermitência do indicador de fala (LiveKit LOCAL + mídia SIMULADA).
// Amostra a cada 50 ms, na janela da Ana, três camadas para o participante Bruno:
//   host: estado LiveKit do host (lista de membros do laboratório, ponto "speaking")
//   bridge: VoiceState que chegou ao jogo (uiStore.voice, depois do bridge)
//   tela: indicador renderizado (lobby: avatar; partida: ponto do placar)
// Não injeta estado: só observa. Sem tokens ou dados pessoais no log.
//   AUDIO_FILE=caminho.wav usa --use-file-for-fake-audio-capture (entrada reproduzível).
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { HOST_URL, OUT } from './lib.mjs';

const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
if (process.env.AUDIO_FILE) args.push(`--use-file-for-fake-audio-capture=${process.env.AUDIO_FILE}`);
if (process.env.E2E_SWIFTSHADER === '1') args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
const browser = await chromium.launch({ args });
const SID = `diag-${Date.now().toString(36)}`;
const SECS = Number(process.env.SECS ?? 20);

async function openAs(origin, user) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  await page.goto(origin);
  await page.locator('aside[aria-label=Canal] select').selectOption(user);
  await page.waitForFunction((u) => document.body.innerText.toLowerCase().includes(`sessão de desenvolvimento: ${u}`), user);
  await page.fill('input[aria-label="Id da sessão da Atividade"]', SID);
  await page.click('button:has-text("Abrir Borrifo")');
  const frame = await (await page.waitForSelector('.slot iframe')).contentFrame();
  await frame.waitForFunction(() => window.__borrifo?.uiStore.get().screen === 'lobby', null, { timeout: 120000 });
  return { page, frame };
}

const A = await openAs(HOST_URL, 'ana');
const B = await openAs(HOST_URL.replace('localhost', '127.0.0.1'), 'bruno');
for (const x of [A, B]) {
  await x.page.click('button:has-text("Entrar na chamada")');
  await x.page.waitForSelector('button:has-text("Ativar microfone")', { timeout: 30000 });
}
await B.page.click('button:has-text("Ativar microfone")');
const t0 = Date.now();

async function sample(phase) {
  const src = await B.page.evaluate(async () => {
    const d = await window.__labVoiceDiag?.();
    const me = d?.participants.find((p) => p.local);
    return { nivelSaida: d?.localLevel ?? null, bytes: d?.bytesSent ?? null, falaLocal: !!me?.speaking };
  });
  const rx = await A.page.evaluate(async () => {
    const d = await window.__labVoiceDiag?.();
    const b = d?.participants.find((p) => p.id === 'bruno');
    return { nivelVistoPelaAna: b?.level ?? null, nivelRecebido: d?.received?.bruno ?? null };
  });
  const host = await A.page.evaluate(() => {
    const li = [...document.querySelectorAll('.members li')].find((l) => l.textContent.includes('Bruno'));
    return !!li?.querySelector('.dot.speaking');
  });
  const f = await A.frame.evaluate(() => {
    const v = window.__borrifo.uiStore.get().voice;
    const p = v.participants.find((x) => (x.userId ?? x.id) === 'bruno');
    const lobby = !!document.querySelector('.slot .avatar.speaking');
    const hud = !!document.querySelector('.roster .dot.speaking');
    return { bridge: !!p?.speaking && !p.muted, lobby, hud, screen: window.__borrifo.uiStore.get().screen };
  });
  return { t: Date.now() - t0, phase, host, ...f, ...src, ...rx };
}

const rows = [];
const run = async (phase, secs) => {
  const end = Date.now() + secs * 1000;
  while (Date.now() < end) {
    rows.push(await sample(phase));
    await new Promise((r) => setTimeout(r, 50));
  }
};
await run('lobby', SECS);
const click = (f, t) => f.evaluate((txt) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(txt))?.click(), t);
await click(B.frame, 'Estou pronto');
await A.frame.waitForTimeout(500);
await click(A.frame, 'Começar partida');
await A.frame.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'running', null, { timeout: 60000 });
await run('partida', SECS);

// resumo por camada e fase: fração do tempo "falando" e transições
const summary = {};
for (const phase of ['lobby', 'partida']) {
  const r = rows.filter((x) => x.phase === phase);
  const frac = (k) => Math.round((r.filter((x) => x[k]).length / Math.max(1, r.length)) * 100);
  const trans = (k) => r.reduce((a, x, i) => a + (i && x[k] !== r[i - 1][k] ? 1 : 0), 0);
  const firstOn = (k) => r.find((x) => x[k])?.t ?? null;
  summary[phase] = { amostras: r.length, host: { pct: frac('host'), trocas: trans('host'), primeiro: firstOn('host') }, bridge: { pct: frac('bridge'), trocas: trans('bridge'), primeiro: firstOn('bridge') }, tela: { pct: frac(phase === 'lobby' ? 'lobby' : 'hud'), trocas: trans(phase === 'lobby' ? 'lobby' : 'hud') } };
  // divergências bridge×tela (a tela deveria seguir o bridge em até ~150 ms)
  let div = 0;
  for (let i = 3; i < r.length; i++) {
    const want = r[i - 3].bridge && r[i - 2].bridge && r[i - 1].bridge && r[i].bridge;
    const got = phase === 'lobby' ? r[i].lobby : r[i].hud;
    if (want && !got) div++;
  }
  summary[phase].bridgeSemTela = div;
  const lv = r.map((x) => x.nivelSaida).filter((x) => typeof x === 'number');
  const above = (th) => Math.round((lv.filter((x) => x > th).length / Math.max(1, lv.length)) * 100);
  summary[phase].nivelSaida = { amostras: lv.length, max: Math.max(0, ...lv).toFixed(3), pctAcima001: above(0.01), pctAcima005: above(0.05) };
  const rec = r.map((x) => x.nivelRecebido).filter((x) => typeof x === 'number');
  summary[phase].nivelRecebidoPelaAna = { amostras: rec.length, max: Math.max(0, ...rec).toFixed(3), pctAcima001: Math.round((rec.filter((x) => x > 0.01).length / Math.max(1, rec.length)) * 100) };
  const bytes = r.map((x) => x.bytes).filter((x) => typeof x === 'number');
  summary[phase].bytesEnviados = bytes.length ? bytes[bytes.length - 1] - bytes[0] : null;
}
console.log(JSON.stringify({ entrada: process.env.AUDIO_FILE ? 'arquivo' : 'bipe padrão do Chromium', ...summary }));
writeFileSync(`${OUT}voz-diagnostico-${Date.now()}.json`, JSON.stringify(rows));
await browser.close();

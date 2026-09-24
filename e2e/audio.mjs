// Áudio numa partida real (build de dev + servidor): arquivos carregados, sons
// disparados pelos eventos, limite de vozes, loops que param, menus, revanche.
// Grava a saída mixada em e2e/out/audio-partida.wav para escuta e análise.
import { writeFileSync } from 'node:fs';
import { OUT, check, done, launch, openStandalone, startMatch, watchErrors } from './lib.mjs';

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
// música (fora do escopo desta validação) silenciada para a gravação conter só os efeitos
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('borrifo.settings.v1', JSON.stringify({ volumeMusic: 0 }));
  } catch {
    /* ignorado */
  }
});
const page = await ctx.newPage();
const errs = watchErrors(page, 'jogo');
await openStandalone(page, 'gabi', `som-${Date.now().toString(36)}`);

// gesto do usuário destrava o áudio; espera os arquivos decodificarem
await page.mouse.click(8, 8);
await page.waitForFunction(() => window.__borrifo.controller.runtime.audio.state === 'running', null, { timeout: 15000 });
await page.waitForFunction(() => { const s = window.__borrifo.controller.runtime.audio.samples; return s.decoded + s.failed.length === s.total; }, null, { timeout: 30000 });
const bank = await page.evaluate(() => window.__borrifo.controller.runtime.audio.samples);
check(bank.failed.length === 0 && bank.decoded === bank.total, `arquivos de áudio decodificados: ${bank.decoded}/${bank.total} (falhas: ${bank.failed.join(', ') || 'nenhuma'})`);

// atraso inicial de cada arquivo decodificado (silêncio antes do ataque)
const lead = await page.evaluate(() => {
  const b = window.__borrifo.controller.runtime.audio.bank;
  let worst = 0;
  let name = '';
  for (const [n] of b.files) {
    const buf = b.get(n);
    if (!buf) continue;
    const d = buf.getChannelData(0);
    let pk = 0;
    for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
    let i = 0;
    while (i < d.length && Math.abs(d[i]) < pk * 0.05) i++;
    const ms = (i / buf.sampleRate) * 1000;
    if (ms > worst) {
      worst = ms;
      name = n;
    }
  }
  return { worst, name };
});
check(lead.worst < 20, `maior silêncio antes do ataque: ${lead.worst.toFixed(1)} ms (${lead.name})`);

// grava a saída mixada (depois do compressor) e mede picos
await page.evaluate(() => {
  const a = window.__borrifo.controller.runtime.audio;
  const c = a.ctx;
  const rec = c.createScriptProcessor(4096, 2, 2);
  window.__rec = { chunks: [], rate: c.sampleRate, peak: 0, clipped: 0 };
  rec.onaudioprocess = (e) => {
    const l = e.inputBuffer.getChannelData(0);
    const r = e.inputBuffer.getChannelData(1);
    const m = new Float32Array(l.length);
    for (let i = 0; i < l.length; i++) {
      m[i] = (l[i] + r[i]) * 0.5;
      const p = Math.max(Math.abs(l[i]), Math.abs(r[i]));
      if (p > window.__rec.peak) window.__rec.peak = p;
      if (p >= 0.999) window.__rec.clipped++;
    }
    window.__rec.chunks.push(m);
  };
  a.comp.connect(rec);
  rec.connect(c.destination);
  window.__recNode = rec;
});

// menus: cliques em botões tocam confirmação / voltar
const plays = () => page.evaluate(() => Object.fromEntries(window.__borrifo.controller.runtime.audio.stats.plays));
const p0 = await plays();
await page.click('text=Configurações');
await page.waitForTimeout(300);
// "Silenciar o jogo" pelo menu real corta a saída e volta ao desmarcar
const master = () => page.evaluate(() => window.__borrifo.controller.runtime.audio.master.gain.value);
await page.click('[role=tab]:has-text("Áudio")');
await page.click('label:has-text("Silenciar o jogo") input');
await page.waitForTimeout(250);
const mutedGain = await master();
await page.click('label:has-text("Silenciar o jogo") input');
await page.waitForTimeout(250);
const unmutedGain = await master();
check(mutedGain < 0.001 && unmutedGain > 0.1, `"Silenciar o jogo" zera a saída (${mutedGain.toFixed(4)}) e desmarcar restaura (${unmutedGain.toFixed(2)})`);
await page.click('button:has-text("Fechar")');
await page.waitForTimeout(300);
const p1 = await plays();
check((p1.ui_confirm ?? 0) > (p0.ui_confirm ?? 0), `clique em botão toca confirmação (${p1.ui_confirm ?? 0})`);
check((p1.ui_back ?? 0) > (p0.ui_back ?? 0), `botão "Fechar" toca o som de voltar (${p1.ui_back ?? 0})`);

// partida: contagem, início, movimento, disparo, pulo, fluxo, Moringa
let maxVoices = 0;
let maxLoops = 0;
const sample = async () => {
  const s = await page.evaluate(() => ({ v: window.__borrifo.controller.runtime.audio.activeVoices, l: window.__borrifo.controller.runtime.audio.activeLoops }));
  maxVoices = Math.max(maxVoices, s.v);
  maxLoops = Math.max(maxLoops, s.l);
};
await startMatch(page);
await page.evaluate(() => document.querySelector('canvas').focus());
const hold = async (keys, ms) => {
  for (const k of keys) await page.keyboard.down(k);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sample();
    await page.waitForTimeout(150);
  }
  for (const k of keys) await page.keyboard.up(k);
};
await hold(['KeyW'], 2500); // passos
// loop de nado: pinta o chão à frente, nada sobre a própria tinta e sai do fluxo
const aim = (pitch) => page.evaluate((p) => { window.__borrifo.controller.runtime.input.pitch = p; }, pitch);
await aim(0.75);
await hold(['KeyF'], 1800);
await page.keyboard.down('ShiftLeft');
let swimOn = false;
await page.keyboard.down('KeyW');
for (let i = 0; i < 10 && !swimOn; i++) {
  await page.waitForTimeout(150);
  swimOn = await page.evaluate(() => window.__borrifo.controller.runtime.audio.loops.has('swim'));
}
await page.keyboard.up('KeyW');
await page.keyboard.up('ShiftLeft');
await page.waitForTimeout(400);
const swimAfter = await page.evaluate(() => window.__borrifo.controller.runtime.audio.loops.has('swim'));
await aim(0.25);
check(swimOn, 'nadar sobre a própria tinta liga o loop de nado');
check(!swimAfter, 'o loop de nado para logo depois de sair da forma Pião');

// disparo contínuo: cada tiro previsto no cliente soa uma vez (sem perder nem duplicar)
await page.evaluate(() => {
  const rt = window.__borrifo.controller.runtime;
  window.__shots = { predicted: 0 };
  const orig = rt.localCosmetics.bind(rt);
  rt.localCosmetics = (pred, intents, dir) => {
    window.__shots.predicted += intents.shots;
    return orig(pred, intents, dir);
  };
});
const localShots = () => page.evaluate(() => window.__borrifo.controller.runtime.audio.stats.local.get('shot_esguicho') ?? 0);
const s0 = await localShots();
const t0 = Date.now();
await hold(['KeyW', 'KeyF'], 3000);
const secs = (Date.now() - t0) / 1000;
const s1 = await localShots();
const predicted = await page.evaluate(() => window.__shots.predicted);
const expected = Math.floor(secs / 0.115) + 1;
console.log(`     tiros previstos: ${predicted} · sons de disparo locais: ${s1 - s0} · máximo pela cadência em ${secs.toFixed(1)} s: ${expected}`);
// (disparos que o servidor fez e a previsão perdeu num quadro lento também soam, pelo evento autoritativo)
check(predicted > 0 && s1 - s0 >= predicted, 'todo tiro previsto soa');
check(s1 - s0 <= expected, 'nenhum som de disparo além da cadência do Esguicho');
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('Space'); // pulo + aterrissagem
  await page.waitForTimeout(700);
}
await hold(['ShiftLeft', 'KeyW'], 2500); // forma Pião sobre a tinta (nado)
await page.waitForTimeout(400);
await page.keyboard.press('KeyQ'); // Moringa
await hold(['KeyA', 'KeyF'], 4000);
await hold(['KeyD'], 3000); // bots seguem atirando: vozes simultâneas
const inRound = await plays();
console.log('     disparos por efeito na rodada:', JSON.stringify(inRound));
for (const id of ['countdown_tick', 'round_start', 'shot_esguicho', 'impact', 'jump', 'transform_in', 'transform_out']) check((inRound[id] ?? 0) > 0, `evento real tocou "${id}" (${inRound[id] ?? 0}×)`);
check((inRound.step_stone ?? 0) + (inRound.step_wood ?? 0) + (inRound.step_ink ?? 0) > 3, `passos acompanham o movimento (${(inRound.step_stone ?? 0) + (inRound.step_wood ?? 0) + (inRound.step_ink ?? 0)} passos)`);
check((inRound.countdown_tick ?? 0) <= 3, `contagem regressiva sem repetição (${inRound.countdown_tick ?? 0} toques para 3 s)`);
check((inRound.round_start ?? 0) === 1, 'início da rodada tocou uma única vez');
const stats = await page.evaluate(() => ({ dropped: window.__borrifo.controller.runtime.audio.stats.dropped }));
check(maxVoices <= 24, `vozes simultâneas limitadas: máximo ${maxVoices} (teto 24); ${stats.dropped} disparos descartados por limite/intervalo`);
check(maxLoops <= 12, `loops simultâneos: máximo ${maxLoops}`);

// grava ~6 s de combate para a análise de mixagem
await hold(['KeyW', 'KeyF'], 6000);
const rec = await page.evaluate(() => {
  const r = window.__rec;
  window.__recNode.disconnect();
  const total = r.chunks.reduce((a, c) => a + c.length, 0);
  const pcm = new Int16Array(total);
  let o = 0;
  for (const c of r.chunks) for (let i = 0; i < c.length; i++) pcm[o++] = Math.max(-1, Math.min(1, c[i])) * 32767;
  const bytes = new Uint8Array(pcm.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { b64: btoa(bin), rate: r.rate, peak: r.peak, clipped: r.clipped, seconds: total / r.rate };
});
const pcm = Buffer.from(rec.b64, 'base64');
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0);
hdr.writeUInt32LE(36 + pcm.length, 4);
hdr.write('WAVEfmt ', 8);
hdr.writeUInt32LE(16, 16);
hdr.writeUInt16LE(1, 20);
hdr.writeUInt16LE(1, 22);
hdr.writeUInt32LE(rec.rate, 24);
hdr.writeUInt32LE(rec.rate * 2, 28);
hdr.writeUInt16LE(2, 32);
hdr.writeUInt16LE(16, 34);
hdr.write('data', 36);
hdr.writeUInt32LE(pcm.length, 40);
writeFileSync(`${OUT}audio-partida.wav`, Buffer.concat([hdr, pcm]));
console.log(`     gravação: ${rec.seconds.toFixed(1)} s em e2e/out/audio-partida.wav · pico ${(20 * Math.log10(rec.peak + 1e-9)).toFixed(1)} dBFS`);
check(rec.clipped === 0, `saída sem clipping (${rec.clipped} amostras no teto)`);

// fim da rodada e revanche: loops param; o jogo segue tocando na nova rodada
await page.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'results', null, { timeout: 240000 });
await page.waitForTimeout(1800);
const afterEnd = await page.evaluate(() => ({ loops: window.__borrifo.controller.runtime.audio.activeLoops, keys: [...window.__borrifo.controller.runtime.audio.loops.keys()], plays: Object.fromEntries(window.__borrifo.controller.runtime.audio.stats.plays) }));
check(afterEnd.loops === 0, `nenhum loop tocando na tela de resultado (${afterEnd.loops} ${afterEnd.keys.join(',')})`);
check((afterEnd.plays.round_end ?? 0) === 1, 'sino de fim de rodada tocou uma vez');
const res = (afterEnd.plays.victory ?? 0) + (afterEnd.plays.defeat ?? 0) + (afterEnd.plays.draw ?? 0);
check(res === 1, `um único jingle de resultado (vitória ${afterEnd.plays.victory ?? 0}, derrota ${afterEnd.plays.defeat ?? 0}, empate ${afterEnd.plays.draw ?? 0})`);
await page.click('text=Revanche').catch(() => page.click('button.btn.primary'));
await page.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'running', null, { timeout: 60000 });
const before2 = (await plays()).shot_esguicho ?? 0;
await page.evaluate(() => document.querySelector('canvas').focus());
await hold(['KeyW', 'KeyF'], 2500);
const after2 = (await plays()).shot_esguicho ?? 0;
check(after2 > before2, `revanche: efeitos continuam tocando (${after2 - before2} disparos)`);

// sair da Atividade libera tudo
await page.evaluate(() => window.__borrifo.controller.runtime.dispose());
const closed = await page.evaluate(() => ({ state: window.__borrifo.controller.runtime.audio.state, loops: window.__borrifo.controller.runtime.audio.activeLoops, voices: window.__borrifo.controller.runtime.audio.activeVoices }));
check(closed.state === 'closed' && closed.loops === 0 && closed.voices === 0, `ao sair: contexto ${closed.state}, ${closed.loops} loops, ${closed.voices} vozes`);

check(errs.length === 0, `sem erros de página (${errs.slice(0, 3).join(' | ')})`);
await browser.close();
done();

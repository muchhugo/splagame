// Cobertura dos efeitos que dependem de ferramenta ou situação: carga do
// Estilingue, Rodo (balanço e arrasto), tanque vazio, Pião-Guia e, no nível do
// motor, cada arquivo do manifesto e o mapeamento evento → som do resultado.
import { check, done, launch, openStandalone, startMatch, watchErrors } from './lib.mjs';

const browser = await launch();
const errs = [];

async function session(weapon) {
  const page = await (await browser.newContext({ viewport: { width: 800, height: 450 } })).newPage();
  errs.push(...[]);
  const e = watchErrors(page, weapon);
  await openStandalone(page, 'gabi', `cob-${weapon}-${Date.now().toString(36)}`);
  await page.click(`button[role=radio]:has-text("${weapon}")`);
  await page.waitForFunction((w) => window.__borrifo.uiStore.get().lobby.players.some((p) => p.weaponId === w.toLowerCase()), weapon);
  await page.waitForFunction(() => window.__borrifo.controller.runtime.audio.state === 'running', null, { timeout: 15000 });
  await page.waitForFunction(() => { const s = window.__borrifo.controller.runtime.audio.samples; return s.decoded + s.failed.length === s.total; }, null, { timeout: 30000 });
  await startMatch(page);
  await page.evaluate(() => document.querySelector('canvas').focus());
  return { page, errs: e };
}
const stat = (page, id, local = false) => page.evaluate(([i, l]) => (l ? window.__borrifo.controller.runtime.audio.stats.local : window.__borrifo.controller.runtime.audio.stats.plays).get(i) ?? 0, [id, local]);
const loopOn = (page, key) => page.evaluate((k) => window.__borrifo.controller.runtime.audio.loops.has(k), key);

// ---------- nível do motor: todo arquivo do manifesto toca ----------
{
  const { page, errs: e } = await session('Esguicho');
  const r = await page.evaluate(async () => {
    const a = window.__borrifo.controller.runtime.audio;
    const { SFX, LOOPS } = await import('/src/game/audio/samples.ts');
    a.setMuted(true);
    const failed = [];
    for (const id of Object.keys(SFX)) {
      // limpa o intervalo mínimo para testar cada efeito isoladamente
      a.lastPlayed.clear();
      if (!a.play(id, { volume: 0.5 })) failed.push(id);
      await new Promise((res) => setTimeout(res, 40));
    }
    const loopFail = [];
    for (const id of Object.keys(LOOPS)) {
      a.setLoop(`teste-${id}`, id, true);
      if (!a.loops.has(`teste-${id}`)) loopFail.push(id);
      a.setLoop(`teste-${id}`, id, false);
    }
    a.setMuted(false);
    return { n: Object.keys(SFX).length, failed, loops: Object.keys(LOOPS).length, loopFail };
  });
  check(r.failed.length === 0, `todos os ${r.n} efeitos do manifesto tocam a partir dos arquivos (${r.failed.join(', ') || 'sem falhas'})`);
  check(r.loopFail.length === 0, `todos os ${r.loops} loops iniciam e param (${r.loopFail.join(', ') || 'sem falhas'})`);

  // mapeamento de eventos (injetados no runtime; confirma o som escolhido para cada caso)
  const m = await page.evaluate(() => {
    const rt = window.__borrifo.controller.runtime;
    const a = rt.audio;
    const before = Object.fromEntries(a.stats.plays);
    const other = [...rt.roster.values()].find((p) => p.team !== rt.myTeam)?.playerId ?? -1;
    rt.handleEvent({ k: 'hit', src: rt.myId, dst: other, dmg: 30, lethal: false, p: [0, 0, 0] });
    a.lastPlayed.clear();
    rt.handleEvent({ k: 'elim', killer: rt.myId, victim: other, cause: 'esguicho' });
    const after = Object.fromEntries(a.stats.plays);
    return { hit: (after.hit_confirm ?? 0) - (before.hit_confirm ?? 0), elim: (after.elim_confirm ?? 0) - (before.elim_confirm ?? 0) };
  });
  check(m.hit === 1 && m.elim === 1, `acerto e eliminação próprios tocam "hit_confirm" e "elim_confirm" uma vez cada (${m.hit}, ${m.elim})`);
  const res = await page.evaluate(async () => {
    const rt = window.__borrifo.controller.runtime;
    const a = rt.audio;
    const count = () => ({ v: a.stats.plays.get('victory') ?? 0, d: a.stats.plays.get('defeat') ?? 0, e: a.stats.plays.get('draw') ?? 0 });
    rt.roundEndAt = 0;
    const c0 = count();
    rt.playRoundResult(901, rt.myTeam);
    rt.playRoundResult(901, rt.myTeam); // repetido: não toca de novo
    await new Promise((r) => setTimeout(r, 120));
    a.lastPlayed.clear();
    rt.playRoundResult(902, rt.myTeam === 0 ? 1 : 0);
    await new Promise((r) => setTimeout(r, 120));
    a.lastPlayed.clear();
    rt.playRoundResult(903, 'draw');
    await new Promise((r) => setTimeout(r, 120));
    const c1 = count();
    return { v: c1.v - c0.v, d: c1.d - c0.d, e: c1.e - c0.e };
  });
  check(res.v === 1 && res.d === 1 && res.e === 1, `resultado: vitória, derrota e empate tocam o jingle certo, sem repetir (${res.v}/${res.d}/${res.e})`);

  // tanque vazio: atira até acabar o pigmento
  await page.evaluate(() => { window.__borrifo.controller.runtime.input.pitch = 0.2; });
  await page.keyboard.down('KeyF');
  await page.waitForFunction(() => window.__borrifo.controller.runtime.predictor.state.ink < 1.05, null, { timeout: 40000 });
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyF');
  check((await stat(page, 'ink_low', true)) >= 1, 'aviso de tanque baixo tocou');
  check((await stat(page, 'ink_empty', true)) >= 1, `apertar o disparo com o tanque vazio toca "tanque vazio" (${await stat(page, 'ink_empty', true)}×)`);

  // Pião-Guia até um aliado
  const ally = await page.evaluate(() => { const rt = window.__borrifo.controller.runtime; return [...rt.roster.values()].find((p) => p.team === rt.myTeam && p.playerId !== rt.myId)?.playerId ?? null; });
  if (ally !== null) {
    await page.evaluate((id) => window.__borrifo.controller.travelTo(id), ally);
    await page.waitForTimeout(3500);
    check((await stat(page, 'travel_launch')) >= 1 && (await stat(page, 'travel_land')) >= 1, `Pião-Guia: lançamento e pouso soaram (${await stat(page, 'travel_launch')}, ${await stat(page, 'travel_land')})`);
  } else check(false, 'Pião-Guia: nenhum aliado disponível');
  errs.push(...e);
  await page.context().close();
}

// ---------- Estilingue: carga interrompível ----------
{
  const { page, errs: e } = await session('Estilingue');
  await page.keyboard.down('KeyF');
  await page.waitForTimeout(700);
  const during = await loopOn(page, 'charge');
  await page.keyboard.up('KeyF');
  await page.waitForTimeout(300);
  const after = await loopOn(page, 'charge');
  check(during && !after, `carga do Estilingue soa enquanto carrega e para ao soltar (${during} → ${after})`);
  check((await stat(page, 'charge_release', true)) >= 1, 'soltar o Estilingue toca o disparo');
  errs.push(...e);
  await page.context().close();
}

// ---------- Rodo: balanço e arrasto ----------
{
  const { page, errs: e } = await session('Rodo');
  await page.keyboard.down('KeyF');
  await page.keyboard.down('KeyW');
  let drag = false;
  for (let i = 0; i < 12 && !drag; i++) {
    await page.waitForTimeout(250);
    drag = await loopOn(page, 'rodo');
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyF');
  await page.waitForTimeout(400);
  const after = await loopOn(page, 'rodo');
  check((await stat(page, 'shot_flick', true)) >= 1, 'balanço do Rodo tocou');
  check(drag && !after, `arrasto do Rodo soa em movimento e para ao soltar (${drag} → ${after})`);
  errs.push(...e);
  await page.context().close();
}

check(errs.length === 0, `sem erros de página (${errs.slice(0, 3).join(' | ')})`);
await browser.close();
done();

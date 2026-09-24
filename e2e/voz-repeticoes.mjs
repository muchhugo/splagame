// Roda e2e/voz.mjs N vezes (REPETICOES, padrão 10) e registra TODAS as execuções,
// inclusive as falhas, em e2e/out/voz-repeticoes.json. Não repete "até passar".
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { OUT } from './lib.mjs';

const N = Number(process.env.REPETICOES ?? 10);
const runs = [];
// grava a cada execução: uma interrupção não apaga as execuções já feitas
function save() {
  const passed = runs.filter((r) => r.ok).length;
  const report = { entrada: process.env.VOZ_ENTRADA === 'bipe' ? 'bipe padrão do Chromium' : 'fala sintética (e2e/fala-sintetica.mjs)', execucoes: runs.length, planejadas: N, completas: passed, taxa: `${passed}/${runs.length}`, runs };
  writeFileSync(`${OUT}voz-repeticoes-${process.env.VOZ_ENTRADA === 'bipe' ? 'bipe' : 'fala'}.json`, JSON.stringify(report, null, 2));
}
for (let i = 1; i <= N; i++) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [new URL('./voz.mjs', import.meta.url).pathname], { env: process.env, encoding: 'utf8', timeout: 600000 });
  const lines = (r.stdout ?? '').split('\n');
  const falhas = lines.filter((l) => l.startsWith('FALHA')).map((l) => l.slice(6));
  const ok = r.status === 0 && falhas.length === 0;
  runs.push({ execucao: i, ok, segundos: Math.round((Date.now() - t) / 1000), falhas, verificacoes: lines.filter((l) => /^(ok|FALHA)/.test(l)).length, erro: r.status !== 0 && !falhas.length ? (r.stderr ?? '').slice(-400) : undefined });
  console.log(`${ok ? 'ok   ' : 'FALHA'} execução ${i}/${N}${falhas.length ? ` — ${falhas.join('; ')}` : ''}${runs.at(-1).erro ? ` — erro: ${runs.at(-1).erro.split('\n').filter(Boolean).slice(-2).join(' / ')}` : ''}`);
  save();
}
const passed = runs.filter((r) => r.ok).length;
console.log(`\n${passed}/${N} execuções completas`);
process.exit(passed === N ? 0 : 1);

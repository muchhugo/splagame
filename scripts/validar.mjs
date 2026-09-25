// Validação agregada, executável por qualquer pessoa na própria máquina:
//   node scripts/validar.mjs [--rapido] [--sem-navegador] [--voz] [--desempenho]
//
// 1. typecheck, testes unitários/integração, build de produção;
// 2. verificações de segurança no build (páginas de dev fora do bundle, sem segredos
//    locais, fixture de voz ausente no host de produção, modo dev bloqueado em produção);
// 3. custo do tick autoritativo com 4/8/16 participantes;
// 4. uma pilha ISOLADA do commit atual (worktree temporária, portas livres, .env local
//    derivado) e os testes de navegador: shell/iframe, partida, controle, treino, menus,
//    contrato de voz (fixture), e — com --voz e um LiveKit local em LIVEKIT_URL — a voz
//    com mídia simulada; com --desempenho, a medição do cliente.
// Relatório: e2e/out/validacao.json (e resumo no terminal). Código de saída ≠ 0 se algo falhar.
// Não publica nada, não usa contas reais e não toca em produção.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, 'e2e/out');
mkdirSync(OUT, { recursive: true });
const args = new Set(process.argv.slice(2));
const RAPIDO = args.has('--rapido');
const NAVEGADOR = !args.has('--sem-navegador');
const VOZ = args.has('--voz');
const DESEMPENHO = args.has('--desempenho');
const report = { inicio: new Date().toISOString(), commit: git(['rev-parse', '--short', 'HEAD']), limpo: git(['status', '--porcelain']).trim() === '', etapas: [] };

function git(a) {
  return spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout ?? '';
}

function run(nome, cmd, cmdArgs, opts = {}) {
  const t0 = Date.now();
  process.stdout.write(`… ${nome}\n`);
  const r = spawnSync(cmd, cmdArgs, { cwd: opts.cwd ?? ROOT, env: { ...process.env, ...(opts.env ?? {}) }, encoding: 'utf8', timeout: opts.timeout ?? 1800000, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const ok = r.status === 0;
  const etapa = { etapa: nome, ok, segundos: Math.round((Date.now() - t0) / 1000), resumo: (opts.resumo ? opts.resumo(out) : null) ?? tail(out, ok ? 3 : 25) };
  report.etapas.push(etapa);
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${nome} (${etapa.segundos}s)${etapa.resumo ? ` — ${String(etapa.resumo).split('\n')[0].slice(0, 160)}` : ''}`);
  return { ok, out };
}

function check(nome, ok, detalhe) {
  report.etapas.push({ etapa: nome, ok, segundos: 0, resumo: detalhe });
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}

const tail = (s, n) => s.trim().split('\n').slice(-n).join('\n');

// Tudo roda numa WORKTREE temporária do commit atual: valida o que está commitado e não
// interfere na pilha de desenvolvimento em uso (nem no .next do host).
const wt = join(tmpdir(), `borrifo-validar-${Date.now().toString(36)}`);
const procs = [];
const pnpm = 'pnpm';
try {
  run('worktree isolada do commit atual', 'git', ['worktree', 'add', '--detach', wt, 'HEAD']);
  run('dependências na worktree (offline)', pnpm, ['install', '--frozen-lockfile', '--offline'], { cwd: wt });
  const base = existsSync(join(ROOT, '.env')) ? readFileSync(join(ROOT, '.env'), 'utf8') : readFileSync(join(ROOT, '.env.example'), 'utf8');
  writeFileSync(join(wt, '.env'), base);
  if (!existsSync(join(ROOT, '.env'))) spawnSync(process.execPath, ['scripts/setup-env.mjs'], { cwd: wt });

  // ---------------------------------------------------------- 1. estático
  run('typecheck (todos os pacotes)', pnpm, ['-r', 'typecheck'], { cwd: wt });
  run('testes unitários e de integração (vitest)', pnpm, ['test'], { cwd: wt, resumo: (o) => (o.match(/Tests\s+[^\n]+/g) ?? []).pop() ?? null });
  if (!RAPIDO) {
    const b = run('build de produção', pnpm, ['-r', 'build'], { cwd: wt });
    if (b.ok) {
      // ------------------------------------------------------ 2. segurança do build
      const files = walk(join(wt, 'apps/game-client/dist'));
      check('vitrines de desenvolvimento fora do bundle do jogo', files.length > 0 && !files.some((f) => /vitrine\.html|mapas\.html/.test(f)), `${files.length} arquivos no dist`);
      const env = readFileSync(join(wt, '.env'), 'utf8');
      const secrets = [...env.matchAll(/^(DEV_MATCH_CREDENTIAL_SECRET|LAB_SESSION_SECRET|LIVEKIT_API_SECRET)=(.{8,})$/gm)].map((m) => m[2].trim());
      const clientBlob = files.filter((f) => /\.(js|html|css)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
      check('nenhum segredo local no bundle do jogo', secrets.every((x) => !clientBlob.includes(x)), `${secrets.length} segredo(s) do .env procurados`);
      check('gancho de diagnóstico __borrifo ausente do bundle de produção', !clientBlob.includes('__borrifo'), null);
      const hostBlob = walk(join(wt, 'apps/activity-shell/.next/static')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8')).join('\n');
      check('fixture e diagnóstico de voz ausentes do host de produção', hostBlob.length > 0 && !hostBlob.includes('__labVoiceFixture') && !hostBlob.includes('__labVoiceDiag'), `${Math.round(hostBlob.length / 1024)} KB de JS do host verificados`);
    }
  }
  run('modo de credencial de desenvolvimento recusado em produção', pnpm, ['--filter', '@borrifo/game-server', 'exec', 'tsx', '-e', "import('./src/config.ts').then(({loadConfig})=>{try{loadConfig({NODE_ENV:'production',MATCH_AUTH_MODE:'dev-hs256',DEV_MATCH_CREDENTIAL_SECRET:'x'.repeat(40)});process.exit(1)}catch{process.exit(0)}})"], { cwd: wt });

  // ---------------------------------------------------------- 3. servidor
  run('custo do tick com 4/8/16 participantes', pnpm, ['--filter', '@borrifo/game-server', 'exec', 'tsx', 'scripts/bench-tick.ts'], {
    cwd: wt,
    env: { SAIDA: join(OUT, 'bench-tick.json'), SEGUNDOS: RAPIDO ? '10' : '30' },
    resumo: (o) => {
      const rows = o.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
      return rows.map((r) => `${r.mapa}/${r.modo}/${r.jogadores}: p99 ${r.tickMs.p99} ms`).join(' · ');
    },
  });

  // ---------------------------------------------------------- 4. pilha isolada + navegador
  if (NAVEGADOR) {
    const [pServer, pClient, pHost] = await Promise.all([freePort(), freePort(), freePort()]);
    const env = {
      GAME_SERVER_PORT: String(pServer),
      GAME_ALLOWED_ORIGINS: `http://localhost:${pClient},http://127.0.0.1:${pClient}`,
      ROUND_DURATION_SECONDS: '40',
      CORREIO_DURATION_SECONDS: '45',
      RESULTS_FILE: join(wt, 'data/results.jsonl'),
      ACTIVITY_URL: `http://localhost:${pClient}/`,
      GAME_SERVER_PUBLIC_URL: `http://localhost:${pServer}`,
      LAB_GAME_ORIGIN: `http://localhost:${pClient}`,
      VITE_GAME_SERVER_URL: `http://localhost:${pServer}`,
      VITE_ALLOWED_HOST_ORIGINS: `http://localhost:${pHost},http://127.0.0.1:${pHost}`,
      VITE_LAB_BACKEND_URL: `http://localhost:${pHost}`,
      LIVEKIT_URL: '',
      LIVEKIT_API_KEY: '',
      LIVEKIT_API_SECRET: '',
    };
    const logs = join(OUT, 'validacao-logs');
    mkdirSync(logs, { recursive: true });
    procs.push(start('servidor', 'npx', ['tsx', 'src/main.ts'], join(wt, 'apps/game-server'), env, logs));
    procs.push(start('cliente', 'npx', ['vite', '--port', String(pClient), '--strictPort'], join(wt, 'apps/game-client'), env, logs));
    let host = start('host', 'npx', ['next', 'dev', '--port', String(pHost)], join(wt, 'apps/activity-shell'), env, logs);
    procs.push(host);
    const up = await waitHttp([`http://127.0.0.1:${pServer}/`, `http://127.0.0.1:${pClient}/`, `http://127.0.0.1:${pHost}/`], 180000);
    check('pilha isolada de pé (servidor, cliente, host)', up, `portas ${pServer}/${pClient}/${pHost}`);
    if (up) {
      const e2eEnv = { E2E_HOST_URL: `http://localhost:${pHost}/`, E2E_GAME_URL: `http://localhost:${pClient}/`, E2E_SWIFTSHADER: process.env.E2E_SWIFTSHADER ?? '1' };
      const e2e = (nome, file, extra = {}) =>
        run(nome, process.execPath, [join(ROOT, 'e2e', file)], {
          env: { ...e2eEnv, ...extra },
          resumo: (o) => (o.includes('todas as verificações passaram') ? `${(o.match(/^ok /gm) ?? []).length} verificações` : o.split('\n').filter((l) => l.startsWith('FALHA')).join(' | ') || tail(o, 3)),
          timeout: 1200000,
        });
      e2e('navegador: host, iframe, handshake, credencial, fechamento', 'shell.mjs');
      e2e('navegador: partida com dois humanos, tinta idêntica, limpeza', 'gameplay.mjs');
      e2e('navegador: controle (entrada, glifos, vibração, menu)', 'gamepad.mjs');
      e2e('navegador: treino rápido v2', 'tutorial.mjs');
      e2e('navegador: menus sobre a arena (lobby, vitrine 3D, configurações, entrada na rodada, celular)', 'menus.mjs');
      e2e('navegador: banco (entrar no meio da partida e assistir como espectador)', 'banco.mjs');
      e2e('navegador: contrato de voz pelo bridge (mesmo nome, userId)', 'voz-interface.mjs');
      if (!RAPIDO) e2e('navegador: capturas das telas (desktop e celular emulado)', 'capturas.mjs', { PREFIXO: 'validacao' });
      if (DESEMPENHO) e2e('desempenho do cliente (4×4 e 8×8)', 'desempenho.mjs', { ROTULO: 'validacao', CENARIOS: '4x4,8x8', RODADAS: '1' });
      if (VOZ) {
        if (!process.env.LIVEKIT_URL) check('voz com mídia simulada', false, 'defina LIVEKIT_URL (LiveKit local --dev) e as chaves de dev no ambiente');
        else {
          try {
            process.kill(-host.pid, 'SIGTERM');
          } catch {
            /* já terminou */
          }
          await new Promise((r) => setTimeout(r, 3000));
          host = start('host-voz', 'npx', ['next', 'dev', '--port', String(pHost)], join(wt, 'apps/activity-shell'), { ...env, LIVEKIT_URL: process.env.LIVEKIT_URL, LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY ?? '', LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET ?? '' }, logs);
          procs.push(host);
          if (await waitHttp([`http://127.0.0.1:${pHost}/`], 120000)) e2e('voz com LiveKit local e fala sintética (5 repetições)', 'voz-repeticoes.mjs', { REPETICOES: '5' });
          else check('host com LiveKit de pé', false, null);
        }
      }
    }
  }
} finally {
  for (const p of procs) {
    try {
      process.kill(-p.pid, 'SIGTERM');
    } catch {
      /* já terminou */
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
  spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT });
  rmSync(wt, { recursive: true, force: true });
}

report.fim = new Date().toISOString();
const falhas = report.etapas.filter((e) => !e.ok);
report.resultado = falhas.length ? `${falhas.length} etapa(s) falharam` : 'todas as etapas passaram';
writeFileSync(join(OUT, 'validacao.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.resultado} (${report.etapas.length} etapas; commit ${report.commit.trim()}${report.limpo ? '' : ', com alterações não commitadas'}) — e2e/out/validacao.json`);
process.exit(falhas.length ? 1 : 0);

// ------------------------------------------------------------ utilitários
function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.unref();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

function start(nome, cmd, a, cwd, env, logs) {
  const out = join(logs, `${nome}.log`);
  const p = spawn(cmd, a, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  p.stdout.on('data', (d) => chunks.push(d));
  p.stderr.on('data', (d) => chunks.push(d));
  p.on('exit', () => writeFileSync(out, Buffer.concat(chunks)));
  return p;
}

async function waitHttp(urls, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const ok = await Promise.all(urls.map((u) => fetch(u).then((r) => r.status < 500, () => false)));
    if (ok.every(Boolean)) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/**
 * Carga com VÁRIAS SALAS no mesmo processo (um núcleo de Node): cada sala com 1 cliente
 * headless (anfitrião) + 15 bots (8 × 8), todas rodando ao mesmo tempo. Mede o custo do
 * passo fixo por sala, o atraso do laço de eventos (quanto os ticks de 33 ms escorregam) e
 * a CPU do processo. Serve para achar quantas salas cabem por núcleo. Local: clientes e
 * servidor na mesma máquina, sem rede real.
 *
 *   SALAS=1,2,4,8 SEGUNDOS=20 pnpm --filter @borrifo/game-server exec tsx scripts/load-rooms.ts
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { C2S } from '@borrifo/game-contracts';
import { CATALOG_HASH } from '@borrifo/game-content';
import { HeadlessClient, TEST_DEV_SECRET, issueDevCredential } from '@borrifo/test-utils';
import { loadConfig } from '../src/config';
import { startGameServer } from '../src/server';
import { MemoryResultSink } from '../src/results';
import { ArenaRoom } from '../src/rooms/ArenaRoom';
import { setLogLevel } from '../src/logger';

setLogLevel('warn');
const STEPS = (process.env.SALAS ?? '1,2,4,8').split(',').map(Number);
const SECONDS = Math.max(5, Number(process.env.SEGUNDOS ?? 20));

const tickMs: number[] = [];
let measuring = false;
const proto = ArenaRoom.prototype as unknown as { fixedStep: () => void };
const original = proto.fixedStep;
proto.fixedStep = function (this: unknown) {
  const t0 = performance.now();
  original.call(this);
  if (measuring) tickMs.push(performance.now() - t0);
};

const port = 30000 + Math.floor(Math.random() * 20000);
const cfg = loadConfig({ NODE_ENV: 'test', MATCH_AUTH_MODE: 'dev-hs256', DEV_MATCH_CREDENTIAL_SECRET: TEST_DEV_SECRET, GAME_SERVER_HOST: '127.0.0.1', ROUND_DURATION_SECONDS: String(SECONDS + 30), JOIN_RATE_BURST: '500', JOIN_RATE_PER_SECOND: '100', MAX_ROOMS: '200', LOG_LEVEL: 'warn' } as NodeJS.ProcessEnv);
const srv = await startGameServer(cfg, { sink: new MemoryResultSink(), port });
const url = `http://127.0.0.1:${port}`;
const q = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0;
};

const rows: Array<Record<string, number>> = [];
for (const rooms of STEPS) {
  const clients: HeadlessClient[] = [];
  for (let r = 0; r < rooms; r++) {
    const sid = `salas-${rooms}-${r}-${Date.now().toString(36)}`;
    const c = new HeadlessClient(url);
    await c.join({ activitySessionId: sid, credential: await issueDevCredential(TEST_DEV_SECRET, { userId: `h${r}`, name: `Sala ${r}`, activitySessionId: sid }), mapHash: CATALOG_HASH });
    await c.waitFor(() => c.welcome && c.lobby, 10000, 'welcome');
    c.send(C2S.SET_OPTIONS, { formation: 8 });
    await c.waitFor(() => c.lobby!.plan.teamSize === 8, 5000, 'formação 8');
    c.send(C2S.START, {});
    clients.push(c);
  }
  for (const c of clients) await c.waitFor(() => c.lobby?.phase === 'running', 60000, 'running');
  const start = Date.now();
  const timer = setInterval(() => {
    const t = (Date.now() - start) / 1000;
    clients.forEach((c, i) => c.sendInput({ moveY: 1, moveX: Math.sin(t + i) * 0.6, yaw: Math.sin(t * 0.4 + i) * 2, pitch: 0.25, heldButtons: Math.sin(t * 1.3 + i) > -0.3 ? 1 : 0 }));
  }, 33);
  await new Promise((r) => setTimeout(r, 2000));
  tickMs.length = 0;
  const lag = monitorEventLoopDelay({ resolution: 5 });
  lag.enable();
  const cpu0 = process.cpuUsage();
  const w0 = performance.now();
  measuring = true;
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  measuring = false;
  lag.disable();
  const cpu = process.cpuUsage(cpu0);
  const wall = performance.now() - w0;
  clearInterval(timer);
  const ticksPerSec = tickMs.length / (wall / 1000);
  const row = {
    salas: rooms,
    jogadoresSimulados: rooms * 16,
    ticksPorSegundo: Math.round(ticksPerSec),
    ticksEsperados: rooms * 30,
    passoP50ms: Math.round(q(tickMs, 0.5) * 100) / 100,
    passoP99ms: Math.round(q(tickMs, 0.99) * 100) / 100,
    atrasoLacoP99ms: Math.round((lag.percentile(99) / 1e6) * 10) / 10,
    atrasoLacoMaxms: Math.round((lag.max / 1e6) * 10) / 10,
    cpuPct: Math.round(((cpu.user + cpu.system) / 1000 / wall) * 100),
  };
  rows.push(row);
  console.log(JSON.stringify(row));
  await Promise.all(clients.map((c) => c.leave()));
  await new Promise((r) => setTimeout(r, 1500));
}
console.log('RESUMO ' + JSON.stringify(rows));
await srv.shutdown();
process.exit(0);

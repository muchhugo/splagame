/**
 * Teste de carga LOCAL: sobe o servidor de partidas real no mesmo processo e
 * conecta N clientes headless pelo WebSocket do Colyseus. Mede custo do tick
 * autoritativo e banda por cliente. Não é benchmark de produção: cliente e
 * servidor dividem a mesma máquina e não há perda/latência de rede real.
 *
 *   pnpm --filter @borrifo/game-server load-test            # 8 clientes, 60 s
 *   CLIENTS=1 DURATION=60 pnpm --filter @borrifo/game-server load-test   # 1 humano + 7 bots
 */
import os from 'node:os';
import { C2S, encodePaintDelta, encodePaintSnapshot } from '@borrifo/game-contracts';
import { CATALOG_HASH } from '@borrifo/game-content';
import { HeadlessClient, TEST_DEV_SECRET, issueDevCredential } from '@borrifo/test-utils';
import { loadConfig } from '../src/config';
import { startGameServer } from '../src/server';
import { MemoryResultSink } from '../src/results';
import { ArenaRoom } from '../src/rooms/ArenaRoom';
import { setLogLevel } from '../src/logger';

setLogLevel('warn');

const CLIENTS = Math.min(8, Math.max(1, Number(process.env.CLIENTS ?? 8)));
const DURATION = Math.max(10, Number(process.env.DURATION ?? 60));
const port = 30000 + Math.floor(Math.random() * 20000);

// mede cada passo fixo completo (simulação + codificação + envio)
const tickMs: number[] = [];
let measuring = false;
const proto = ArenaRoom.prototype as unknown as { fixedStep: () => void };
const original = proto.fixedStep;
proto.fixedStep = function (this: unknown) {
  const t0 = performance.now();
  original.call(this);
  if (measuring) tickMs.push(performance.now() - t0);
};

const cfg = loadConfig({
  NODE_ENV: 'test',
  MATCH_AUTH_MODE: 'dev-hs256',
  DEV_MATCH_CREDENTIAL_SECRET: TEST_DEV_SECRET,
  GAME_SERVER_HOST: '127.0.0.1',
  ROUND_DURATION_SECONDS: String(DURATION),
  JOIN_RATE_BURST: '50',
  LOG_LEVEL: 'warn',
} as NodeJS.ProcessEnv);
const srv = await startGameServer(cfg, { sink: new MemoryResultSink(), port });
const url = `http://127.0.0.1:${port}`;
const sid = `carga-${Date.now().toString(36)}`;
const mapHash = CATALOG_HASH;

const clients: HeadlessClient[] = [];
for (let i = 0; i < CLIENTS; i++) {
  const c = new HeadlessClient(url);
  await c.join({ activitySessionId: sid, credential: await issueDevCredential(TEST_DEV_SECRET, { userId: `u${i}`, name: `Carga ${i}`, activitySessionId: sid }), mapHash });
  await c.waitFor(() => c.welcome && c.lobby, 5000, 'welcome');
  clients.push(c);
}
const host = clients.find((c) => c.lobby!.hostPlayerId === c.welcome!.playerId) ?? clients[0];
// os demais humanos precisam estar prontos para o anfitrião iniciar
for (const c of clients) if (c !== host) c.send(C2S.SET_READY, { ready: true });
await host.waitFor(() => host.lobby!.players.filter((p) => p.ready && !p.isBot).length >= CLIENTS - 1, 5000, 'prontos');
host.send(C2S.START, {});
await host.waitFor(() => host.lobby?.phase === 'running', 30000, 'running');

// entradas a 30 Hz: anda, gira devagar e atira em rajadas
const start = Date.now();
const inputTimer = setInterval(() => {
  const t = (Date.now() - start) / 1000;
  clients.forEach((c, i) => {
    const yaw = Math.sin(t * 0.4 + i) * 2 + (c.lobby!.players.find((p) => p.playerId === c.welcome!.playerId)?.team === 1 ? -Math.PI / 2 : Math.PI / 2);
    c.sendInput({ moveY: 1, moveX: Math.sin(t * 0.9 + i) * 0.6, yaw, pitch: 0.25, heldButtons: Math.sin(t * 1.3 + i) > -0.3 ? 1 : 0 });
  });
}, 33);

const in0 = clients.map((c) => c.bytesIn);
const out0 = clients.map((c) => c.bytesOut);
measuring = true;
const cpu0 = process.cpuUsage();
const w0 = Date.now();
// ressincronização sob demanda no meio da rodada (tempo até o snapshot chegar)
await new Promise((r) => setTimeout(r, (DURATION * 1000) / 2));
const snapsBefore = host.paintSnapshots.length;
const tResync = performance.now();
host.send(C2S.PAINT_RESYNC, { roundId: host.lobby!.roundId, reason: 'carga' });
await host.waitFor(() => host.paintSnapshots.length > snapsBefore, 5000, 'ressincronização');
const resyncMs = performance.now() - tResync;
const midSnapshotBytes = encodePaintSnapshot(host.paintSnapshots[host.paintSnapshots.length - 1]).byteLength;
await host.waitFor(() => host.results.length > 0, (DURATION + 30) * 1000, 'resultado');
measuring = false;
const wall = (Date.now() - w0) / 1000;
const cpu = process.cpuUsage(cpu0);
clearInterval(inputTimer);

function deltaStats(sizes: number[]) {
  const s = [...sizes].sort((a, b) => a - b);
  return { quantidade: s.length, mediaBytes: Math.round(s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)), p95Bytes: s[Math.floor(s.length * 0.95)] ?? 0, maxBytes: s[s.length - 1] ?? 0 };
}

const sorted = [...tickMs].sort((a, b) => a - b);
const q = (x: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * x))].toFixed(2);
const kbps = (b: number) => ((b * 8) / 1000 / wall).toFixed(1);
const inB = clients.map((c, i) => c.bytesIn - in0[i]);
const outB = clients.map((c, i) => c.bytesOut - out0[i]);
const r = host.results[0];
const agree = clients.every((c) => c.results[0] && JSON.stringify(c.results[0].teamUnits) === JSON.stringify(r.teamUnits));

console.log(
  JSON.stringify(
    {
      ambiente: { node: process.version, cpu: os.cpus()[0]?.model, nucleos: os.cpus().length, plataforma: `${os.platform()} ${os.release()}` },
      clientes: CLIENTS,
      bots: 8 - CLIENTS,
      duracaoRodadaS: DURATION,
      medidoS: Number(wall.toFixed(1)),
      ticks: tickMs.length,
      tickMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted[sorted.length - 1].toFixed(2) },
      cpuProcesso: `${(((cpu.user + cpu.system) / 1e6 / wall) * 100).toFixed(1)}% de um núcleo (servidor + ${CLIENTS} clientes no mesmo processo)`,
      downloadPorClienteKbps: { media: kbps(inB.reduce((a, b) => a + b, 0) / CLIENTS), max: kbps(Math.max(...inB)) },
      uploadPorClienteKbps: { media: kbps(outB.reduce((a, b) => a + b, 0) / CLIENTS) },
      tinta: {
        snapshotInicialBytes: encodePaintSnapshot(host.paintSnapshots[0]).byteLength,
        snapshotMeioDaRodadaBytes: midSnapshotBytes,
        ressincronizacaoMs: Number(resyncMs.toFixed(1)),
        deltas: deltaStats(host.paintDeltas.map((d) => encodePaintDelta(d).byteLength)),
      },
      resultado: { percent: r.percent, neutro: r.neutralPercent, vencedor: r.winner, todosConcordam: agree },
    },
    null,
    2,
  ),
);
for (const c of clients) await c.leave();
await srv.shutdown();
process.exit(0);

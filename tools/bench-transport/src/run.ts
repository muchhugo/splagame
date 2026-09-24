/**
 * Benchmark ISOLADO de transporte: o mesmo tráfego sintético de gameplay por
 * (A) LiveKit Data (SFU + um participante-autoridade no servidor) e
 * (B) Colyseus/WebSocket (sala mínima), com 2, 4, 8 e 16 jogadores.
 *
 * Não roda a simulação do jogo: mede só o transporte, com tamanhos e taxas
 * tirados do jogo real (ver docs/livekit-transporte.md). Tudo roda na mesma
 * máquina (loopback): não há latência, jitter nem perda de rede reais.
 *
 *   livekit-server --dev --bind 127.0.0.1   # em outro terminal (servidor local de desenvolvimento)
 *   LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=… LIVEKIT_PID=$(pgrep -x livekit-server) \
 *     pnpm --filter @borrifo/bench-transport bench
 *   Variáveis: DURATION (s), SIZES (ex.: 2,4,8,16), LK_PROCS (processos de clientes),
 *   SNAP_RELIABLE=1, ONLY=colyseus|livekit, AUDIO=0.
 */
import os from 'node:os';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  DataPacketKind,
  LocalAudioTrack,
  Room,
  RoomEvent,
  SimulateScenarioKind,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  dispose,
  type RemoteParticipant,
} from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import { Room as CRoom, Server, type Client as CClient } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client as ColyseusClient, type Room as CSdkRoom } from '@colyseus/sdk';

const LIVEKIT_URL = process.env.LIVEKIT_URL ?? 'ws://127.0.0.1:7880';
// Sem valores padrão no código: as chaves vêm do ambiente (as do `livekit-server --dev` estão na
// documentação do LiveKit). O benchmark só fala com um servidor local, a menos que se peça o contrário.
const LK_KEY = process.env.LIVEKIT_API_KEY ?? '';
const LK_SECRET = process.env.LIVEKIT_API_SECRET ?? '';
const needsLiveKit = process.env.ONLY !== 'colyseus' || process.env.AUDIO !== '0';
if (needsLiveKit && (!LK_KEY || !LK_SECRET)) {
  console.error('Defina LIVEKIT_API_KEY e LIVEKIT_API_SECRET do servidor LiveKit LOCAL (ver docs/livekit-transporte.md), ou use ONLY=colyseus AUDIO=0.');
  process.exit(2);
}
if (needsLiveKit && !/^wss?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(LIVEKIT_URL) && process.env.BENCH_ALLOW_REMOTE !== '1') {
  console.error(`LIVEKIT_URL=${LIVEKIT_URL} não é local. O benchmark gera carga sintética; para um servidor remoto de teste (nunca produção), defina BENCH_ALLOW_REMOTE=1.`);
  process.exit(2);
}
const DURATION_S = Number(process.env.DURATION ?? 20);
const WARMUP_S = 2;
const SIZES_LIST = (process.env.SIZES ?? '2,4,8,16').split(',').map(Number);
const LK_PID = process.env.LIVEKIT_PID ? Number(process.env.LIVEKIT_PID) : null;
/** SNAP_RELIABLE=1: snapshots pelo canal confiável (para comparar com o lossy). */
const SNAP_RELIABLE = process.env.SNAP_RELIABLE === '1';
/** Quantos processos filhos hospedam os jogadores LiveKit (1 = todos no processo da autoridade). */
const LK_PROCS = Number(process.env.LK_PROCS ?? 4);

// Taxas e tamanhos do jogo real (docs/performance.md, docs/networking.md)
const SNAP_HZ = 15;
const INPUT_HZ = 30;
const PAINT_HZ = 9;
const PING_MS = 250;
const BYTES = { input: 40, ping: 13, paint: 130, paintBig: 520 };
/** Snapshot por jogador: base + tupla de cada remoto (limitado abaixo do MTU recomendado para lossy). */
const snapshotBytes = (n: number) => Math.min(1200, 380 + 40 * n);

const T = { INPUT: 1, PING: 2, PONG: 3, SNAP: 4, PAINT: 5 } as const;

/** Relógio de parede com resolução de sub-ms, comparável entre processos da mesma máquina. */
const wallNow = () => performance.timeOrigin + performance.now();

function frame(type: number, seq: number, t: number, size: number): Uint8Array {
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  dv.setUint8(0, type);
  dv.setUint32(1, seq);
  dv.setFloat64(5, t);
  return b;
}
function parse(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { type: dv.getUint8(0), seq: dv.getUint32(1), t: dv.getFloat64(5) };
}

class Stats {
  v: number[] = [];
  add(x: number) {
    this.v.push(x);
  }
  q(p: number) {
    if (!this.v.length) return NaN;
    const s = [...this.v].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
  }
  mean() {
    return this.v.length ? this.v.reduce((a, b) => a + b, 0) / this.v.length : NaN;
  }
  std() {
    const m = this.mean();
    return this.v.length ? Math.sqrt(this.v.reduce((a, b) => a + (b - m) ** 2, 0) / this.v.length) : NaN;
  }
}

interface ClientStats {
  snapDelay: Stats;
  paintDelay: Stats;
  rttLossy: Stats;
  rttReliable: Stats;
  snapSeqs: Set<number>;
  snapFirst: number;
  snapLast: number;
  bytesDown: number;
  msgsDown: number;
  bytesUp: number;
  msgsUp: number;
  measuring: boolean;
}
const newClientStats = (): ClientStats => ({
  snapDelay: new Stats(),
  paintDelay: new Stats(),
  rttLossy: new Stats(),
  rttReliable: new Stats(),
  snapSeqs: new Set(),
  snapFirst: -1,
  snapLast: -1,
  bytesDown: 0,
  msgsDown: 0,
  bytesUp: 0,
  msgsUp: 0,
  measuring: false,
});

function onClientMessage(st: ClientStats, b: Uint8Array, reliable: boolean) {
  const now = wallNow();
  const m = parse(b);
  if (!st.measuring) return;
  st.bytesDown += b.byteLength;
  st.msgsDown++;
  if (m.type === T.SNAP) {
    st.snapDelay.add(now - m.t);
    st.snapSeqs.add(m.seq);
    if (st.snapFirst < 0) st.snapFirst = m.seq;
    st.snapLast = Math.max(st.snapLast, m.seq);
  } else if (m.type === T.PAINT) st.paintDelay.add(now - m.t);
  else if (m.type === T.PONG) (reliable ? st.rttReliable : st.rttLossy).add(now - m.t);
}

// ---------------------------------------------------------------- CPU/memória
function procTicks(pid: number): number {
  const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
  return Number(f[11]) + Number(f[12]); // utime + stime (a partir do campo 3)
}
function procRssMb(pid: number): number {
  const m = readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/);
  return m ? Number(m[1]) / 1024 : NaN;
}
const CLK_TCK = 100;

interface Usage {
  cpuSelf: number;
  cpuSfu: number | null;
  cpuClients: number | null;
  rssSelfMb: number;
  rssSfuMb: number | null;
  rssClientsMb: number | null;
}
function startUsage(childPids: number[] = []) {
  const c0 = process.cpuUsage();
  const w0 = performance.now();
  const s0 = LK_PID ? procTicks(LK_PID) : 0;
  const k0 = childPids.map(procTicks);
  return (sfu: boolean): Usage => {
    const wall = (performance.now() - w0) / 1000;
    const c = process.cpuUsage(c0);
    return {
      cpuSelf: ((c.user + c.system) / 1e6 / wall) * 100,
      cpuSfu: sfu && LK_PID ? ((procTicks(LK_PID) - s0) / CLK_TCK / wall) * 100 : null,
      cpuClients: childPids.length ? (childPids.reduce((a, pid, i) => a + procTicks(pid) - k0[i], 0) / CLK_TCK / wall) * 100 : null,
      rssSelfMb: process.memoryUsage().rss / 1048576,
      rssSfuMb: sfu && LK_PID ? procRssMb(LK_PID) : null,
      rssClientsMb: childPids.length ? childPids.reduce((a, pid) => a + procRssMb(pid), 0) : null,
    };
  };
}

// ---------------------------------------------------------------- resumo
function summarize(transport: string, n: number, clients: ClientStats[], inputsAtAuthority: number, secs: number, usage: Usage, extra: Record<string, unknown> = {}) {
  const all = (k: 'snapDelay' | 'paintDelay' | 'rttLossy' | 'rttReliable') => {
    const s = new Stats();
    for (const c of clients) s.v.push(...c[k].v);
    return s;
  };
  const snap = all('snapDelay');
  const loss = clients.map((c) => (c.snapLast >= c.snapFirst && c.snapFirst >= 0 ? 1 - c.snapSeqs.size / (c.snapLast - c.snapFirst + 1) : NaN));
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    transport,
    jogadores: n,
    snapshotBytes: snapshotBytes(n),
    snapshotAtrasoMs: { p50: r(snap.q(0.5)), p95: r(snap.q(0.95)), p99: r(snap.q(0.99)), max: r(snap.q(1)), jitterDesvio: r(snap.std()) },
    tintaAtrasoMs: { p50: r(all('paintDelay').q(0.5)), p99: r(all('paintDelay').q(0.99)) },
    rttLossyMs: { p50: r(all('rttLossy').q(0.5)), p95: r(all('rttLossy').q(0.95)), p99: r(all('rttLossy').q(0.99)) },
    rttConfiavelMs: { p50: r(all('rttReliable').q(0.5)), p95: r(all('rttReliable').q(0.95)), p99: r(all('rttReliable').q(0.99)) },
    perdaSnapshotsPct: r(Math.max(...loss.filter((x) => !Number.isNaN(x)), 0) * 100),
    porClienteDown: { kbitps: r((clients.reduce((a, c) => a + c.bytesDown, 0) / n / secs) * 0.008), msgsps: r(clients.reduce((a, c) => a + c.msgsDown, 0) / n / secs) },
    porClienteUp: { kbitps: r((clients.reduce((a, c) => a + c.bytesUp, 0) / n / secs) * 0.008), msgsps: r(clients.reduce((a, c) => a + c.msgsUp, 0) / n / secs) },
    entradasNaAutoridadePct: r((inputsAtAuthority / (INPUT_HZ * n * secs)) * 100),
    // processoBench: autoridade (e os clientes, quando estão no mesmo processo); clientes: soma dos processos filhos
    cpu: { processoBenchPct: r(usage.cpuSelf), sfuPct: usage.cpuSfu === null ? null : r(usage.cpuSfu), clientesPct: usage.cpuClients === null ? null : r(usage.cpuClients) },
    memoriaMb: { processoBench: r(usage.rssSelfMb), sfu: usage.rssSfuMb === null ? null : r(usage.rssSfuMb), clientes: usage.rssClientsMb === null ? null : r(usage.rssClientsMb) },
    ...extra,
  };
}

// ---------------------------------------------------------------- LiveKit
async function lkToken(identity: string, room: string, hidden = false) {
  const at = new AccessToken(LK_KEY, LK_SECRET, { identity, ttl: '10m' });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true, ...(hidden ? { hidden: true } : {}) });
  return at.toJwt();
}

/** Um grupo de jogadores LiveKit: entradas lossy a 30 Hz para a autoridade e pings lossy e confiáveis. */
async function lkClientGroup(roomName: string, ids: string[]) {
  const rooms: Room[] = [];
  const stats: ClientStats[] = [];
  for (const id of ids) {
    const r = new Room();
    const st = newClientStats();
    r.on(RoomEvent.DataReceived, (payload: Uint8Array, _p?: RemoteParticipant, kind?: DataPacketKind) => onClientMessage(st, payload, kind === DataPacketKind.KIND_RELIABLE));
    await r.connect(LIVEKIT_URL, await lkToken(id, roomName), { autoSubscribe: false, dynacast: false });
    rooms.push(r);
    stats.push(st);
  }
  let pingSeq = 0;
  const inputTimer = setInterval(() => {
    rooms.forEach((r, i) => {
      const b = frame(T.INPUT, 0, wallNow(), BYTES.input);
      void r.localParticipant!.publishData(b, { reliable: false, destination_identities: ['autoridade'], topic: 'in' }).catch(() => {});
      if (stats[i].measuring) {
        stats[i].bytesUp += b.byteLength;
        stats[i].msgsUp++;
      }
    });
  }, 1000 / INPUT_HZ);
  const pingTimer = setInterval(() => {
    pingSeq++;
    for (const r of rooms) {
      for (const reliable of [false, true]) void r.localParticipant!.publishData(frame(T.PING, pingSeq, wallNow(), BYTES.ping), { reliable, destination_identities: ['autoridade'], topic: 'pi' }).catch(() => {});
    }
  }, PING_MS);
  return {
    stats,
    setMeasuring(on: boolean) {
      for (const st of stats) st.measuring = on;
    },
    /** Resume de sinalização e full reconnect no primeiro jogador: tempo até voltar a receber snapshots. */
    async reconnectTests() {
      const out: Record<string, number | null> = {};
      for (const [label, kind] of [
        ['resumeMs', SimulateScenarioKind.SIMULATE_SIGNAL_RECONNECT],
        ['fullReconnectMs', SimulateScenarioKind.SIMULATE_FULL_RECONNECT],
      ] as const) {
        const st = newClientStats();
        const probe = (payload: Uint8Array) => onClientMessage(st, payload, false);
        st.measuring = true;
        const a = performance.now();
        await rooms[0].simulateScenario(kind).catch(() => {});
        rooms[0].on(RoomEvent.DataReceived, probe);
        // conta só snapshots que chegam DEPOIS do cenário (dois seguidos = fluxo retomado)
        let got: number | null = null;
        while (performance.now() - a < 15000) {
          if (st.snapSeqs.size >= 2) {
            got = performance.now() - a;
            break;
          }
          await sleep(5);
        }
        rooms[0].off(RoomEvent.DataReceived, probe);
        out[label] = got === null ? null : Math.round(got);
        await sleep(1500);
      }
      return out;
    },
    async close() {
      clearInterval(inputTimer);
      clearInterval(pingTimer);
      await Promise.all(rooms.map((r) => r.disconnect().catch(() => {})));
    },
  };
}

type Serialized = Omit<ClientStats, 'snapDelay' | 'paintDelay' | 'rttLossy' | 'rttReliable' | 'snapSeqs'> & Record<'snapDelay' | 'paintDelay' | 'rttLossy' | 'rttReliable' | 'snapSeqs', number[]>;
const serialize = (c: ClientStats): Serialized => ({ ...c, snapDelay: c.snapDelay.v, paintDelay: c.paintDelay.v, rttLossy: c.rttLossy.v, rttReliable: c.rttReliable.v, snapSeqs: [...c.snapSeqs] });
function deserialize(c: Serialized): ClientStats {
  const st = (v: number[]) => Object.assign(new Stats(), { v });
  return { ...c, snapDelay: st(c.snapDelay), paintDelay: st(c.paintDelay), rttLossy: st(c.rttLossy), rttReliable: st(c.rttReliable), snapSeqs: new Set(c.snapSeqs) };
}

interface GroupHandle {
  pid: number | null;
  measure(): void;
  stop(): Promise<ClientStats[]>;
  reconnect(): Promise<Record<string, number | null>>;
  exit(): Promise<void>;
}

/** Jogadores num processo filho (cada navegador real é um processo; aqui, um processo por grupo). */
async function spawnGroup(roomName: string, ids: string[]): Promise<GroupHandle> {
  const cp = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
    env: { ...process.env, ROLE: 'lk-clients', ROOM: roomName, IDS: ids.join(',') },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const waiters: Array<(o: Record<string, unknown>) => void> = [];
  createInterface({ input: cp.stdout! }).on('line', (l) => {
    if (l.startsWith('@@bench ')) waiters.shift()?.(JSON.parse(l.slice(8)));
  });
  const next = () => new Promise<Record<string, unknown>>((r) => waiters.push(r));
  const send = (cmd: string) => cp.stdin!.write(`${cmd}\n`);
  await next(); // pronto
  return {
    pid: cp.pid ?? null,
    measure: () => send('measure'),
    async stop() {
      const w = next();
      send('stop');
      return ((await w).stats as Serialized[]).map(deserialize);
    },
    async reconnect() {
      const w = next();
      send('reconnect');
      return (await w).reconnect as Record<string, number | null>;
    },
    async exit() {
      const gone = once(cp, 'exit');
      send('exit');
      await Promise.race([gone, sleep(5000)]);
    },
  };
}

async function localGroup(roomName: string, ids: string[]): Promise<GroupHandle> {
  const g = await lkClientGroup(roomName, ids);
  return {
    pid: null,
    measure: () => g.setMeasuring(true),
    async stop() {
      g.setMeasuring(false);
      return g.stats;
    },
    reconnect: () => g.reconnectTests(),
    exit: () => g.close(),
  };
}

/** Processo filho: um grupo de jogadores comandado pelo processo principal via stdin. */
async function childMain() {
  const g = await lkClientGroup(process.env.ROOM!, process.env.IDS!.split(','));
  const out = (o: unknown) => process.stdout.write(`@@bench ${JSON.stringify(o)}\n`);
  out({ pronto: true });
  for await (const line of createInterface({ input: process.stdin })) {
    if (line === 'measure') g.setMeasuring(true);
    else if (line === 'stop') {
      g.setMeasuring(false);
      out({ stats: g.stats.map(serialize) });
    } else if (line === 'reconnect') out({ reconnect: await g.reconnectTests() });
    else if (line === 'exit') break;
  }
  await g.close();
  await dispose();
  process.exit(0);
}

/**
 * LiveKit: a autoridade (participante oculto) manda snapshot por jogador (lossy,
 * 15 Hz) e tinta confiável (9 Hz) para todos, e responde pings pelo mesmo canal.
 * LK_PROCS>1 distribui os jogadores em processos filhos, para o custo dos
 * clientes não cair no mesmo event loop da autoridade.
 */
async function benchLiveKit(n: number) {
  const roomName = `bench-${n}-${Date.now().toString(36)}`;
  const authority = new Room();
  let inputs = 0;
  let measuring = false;
  const ids = Array.from({ length: n }, (_, i) => `jogador-${i}`);
  const procs = Math.max(1, Math.min(n, LK_PROCS));
  const t0 = performance.now();
  await authority.connect(LIVEKIT_URL, await lkToken('autoridade', roomName, true), { autoSubscribe: false, dynacast: false });
  authority.on(RoomEvent.DataReceived, (payload: Uint8Array, p?: RemoteParticipant, kind?: DataPacketKind) => {
    const m = parse(payload);
    if (m.type === T.INPUT) {
      if (measuring) inputs++;
    } else if (m.type === T.PING && p) {
      void authority.localParticipant!.publishData(frame(T.PONG, m.seq, m.t, BYTES.ping), { reliable: kind === DataPacketKind.KIND_RELIABLE, destination_identities: [p.identity], topic: 'po' }).catch(() => {});
    }
  });
  const parts = Array.from({ length: procs }, (_, k) => ids.filter((_, i) => i % procs === k));
  const groups = await Promise.all(parts.map((g) => (procs === 1 ? localGroup(roomName, g) : spawnGroup(roomName, g))));
  const connectMs = performance.now() - t0;
  let snapSeq = 0;
  let paintSeq = 0;
  let rejected = 0;
  let sent = 0;
  const sendCost = new Stats();
  const snapTimer = setInterval(() => {
    const a = performance.now();
    snapSeq++;
    for (const id of ids) {
      if (measuring) sent++;
      void authority.localParticipant!.publishData(frame(T.SNAP, snapSeq, wallNow(), snapshotBytes(n)), { reliable: SNAP_RELIABLE, destination_identities: [id], topic: 's' }).catch(() => {
        if (measuring) rejected++;
      });
    }
    sendCost.add(performance.now() - a);
  }, 1000 / SNAP_HZ);
  const paintTimer = setInterval(() => {
    paintSeq++;
    const size = paintSeq % 10 === 0 ? BYTES.paintBig : BYTES.paint;
    void authority.localParticipant!.publishData(frame(T.PAINT, paintSeq, wallNow(), size), { reliable: true, topic: 'p' }).catch(() => {});
  }, 1000 / PAINT_HZ);

  await sleep(WARMUP_S * 1000);
  const childPids = groups.map((g) => g.pid).filter((x): x is number => x !== null);
  const usage = startUsage(childPids);
  measuring = true;
  for (const g of groups) g.measure();
  const tm = performance.now();
  await sleep(DURATION_S * 1000);
  const secs = (performance.now() - tm) / 1000;
  measuring = false;
  const stats = (await Promise.all(groups.map((g) => g.stop()))).flat();
  const u = usage(true);
  const label = `livekit-data${SNAP_RELIABLE ? ' (snapshots confiáveis)' : ''}${procs > 1 ? ` (${procs} processos de clientes)` : ' (clientes no mesmo processo)'}`;
  const summary = summarize(label, n, stats, inputs, secs, u);

  // reconexão (depois do resumo, para não contaminar as métricas)
  const reconnect = await groups[0].reconnect();
  for (const t of [snapTimer, paintTimer]) clearInterval(t);
  await Promise.all(groups.map((g) => g.exit()));
  await authority.disconnect().catch(() => {});
  return {
    ...summary,
    snapshotsEnvioRejeitado: `${rejected}/${sent}`,
    conexaoTodosMs: Math.round(connectMs),
    custoEnvioTickAutoridadeMs: { p50: Math.round(sendCost.q(0.5) * 100) / 100, p99: Math.round(sendCost.q(0.99) * 100) / 100 },
    reconexao: reconnect,
  };
}

// ---------------------------------------------------------------- Colyseus
class BenchRoom extends CRoom {
  static inputs = 0;
  static measuring = false;
  static n = 2;
  static debug = { joins: 0, drops: 0 };
  private seq!: number;
  private paint!: number;
  private timers!: ReturnType<typeof setInterval>[];
  override onCreate() {
    this.maxClients = 32;
    this.autoDispose = true;
    this.seq = 0;
    this.paint = 0;
    // bytes vindos do cliente (sendBytes) só chegam a handlers registrados com onMessageBytes;
    // sem handler, o Colyseus 0.18 derruba a conexão com 4002
    this.onMessageBytes('in', () => {
      if (BenchRoom.measuring) BenchRoom.inputs++;
    });
    this.onMessageBytes('ping', (client: CClient, data: Uint8Array) => {
      const pong = data.slice();
      pong[0] = T.PONG;
      client.sendBytes('pong', pong);
    });
    this.timers = [
      setInterval(() => {
        this.seq++;
        for (const c of this.clients) {
          c.sendBytes('s', frame(T.SNAP, this.seq, wallNow(), snapshotBytes(BenchRoom.n)));
        }
      }, 1000 / SNAP_HZ),
      setInterval(() => {
        this.paint++;
        this.broadcastBytes('p', frame(T.PAINT, this.paint, wallNow(), this.paint % 10 === 0 ? BYTES.paintBig : BYTES.paint), {});
      }, 1000 / PAINT_HZ),
    ];
  }
  override onJoin() {
    BenchRoom.debug.joins++;
  }
  override onDispose() {
    for (const t of this.timers) clearInterval(t);
  }
  override onDrop(client: CClient) {
    BenchRoom.debug.drops++;
    this.allowReconnection(client, 20).catch(() => {});
  }
}

async function benchColyseus(n: number) {
  BenchRoom.inputs = 0;
  BenchRoom.debug = { joins: 0, drops: 0 };
  BenchRoom.measuring = false;
  BenchRoom.n = n;
  const port = 40000 + Math.floor(Math.random() * 10000);
  const server = new Server({ transport: new WebSocketTransport({ pingInterval: 5000, maxPayload: 64 * 1024 }), greet: false, gracefullyShutdown: false });
  server.define('bench', BenchRoom);
  await server.listen(port, '127.0.0.1');
  const t0 = performance.now();
  const rooms: CSdkRoom[] = [];
  const stats: ClientStats[] = [];
  for (let i = 0; i < n; i++) {
    const client = new ColyseusClient(`http://127.0.0.1:${port}`);
    const room = await client.joinOrCreate('bench');
    const st = newClientStats();
    room.reconnection.minUptime = 0;
    room.onMessage('s', (b: Uint8Array) => onClientMessage(st, new Uint8Array(b), true));
    room.onMessage('p', (b: Uint8Array) => onClientMessage(st, new Uint8Array(b), true));
    room.onMessage('pong', (b: Uint8Array) => onClientMessage(st, new Uint8Array(b), true));
    rooms.push(room);
    stats.push(st);
  }
  const connectMs = performance.now() - t0;
  let pingSeq = 0;
  const inputTimer = setInterval(() => {
    rooms.forEach((r, i) => {
      const b = frame(T.INPUT, 0, wallNow(), BYTES.input);
      r.sendBytes('in', b);
      if (stats[i].measuring) {
        stats[i].bytesUp += b.byteLength;
        stats[i].msgsUp++;
      }
    });
  }, 1000 / INPUT_HZ);
  const pingTimer = setInterval(() => {
    pingSeq++;
    for (const r of rooms) r.sendBytes('ping', frame(T.PING, pingSeq, wallNow(), BYTES.ping));
  }, PING_MS);
  await sleep(WARMUP_S * 1000);
  const usage = startUsage();
  BenchRoom.measuring = true;
  for (const s of stats) s.measuring = true;
  const tm = performance.now();
  await sleep(DURATION_S * 1000);
  const secs = (performance.now() - tm) / 1000;
  BenchRoom.measuring = false;
  for (const s of stats) s.measuring = false;
  const u = usage(false);
  const summary = summarize('colyseus-websocket', n, stats, BenchRoom.inputs, secs, u);

  // reconexão (depois do resumo): queda do socket sem fechamento; o SDK reconecta ao mesmo slot
  const st = stats[0];
  st.measuring = true;
  const before = st.snapLast;
  const a = performance.now();
  // o WebSocket global do Node não tem terminate(); 4010 (MAY_TRY_RECONNECT) é uma queda não consentida
  const ws = (rooms[0] as unknown as { connection: { transport: { ws: { terminate?: () => void; close: (c?: number) => void } } } }).connection.transport.ws;
  if (ws.terminate) ws.terminate();
  else ws.close(4010);
  let got: number | null = null;
  while (performance.now() - a < 15000) {
    if (st.snapLast > before + 1) {
      got = performance.now() - a;
      break;
    }
    await sleep(10);
  }
  st.measuring = false;

  clearInterval(inputTimer);
  clearInterval(pingTimer);
  for (const r of rooms) {
    r.reconnection.enabled = false;
    await Promise.race([r.leave(true).catch(() => {}), sleep(1000)]);
  }
  await server.gracefullyShutdown(false).catch(() => {});
  // Colyseus usa só TCP: "lossy" não existe; os pings medem o RTT confiável
  return {
    ...summary,
    conexaoTodosMs: Math.round(connectMs),
    reconexao: { quedaDeSocketMs: got === null ? null : Math.round(got) },
    servidor: { entradas: BenchRoom.debug.joins, quedas: BenchRoom.debug.drops },
  };
}

// ---------------------------------------------------------------- áudio
/** Um participante fala (tom de 48 kHz) e outro ouve; conta quadros e buracos com e sem carga de dados. */
async function audioImpact(withData: boolean) {
  const roomName = `audio-${withData ? 'com' : 'sem'}-${Date.now().toString(36)}`;
  const speaker = new Room();
  const listener = new Room();
  await speaker.connect(LIVEKIT_URL, await lkToken('falante', roomName), { autoSubscribe: false, dynacast: false });
  const arrivals: number[] = [];
  let stop = false;
  const subscribed = new Promise<void>((resolve) => {
    listener.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== TrackKind.KIND_AUDIO) return;
      resolve();
      void (async () => {
        const stream = new AudioStream(track);
        for await (const _f of stream) {
          if (stop) break;
          arrivals.push(performance.now());
        }
      })();
    });
  });
  await listener.connect(LIVEKIT_URL, await lkToken('ouvinte', roomName), { autoSubscribe: true, dynacast: false });
  const source = new AudioSource(48000, 1);
  const track = LocalAudioTrack.createAudioTrack('voz', source);
  const opts = new TrackPublishOptions();
  opts.source = TrackSource.SOURCE_MICROPHONE;
  await speaker.localParticipant!.publishTrack(track, opts);
  let phase = 0;
  const pump = (async () => {
    while (!stop) {
      const f = AudioFrame.create(48000, 1, 480);
      for (let i = 0; i < 480; i++) f.data[i] = Math.round(Math.sin((phase++ / 48000) * 2 * Math.PI * 440) * 8000);
      await source.captureFrame(f);
    }
  })();
  await Promise.race([subscribed, sleep(8000)]);
  // carga de dados de gameplay simultânea (16 jogadores) no mesmo processo e SFU
  const load = withData ? benchLiveKit(16) : null;
  await sleep(4000);
  arrivals.length = 0;
  const a = performance.now();
  await sleep(12000);
  const secs = (performance.now() - a) / 1000;
  const got = arrivals.filter((t) => t >= a);
  const gaps = got.slice(1).map((t, i) => t - got[i]);
  stop = true;
  await pump.catch(() => {});
  await Promise.all([speaker.disconnect(), listener.disconnect()]).catch(() => {});
  if (load) await load;
  const sorted = [...gaps].sort((x, y) => x - y);
  return {
    cenario: withData ? 'voz + dados de 16 jogadores no mesmo SFU' : 'só voz',
    quadrosPorSegundo: Math.round((got.length / secs) * 10) / 10,
    esperadoPorSegundo: 100,
    buracosAcimaDe40ms: gaps.filter((g) => g > 40).length,
    maiorBuracoMs: Math.round(sorted[sorted.length - 1] ?? NaN),
    intervaloP99Ms: Math.round((sorted[Math.floor(sorted.length * 0.99)] ?? NaN) * 10) / 10,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- execução
if (process.env.ROLE === 'lk-clients') await childMain();
else {
  const results: Record<string, unknown>[] = [];
  const env = { node: process.version, cpu: os.cpus()[0]?.model, nucleos: os.cpus().length, duracaoS: DURATION_S, livekitUrl: LIVEKIT_URL, livekitPid: LK_PID, lkProcessosDeClientes: LK_PROCS, snapshotsConfiaveis: SNAP_RELIABLE };
  console.log(JSON.stringify({ ambiente: env }));
  for (const n of SIZES_LIST) {
    const only = process.env.ONLY;
    for (const run of [benchColyseus, benchLiveKit].filter((f) => !only || (only === 'colyseus' ? f === benchColyseus : f === benchLiveKit))) {
      const r = await run(n);
      console.log(JSON.stringify(r));
      results.push(r);
      await sleep(1500);
    }
  }
  const audio = process.env.AUDIO === '0' ? [] : [await audioImpact(false), await audioImpact(true)];
  for (const a of audio) console.log(JSON.stringify(a));
  mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
  const file = new URL(`../results/bench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify({ ambiente: env, resultados: results, audio }, null, 2));
  console.log('resultado salvo em', file.pathname);
  await dispose();
  process.exit(0);
}

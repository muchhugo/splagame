// Pilha PRÓPRIA e de curta duração para testes de navegador que não precisam do host de
// laboratório: servidor de partidas + cliente Vite em portas livres, com segredo de
// desenvolvimento gerado na hora (nada fixo no código). A credencial que o jogo pediria ao
// backend do laboratório é respondida pelo próprio teste (page.route), assinada com esse
// segredo. `stop()` encerra os dois processos.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = new URL('..', import.meta.url).pathname;
const b64u = (b) => Buffer.from(b).toString('base64url');

export async function startStack({ serverPort = 2690, gamePort = 5290, labPort = 3290, roundSeconds = 120 } = {}) {
  const secret = randomBytes(32).toString('hex');
  const gameUrl = `http://localhost:${gamePort}/`;
  const serverUrl = `http://localhost:${serverPort}`;
  const env = { ...process.env, NODE_ENV: 'development', MATCH_AUTH_MODE: 'dev-hs256', DEV_MATCH_CREDENTIAL_SECRET: secret, GAME_SERVER_PORT: String(serverPort), GAME_SERVER_HOST: '127.0.0.1', GAME_ALLOWED_ORIGINS: `http://localhost:${gamePort},http://127.0.0.1:${gamePort}`, ROUND_DURATION_SECONDS: String(roundSeconds), CORREIO_DURATION_SECONDS: String(Math.max(45, roundSeconds)), RESULTS_FILE: `/tmp/borrifo-stack-${serverPort}.jsonl`, LOG_LEVEL: 'warn', LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '', VITE_GAME_SERVER_URL: serverUrl, VITE_LAB_BACKEND_URL: `http://localhost:${labPort}`, VITE_ALLOWED_HOST_ORIGINS: `http://localhost:${gamePort}` };
  const procs = [
    spawn('npx', ['tsx', 'src/main.ts'], { cwd: `${ROOT}apps/game-server`, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true }),
    spawn('npx', ['vite', '--port', String(gamePort), '--strictPort'], { cwd: `${ROOT}apps/game-client`, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true }),
  ];
  let log = '';
  for (const p of procs) {
    p.stdout.on('data', (d) => (log += d));
    p.stderr.on('data', (d) => (log += d));
  }
  // backend de credencial mínimo (só o endpoint standalone de desenvolvimento, só para a
  // origem do jogo desta pilha): os testes que usam openStandalone funcionam sem o host Next
  const gameOrigin = `http://localhost:${gamePort}`;
  const lab = createServer((req, res) => {
    const cors = { 'access-control-allow-origin': gameOrigin, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    if (req.method !== 'POST' || req.url !== '/api/lab/standalone-credential' || req.headers.origin !== gameOrigin) return res.writeHead(404, cors).end();
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      try {
        const { userId, activitySessionId } = JSON.parse(body);
        if (typeof userId !== 'string' || typeof activitySessionId !== 'string') throw new Error('entrada');
        res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ credential: credentialFor(userId, activitySessionId), expiresAt: Date.now() + 120_000, gameServerUrl: serverUrl }));
      } catch {
        res.writeHead(400, cors).end();
      }
    });
  });
  await new Promise((r) => lab.listen(labPort, '127.0.0.1', r));
  const stop = () => {
    lab.close();
    for (const p of procs) {
      try {
        process.kill(-p.pid, 'SIGTERM');
      } catch {
        /* já saiu */
      }
    }
  };
  process.on('exit', stop);
  const up = async (url) => {
    for (let i = 0; i < 120; i++) {
      try {
        const r = await fetch(url);
        if (r.status < 500) return;
      } catch {
        /* ainda subindo */
      }
      await sleep(500);
    }
    stop();
    throw new Error(`pilha não subiu (${url}):\n${log.slice(-2000)}`);
  };
  await up(`${serverUrl}/healthz`);
  await up(gameUrl);
  /** Credencial HS256 de DESENVOLVIMENTO, com o segredo desta pilha. */
  const credentialFor = (userId, activitySessionId, name = userId) => {
    const now = Math.floor(Date.now() / 1000);
    const head = b64u(JSON.stringify({ alg: 'HS256' }));
    const body = b64u(JSON.stringify({ sid: activitySessionId, name, cap: { join: true, create: true }, sub: userId, iss: 'trivo-activities-lab:dev', aud: 'borrifo-match-server', iat: now, exp: now + 120, jti: randomUUID() }));
    const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
    return `${head}.${body}.${sig}`;
  };
  /** Mantido por compatibilidade: o backend de credencial da pilha já responde. */
  const serveCredentials = async () => {};
  return { gameUrl, serverUrl, stop, serveCredentials, credentialFor };
}

// Uso direto: `node e2e/stack.mjs` sobe a pilha e imprime as URLs; Ctrl+C (ou SIGTERM) encerra.
if (import.meta.url === `file://${process.argv[1]}`) {
  const st = await startStack({ serverPort: Number(process.env.PORTA_SERVIDOR ?? 2690), gamePort: Number(process.env.PORTA_JOGO ?? 5290), labPort: Number(process.env.PORTA_LAB ?? 3290), roundSeconds: Number(process.env.ROUND_DURATION_SECONDS ?? 40) });
  console.log(JSON.stringify({ gameUrl: st.gameUrl, serverUrl: st.serverUrl }));
  const bye = () => {
    st.stop();
    process.exit(0);
  };
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
  setInterval(() => {}, 1 << 30);
}

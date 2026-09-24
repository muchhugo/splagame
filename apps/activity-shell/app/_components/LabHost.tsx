'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HostRequestError, randomNonce, type ActivityContext, type MatchCredentialResponse } from '@borrifo/activity-sdk';
import { GAME_ID, GAME_NAME } from '@borrifo/game-contracts';
import { buildActivitySrc, newActivitySessionId } from '@/lib/activityUrl';
import { getLeakCounters, getServerLeakCounters, LabActivityHost, notifyLeakCounters, subscribeLeakCounters, trackListener } from '@/lib/client/trackedHost';
import { LabVoiceController } from '@/lib/client/voice';
import { ACTIVITY_SESSION_ID_RE, isChannelMember, LAB_CHANNEL_ID, LAB_COMMUNITY_ID, LAB_ROSTER, type LabUser } from '@/lib/roster';
import { EventLog, type LogLevel, type LogLine } from './EventLog';
import { VoicePanel } from './VoicePanel';

export interface LabHostProps {
  activityUrl: string;
  activityOrigin: string;
  voiceConfigured: boolean;
  initialUser: LabUser | null;
  isProduction: boolean;
  standaloneEnabled: boolean;
  labGameOrigin: string;
  problems: string[];
}

interface OpenActivity {
  key: number;
  sessionId: string;
  nonce: string;
}

const LOG_CAP = 100;
const DEFAULT_SESSION = 'sessao-dev-1';
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function timestamp(): string {
  const d = new Date();
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

async function readError(res: Response): Promise<{ code: string; message: string }> {
  const data = (await res.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
  return {
    code: typeof data?.code === 'string' ? data.code.slice(0, 64) : `http_${res.status}`,
    message: typeof data?.error === 'string' ? data.error : `Falha HTTP ${res.status}`,
  };
}

export default function LabHost(props: LabHostProps) {
  const { activityUrl, activityOrigin, voiceConfigured } = props;
  const [user, setUser] = useState<LabUser | null>(props.initialUser);
  const [sessionInput, setSessionInput] = useState(DEFAULT_SESSION);
  const [open, setOpen] = useState<OpenActivity | null>(null);
  const [closing, setClosing] = useState(false);
  const [status, setStatus] = useState('fechada');
  const [log, setLog] = useState<LogLine[]>([]);
  const [loginBusy, setLoginBusy] = useState(false);
  const [stress, setStress] = useState<{ running: boolean; cycle: number }>({ running: false, cycle: 0 });
  const [invite, setInvite] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<LabActivityHost | null>(null);
  const openRef = useRef<OpenActivity | null>(null);
  const closingRef = useRef(false);
  const userRef = useRef(user);
  const sessionInputRef = useRef(sessionInput);
  const seqRef = useRef(0);
  const logSeqRef = useRef(0);
  const stressCancelRef = useRef(false);
  const stressRunningRef = useRef(false);

  useEffect(() => {
    userRef.current = user;
  }, [user]);
  useEffect(() => {
    sessionInputRef.current = sessionInput;
  }, [sessionInput]);

  const appendLog = useCallback((level: LogLevel, text: string) => {
    const line: LogLine = { id: ++logSeqRef.current, time: timestamp(), level, text };
    setLog((prev) => (prev.length >= LOG_CAP ? [...prev.slice(prev.length - LOG_CAP + 1), line] : [...prev, line]));
  }, []);

  // ---- Voz (LiveKit no host; a Atividade só vê VoiceState) ----
  const voiceRef = useRef<LabVoiceController | null>(null);
  if (voiceRef.current === null) {
    voiceRef.current = new LabVoiceController({
      configured: voiceConfigured,
      log: (text, level = 'info') => appendLog(level, text),
      fetchToken: async () => {
        const res = await fetch('/api/lab/livekit-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ viewerId: userRef.current?.id }),
          cache: 'no-store',
        });
        if (!res.ok) throw new Error((await readError(res)).message);
        const data = (await res.json()) as { token: string; url: string };
        return { token: data.token, url: data.url };
      },
    });
  }
  const voice = voiceRef.current;
  const voiceState = useSyncExternalStore(voice.subscribe, voice.getState, voice.getState);
  const voiceExtras = useSyncExternalStore(voice.subscribe, voice.getExtras, voice.getExtras);
  const leaks = useSyncExternalStore(subscribeLeakCounters, getLeakCounters, getServerLeakCounters);

  // Todo VoiceState novo vai para a Atividade aberta (dados puros, nunca o Room).
  const lastVoiceLog = useRef('');
  useEffect(() => {
    hostRef.current?.setVoice(voiceState);
    const summary = `${voiceState.reason}/${voiceState.connected ? 'conectado' : 'desconectado'}/${voiceState.muted ? 'mudo' : 'microfone ligado'}`;
    if (summary !== lastVoiceLog.current) {
      lastVoiceLog.current = summary;
      appendLog('info', `estado de voz: ${summary}${hostRef.current ? ' (enviado à Atividade)' : ''}`);
    }
  }, [voiceState, appendLog]);

  // ---- Estado inicial: ?sid= na URL preenche a sessão (convites do laboratório) ----
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const sid = new URLSearchParams(window.location.search).get('sid');
    if (sid && ACTIVITY_SESSION_ID_RE.test(sid)) setSessionInput(sid);
    appendLog('info', `host de desenvolvimento pronto (Atividade em ${activityOrigin})`);
  }, [appendLog, activityOrigin]);

  // ---- Credencial de partida (backend do laboratório) ----
  const requestCredential = useCallback(
    async (activitySessionId: string, viewerId: string): Promise<MatchCredentialResponse> => {
      const res = await fetch('/api/lab/match-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activitySessionId, viewerId }),
        cache: 'no-store',
      });
      if (!res.ok) {
        const err = await readError(res);
        appendLog('error', `credencial recusada (${res.status} ${err.code}): ${err.message}`);
        throw new HostRequestError(err.code, err.message);
      }
      const data = (await res.json()) as MatchCredentialResponse;
      // Nunca registrar o token.
      appendLog('info', `credencial de partida emitida (sessão ${activitySessionId}, expira em ${Math.round((data.expiresAt - Date.now()) / 1000)}s)`);
      return data;
    },
    [appendLog],
  );

  // ---- Abrir / fechar ----
  const closeActivity = useCallback(
    async (reason: string, notifyActivity: boolean) => {
      if (!openRef.current || closingRef.current) return;
      closingRef.current = true;
      setClosing(true);
      const host = hostRef.current;
      appendLog('info', `fechando a Atividade (${reason})…`);
      if (notifyActivity) host?.requestClose(reason);
      await delay(300);
      host?.destroy();
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      openRef.current = null;
      setOpen(null);
      setStatus('fechada');
      closingRef.current = false;
      setClosing(false);
    },
    [appendLog],
  );
  const closeRef = useRef(closeActivity);
  useEffect(() => {
    closeRef.current = closeActivity;
  }, [closeActivity]);

  const openActivity = useCallback((): boolean => {
    const viewer = userRef.current;
    if (!viewer) {
      appendLog('warn', 'escolha um usuário de desenvolvimento antes de abrir a Atividade');
      return false;
    }
    if (openRef.current || closingRef.current) {
      appendLog('warn', 'já existe uma Atividade aberta');
      return false;
    }
    if (activityOrigin === window.location.origin) {
      // Com a mesma origem, allow-scripts + allow-same-origin anularia o sandbox do iframe.
      appendLog('error', 'ACTIVITY_URL tem a mesma origem do host; recusado (o sandbox do iframe exige origens diferentes)');
      return false;
    }
    const sessionId = sessionInputRef.current.trim();
    if (!ACTIVITY_SESSION_ID_RE.test(sessionId)) {
      appendLog('error', 'id de sessão inválido: use a-z, 0-9 e hífen (4 a 64 caracteres)');
      return false;
    }
    const next: OpenActivity = { key: ++seqRef.current, sessionId, nonce: randomNonce() };
    openRef.current = next;
    setOpen(next);
    setStatus('carregando');
    appendLog('info', `abrindo ${GAME_NAME} na sessão ${sessionId} como ${viewer.displayName}`);
    return true;
  }, [appendLog, activityOrigin]);

  // Monta iframe + ActivityHost para cada abertura; a limpeza remove tudo.
  useEffect(() => {
    if (!open) return;
    const slot = slotRef.current;
    const viewer = userRef.current;
    if (!slot || !viewer) return;

    const context: ActivityContext = {
      protocolVersion: 1,
      activityId: GAME_ID,
      activitySessionId: open.sessionId,
      channelId: LAB_CHANNEL_ID,
      communityId: LAB_COMMUNITY_ID,
      viewer: { id: viewer.id, displayName: viewer.displayName },
      capabilities: {
        canCreateMatch: true,
        canJoinMatch: isChannelMember(viewer.id),
        canInvite: true,
        canUseVoice: voiceConfigured,
      },
      locale: 'pt-BR',
      theme: 'dark',
      hostKind: 'lab-dev',
    };

    let ready = false;
    const host: LabActivityHost = new LabActivityHost({
      activityOrigin,
      nonce: open.nonce,
      context,
      voice: voice.getState(),
      handlers: {
        onReady: (p) => {
          ready = true;
          appendLog('activity', `pronta: ${p.gameId} v${p.version}`);
          setStatus('pronta');
          const r = slot.getBoundingClientRect();
          host.resize(r.width, r.height);
          host.setVisibility(!document.hidden);
          host.setVoice(voice.getState());
        },
        onLoading: (p) => appendLog('activity', `carregando ${Math.round(p.progress * 100)}% — ${p.label}`),
        onError: (p) => appendLog(p.fatal ? 'error' : 'warn', `erro da Atividade [${p.code}]${p.fatal ? ' (fatal)' : ''}: ${p.message}`),
        onSessionState: (p) => {
          appendLog('activity', `estado da sessão: ${p.state}${p.matchId ? ` (partida ${p.matchId})` : ''}`);
          setStatus(p.state);
        },
        onClosed: () => appendLog('activity', 'a Atividade confirmou o fechamento'),
        onRejectedMessage: (reason) => appendLog('warn', `mensagem rejeitada pelo host: ${reason}`),
        requestMatchCredential: (p) => requestCredential(p.activitySessionId, viewer.id),
        requestInvite: async () => {
          const link = `${window.location.origin}/?sid=${encodeURIComponent(open.sessionId)}`;
          const text = `Convite do Laboratório de Atividades (dev, não é o Trivo): jogue ${GAME_NAME} no #${LAB_CHANNEL_ID}, sessão "${open.sessionId}". Abra ${link}`;
          setInvite(text);
          try {
            await navigator.clipboard.writeText(text);
            appendLog('info', `convite copiado para a área de transferência (sessão ${open.sessionId})`);
            return { shared: true };
          } catch {
            appendLog('warn', 'não foi possível copiar o convite automaticamente; o texto está visível acima da Atividade');
            return { shared: false };
          }
        },
        requestFullscreen: async (p) => {
          const stage = stageRef.current;
          try {
            if (p.enter && !document.fullscreenElement && stage) await stage.requestFullscreen();
            else if (!p.enter && document.fullscreenElement) await document.exitFullscreen();
          } catch {
            throw new HostRequestError('fullscreen_denied', 'O navegador recusou a tela cheia.');
          }
          return { fullscreen: !!document.fullscreenElement };
        },
        requestClose: (p) => {
          appendLog('activity', `a Atividade pediu para fechar (${p.reason})`);
          void closeRef.current(`atividade:${p.reason}`, false);
        },
        voiceAction: (p) => voice.handleActivityAction(p.action),
      },
    });

    const iframe = document.createElement('iframe');
    iframe.title = `${GAME_NAME} — Atividade`;
    iframe.dataset.borrifoActivity = String(open.key);
    // `allow-same-origin` só é aceitável porque a Atividade é servida de OUTRA origem
    // (porta 5173 ≠ 3000 do host): ela mantém a própria origem (storage, WebGL, workers)
    // sem ganhar acesso ao DOM, cookies ou storage do host. Se um dia fossem da mesma
    // origem, allow-scripts + allow-same-origin anularia o sandbox.
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock');
    // Sem camera/microphone: a voz pertence ao host.
    iframe.setAttribute('allow', 'fullscreen; autoplay; gamepad');
    iframe.className = 'activity-frame';
    // O handshake é armado ANTES de o iframe carregar.
    host.attachIframe(iframe);
    slot.appendChild(iframe);
    iframe.src = buildActivitySrc(activityUrl, open.nonce, open.sessionId);
    hostRef.current = host;
    notifyLeakCounters();

    const onVisibility = () => host.setVisibility(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    const offVisibility = trackListener(() => document.removeEventListener('visibilitychange', onVisibility));

    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) host.resize(r.width, r.height);
    });
    ro.observe(slot);
    const offResize = trackListener(() => ro.disconnect());

    // Diagnóstico: o jogo não respondeu ao handshake (não está rodando em ACTIVITY_URL?).
    const watchdog = setTimeout(() => {
      if (ready) return;
      appendLog(
        'warn',
        host.connected
          ? 'a Atividade fez o handshake mas ainda não enviou ACTIVITY_READY'
          : `sem handshake da Atividade após 10 s — o jogo está rodando em ${activityOrigin}?`,
      );
    }, 10_000);

    return () => {
      clearTimeout(watchdog);
      offVisibility();
      offResize();
      host.destroy();
      iframe.remove();
      if (hostRef.current === host) hostRef.current = null;
      notifyLeakCounters();
    };
  }, [open, activityOrigin, activityUrl, voiceConfigured, voice, appendLog, requestCredential]);

  // ---- Teste de vazamento ----
  const runStress = useCallback(async () => {
    if (stressRunningRef.current) {
      stressCancelRef.current = true;
      return;
    }
    stressRunningRef.current = true;
    stressCancelRef.current = false;
    setStress({ running: true, cycle: 0 });
    appendLog('info', 'teste de vazamento: abrir/fechar 10×');
    if (openRef.current) await closeActivity('stress_reset', true);
    for (let i = 1; i <= 10 && !stressCancelRef.current; i++) {
      if (!openActivity()) break;
      await delay(1500);
      await closeActivity('stress_test', true);
      await delay(150);
      const c = getLeakCounters();
      appendLog('info', `ciclo ${i}/10 — hosts ativos: ${c.hosts} · iframes: ${c.iframes} · ouvintes: ${c.listeners}`);
      setStress({ running: true, cycle: i });
    }
    const c = getLeakCounters();
    const clean = c.hosts === 0 && c.iframes === 0 && c.listeners === 0;
    appendLog(clean ? 'info' : 'error', `teste de vazamento ${stressCancelRef.current ? 'interrompido' : 'concluído'}: hosts ativos ${c.hosts}, iframes ${c.iframes}, ouvintes ${c.listeners}${clean ? ' (ok)' : ' — possível vazamento!'}`);
    stressRunningRef.current = false;
    setStress((s) => ({ running: false, cycle: s.cycle }));
  }, [appendLog, closeActivity, openActivity]);

  // ---- Sessão de desenvolvimento ----
  const chooseUser = useCallback(
    async (userId: string) => {
      setLoginBusy(true);
      try {
        if (!userId) {
          await fetch('/api/lab/session', { method: 'DELETE' });
          setUser(null);
          appendLog('info', 'sessão de desenvolvimento encerrada');
          return;
        }
        const res = await fetch('/api/lab/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
          cache: 'no-store',
        });
        if (!res.ok) {
          const err = await readError(res);
          appendLog('error', `login de desenvolvimento falhou: ${err.message}`);
          return;
        }
        const data = (await res.json()) as { user: LabUser; channel: { member: boolean } };
        setUser(data.user);
        appendLog('info', `sessão de desenvolvimento: ${data.user.displayName}${data.channel.member ? '' : ` (sem acesso ao #${LAB_CHANNEL_ID})`}`);
      } finally {
        setLoginBusy(false);
      }
    },
    [appendLog],
  );

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch {
      appendLog('warn', 'o navegador recusou a tela cheia');
    }
  }, [appendLog]);

  const isOpen = open !== null;
  const userLocked = isOpen || closing || voiceState.connected || voiceExtras.busy || stress.running || loginBusy;
  const members = LAB_ROSTER.filter((u) => isChannelMember(u.id));
  const outsiders = LAB_ROSTER.filter((u) => !isChannelMember(u.id));
  const speaking = new Set(voiceState.participants.filter((p) => p.speaking).map((p) => p.id));
  const inCall = new Set(voiceState.participants.map((p) => p.id));

  return (
    <div className="lab">
      <header className="lab-header">
        <span className="dev-badge">DEV</span>
        <div>
          <h1>Laboratório de Atividades — host de desenvolvimento (não é o Trivo)</h1>
          <p className="muted">
            Host fictício para testar a Atividade {GAME_NAME}. Usuários, canal e comunidade são de mentira; credenciais emitidas aqui só valem em
            desenvolvimento.
          </p>
        </div>
      </header>

      {props.problems.length > 0 && (
        <ul className="warnings" role="status">
          {props.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="lab-grid">
        <aside className="panel sidebar" aria-label="Canal">
          <div className="community">{LAB_COMMUNITY_ID}</div>
          <div className="channel-name">#{LAB_CHANNEL_ID}</div>

          <label className="field">
            <span>Usuário de desenvolvimento</span>
            <select value={user?.id ?? ''} disabled={userLocked} onChange={(e) => void chooseUser(e.target.value)}>
              <option value="">— escolha —</option>
              {LAB_ROSTER.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                  {isChannelMember(u.id) ? '' : ' (sem acesso ao canal)'}
                </option>
              ))}
            </select>
          </label>
          {userLocked && user && <p className="hint">Feche a Atividade e saia da chamada para trocar de usuário.</p>}
          <p className="hint">
            O cookie de sessão é compartilhado entre abas. Para dois usuários no mesmo navegador, use uma janela anônima ou abra a segunda aba em{' '}
            <code>127.0.0.1:3000</code>.
          </p>

          <h3>Membros ({members.length})</h3>
          <ul className="members">
            {members.map((u) => (
              <li key={u.id} className={u.id === user?.id ? 'me' : undefined}>
                <span className={`dot${speaking.has(u.id) ? ' speaking' : inCall.has(u.id) ? ' in-call' : ''}`} aria-hidden />
                {u.displayName}
                {u.id === user?.id && <em> (você)</em>}
                {inCall.has(u.id) && <small className="tag">na chamada</small>}
              </li>
            ))}
          </ul>
          <h3>Sem acesso ao canal</h3>
          <ul className="members outsiders">
            {outsiders.map((u) => (
              <li key={u.id} className={u.id === user?.id ? 'me' : undefined}>
                <span className="dot" aria-hidden />
                {u.displayName}
                {u.id === user?.id && <em> (você)</em>}
                <small className="tag deny">403</small>
              </li>
            ))}
          </ul>

          <div className="meta">
            <div>
              Atividade: <code>{activityOrigin}</code>
            </div>
            <div>
              Rota standalone:{' '}
              {props.standaloneEnabled ? (
                <>
                  habilitada para <code>{props.labGameOrigin}</code>
                </>
              ) : (
                'desabilitada'
              )}
            </div>
          </div>
        </aside>

        <main className="panel main">
          <div className="toolbar">
            <label className="field inline">
              <span>Sessão</span>
              <input
                value={sessionInput}
                onChange={(e) => setSessionInput(e.target.value.toLowerCase())}
                disabled={isOpen || stress.running}
                spellCheck={false}
                maxLength={64}
                aria-label="Id da sessão da Atividade"
              />
            </label>
            <button type="button" onClick={() => setSessionInput(newActivitySessionId())} disabled={isOpen || stress.running}>
              Nova sessão
            </button>
            <button type="button" className="primary" onClick={() => openActivity()} disabled={!user || isOpen || closing || stress.running || props.isProduction}>
              Abrir {GAME_NAME}
            </button>
            <button type="button" onClick={() => void closeActivity('host_button', true)} disabled={!isOpen || closing || stress.running}>
              Fechar Atividade
            </button>
            <button type="button" onClick={() => void toggleFullscreen()} disabled={!isOpen}>
              Tela cheia
            </button>
            <button type="button" className={stress.running ? 'danger' : undefined} onClick={() => void runStress()} disabled={!user || (!stress.running && (isOpen || closing))}>
              {stress.running ? `Parar teste (${stress.cycle}/10)` : 'Abrir/fechar 10×'}
            </button>
          </div>

          <div className="counters" aria-live="polite">
            <span>hosts ativos: {leaks.hosts}</span>
            <span>iframes: {leaks.iframes}</span>
            <span>ouvintes: {leaks.listeners}</span>
            <span>
              estado: <strong>{status}</strong>
            </span>
            {open && (
              <span>
                sessão: <code>{open.sessionId}</code>
              </span>
            )}
          </div>

          {invite && (
            <div className="invite">
              <span>{invite}</span>
              <button type="button" onClick={() => setInvite(null)} aria-label="Dispensar convite">
                ×
              </button>
            </div>
          )}

          <div className="stage" ref={stageRef}>
            {/* O React nunca renderiza filhos no slot: o iframe é criado e removido pelo efeito. */}
            <div className="slot" ref={slotRef} />
            {!isOpen && (
              <div className="placeholder">
                <strong>{GAME_NAME}</strong>
                <span>{user ? 'Escolha a sessão e clique em “Abrir”.' : 'Escolha um usuário de desenvolvimento para começar.'}</span>
              </div>
            )}
          </div>
        </main>

        <aside className="side-right">
          <VoicePanel
            configured={voiceConfigured}
            state={voiceState}
            extras={voiceExtras}
            canJoin={!!user && isChannelMember(user.id)}
            loggedIn={!!user}
            onJoin={() => void voice.join()}
            onLeave={() => void voice.leave()}
            onMic={(enabled) => void voice.setMicEnabled(enabled, true)}
            onStartAudio={() => void voice.startAudio()}
          />
          <EventLog lines={log} onClear={() => setLog([])} />
        </aside>
      </div>
    </div>
  );
}

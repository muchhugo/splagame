import { GAME_ID, GAME_VERSION, C2S, paintContextTag, type LobbyState, type TeamId, type WeaponId } from '@borrifo/game-contracts';
import { ActivityRequestError, MatchCredentialResponseSchema, type ActivityClient } from '@borrifo/activity-sdk';
import { HostVoiceAdapter, type VoiceAdapter } from '@borrifo/voice-adapter';
import { DEFAULT_MAP_ID, MAPS, computeMapHash } from '@borrifo/game-content';
import { CLIENT_CONFIG } from '../config';
import { GameRuntime, WebGL2UnavailableError, detectWebGL2 } from '../game/GameRuntime';
import { MatchConnection } from '../net/MatchConnection';
import { hudStore } from '../game/hud';
import { pushNotice, showError, uiStore } from './uiStore';

const MAP = MAPS[DEFAULT_MAP_ID];
const MAP_HASH = computeMapHash(MAP);

/**
 * Cola entre host (bridge da Atividade), servidor de partidas e runtime 3D.
 * Não contém regras de jogo: o servidor decide; o runtime apresenta.
 */
export class AppController {
  runtime: GameRuntime | null = null;
  conn: MatchConnection | null = null;
  voice: VoiceAdapter | null = null;
  readonly canvas: HTMLCanvasElement;
  private offs: Array<() => void> = [];
  private closed = false;
  private rejoinAttempts = 0;
  private lastLobby: LobbyState | null = null;
  private currentRound = 0;

  constructor(private readonly bridge: ActivityClient) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    this.canvas.setAttribute('aria-label', 'Arena do Borrifo');
    // o canvas fica atrás de toda a interface React
    document.body.prepend(this.canvas);
  }

  async start() {
    const b = this.bridge;
    uiStore.set({ context: b.context, voice: b.voice });
    this.voice = new HostVoiceAdapter(b);
    this.offs.push(this.voice.subscribe((v) => uiStore.set({ voice: v })));
    this.offs.push(b.on('ACTIVITY_CONTEXT_UPDATED', (p) => uiStore.set({ context: p.context })));
    this.offs.push(b.on('ACTIVITY_VISIBILITY_CHANGED', (p) => this.runtime?.setVisible(p.visible)));
    this.offs.push(b.on('ACTIVITY_SUSPEND', () => this.runtime?.setVisible(false)));
    this.offs.push(b.on('ACTIVITY_RESUME', () => this.runtime?.setVisible(true)));
    this.offs.push(b.on('ACTIVITY_CLOSE_REQUESTED', () => void this.close()));
    const onHidden = () => this.runtime?.setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onHidden);
    this.offs.push(() => document.removeEventListener('visibilitychange', onHidden));

    if (!detectWebGL2()) {
      b.send('ACTIVITY_ERROR', { code: 'webgl2_unavailable', message: 'WebGL2 indisponível neste ambiente', fatal: true });
      showError({ title: 'Seu navegador não consegue abrir o Borrifo', message: 'Este jogo precisa de WebGL2 (aceleração gráfica). Atualize o navegador ou ative a aceleração de hardware e tente de novo.', actions: ['close', 'reload'] });
      return;
    }
    const progress = (p: number, label: string) => {
      uiStore.set({ boot: { progress: p, label } });
      b.send('ACTIVITY_LOADING_PROGRESS', { progress: Math.min(1, p), label: label.slice(0, 80) });
    };
    b.send('ACTIVITY_SESSION_STATE_CHANGED', { state: 'loading' });
    try {
      this.runtime = await GameRuntime.create(this.canvas, MAP, {
        sendInput: (w) => this.conn?.sendInput(w),
        onMapToggle: (open) => uiStore.set({ mapOpen: open }),
        onMenuRequested: () => uiStore.set({ menuOpen: true }),
        onPointerLock: (locked) => {
          uiStore.set({ pointerLocked: locked });
          // Esc libera o ponteiro: abre o menu sem pausar a partida dos demais
          if (!locked && uiStore.get().screen === 'match' && hudStore.get().phase === 'running') uiStore.set({ menuOpen: true });
        },
        onUserGesture: () => void this.unlockAudio(),
        playerName: (id) => this.lastLobby?.players.find((p) => p.playerId === id)?.displayName ?? `#${id}`,
        requestPaintResync: (roundId, reason) => this.conn?.send(C2S.PAINT_RESYNC, { roundId, reason: reason.slice(0, 40) }),
      }, progress);
      uiStore.set({ sceneReady: true });
    } catch (e) {
      const webgl = e instanceof WebGL2UnavailableError;
      b.send('ACTIVITY_ERROR', { code: webgl ? 'webgl2_unavailable' : 'runtime_init_failed', message: String((e as Error).message).slice(0, 300), fatal: true });
      showError({ title: 'Não foi possível preparar a arena', message: webgl ? 'Este jogo precisa de WebGL2.' : `Falha ao iniciar o jogo: ${(e as Error).message}`, actions: ['reload', 'close'] });
      return;
    }
    await this.connect();
  }

  private async connect() {
    uiStore.set({ screen: 'connecting', connection: 'connecting' });
    const ctx = this.bridge.context;
    try {
      const raw = await this.bridge.request('ACTIVITY_REQUEST_MATCH_CREDENTIAL', { activitySessionId: ctx.activitySessionId });
      const cred = MatchCredentialResponseSchema.parse(raw);
      this.conn?.leave();
      this.conn = new MatchConnection(cred.gameServerUrl || CLIENT_CONFIG.gameServerUrl, this.handlers());
      await this.conn.join(ctx.activitySessionId, cred.credential, MAP_HASH);
      this.rejoinAttempts = 0;
      this.bridge.send('ACTIVITY_READY', { gameId: GAME_ID, version: GAME_VERSION });
    } catch (e) {
      const code = e instanceof ActivityRequestError ? e.code : (e as { code?: number }).code;
      const msg = (e as Error).message ?? String(e);
      const forbidden = code === 'forbidden' || code === 401 || code === 403;
      this.bridge.send('ACTIVITY_ERROR', { code: String(code ?? 'join_failed').slice(0, 64), message: msg.slice(0, 300), fatal: false });
      showError({
        title: forbidden ? 'Sem acesso a esta partida' : 'Não conseguimos entrar na partida',
        message: forbidden ? `Você não tem permissão para entrar nesta sessão. (${msg})` : `O servidor de partidas não respondeu como esperado: ${msg}`,
        actions: forbidden ? ['close'] : ['retry', 'close'],
      });
    }
  }

  retry() {
    uiStore.set({ error: null });
    void this.connect();
  }

  private handlers() {
    const rt = () => this.runtime!;
    return {
      onWelcome: (m: import('@borrifo/game-contracts').WelcomeMessage) => {
        uiStore.set({ welcome: m });
        if (m.map.hash !== MAP_HASH) showError({ title: 'Versão incompatível', message: 'O mapa do servidor é diferente do seu. Recarregue a Atividade.', actions: ['reload', 'close'] });
        if (m.resumed) pushNotice('Conexão recuperada', 'good');
      },
      onLobby: (l: LobbyState) => this.onLobby(l),
      onRoundLoading: (m: import('@borrifo/game-contracts').RoundLoadingMessage) => {
        this.currentRound = m.roundId;
        const lobby = this.lastLobby;
        const me = uiStore.get().welcome?.playerId ?? 0;
        if (lobby) rt().setRoster(lobby.players, me);
        rt().beginRound(m.roundId, paintContextTag(m.matchId, m.mapHash));
        uiStore.set({ result: null, menuOpen: false });
        this.conn?.send(C2S.LOADED, { roundId: m.roundId, mapHash: MAP_HASH });
      },
      onRoundCountdown: () => {
        rt().setPhase('countdown', 3000);
      },
      onRoundStart: (m: import('@borrifo/game-contracts').RoundStartMessage) => {
        rt().setPhase('running', m.durationMs);
        this.bridge.send('ACTIVITY_SESSION_STATE_CHANGED', { state: 'in_match', matchId: this.lastLobby?.matchId });
      },
      onRoundResult: (r: import('@borrifo/game-contracts').RoundResult) => {
        uiStore.set({ result: r });
        rt().setPhase('finishing', null);
        this.bridge.send('ACTIVITY_SESSION_STATE_CHANGED', { state: 'results', matchId: r.matchId });
      },
      onSnapshot: (m: import('@borrifo/game-contracts').SnapshotMessage, at: number) => rt().onSnapshot(m, at),
      onPaintSnapshot: (s: import('@borrifo/game-contracts').PaintSnapshotWire) => rt().onPaintSnapshot(s),
      onPaintDelta: (d: import('@borrifo/game-contracts').PaintDeltaWire) => rt().onPaintDelta(d),
      onNotice: (n: import('@borrifo/game-contracts').NoticeMessage) => pushNotice(n.message, n.code === 'late_join_waiting' ? 'info' : 'warn', 4500),
      onConnectionState: (s: 'connected' | 'reconnecting' | 'lost', detail?: string) => this.onConnectionState(s, detail),
      onRtt: (ms: number) => uiStore.set({ rttMs: ms }),
    };
  }

  private onLobby(l: LobbyState) {
    this.lastLobby = l;
    const myId = uiStore.get().welcome?.playerId ?? 0;
    const me = l.players.find((p) => p.playerId === myId);
    this.runtime?.setRoster(l.players, myId);
    let screen = uiStore.get().screen;
    if (screen !== 'error' && screen !== 'closed') {
      if (l.phase === 'lobby') screen = 'lobby';
      else if (l.phase === 'results') screen = 'results';
      else screen = me?.inRound ? 'match' : 'waiting';
    }
    if (l.phase === 'lobby' && uiStore.get().screen !== 'lobby') this.bridge.send('ACTIVITY_SESSION_STATE_CHANGED', { state: 'lobby', matchId: l.matchId });
    if (l.phase === 'lobby' || l.phase === 'results') this.runtime?.input.releaseLock();
    uiStore.set({ lobby: l, screen });
    if (l.lastResult && l.phase === 'results' && !uiStore.get().result) uiStore.set({ result: l.lastResult });
    this.runtime?.setPhase(l.phase, l.phaseRemainingMs);
  }

  private onConnectionState(s: 'connected' | 'reconnecting' | 'lost', detail?: string) {
    uiStore.set({ connection: s === 'lost' ? 'lost' : s });
    if (s === 'reconnecting') {
      pushNotice('Conexão instável — reconectando…', 'warn', 3000);
      this.bridge.send('ACTIVITY_SESSION_STATE_CHANGED', { state: 'reconnecting' });
    }
    if (s === 'lost' && !this.closed) {
      if (detail === 'replaced') {
        showError({ title: 'Sessão aberta em outro lugar', message: 'Você entrou nesta partida por outra janela ou dispositivo. Esta conexão foi encerrada.', actions: ['close'] });
        return;
      }
      if (this.rejoinAttempts < 3) {
        this.rejoinAttempts++;
        pushNotice('Tentando voltar à partida…', 'warn');
        setTimeout(() => void this.connect(), 800 * this.rejoinAttempts);
      } else showError({ title: 'Conexão perdida', message: 'Não foi possível restabelecer a conexão com o servidor de partidas.', actions: ['retry', 'close'] });
    }
  }

  async unlockAudio() {
    if (!this.runtime) return;
    const ok = await this.runtime.audio.unlock();
    uiStore.set({ audioState: this.runtime.audio.state });
    if (!ok) pushNotice('Áudio bloqueado pelo navegador. Clique no jogo para ativar.', 'warn');
  }

  /* ---------------------------- ações da UI ---------------------------- */

  setTeam(team: TeamId) {
    this.conn?.send(C2S.SET_TEAM, { team });
  }
  setWeapon(weaponId: WeaponId) {
    this.conn?.send(C2S.SET_WEAPON, { weaponId });
  }
  setReady(ready: boolean) {
    this.conn?.send(C2S.SET_READY, { ready });
  }
  setBots(enabled: boolean) {
    this.conn?.send(C2S.SET_BOTS, { enabled });
  }
  startMatch() {
    void this.unlockAudio();
    this.conn?.send(C2S.START, {});
  }
  vote(choice: 'rematch' | 'lobby') {
    this.conn?.send(C2S.VOTE, { choice });
  }
  travelTo(playerId: number) {
    this.runtime?.requestTravel(playerId);
    this.runtime?.input.closeMap();
    uiStore.set({ mapOpen: false });
  }
  async invite() {
    try {
      await this.bridge.request('ACTIVITY_REQUEST_INVITE', {});
      pushNotice('Convite enviado pelo host.', 'good');
    } catch (e) {
      pushNotice(`Convite indisponível: ${(e as Error).message}`, 'warn');
    }
  }
  async toggleFullscreen() {
    try {
      await this.bridge.request('ACTIVITY_REQUEST_FULLSCREEN', { enter: !document.fullscreenElement });
    } catch (e) {
      pushNotice(`Tela cheia indisponível: ${(e as Error).message}`, 'warn');
    }
  }
  async toggleMute() {
    try {
      const ok = await this.voice?.requestToggleMute();
      if (!ok) pushNotice('Voz não configurada neste ambiente.', 'warn');
    } catch (e) {
      pushNotice(`Voz: ${(e as Error).message}`, 'warn');
    }
  }
  resumeGame() {
    uiStore.set({ menuOpen: false, settingsOpen: false });
    this.runtime?.input.requestLock();
    this.canvas.focus();
  }

  /**
   * Fecha a Atividade: libera ponteiro, listeners, render loop, GPU, áudio do
   * jogo e a conexão de gameplay. NÃO toca na chamada de voz do host.
   */
  async close(reason = 'user') {
    if (this.closed) return;
    this.closed = true;
    for (const off of this.offs) off();
    this.offs = [];
    await this.conn?.leave();
    this.conn = null;
    this.runtime?.dispose();
    this.runtime = null;
    this.canvas.remove();
    this.voice?.dispose();
    uiStore.set({ screen: 'closed' });
    if (reason === 'user') this.bridge.send('ACTIVITY_REQUEST_CLOSE', { reason: 'user' });
    this.bridge.close();
  }
}

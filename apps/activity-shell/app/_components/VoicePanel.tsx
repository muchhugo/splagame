'use client';

import type { VoiceState } from '@borrifo/activity-sdk';
import type { VoiceUiExtras } from '@/lib/client/voice';

const REASON_LABEL: Record<VoiceState['reason'], string> = {
  ok: 'conectado',
  not_configured: 'não configurada',
  not_in_call: 'fora da chamada',
  connecting: 'conectando…',
  error: 'erro ao conectar',
  permission_denied: 'microfone bloqueado pelo navegador',
};

export function VoicePanel(props: {
  configured: boolean;
  state: VoiceState;
  extras: VoiceUiExtras;
  loggedIn: boolean;
  canJoin: boolean;
  onJoin(): void;
  onLeave(): void;
  onMic(enabled: boolean): void;
  onStartAudio(): void;
}) {
  const { state, extras } = props;
  return (
    <section className="panel voice" aria-label="Voz">
      <h2>Voz</h2>
      {!props.configured ? (
        <>
          <p className="voice-off">Voz não configurada neste ambiente</p>
          <p className="hint">
            Defina <code>LIVEKIT_URL</code>, <code>LIVEKIT_API_KEY</code> e <code>LIVEKIT_API_SECRET</code> no <code>.env</code> para testar a chamada.
          </p>
        </>
      ) : (
        <>
          <p className="note">Voz compartilhada da chamada: todas as equipes se ouvem.</p>
          <p className="voice-status">
            Estado: <strong>{REASON_LABEL[state.reason]}</strong>
            {state.connected && <> · microfone {state.muted ? 'desligado' : 'ligado'}</>}
          </p>
          <div className="row">
            {!state.connected ? (
              <button type="button" className="primary" onClick={props.onJoin} disabled={!props.canJoin || extras.busy}>
                {extras.busy ? 'Entrando…' : 'Entrar na chamada'}
              </button>
            ) : (
              <>
                <button type="button" className={state.muted ? 'primary' : undefined} onClick={() => props.onMic(state.muted)}>
                  {state.muted ? 'Ativar microfone' : 'Silenciar microfone'}
                </button>
                <button type="button" className="danger" onClick={props.onLeave}>
                  Sair da chamada
                </button>
              </>
            )}
            {extras.audioBlocked && (
              <button type="button" onClick={props.onStartAudio}>
                Ativar áudio
              </button>
            )}
          </div>
          {!props.loggedIn && <p className="hint">Escolha um usuário para entrar na chamada.</p>}
          {props.loggedIn && !props.canJoin && <p className="hint">Este usuário não tem acesso ao canal.</p>}
          {state.connected && (
            <ul className="participants">
              {state.participants.map((p) => (
                <li key={p.id} className={p.speaking ? 'speaking' : undefined}>
                  <span className={`dot${p.speaking ? ' speaking' : ' in-call'}`} aria-hidden />
                  {p.displayName}
                  {p.isLocal && <em> (você)</em>}
                  {p.muted && <small className="tag">mudo</small>}
                </li>
              ))}
            </ul>
          )}
          <p className="hint">O microfone só liga com seu clique. Fechar a Atividade não encerra a chamada.</p>
        </>
      )}
    </section>
  );
}

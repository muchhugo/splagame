import { TEAMS, type LobbyPlayer, type TeamId, type WeaponId } from '@borrifo/game-contracts';
import { WEAPONS, MORINGA, RODA_DE_OLEIRO } from '@borrifo/game-content';
import { useStore } from '../app/store';
import { uiStore } from '../app/uiStore';
import { useHints, type HintAction } from '../app/hints';
import { useVoiceByUser, type VoiceInfo } from '../app/profiles';
import { Avatar, VoiceBadge } from './Avatar';
import { getController } from './App';
import { Logo } from './Logo';
import { VoiceChip } from './VoiceChip';

const STATS: Record<WeaponId, { alcance: number; pintura: number; dano: number; mobilidade: number }> = {
  esguicho: { alcance: 0.55, pintura: 0.65, dano: 0.6, mobilidade: 0.75 },
  rodo: { alcance: 0.25, pintura: 0.9, dano: 0.85, mobilidade: 0.55 },
  estilingue: { alcance: 0.95, pintura: 0.35, dano: 0.9, mobilidade: 0.35 },
};

export function Lobby() {
  const lobby = useStore(uiStore, (s) => s.lobby);
  const welcome = useStore(uiStore, (s) => s.welcome);
  const ctx = useStore(uiStore, (s) => s.context);
  const rtt = useStore(uiStore, (s) => s.rttMs);
  const hints = useHints();
  if (!lobby || !welcome) return null;
  const c = getController();
  const myId = welcome.playerId;
  const me = lobby.players.find((p) => p.playerId === myId);
  const isHost = lobby.hostPlayerId === myId;
  const humans = lobby.players.filter((p) => !p.isBot);
  const notReady = humans.filter((p) => p.playerId !== lobby.hostPlayerId && !p.ready && p.connection === 'connected');
  const teamPlayers = (t: TeamId) => lobby.players.filter((p) => p.team === t && !p.isBot);
  const canStart = isHost && notReady.length === 0 && (lobby.fillWithBots || (teamPlayers(0).length > 0 && teamPlayers(1).length > 0));

  return (
    <div className="screen">
      <div className="lobby panel">
        <div className="lobby-head">
          <Logo size={44} />
          <div className="row">
            <span className="chip">{lobby.map.name}</span>
            <span className="chip">Território · {Math.round(lobby.roundDurationSeconds / 60)} min</span>
            <span className={`chip ${rtt !== null && rtt < 120 ? 'ok' : 'warn'}`}>Conexão {rtt !== null ? `${rtt} ms` : '…'}</span>
            <VoiceChip />
            {ctx?.capabilities.canInvite ? (
              <button className="btn small ghost" onClick={() => void c?.invite()}>
                Convidar
              </button>
            ) : null}
            <button className="btn small ghost" onClick={() => uiStore.set({ menuOpen: true, settingsOpen: true })}>
              Configurações
            </button>
          </div>
        </div>
        {([0, 1] as TeamId[]).map((t) => (
          <TeamColumn key={t} team={t} players={teamPlayers(t)} myId={myId} hostId={lobby.hostPlayerId} fill={lobby.fillWithBots} max={lobby.maxTeamSize} onJoin={() => c?.setTeam(t)} canJoin={me?.team !== t} />
        ))}
        <div className="weapons" role="radiogroup" aria-label="Ferramenta principal">
          {(Object.keys(WEAPONS) as WeaponId[]).map((w) => {
            const d = WEAPONS[w];
            const st = STATS[w];
            return (
              <button key={w} className={`weapon ${me?.weaponId === w ? 'selected' : ''}`} role="radio" aria-checked={me?.weaponId === w} onClick={() => c?.setWeapon(w)}>
                <h3>{d.name}</h3>
                <span className="chip">{d.role}</span>
                <span className="muted" style={{ fontSize: 13 }}>
                  {d.description}
                </span>
                {(['alcance', 'pintura', 'dano', 'mobilidade'] as const).map((k) => (
                  <div className="stat" key={k}>
                    <span>{k[0].toUpperCase() + k.slice(1)}</span>
                    <span className="bar">
                      <i style={{ width: `${st[k] * 100}%` }} />
                    </span>
                  </div>
                ))}
              </button>
            );
          })}
        </div>
        <div className="lobby-foot">
          <div className="keys" aria-label="Controles">
            {CONTROL_LIST.map(([a, text]) => (
              <span key={a}>
                <kbd>{hints.label(a)}</kbd> {text}
              </span>
            ))}
          </div>
          <div className="row">
            {isHost ? (
              <label className="chip" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={lobby.fillWithBots} onChange={(e) => c?.setBots(e.target.checked)} /> Completar vagas com bots
              </label>
            ) : null}
            {!isHost ? (
              <button className={`btn ${me?.ready ? 'ghost' : 'secondary'}`} data-sfx={me?.ready ? 'back' : undefined} onClick={() => c?.setReady(!me?.ready)}>
                {me?.ready ? 'Cancelar pronto' : 'Estou pronto'}
              </button>
            ) : (
              <button className="btn primary" disabled={!canStart} onClick={() => c?.startMatch()} title={canStart ? '' : `Aguardando: ${notReady.map((p) => p.displayName).join(', ')}`}>
                Começar partida
              </button>
            )}
          </div>
          {isHost && notReady.length > 0 ? <div className="muted" style={{ fontSize: 13 }}>Aguardando prontos: {notReady.map((p) => p.displayName).join(', ')}</div> : null}
          {!isHost ? <div className="muted" style={{ fontSize: 13 }}>Quem organiza a sala inicia a partida quando todos estiverem prontos.</div> : null}
        </div>
      </div>
    </div>
  );
}

function TeamColumn(props: { team: TeamId; players: LobbyPlayer[]; myId: number; hostId: number | null; fill: boolean; max: number; onJoin: () => void; canJoin: boolean }) {
  const { team, players, myId, hostId, fill, max } = props;
  const voices = useVoiceByUser();
  const voiceOf = (p: LobbyPlayer): VoiceInfo | undefined => (p.userId ? voices.get(p.userId) : undefined);
  const info = TEAMS[team];
  const slots = Array.from({ length: max }, (_, i) => players[i] ?? null);
  return (
    <section className={`team-col t${team}`} aria-label={`Turma ${info.name}`}>
      <div className="team-title">
        <span>
          {info.symbol} Turma {info.name}
        </span>
        {props.canJoin && players.length < max ? (
          <button className="btn small ghost" onClick={props.onJoin}>
            Entrar nesta turma
          </button>
        ) : null}
      </div>
      {slots.map((p, i) =>
        p ? (
          <div key={p.playerId} className={`slot ${p.playerId === myId ? 'me' : ''}`}>
            <span aria-hidden="true">{info.symbol}</span>
            <Avatar player={p} voice={voiceOf(p)} />
            <span className="name">
              {p.displayName}
              {p.playerId === myId ? ' (você)' : ''}
            </span>
            <VoiceBadge voice={voiceOf(p)} />
            {p.playerId === hostId ? <span className="chip">anfitrião</span> : null}
            <span className="chip">{WEAPONS[p.weaponId].name}</span>
            {p.connection === 'reconnecting' ? <span className="chip warn">reconectando</span> : p.playerId === hostId ? null : p.ready ? <span className="chip ok">pronto</span> : <span className="chip">aguardando</span>}
          </div>
        ) : (
          <div key={`e${i}`} className="slot empty">
            {fill ? 'Vaga — um bibelô-bot completa' : 'Vaga livre'}
          </div>
        ),
      )}
    </section>
  );
}

export { keyName } from '../app/hints';

const CONTROL_LIST: Array<[HintAction, string]> = [
  ['move', 'mover'],
  ['look', 'mirar'],
  ['fire', 'usar ferramenta'],
  ['flow', 'Forma Pião'],
  ['jump', 'pular'],
  ['secondary', MORINGA.name],
  ['special', RODA_DE_OLEIRO.name],
  ['map', 'mapa / Pião-Guia'],
];

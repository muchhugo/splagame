import { useRef, useState } from 'react';
import { APPEARANCE_IDS, MAX_TEAM_SIZE, type FormationOption, type GameModeId, type LobbyPlayer, type LobbyState, type TeamId, type WeaponId } from '@borrifo/game-contracts';
import { CORREIO, MAP_FAMILIES, MODES, MORINGA, RODA_DE_OLEIRO, WEAPONS } from '@borrifo/game-content';
import { useStore } from '../app/store';
import { uiStore } from '../app/uiStore';
import { useHints, type HintAction } from '../app/hints';
import { useVoiceByUser, type VoiceInfo } from '../app/profiles';
import { useTeams } from '../app/teams';
import { Avatar, VoiceBadge } from './Avatar';
import { getController } from './App';
import { Logo } from './Logo';
import { VoiceChip } from './VoiceChip';
import { useEnter } from './motion';

const STATS: Record<WeaponId, { alcance: number; pintura: number; dano: number; mobilidade: number }> = {
  esguicho: { alcance: 0.55, pintura: 0.65, dano: 0.6, mobilidade: 0.75 },
  rodo: { alcance: 0.25, pintura: 0.9, dano: 0.85, mobilidade: 0.55 },
  estilingue: { alcance: 0.95, pintura: 0.35, dano: 0.9, mobilidade: 0.35 },
};
export const VARIANT_NAME = { compacto: 'compacta', padrao: 'padrão', ampliado: 'ampliada' } as const;
const FORMATIONS: FormationOption[] = ['flex', 1, 2, 3, 4, 5, 6, 7, 8];
/** Cores de identificação dos mapas (cartões): Toca = terracota e verde; Clube = água e coral. */
const MAP_ART: Record<string, [string, string]> = { 'toca-do-ara': ['#e0764a', '#5fae6a'], 'clube-da-mare': ['#4cc3d0', '#f38a6f'] };
type Tab = 'partida' | 'equipes' | 'voce';

/**
 * Lobby: opções da partida (anfitrião), formação REAL calculada pelo servidor (com bots
 * e fila visíveis antes de começar), visual e ferramenta. No celular vira três abas com
 * a ação principal fixa embaixo.
 */
export function Lobby() {
  const lobby = useStore(uiStore, (s) => s.lobby);
  const welcome = useStore(uiStore, (s) => s.welcome);
  const ctx = useStore(uiStore, (s) => s.context);
  const rtt = useStore(uiStore, (s) => s.rttMs);
  const [tab, setTab] = useState<Tab>('equipes');
  const root = useRef<HTMLDivElement>(null);
  useEnter(root, [!!lobby]);
  if (!lobby || !welcome) return null;
  const c = getController();
  const myId = welcome.playerId;
  const me = lobby.players.find((p) => p.playerId === myId);
  const isHost = lobby.hostPlayerId === myId;
  const humans = lobby.players.filter((p) => !p.isBot);
  const notReady = humans.filter((p) => p.playerId !== lobby.hostPlayerId && !p.ready && p.connection === 'connected');
  const plan = lobby.plan;
  const canStart = isHost && notReady.length === 0 && !plan.blocked;
  const queued = plan.queue.includes(myId);

  return (
    <div className="screen lobby-screen" ref={root}>
      <header className="lobby-head" data-enter>
        <Logo size={40} />
        <div className="row wrap">
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
      </header>

      <nav className="lobby-tabs" role="tablist" aria-label="Seções do lobby">
        {(
          [
            ['partida', 'Partida'],
            ['equipes', 'Equipes'],
            ['voce', 'Você'],
          ] as Array<[Tab, string]>
        ).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </nav>

      <div className="lobby-grid">
        <section className={`lobby-col col-partida ${tab === 'partida' ? 'show' : ''}`} aria-label="Partida" data-enter>
          <MatchOptions lobby={lobby} isHost={isHost} />
        </section>
        <section className={`lobby-col col-equipes ${tab === 'equipes' ? 'show' : ''}`} aria-label="Equipes" data-enter>
          <Formation lobby={lobby} myId={myId} />
        </section>
        <section className={`lobby-col col-voce ${tab === 'voce' ? 'show' : ''}`} aria-label="Você" data-enter>
          <h3 className="sec">Seu visual</h3>
          <AppearancePicker current={me?.appearance} onPick={(a) => c?.setAppearance(a)} />
          <h3 className="sec">Ferramenta</h3>
          <div className="weapons" role="radiogroup" aria-label="Ferramenta principal">
            {(Object.keys(WEAPONS) as WeaponId[]).map((w) => {
              const d = WEAPONS[w];
              const st = STATS[w];
              return (
                <button key={w} className={`weapon ${me?.weaponId === w ? 'selected' : ''}`} role="radio" aria-checked={me?.weaponId === w} onClick={() => c?.setWeapon(w)}>
                  <span className="w-head">
                    <b>{d.name}</b>
                    <span className="chip">{d.role}</span>
                  </span>
                  <span className="w-desc">{d.description}</span>
                  <span className="w-stats">
                    {(['alcance', 'pintura', 'dano', 'mobilidade'] as const).map((k) => (
                      <span className="stat" key={k}>
                        <span>{k[0].toUpperCase() + k.slice(1)}</span>
                        <span className="bar">
                          <i style={{ width: `${st[k] * 100}%` }} />
                        </span>
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
          <Controls />
        </section>
      </div>

      <footer className="lobby-foot" data-enter>
        <div className="summary" aria-live="polite">
          <PlanSummary lobby={lobby} />
          {queued ? <span className="chip warn">Você está na fila: entra na próxima rodada</span> : null}
          {isHost && notReady.length > 0 ? <span className="muted">Aguardando prontos: {notReady.map((p) => p.displayName).join(', ')}</span> : null}
          {!isHost ? <span className="muted">Quem organiza a sala inicia quando todos estiverem prontos.</span> : null}
        </div>
        {!isHost ? (
          <button className={`btn big ${me?.ready ? 'ghost' : 'secondary'}`} data-sfx={me?.ready ? 'back' : undefined} onClick={() => c?.setReady(!me?.ready)}>
            {me?.ready ? 'Cancelar pronto' : 'Estou pronto'}
          </button>
        ) : (
          <button className="btn big primary" disabled={!canStart} onClick={() => c?.startMatch()} title={plan.blocked ?? (canStart ? '' : `Aguardando: ${notReady.map((p) => p.displayName).join(', ')}`)}>
            Começar partida
          </button>
        )}
      </footer>
    </div>
  );
}

function PlanSummary({ lobby }: { lobby: LobbyState }) {
  const p = lobby.plan;
  if (p.blocked) return <span className="chip warn">{p.blocked}</span>;
  const bots = p.bots[0] + p.bots[1];
  return (
    <span className="plan">
      <b>
        {p.teamSize} × {p.teamSize}
      </b>{' '}
      · {MODES[lobby.mode].name} · {lobby.map.name} <span className="muted">({VARIANT_NAME[p.variant]})</span>
      {bots ? ` · ${bots} bot${bots > 1 ? 's' : ''}` : ''}
      {p.queue.length ? ` · ${p.queue.length} na fila` : ''}
    </span>
  );
}

function MatchOptions({ lobby, isHost }: { lobby: LobbyState; isHost: boolean }) {
  const c = getController();
  const set = (o: { mode?: GameModeId; map?: string; formation?: FormationOption }) => {
    if (isHost) c?.setOptions(o);
  };
  return (
    <>
      <h3 className="sec">Modo {isHost ? null : <span className="muted">(escolha de quem organiza)</span>}</h3>
      <div className="cards" role="radiogroup" aria-label="Modo de jogo">
        {(Object.keys(MODES) as GameModeId[]).map((m) => (
          <button key={m} role="radio" aria-checked={lobby.mode === m} disabled={!isHost} className={`card mode-${m} ${lobby.mode === m ? 'selected' : ''}`} onClick={() => set({ mode: m })}>
            <b>{MODES[m].name}</b>
            <span>{m === 'correio' ? `Leve a cápsula até a estação pintada. ${CORREIO.targetDeliveries} entregas vencem.` : MODES[m].short}</span>
          </button>
        ))}
      </div>
      <h3 className="sec">Mapa</h3>
      <div className="cards" role="radiogroup" aria-label="Mapa">
        <button role="radio" aria-checked={lobby.mapChoice === 'rotacao'} disabled={!isHost} className={`card ${lobby.mapChoice === 'rotacao' ? 'selected' : ''}`} onClick={() => set({ map: 'rotacao' })}>
          <b>Rotação</b>
          <span>Alterna os mapas a cada rodada</span>
        </button>
        {MAP_FAMILIES.map((f) => (
          <button key={f.id} role="radio" aria-checked={lobby.mapChoice === f.id} disabled={!isHost} className={`card map-card ${lobby.mapChoice === f.id ? 'selected' : ''}`} onClick={() => set({ map: f.id })}>
            <MapArt id={f.id} />
            <b>{f.name}</b>
          </button>
        ))}
      </div>
      <p className="muted small">
        Próxima rodada: <b>{lobby.map.name}</b>, variante {VARIANT_NAME[lobby.map.variant]}. O tamanho sai do total de participantes ativos.
      </p>
      <h3 className="sec">Formação</h3>
      <div className="seg" role="radiogroup" aria-label="Formação">
        {FORMATIONS.map((f) => (
          <button key={String(f)} role="radio" aria-checked={lobby.formation === f} disabled={!isHost} className={lobby.formation === f ? 'on' : ''} onClick={() => set({ formation: f })} title={f === 'flex' ? 'Pelo número de pessoas prontas' : `Até ${f} por equipe`}>
            {f === 'flex' ? 'Flex' : `${f}×${f}`}
          </button>
        ))}
      </div>
      <label className={`toggle ${isHost ? '' : 'disabled'}`}>
        <input type="checkbox" checked={lobby.fillWithBots} disabled={!isHost} onChange={(e) => c?.setBots(e.target.checked)} />
        <span>Completar vagas com bots</span>
      </label>
    </>
  );
}

export function MapArt({ id }: { id: string }) {
  const [a, b] = MAP_ART[id] ?? ['#888', '#aaa'];
  return (
    <svg className="map-art" viewBox="0 0 64 36" aria-hidden="true">
      <rect width="64" height="36" rx="6" fill={a} />
      {id === 'clube-da-mare' ? (
        <>
          <rect x="18" y="10" width="28" height="16" rx="3" fill="#bdf0f4" stroke="#fff" strokeWidth="2" />
          <rect x="30" y="4" width="4" height="28" fill={b} />
        </>
      ) : (
        <>
          <circle cx="32" cy="18" r="9" fill={b} />
          <path d="M26 16 q6 -10 12 0" fill="#e1352b" />
          <rect x="8" y="8" width="8" height="20" rx="2" fill="#f4e6cf" />
          <rect x="48" y="8" width="8" height="20" rx="2" fill="#f4e6cf" />
        </>
      )}
    </svg>
  );
}

/** Colunas com a formação que o servidor vai aplicar (quem joga onde, bots e fila). */
function Formation({ lobby, myId }: { lobby: LobbyState; myId: number }) {
  const c = getController();
  const plan = lobby.plan;
  const humans = lobby.players.filter((p) => !p.isBot);
  const byTeam = (t: TeamId) => humans.filter((p) => plan.teamOf[p.playerId] === t);
  const queue = humans.filter((p) => plan.queue.includes(p.playerId));
  const me = humans.find((p) => p.playerId === myId);
  return (
    <>
      <div className="teams">
        {([0, 1] as TeamId[]).map((t) => (
          <TeamColumn key={t} team={t} players={byTeam(t)} bots={plan.bots[t]} size={plan.teamSize} myId={myId} hostId={lobby.hostPlayerId} canJoin={me !== undefined && me.team !== t && humans.filter((p) => p.team === t).length < MAX_TEAM_SIZE} onJoin={() => c?.setTeam(t)} />
        ))}
      </div>
      {queue.length ? (
        <div className="queue" aria-label="Fila">
          <span className="muted">Fila (entra na próxima revanche):</span>
          {queue.map((p) => (
            <span key={p.playerId} className="chip">
              {p.displayName}
              {p.playerId === myId ? ' (você)' : ''}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function TeamColumn(props: { team: TeamId; players: LobbyPlayer[]; bots: number; size: number; myId: number; hostId: number | null; canJoin: boolean; onJoin: () => void }) {
  const { team, players, myId, hostId } = props;
  const voices = useVoiceByUser();
  const voiceOf = (p: LobbyPlayer): VoiceInfo | undefined => (p.userId ? voices.get(p.userId) : undefined);
  const info = useTeams()[team];
  return (
    <section className={`team-col t${team}`} aria-label={`Turma ${info.name}`}>
      <div className="team-title">
        <span>
          {info.symbol} Turma {info.name} <span className="muted">· {players.length + props.bots}/{props.size}</span>
        </span>
        {props.canJoin ? (
          <button className="btn small ghost" onClick={props.onJoin}>
            Preferir esta turma
          </button>
        ) : null}
      </div>
      {players.map((p) => (
        <div key={p.playerId} data-player={p.playerId} data-speaking={voiceOf(p)?.speaking ? 'true' : 'false'} data-muted={voiceOf(p)?.muted ? 'true' : 'false'} className={`slot ${p.playerId === myId ? 'me' : ''}`}>
          <Avatar player={p} voice={voiceOf(p)} />
          <span className="name">
            {p.displayName}
            {p.playerId === myId ? ' (você)' : ''}
          </span>
          <VoiceBadge voice={voiceOf(p)} />
          {p.playerId === hostId ? <span className="chip">anfitrião</span> : null}
          <span className="chip dim">{WEAPONS[p.weaponId].name}</span>
          {p.connection === 'reconnecting' ? <span className="chip warn">reconectando</span> : p.playerId === hostId ? null : p.ready ? <span className="chip ok">pronto</span> : <span className="chip">aguardando</span>}
        </div>
      ))}
      {Array.from({ length: props.bots }, (_, i) => (
        <div key={`b${i}`} className="slot bot">
          <span className="avatar" aria-hidden="true">
            <span>🏺</span>
          </span>
          <span className="name">Bot da turma</span>
          <span className="chip dim">bot</span>
        </div>
      ))}
      {players.length + props.bots === 0 ? <div className="slot empty">Sem ninguém nesta rodada</div> : null}
    </section>
  );
}

/** Tons de pele iguais aos do personagem 3D (CharacterView.SKIN_TONES). Só cosmético: a hitbox é a mesma. */
const SKIN = ['#f4d4ba', '#dfa982', '#b3764c', '#7a4a2d'];
function AppearancePicker(props: { current: string | undefined; onPick: (a: (typeof APPEARANCE_IDS)[number]) => void }) {
  return (
    <div className="appearance" role="radiogroup" aria-label="Visual do personagem">
      {APPEARANCE_IDS.map((a) => {
        const base = a[0] === 'a' ? 'Base 1 (camiseta)' : 'Base 2 (jardineira)';
        const tone = Number(a[1]) + 1;
        return (
          <button key={a} role="radio" aria-checked={props.current === a} aria-label={`${base}, tom ${tone}`} title={`${base}, tom ${tone}`} className={`look ${a[0]} ${props.current === a ? 'selected' : ''}`} style={{ ['--skin' as string]: SKIN[Number(a[1])] }} onClick={() => props.onPick(a)}>
            <svg viewBox="0 0 40 44" aria-hidden="true">
              <rect x="10" y="24" width="20" height="18" rx="7" fill={a[0] === 'a' ? 'var(--team0)' : '#f3eadb'} />
              {a[0] === 'b' ? <rect x="13" y="30" width="14" height="12" rx="3" fill="var(--team0)" /> : null}
              <circle cx="20" cy="15" r="10" fill="var(--skin)" />
              {a[0] === 'a' ? <path d="M10 13 q10 -14 20 0 q-10 -5 -20 0" fill="#2b1c14" /> : <path d="M9 17 q1 -15 11 -13 q10 -2 11 13 l-2 5 q-1 -12 -9 -12 q-8 0 -9 12z" fill="#3b2318" />}
              <circle cx="16.5" cy="16" r="1.4" fill="#2a1a12" />
              <circle cx="23.5" cy="16" r="1.4" fill="#2a1a12" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

function Controls() {
  const hints = useHints();
  return (
    <div className="keys" aria-label="Controles">
      {CONTROL_LIST.map(([a, text]) => (
        <span key={a}>
          <kbd>{hints.label(a)}</kbd> {text}
        </span>
      ))}
    </div>
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

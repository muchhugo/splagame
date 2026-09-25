import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { MAX_TEAM_SIZE, formatAppearanceId, parseAppearanceId, type AppearanceId, type AppearanceParts, type FormationOption, type GameModeId, type LobbyPlayer, type LobbyState, type TeamId, type WeaponId } from '@borrifo/game-contracts';
import { CORREIO, MAP_FAMILIES, MODES, MORINGA, RODA_DE_OLEIRO, WEAPONS } from '@borrifo/game-content';
import { useStore } from '../app/store';
import { uiStore } from '../app/uiStore';
import { settingsStore } from '../app/settings';
import { useHints, type HintAction } from '../app/hints';
import { useVoiceByUser, type VoiceInfo } from '../app/profiles';
import { useTeams } from '../app/teams';
import { stageStore } from '../game/stage';
import { gamepadHub } from '../game/input/gamepad';
import { HAIR_COLORS, HAIR_COLOR_NAMES, HAIR_STYLE_NAMES, SKIN_TONES } from '../game/render/CharacterView';
import { Avatar } from './Avatar';
import { getController } from './App';
import { Logo } from './Logo';
import { VoiceChip } from './VoiceChip';
import { motionAllowed } from './motion';
import { BotIcon, CheckIcon, CrownIcon, GearIcon, InviteIcon, ModeIcon, RotateIcon, ToolIcon } from './icons';

const STATS: Record<WeaponId, { alcance: number; pintura: number; dano: number; mobilidade: number }> = {
  esguicho: { alcance: 0.55, pintura: 0.65, dano: 0.6, mobilidade: 0.75 },
  rodo: { alcance: 0.25, pintura: 0.9, dano: 0.85, mobilidade: 0.55 },
  estilingue: { alcance: 0.95, pintura: 0.35, dano: 0.9, mobilidade: 0.35 },
};
const STAT_NAMES = { alcance: 'Alcance', pintura: 'Pintura', dano: 'Dano', mobilidade: 'Mobilidade' } as const;
export const VARIANT_NAME = { compacto: 'compacta', padrao: 'padrão', ampliado: 'ampliada' } as const;
const FORMATIONS: FormationOption[] = ['flex', 1, 2, 3, 4, 5, 6, 7, 8];
/** Cores de identificação dos mapas (cartões): Toca = terracota e verde; Clube = água e coral. */
const MAP_ART: Record<string, [string, string]> = { 'toca-do-ara': ['#e0764a', '#5fae6a'], 'clube-da-mare': ['#4cc3d0', '#f38a6f'] };
type Tab = 'sala' | 'partida' | 'voce';
const TABS: Array<[Tab, string]> = [
  ['sala', 'Sala'],
  ['partida', 'Partida'],
  ['voce', 'Você'],
];

/** Tela estreita (celular em pé): a cena fica em cima e o painel vira folha embaixo. */
function useNarrow(): boolean {
  // celular é só na horizontal (em pé, a tela pede para girar); a folha fica para janelas
  // estreitas de desktop (ex.: Atividade ao lado do chat), sem ponteiro de toque
  const q = '(pointer: fine) and (max-width: 760px), (pointer: fine) and (max-aspect-ratio: 4/5)';
  const [n, setN] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(q);
    const on = () => setN(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return n;
}

/**
 * Lobby = hub da Atividade, desenhado SOBRE a arena: o grupo aparece na cena (palco 3D
 * com o personagem de cada pessoa), e os painéis organizam a sala, a partida e o
 * próprio personagem. Na aba "Você" a câmera fecha no seu personagem, que gira por
 * arrasto, toque ou analógico. No celular, a cena fica em cima e o painel vira folha.
 */
export function Lobby({ leaving = false }: { leaving?: boolean }) {
  const lobby = useStore(uiStore, (s) => s.lobby);
  const welcome = useStore(uiStore, (s) => s.welcome);
  const intro = useStore(stageStore, (s) => s.intro);
  const menuOpen = useStore(uiStore, (s) => s.menuOpen);
  const [tab, setTab] = useState<Tab>('sala');
  const narrow = useNarrow();
  const [sheetOpen, setSheetOpen] = useState(true);
  const c = getController();

  useEffect(() => {
    if (!leaving) c?.setStageView(tab === 'voce' ? 'vitrine' : 'sala', narrow ? 'topo' : 'direita');
  }, [tab, narrow, c, leaving]);
  useEffect(() => () => getController()?.setStageView('sala', 'direita'), []);

  // pular a apresentação: qualquer tecla, clique ou botão do controle
  useEffect(() => {
    if (!intro) return;
    const skip = () => getController()?.skipIntro();
    const t = setInterval(() => gamepadHub.frame.pressed.some(Boolean) && skip(), 100);
    window.addEventListener('keydown', skip, { once: true });
    window.addEventListener('pointerdown', skip, { once: true });
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
  }, [intro]);

  if (!lobby || !welcome) return null;
  const myId = welcome.playerId;
  const me = lobby.players.find((p) => p.playerId === myId);
  const isHost = lobby.hostPlayerId === myId;

  return (
    <div className={`screen hub ${intro ? 'is-intro' : ''} ${leaving ? 'is-leaving' : ''} ${narrow ? 'is-narrow' : ''} ${sheetOpen ? '' : 'sheet-closed'} tab-${tab}`} aria-hidden={leaving || undefined} inert={leaving || menuOpen || undefined}>
      {intro ? <IntroCard lobby={lobby} /> : null}
      {tab !== 'voce' && !leaving ? <StageTags lobby={lobby} myId={myId} /> : null}

      {/* a área de giro vem antes dos painéis: eles (e a alça da folha) ficam por cima dela */}
      {tab === 'voce' && !leaving ? <TurnTable /> : null}

      <header className="hub-top">
        <div className="hub-brand">
          <Logo size={30} />
        </div>
        <MatchPoster lobby={lobby} onClick={() => setTab('partida')} />
        <HubTools />
      </header>

      <aside className="hub-panel" aria-label="Lobby">
        {narrow ? (
          <button className="sheet-grip" aria-label={sheetOpen ? 'Recolher painel' : 'Abrir painel'} aria-expanded={sheetOpen} data-sfx="none" onClick={() => setSheetOpen(!sheetOpen)}>
            <span />
          </button>
        ) : null}
        <nav className="hub-tabs" role="tablist" aria-label="Seções do lobby">
          {TABS.map(([t, label]) => (
            <button
              key={t}
              role="tab"
              id={`hub-tab-${t}`}
              aria-selected={tab === t}
              aria-controls="hub-body"
              className={`hub-tab ${tab === t ? 'on' : ''}`}
              onClick={() => {
                setTab(t);
                setSheetOpen(true);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="hub-body" key={tab} id="hub-body" role="tabpanel" aria-labelledby={`hub-tab-${tab}`}>
          {tab === 'sala' ? <Roster lobby={lobby} myId={myId} /> : null}
          {tab === 'partida' ? <MatchOptions lobby={lobby} isHost={isHost} /> : null}
          {tab === 'voce' ? <Customize me={me} narrow={narrow} /> : null}
        </div>
      </aside>

      <ActionDock lobby={lobby} myId={myId} />
    </div>
  );
}

/* ------------------------------ topo ------------------------------ */

function HubTools() {
  const ctx = useStore(uiStore, (s) => s.context);
  const rtt = useStore(uiStore, (s) => s.rttMs);
  const c = getController();
  const good = rtt !== null && rtt < 120;
  return (
    <div className="hub-tools">
      <VoiceChip />
      <span className={`net-dot ${rtt === null ? '' : good ? 'ok' : 'warn'}`} title={`Conexão ${rtt !== null ? `${rtt} ms` : '…'}`}>
        <i aria-hidden="true" />
        Conexão {rtt !== null ? `${rtt} ms` : '…'}
      </span>
      {ctx?.capabilities.canInvite ? (
        <button className="round-btn" onClick={() => void c?.invite()} aria-label="Convidar" title="Convidar">
          <InviteIcon />
        </button>
      ) : null}
      <button className="round-btn" onClick={() => uiStore.set({ menuOpen: true, settingsOpen: true })} aria-label="Configurações" title="Configurações">
        <GearIcon />
      </button>
    </div>
  );
}

/** Cartaz da próxima rodada: mapa, variante, modo e tamanho, num só bloco. */
function MatchPoster({ lobby, onClick }: { lobby: LobbyState; onClick: () => void }) {
  const p = lobby.plan;
  const bots = p.bots[0] + p.bots[1];
  const family = MAP_FAMILIES.find((f) => f.name === lobby.map.name)?.id ?? lobby.mapChoice;
  return (
    <button className="poster" onClick={onClick} title="Ver as opções da partida" aria-label={`Próxima rodada: ${lobby.map.name}, ${MODES[lobby.mode].name}, ${p.teamSize} contra ${p.teamSize}. Abrir opções da partida.`}>
      <MapArt id={family} />
      <span className="poster-main">
        <span className="poster-map">{lobby.map.name}</span>
        <span className="poster-sub">
          variante {VARIANT_NAME[p.variant]}
          {lobby.mapChoice === 'rotacao' ? ' · rotação' : ''}
        </span>
      </span>
      <span className="poster-mode">
        <ModeIcon mode={lobby.mode} size={26} />
        {MODES[lobby.mode].name}
      </span>
      <span className="poster-size">{p.blocked ? '—' : `${p.teamSize}×${p.teamSize}`}</span>
      {bots ? (
        <span className="poster-bots">
          +{bots} bot{bots > 1 ? 's' : ''}
        </span>
      ) : null}
    </button>
  );
}

/** Abertura: título do lugar sobre o sobrevoo da câmera; some sozinho ou com qualquer tecla. */
function IntroCard({ lobby }: { lobby: LobbyState }) {
  const ref = useRef<HTMLDivElement>(null);
  const hints = useHints();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !motionAllowed()) return;
    const ctx = gsap.context(() => {
      gsap.from('.intro-logo', { y: -30, opacity: 0, duration: 0.5, ease: 'back.out(2)' });
      gsap.from('.intro-title', { scale: 1.4, opacity: 0, duration: 0.55, delay: 0.25, ease: 'back.out(1.8)' });
      gsap.from('.intro-sub', { y: 16, opacity: 0, duration: 0.4, delay: 0.55 });
    }, el);
    return () => ctx.revert();
  }, []);
  return (
    <div className="intro-card" ref={ref} role="status" aria-live="polite">
      <div className="intro-logo">
        <Logo size={64} />
      </div>
      <div className="intro-title">{lobby.map.name}</div>
      <div className="intro-sub">{hints.device === 'toque' ? 'Toque para pular' : hints.device === 'controle' ? 'Aperte qualquer botão para pular' : 'Aperte qualquer tecla para pular'}</div>
    </div>
  );
}

/* ------------------------------ etiquetas sobre o palco ------------------------------ */

function StageTags({ lobby, myId }: { lobby: LobbyState; myId: number }) {
  const tags = useStore(stageStore, (s) => s.tags);
  const voices = useVoiceByUser();
  return (
    <div className="stage-tags" aria-hidden="true">
      {tags.map((t) => {
        const p = lobby.players.find((x) => x.playerId === t.playerId);
        const scale = Math.max(0.72, Math.min(1.1, 9 / t.dist));
        const style = { transform: `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})` };
        if (!p)
          return (
            <div key={t.playerId} className="stag bot" style={style}>
              <BotIcon size={16} />
              <span>bot</span>
            </div>
          );
        const voice = p.userId ? voices.get(p.userId) : undefined;
        const isMe = p.playerId === myId;
        return (
          <div key={t.playerId} className={`stag t${lobby.plan.teamOf[p.playerId] ?? p.team} ${isMe ? 'me' : ''} ${p.ready ? 'ready' : ''}`} style={style} data-player={p.playerId} data-speaking={voice?.speaking ? 'true' : 'false'}>
            <Avatar player={p} voice={voice} size={24} />
            <span className="stag-name">{isMe ? 'Você' : p.displayName}</span>
            {p.playerId === lobby.hostPlayerId ? <CrownIcon size={16} /> : p.ready ? <CheckIcon size={14} className="ok" /> : null}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------ Sala ------------------------------ */

function Roster({ lobby, myId }: { lobby: LobbyState; myId: number }) {
  const c = getController();
  const plan = lobby.plan;
  const humans = lobby.players.filter((p) => !p.isBot);
  const byTeam = (t: TeamId) => humans.filter((p) => plan.teamOf[p.playerId] === t);
  const queue = humans.filter((p) => plan.queue.includes(p.playerId));
  const me = humans.find((p) => p.playerId === myId);
  const myTeam: TeamId = (me ? plan.teamOf[me.playerId] : undefined) ?? me?.team ?? 0;
  const order: TeamId[] = myTeam === 1 ? [1, 0] : [0, 1];
  const hidden = useStore(stageStore, (s) => s.hidden);
  return (
    <div className="hub-roster">
      {order.map((t) => (
        <TeamBlock
          key={t}
          team={t}
          players={byTeam(t)}
          bots={plan.bots[t]}
          size={plan.teamSize}
          lobby={lobby}
          myId={myId}
          offStage={hidden[t]}
          canJoin={me !== undefined && me.team !== t && humans.filter((p) => p.team === t).length < MAX_TEAM_SIZE}
          onJoin={() => c?.setTeam(t)}
        />
      ))}
      {queue.length ? (
        <div className="queue" aria-label="Banco">
          <b>No banco</b> <span className="muted">assistem e entram na próxima rodada</span>
          <div className="queue-list">
            {queue.map((p) => (
              <span key={p.playerId} className="queue-chip">
                <Avatar player={p} size={20} />
                {p.displayName}
                {p.playerId === myId ? ' (você)' : ''}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TeamBlock(props: { team: TeamId; players: LobbyPlayer[]; bots: number; size: number; lobby: LobbyState; myId: number; offStage: number; canJoin: boolean; onJoin: () => void }) {
  const { team, players, myId, lobby } = props;
  const voices = useVoiceByUser();
  const voiceOf = (p: LobbyPlayer): VoiceInfo | undefined => (p.userId ? voices.get(p.userId) : undefined);
  const info = useTeams()[team];
  const filled = players.length + props.bots;
  const empty = lobby.formation === 'flex' ? 0 : Math.max(0, props.size - filled);
  return (
    <section className={`team-block t${team}`} aria-label={`Turma ${info.name}`}>
      <header className="team-plate">
        <span className="team-sym" aria-hidden="true">
          {info.symbol}
        </span>
        <span className="team-name">Turma {info.name}</span>
        <span className="team-count">
          {filled}/{props.size || '–'}
        </span>
        {props.canJoin ? (
          <button className="mini-btn" onClick={props.onJoin}>
            Preferir esta turma
          </button>
        ) : null}
      </header>
      <ul className="team-rows">
        {players.map((p) => {
          const v = voiceOf(p);
          const host = p.playerId === lobby.hostPlayerId;
          return (
            <li key={p.playerId} data-player={p.playerId} data-speaking={v?.speaking ? 'true' : 'false'} data-muted={v?.muted ? 'true' : 'false'} className={`prow slot ${p.playerId === myId ? 'me' : ''} ${p.ready || host ? 'ready' : ''}`}>
              <Avatar player={p} voice={v} size={34} />
              <span className="prow-name name">
                {p.displayName}
                {p.playerId === myId ? <em> (você)</em> : null}
              </span>
              <ToolIcon weapon={p.weaponId} size={24} className="prow-tool" />
              <span className="prow-state">
                {p.connection === 'reconnecting' ? (
                  <span className="pill warn">reconectando</span>
                ) : host ? (
                  <span className="pill host" title="Organiza a sala">
                    <CrownIcon size={16} /> anfitrião
                  </span>
                ) : p.ready ? (
                  <span className="pill ok">
                    <CheckIcon size={13} /> pronto
                  </span>
                ) : (
                  <span className="pill">aguardando</span>
                )}
              </span>
            </li>
          );
        })}
        {Array.from({ length: props.bots }, (_, i) => (
          <li key={`b${i}`} className="prow slot bot">
            <span className="avatar bot-av" aria-hidden="true">
              <BotIcon size={22} />
            </span>
            <span className="prow-name">Bot da turma</span>
            <span className="pill dim">bot</span>
          </li>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <li key={`v${i}`} className="prow vaga">
            <span className="avatar vaga-av" aria-hidden="true" />
            <span className="prow-name">vaga livre</span>
          </li>
        ))}
        {filled === 0 && empty === 0 ? <li className="prow vaga">Ninguém nesta rodada</li> : null}
      </ul>
      {props.offStage ? <p className="muted small">No palco aparecem {filled - props.offStage}; a lista mostra todo mundo.</p> : null}
    </section>
  );
}

/* ------------------------------ Partida ------------------------------ */

function MatchOptions({ lobby, isHost }: { lobby: LobbyState; isHost: boolean }) {
  const c = getController();
  const set = (o: { mode?: GameModeId; map?: string; formation?: FormationOption }) => {
    if (isHost) c?.setOptions(o);
  };
  return (
    <div className="options">
      {!isHost ? <p className="note">Quem organiza a sala escolhe o modo, o mapa e o tamanho. Aqui você vê o que foi escolhido.</p> : null}
      <h3 className="hub-h">Modo</h3>
      <div className="big-cards" role="radiogroup" aria-label="Modo de jogo">
        {(Object.keys(MODES) as GameModeId[]).map((m) => (
          <button key={m} role="radio" aria-checked={lobby.mode === m} disabled={!isHost} className={`big-card mode-${m} ${lobby.mode === m ? 'selected' : ''}`} onClick={() => set({ mode: m })}>
            <ModeIcon mode={m} size={44} />
            <b>{MODES[m].name}</b>
            <span>{m === 'correio' ? `Leve a cápsula até a estação pintada. ${CORREIO.targetDeliveries} entregas vencem.` : MODES[m].short}</span>
          </button>
        ))}
      </div>
      <h3 className="hub-h">Mapa</h3>
      <div className="map-cards" role="radiogroup" aria-label="Mapa">
        <button role="radio" aria-checked={lobby.mapChoice === 'rotacao'} disabled={!isHost} className={`map-card ${lobby.mapChoice === 'rotacao' ? 'selected' : ''}`} onClick={() => set({ map: 'rotacao' })}>
          <span className="map-art rot" aria-hidden="true">
            <RotateIcon dir={1} size={28} />
          </span>
          <b>Rotação</b>
          <span>alterna a cada rodada</span>
        </button>
        {MAP_FAMILIES.map((f) => (
          <button key={f.id} role="radio" aria-checked={lobby.mapChoice === f.id} disabled={!isHost} className={`map-card ${lobby.mapChoice === f.id ? 'selected' : ''}`} onClick={() => set({ map: f.id })}>
            <MapArt id={f.id} />
            <b>{f.name}</b>
          </button>
        ))}
      </div>
      <p className="muted small">
        Próxima rodada: <b>{lobby.map.name}</b>, variante {VARIANT_NAME[lobby.map.variant]}. A variante sai do total de participantes ativos.
      </p>
      <h3 className="hub-h">Tamanho</h3>
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
      <details className="controls-box">
        <summary>Comandos</summary>
        <Controls />
      </details>
    </div>
  );
}

export function MapArt({ id }: { id: string }) {
  const [a, b] = MAP_ART[id] ?? ['#8a6a55', '#b98b6a'];
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

/* ------------------------------ Você ------------------------------ */

function Customize({ me, narrow }: { me: LobbyPlayer | undefined; narrow: boolean }) {
  const c = getController();
  const stored = useStore(settingsStore, (s) => s.appearance);
  // o que a pessoa acabou de escolher vale na hora (o servidor confirma em seguida)
  const look = parseAppearanceId(stored ?? me?.appearance);
  const pendingWeapon = useStore(uiStore, (s) => s.pendingWeapon);
  const weapon = pendingWeapon ?? me?.weaponId ?? 'esguicho';
  const lobbyNow = useStore(uiStore, (st) => st.lobby);
  const team: TeamId = (me ? lobbyNow?.plan.teamOf[me.playerId] : undefined) ?? me?.team ?? 0;
  const pick = (p: Partial<AppearanceParts>) => c?.setAppearance(formatAppearanceId({ ...look, ...p }));
  const hairIds = HAIR_STYLE_NAMES.map((_, h) => formatAppearanceId({ ...look, hair: h }));
  const baseIds = (['a', 'b'] as const).map((b) => formatAppearanceId({ ...look, base: b }));
  const hairShots = usePortraits(hairIds, team);
  const baseShots = usePortraits(baseIds, team);
  return (
    <div className={`customize ${narrow ? 'carousel' : ''}`}>
      <h3 className="hub-h">Ferramenta</h3>
      <div className="tool-row" role="radiogroup" aria-label="Ferramenta principal">
        {(Object.keys(WEAPONS) as WeaponId[]).map((w) => (
          <button key={w} role="radio" aria-checked={weapon === w} className={`tool-tile weapon ${weapon === w ? 'selected' : ''}`} onClick={() => c?.setWeapon(w)}>
            <ToolIcon weapon={w} size={46} />
            <b>{WEAPONS[w].name}</b>
            <span>{WEAPONS[w].role}</span>
          </button>
        ))}
      </div>
      <ToolDetail weapon={weapon} />

      <h3 className="hub-h">Visual</h3>
      <div className="look-group" role="radiogroup" aria-label="Base do personagem">
        <span className="look-label">Base</span>
        <div className="look-row">
          {(['a', 'b'] as const).map((b, i) => (
            <button key={b} role="radio" aria-checked={look.base === b} aria-label={b === 'a' ? 'Base 1: camiseta e bermuda' : 'Base 2: jardineira e legging'} className={`portrait ${look.base === b ? 'selected' : ''}`} onClick={() => pick({ base: b })}>
              <Shot src={baseShots[i]} />
              <span>{b === 'a' ? 'Camiseta' : 'Jardineira'}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="look-group" role="radiogroup" aria-label="Cabelo">
        <span className="look-label">Cabelo</span>
        <div className="look-row">
          {HAIR_STYLE_NAMES.map((name, h) => (
            <button key={h} role="radio" aria-checked={look.hair === h} aria-label={name} title={name} className={`portrait ${look.hair === h ? 'selected' : ''}`} onClick={() => pick({ hair: h })}>
              <Shot src={hairShots[h]} />
              <span>{name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="look-group" role="radiogroup" aria-label="Tom de pele">
        <span className="look-label">Pele</span>
        <div className="swatches">
          {SKIN_TONES.map((hex, t) => (
            <button key={t} role="radio" aria-checked={look.tone === t} aria-label={`Tom de pele ${t + 1}`} title={`Tom ${t + 1}`} className={`swatch ${look.tone === t ? 'selected' : ''}`} style={{ ['--sw' as string]: hex }} onClick={() => pick({ tone: t })} />
          ))}
        </div>
      </div>
      <div className="look-group" role="radiogroup" aria-label="Cor do cabelo">
        <span className="look-label">Cor do cabelo</span>
        <div className="swatches">
          {HAIR_COLORS.map((hex, k) => (
            <button key={k} role="radio" aria-checked={look.hairColor === k} aria-label={HAIR_COLOR_NAMES[k]} title={HAIR_COLOR_NAMES[k]} className={`swatch hair ${look.hairColor === k ? 'selected' : ''}`} style={{ ['--sw' as string]: hex }} onClick={() => pick({ hairColor: k })} />
          ))}
        </div>
      </div>
      <p className="muted small">Só aparência: altura, hitbox e movimento são iguais para todo mundo.</p>
    </div>
  );
}

function Shot({ src }: { src: string | undefined }) {
  return src ? <img src={src} alt="" width={64} height={64} draggable={false} /> : <span className="shot-wait" aria-hidden="true" />;
}

/** Retratos do modelo 3D (cache por aparência e turma). */
const shotCache = new Map<string, string>();
function usePortraits(ids: AppearanceId[], team: TeamId): Array<string | undefined> {
  // a cor efetiva da turma (par da rodada ou paleta de acessibilidade) entra na chave
  const teamColor = useTeams()[team].color;
  const [retry, setRetry] = useState(0);
  const key = `${team}:${teamColor}:${ids.join(',')}:${retry}`;
  const ck = (a: AppearanceId) => `${team}:${teamColor}:${a}`;
  const [, bump] = useState(0);
  useEffect(() => {
    const missing = ids.filter((a) => !shotCache.has(ck(a)));
    if (!missing.length) return;
    let alive = true;
    // espera um pouco: trocas seguidas (passar pelas cores) viram um lote só; sem runtime
    // (troca de mapa) ou com falha, tenta de novo em seguida
    const t = setTimeout(() => {
      const rt = getController()?.runtime;
      if (!rt) return void (alive && setTimeout(() => setRetry((x) => x + 1), 800));
      rt.portraits(missing, team)
        .then((urls) => {
          urls.forEach((u, i) => u && shotCache.set(ck(missing[i]), u));
          if (alive) bump((x) => x + 1);
        })
        .catch(() => alive && setTimeout(() => setRetry((x) => x + 1), 800));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ids.map((a) => shotCache.get(ck(a)));
}

function ToolDetail({ weapon }: { weapon: WeaponId }) {
  const d = WEAPONS[weapon];
  const st = STATS[weapon];
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !motionAllowed()) return;
    const ctx = gsap.context(() => {
      gsap.from('.td-name, .td-desc', { x: 18, opacity: 0, duration: 0.28, stagger: 0.05, ease: 'power2.out', clearProps: 'transform,opacity' });
    }, el);
    return () => ctx.revert();
  }, [weapon]);
  return (
    <div className="tool-detail" ref={ref} aria-live="polite">
      <div className="td-name">
        {d.name} <span className="pill">{d.role}</span>
      </div>
      <p className="td-desc">{d.description}</p>
      <div className="td-stats">
        {(Object.keys(STAT_NAMES) as Array<keyof typeof STAT_NAMES>).map((k) => (
          <div className="td-stat" key={k}>
            <span>{STAT_NAMES[k]}</span>
            <span className="bar" role="meter" aria-label={STAT_NAMES[k]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(st[k] * 100)}>
              <i style={{ width: `${st[k] * 100}%` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Área de giro do personagem na vitrine: arrasto (mouse ou dedo), botões e analógico direito. */
function TurnTable() {
  const drag = useRef<{ id: number; x: number } | null>(null);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const rx = gamepadHub.active ? gamepadHub.frame.rx : 0;
      if (Math.abs(rx) > 0.2) getController()?.rotateStage(-rx * dt * 3.2);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const hints = useHints();
  return (
    <div
      className="turntable"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        drag.current = { id: e.pointerId, x: e.clientX };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        // "girar um prato": arrastar para a direita leva a frente do personagem para a direita
        getController()?.rotateStage(-(e.clientX - d.x) * 0.012);
        d.x = e.clientX;
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <div className="turn-hint">
        <button className="round-btn" aria-label="Girar para a esquerda" data-sfx="none" onClick={() => getController()?.rotateStage(0.5)}>
          <RotateIcon dir={-1} />
        </button>
        <span>{hints.device === 'controle' ? 'Analógico direito gira' : 'Arraste para girar'}</span>
        <button className="round-btn" aria-label="Girar para a direita" data-sfx="none" onClick={() => getController()?.rotateStage(-0.5)}>
          <RotateIcon dir={1} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ ação principal ------------------------------ */

function ActionDock({ lobby, myId }: { lobby: LobbyState; myId: number }) {
  const c = getController();
  const me = lobby.players.find((p) => p.playerId === myId);
  const isHost = lobby.hostPlayerId === myId;
  const others = lobby.players.filter((p) => !p.isBot && p.connection === 'connected' && p.playerId !== lobby.hostPlayerId);
  const notReady = others.filter((p) => !p.ready);
  const plan = lobby.plan;
  const canStart = isHost && notReady.length === 0 && !plan.blocked;
  const queued = plan.queue.includes(myId);
  return (
    <footer className="hub-dock">
      <div className="dock-status summary" aria-live="polite">
        {plan.blocked ? (
          <span className="pill warn">{plan.blocked}</span>
        ) : others.length ? (
          <>
            <span className="ready-count">
              <b>{others.length - notReady.length}</b> de {others.length} pront{others.length === 1 ? 'o' : 'os'}
            </span>
            <span className="dots" aria-hidden="true">
              {others.map((p) => (
                <i key={p.playerId} className={p.ready ? 'on' : ''} />
              ))}
            </span>
          </>
        ) : (
          <span className="ready-count">
            {plan.bots[0] + plan.bots[1] === 0 ? 'Só você na sala' : `Sala com você e ${plan.bots[0] + plan.bots[1]} bot${plan.bots[0] + plan.bots[1] > 1 ? 's' : ''}`}
          </span>
        )}
        {queued ? <span className="pill warn">Você fica no banco: assiste e entra na próxima rodada</span> : null}
        {isHost && notReady.length > 0 ? <span className="muted small">Aguardando prontos: {notReady.map((p) => p.displayName).join(', ')}</span> : null}
        {!isHost ? <span className="muted small">Quem organiza a sala inicia quando todos estiverem prontos.</span> : null}
      </div>
      {!isHost ? (
        <button className={`go-btn ${me?.ready ? 'is-ready' : ''}`} data-sfx={me?.ready ? 'back' : undefined} onClick={() => c?.setReady(!me?.ready)} aria-pressed={!!me?.ready}>
          {me?.ready ? (
            <>
              <CheckIcon size={26} /> Cancelar pronto
            </>
          ) : (
            'Estou pronto'
          )}
        </button>
      ) : (
        <button className="go-btn host" disabled={!canStart} onClick={() => c?.startMatch()} title={plan.blocked ?? (canStart ? '' : `Aguardando: ${notReady.map((p) => p.displayName).join(', ')}`)}>
          Começar partida
        </button>
      )}
    </footer>
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

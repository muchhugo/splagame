import { useEffect, useState } from 'react';
import { GAME_NAME } from '@borrifo/game-contracts';
import { AppController } from '../app/AppController';
import { settingsStore, teamColorsFor } from '../app/settings';
import { useStore } from '../app/store';
import { pushNotice, showError, uiStore } from '../app/uiStore';
import { connectEmbedded, connectStandaloneDev, isEmbedded, readHandshakeFragment } from '../boot/host';
import { CLIENT_CONFIG } from '../config';
import { Logo } from './Logo';
import { Lobby } from './Lobby';
import { Hud } from './Hud';
import { Results } from './Results';
import { Menu } from './Menu';
import { StandaloneLogin } from './StandaloneLogin';
import { TacticalMap } from './TacticalMap';
import { Notices } from './Notices';
import { TouchControls } from './TouchControls';
import { Tutorial } from './Tutorial';
import { installGamepadNav } from './gamepadNav';
import { deviceStore, installDeviceTracking } from '../game/input/device';
import { familyName } from '../game/input/gamepad';
import { hudStore } from '../game/hud';
import { useHints } from '../app/hints';

let controller: AppController | null = null;
export function getController() {
  return controller;
}

async function startWith(client: import('@borrifo/activity-sdk').ActivityClient) {
  controller = new AppController(client);
  // gancho de diagnóstico SOMENTE em desenvolvimento (testes E2E automatizados)
  if (import.meta.env.DEV) (window as unknown as { __borrifo?: unknown }).__borrifo = { controller, uiStore };
  await controller.start();
}

export function App() {
  const screen = useStore(uiStore, (s) => s.screen);
  const menuOpen = useStore(uiStore, (s) => s.menuOpen);
  const mapOpen = useStore(uiStore, (s) => s.mapOpen);
  const palette = useStore(settingsStore, (s) => s.palette);
  const teamPairId = useStore(uiStore, (s) => s.lobby?.teamPairId);
  const hudScale = useStore(settingsStore, (s) => s.hudScale);
  const reduceMotion = useStore(settingsStore, (s) => s.reduceMotion);
  const [booted, setBooted] = useState(false);
  // a interface do lobby recolhe (em vez de sumir) quando a rodada começa. Estado derivado
  // durante o render: o MESMO Lobby continua montado e só ganha a classe de saída
  const [prevScreen, setPrevScreen] = useState(screen);
  const [leavingLobby, setLeavingLobby] = useState(false);
  if (prevScreen !== screen) {
    setPrevScreen(screen);
    setLeavingLobby(prevScreen === 'lobby' && (screen === 'match' || screen === 'waiting'));
  }
  useEffect(() => {
    if (!leavingLobby) return;
    const t = setTimeout(() => setLeavingLobby(false), 700);
    return () => clearTimeout(t);
  }, [leavingLobby]);
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = reduceMotion ? 'true' : 'false';
  }, [reduceMotion]);

  // variáveis de cor das equipes (apresentação) e escala do HUD
  useEffect(() => {
    const [c0, c1] = teamColorsFor(palette, teamPairId);
    document.documentElement.style.setProperty('--team0', c0);
    document.documentElement.style.setProperty('--team1', c1);
    document.documentElement.style.setProperty('--hud-scale', String(hudScale));
  }, [palette, teamPairId, hudScale]);

  // sons de interface num só lugar: todo botão confirma; data-sfx="back" cancela/sai;
  // controles de toque e o mapa tático são gameplay e ficam de fora
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      const b = (ev.target as HTMLElement | null)?.closest?.('button');
      if (!b || b.disabled || b.closest('.touch') || b.dataset.sfx === 'none') return;
      void getController()?.uiSound(b.dataset.sfx === 'back' ? 'back' : 'confirm');
    };
    // qualquer interação conta como gesto para destravar o áudio (política de autoplay)
    const onGesture = () => {
      const c = getController();
      if (c && !c.audioRunning) void c.unlockAudio();
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
    };
  }, []);

  // controles: avisos de conexão, último dispositivo usado (dicas) e navegação da interface
  useEffect(() => {
    installDeviceTracking(pushNotice, familyName);
    installGamepadNav();
  }, []);

  // composição do HUD por dispositivo (toque tem layout próprio: polegares embaixo, informação em cima)
  const device = useStore(deviceStore, (d) => d.device);
  useEffect(() => {
    document.documentElement.dataset.device = device;
  }, [device]);

  useEffect(() => {
    if (booted) return;
    setBooted(true);
    (async () => {
      if (isEmbedded()) {
        const { nonce } = readHandshakeFragment();
        if (!nonce) {
          showError({ title: 'Abertura inválida', message: 'Esta Atividade precisa ser aberta pelo host (falta o identificador de sessão do handshake).', actions: ['reload'] });
          return;
        }
        try {
          await startWith(await connectEmbedded(nonce));
        } catch (e) {
          showError({ title: 'O host não respondeu', message: `Não foi possível conectar ao aplicativo que abriu esta Atividade: ${(e as Error).message}`, actions: ['reload'] });
        }
      } else if (CLIENT_CONFIG.standaloneDevHostEnabled) {
        uiStore.set({ screen: 'standalone' });
      } else {
        showError({ title: `${GAME_NAME} é uma Atividade`, message: 'Abra o jogo a partir de uma chamada ou canal do aplicativo.', actions: [] });
      }
    })();
  }, [booted]);

  const onStandalone = async (userId: string, name: string, sid: string) => {
    uiStore.set({ screen: 'boot' });
    try {
      await startWith(connectStandaloneDev(userId, name, sid));
    } catch (e) {
      showError({ title: 'Falha no host de desenvolvimento', message: (e as Error).message, actions: ['reload'] });
    }
  };

  return (
    <>
      {screen === 'boot' || screen === 'connecting' ? <BootScreen connecting={screen === 'connecting'} /> : null}
      {screen === 'standalone' ? <StandaloneLogin onSubmit={onStandalone} /> : null}
      {screen === 'lobby' ? <Lobby /> : leavingLobby ? <Lobby leaving /> : null}
      {screen === 'waiting' ? <Waiting /> : null}
      <MapLoading />
      {screen === 'match' ? <Hud /> : null}
      {screen === 'match' ? <TouchControls /> : null}
      {screen === 'match' ? <Tutorial /> : null}
      {screen === 'match' && mapOpen ? <TacticalMap /> : null}
      {screen === 'results' ? <Results /> : null}
      {screen === 'error' ? <ErrorScreen /> : null}
      {screen === 'closed' ? <Closed /> : null}
      {menuOpen && (screen === 'match' || screen === 'lobby' || screen === 'results' || screen === 'waiting') ? <Menu /> : null}
      <Notices />
      <RotateToLandscape />
    </>
  );
}

function BootScreen({ connecting }: { connecting: boolean }) {
  const boot = useStore(uiStore, (s) => s.boot);
  const tips = ['Na Forma Pião você desliza e recarrega na tinta da sua turma.', 'Paredes pintadas viram atalhos: segure a Forma Pião e empurre contra elas.', 'Vence quem cobre mais chão no fim — eliminar é só um meio.', 'A tinta adversária te deixa lento e visível.'];
  const [tip] = useState(() => tips[Math.floor(Math.random() * tips.length)]);
  return (
    <div className="screen solid" role="status" aria-live="polite">
      <div className="boot">
        <Logo size={96} />
        <div className="progress" aria-label="Carregando">
          <div style={{ width: `${Math.round((connecting ? 1 : boot.progress) * 100)}%` }} />
        </div>
        <div>{connecting ? 'Entrando na sala…' : boot.label}</div>
        <div className="tip">{tip}</div>
      </div>
    </div>
  );
}

/**
 * Banco: quem entrou com a partida em andamento (ou ficou fora da formação) assiste
 * à rodada ao vivo, acompanhando qualquer participante ou a visão geral, e entra na
 * próxima rodada. O HUD mostra placar e tempo; nada pessoal (sem mira, tinta ou vida).
 */
function Waiting() {
  const lobby = useStore(uiStore, (s) => s.lobby);
  const myId = useStore(uiStore, (s) => s.welcome?.playerId);
  const target = useStore(hudStore, (s) => s.spectateTarget);
  const spectating = useStore(hudStore, (s) => s.spectating);
  const hints = useHints();
  const me = lobby?.players.find((p) => p.playerId === myId);
  const c = getController();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (uiStore.get().menuOpen) return;
      if (e.code === 'ArrowRight' || e.code === 'KeyE') c?.spectateNext(1);
      else if (e.code === 'ArrowLeft' || e.code === 'KeyQ') c?.spectateNext(-1);
      else if (e.code === 'KeyV') c?.spectateOverview();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [c]);
  return (
    <>
      {spectating ? <Hud /> : null}
      <div className="bench" role="region" aria-label="Banco">
        <span className="bench-tag">
          <b>No banco</b>
          <span>{me?.queued ? 'Formação completa · você tem prioridade na próxima' : 'Você entra na próxima rodada'}</span>
        </span>
        <span className="bench-target" aria-live="polite">
          <button className="round-btn" aria-label="Acompanhar o anterior" onClick={() => c?.spectateNext(-1)}>
            ‹
          </button>
          <span className={`bench-name ${target ? `t${target.team}` : ''}`}>{target ? target.name : 'Visão geral'}</span>
          <button className="round-btn" aria-label="Acompanhar o próximo" onClick={() => c?.spectateNext(1)}>
            ›
          </button>
        </span>
        <button className="btn small ghost" onClick={() => c?.spectateOverview()} aria-pressed={!target}>
          Visão geral
        </button>
        {hints.device === 'teclado' ? <span className="bench-keys">Q/E trocam · V visão geral</span> : null}
      </div>
    </>
  );
}

/**
 * No celular o jogo é só na horizontal: em pé, uma tela pede para girar o aparelho
 * (a partida continua para os outros; nada é pausado). Tenta travar a orientação
 * quando o navegador permite (tela cheia); se não permitir, a tela de girar basta.
 */
function RotateToLandscape() {
  const q = '(pointer: coarse) and (orientation: portrait)';
  const [portrait, setPortrait] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(q);
    const on = () => setPortrait(m.matches);
    m.addEventListener('change', on);
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    void o?.lock?.('landscape').catch(() => {});
    return () => m.removeEventListener('change', on);
  }, []);
  if (!portrait) return null;
  return (
    <div className="rotate-screen" role="alertdialog" aria-labelledby="rotate-title">
      <svg viewBox="0 0 120 120" className="rotate-phone" aria-hidden="true">
        <rect x="38" y="18" width="44" height="80" rx="9" fill="var(--creme)" stroke="var(--barro-900)" strokeWidth="5" />
        <rect x="45" y="28" width="30" height="58" rx="3" fill="var(--ouro)" />
        <path d="M22 70 a40 40 0 0 0 26 34" fill="none" stroke="var(--creme)" strokeWidth="6" strokeLinecap="round" />
        <path d="M40 98 l9 7 -10 5" fill="none" stroke="var(--creme)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h2 id="rotate-title">Gire o celular</h2>
      <p>O Borrifo é jogado com o celular deitado.</p>
    </div>
  );
}

/** Troca de mapa entre rodadas: nome e variante do lugar enquanto a cena é montada. */
function MapLoading() {
  const ml = useStore(uiStore, (s) => s.mapLoading);
  if (!ml) return null;
  const v = ml.variant === 'compacto' ? 'compacta' : ml.variant === 'ampliado' ? 'ampliada' : 'padrão';
  return (
    <div className="screen solid map-loading" role="status" aria-live="polite">
      <div className="boot">
        <Logo size={64} />
        <h2>{ml.name}</h2>
        <span className="chip">variante {v}</span>
        <div className="progress" aria-label="Carregando o mapa">
          <div style={{ width: `${Math.round(ml.progress * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

function ErrorScreen() {
  const err = useStore(uiStore, (s) => s.error);
  if (!err) return null;
  return (
    <div className="screen solid" role="alertdialog" aria-labelledby="err-title">
      <div className="panel dialog">
        <Logo size={48} />
        <h2 id="err-title">{err.title}</h2>
        <p className="muted">{err.message}</p>
        <div className="row">
          {err.actions.includes('retry') ? (
            <button className="btn primary" onClick={() => getController()?.retry()} autoFocus>
              Tentar de novo
            </button>
          ) : null}
          {err.actions.includes('reload') ? (
            <button className="btn ghost" onClick={() => location.reload()}>
              Recarregar
            </button>
          ) : null}
          {err.actions.includes('close') ? (
            <button className="btn ghost" data-sfx="back" onClick={() => void getController()?.close('user')}>
              Sair da Atividade
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Closed() {
  return (
    <div className="screen solid">
      <div className="panel dialog">
        <Logo size={48} />
        <h2>Atividade encerrada</h2>
        <p className="muted">A conexão com a partida foi fechada. Sua chamada no aplicativo não foi afetada.</p>
        <button className="btn ghost" onClick={() => location.reload()}>
          Abrir de novo
        </button>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { GAME_NAME } from '@borrifo/game-contracts';
import { AppController } from '../app/AppController';
import { settingsStore, PALETTES } from '../app/settings';
import { useStore } from '../app/store';
import { showError, uiStore } from '../app/uiStore';
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
  const hudScale = useStore(settingsStore, (s) => s.hudScale);
  const [booted, setBooted] = useState(false);

  // variáveis de cor das equipes (apresentação) e escala do HUD
  useEffect(() => {
    const [c0, c1] = PALETTES[palette].team;
    document.documentElement.style.setProperty('--team0', c0);
    document.documentElement.style.setProperty('--team1', c1);
    document.documentElement.style.setProperty('--hud-scale', String(hudScale));
  }, [palette, hudScale]);

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
      {screen === 'lobby' ? <Lobby /> : null}
      {screen === 'waiting' ? <Waiting /> : null}
      {screen === 'match' ? <Hud /> : null}
      {screen === 'match' ? <TouchControls /> : null}
      {screen === 'match' && mapOpen ? <TacticalMap /> : null}
      {screen === 'results' ? <Results /> : null}
      {screen === 'error' ? <ErrorScreen /> : null}
      {screen === 'closed' ? <Closed /> : null}
      {menuOpen && (screen === 'match' || screen === 'lobby' || screen === 'results' || screen === 'waiting') ? <Menu /> : null}
      <Notices />
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

function Waiting() {
  const lobby = useStore(uiStore, (s) => s.lobby);
  return (
    <div className="screen">
      <div className="panel dialog">
        <Logo size={56} />
        <h2>Partida em andamento</h2>
        <p className="muted">Você entra na próxima rodada. Enquanto isso, a arena segue ao fundo.</p>
        <p className="muted">
          {lobby?.players.filter((p) => p.inRound).length ?? 0} participantes jogando em {lobby?.map.name}.
        </p>
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
            <button className="btn ghost" onClick={() => void getController()?.close('user')}>
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

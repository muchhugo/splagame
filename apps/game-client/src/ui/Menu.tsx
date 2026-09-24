import { useState } from 'react';
import { useStore } from '../app/store';
import { uiStore } from '../app/uiStore';
import { ACTION_LABELS, DEFAULT_SETTINGS, PALETTES, settingsStore, type BindableAction, type Settings } from '../app/settings';
import { getController } from './App';
import { keyName } from './Lobby';
import { VoiceChip } from './VoiceChip';

/** Menu (Esc). A partida continua para todos enquanto ele está aberto. */
export function Menu() {
  const settingsOpen = useStore(uiStore, (s) => s.settingsOpen);
  const screen = useStore(uiStore, (s) => s.screen);
  const c = getController();
  if (settingsOpen) return <SettingsPanel onClose={() => uiStore.set({ settingsOpen: false, ...(screen !== 'match' ? { menuOpen: false } : {}) })} />;
  return (
    <div className="screen" onKeyDown={(e) => e.key === 'Escape' && c?.resumeGame()}>
      <div className="panel menu" role="dialog" aria-labelledby="menu-title">
        <h2 id="menu-title" style={{ margin: 0 }}>
          Menu
        </h2>
        {screen === 'match' ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>A partida continua enquanto este menu está aberto.</p> : null}
        <button className="btn primary" onClick={() => c?.resumeGame()} autoFocus>
          {screen === 'match' ? 'Voltar ao jogo' : 'Fechar'}
        </button>
        <button className="btn ghost" onClick={() => uiStore.set({ settingsOpen: true })}>
          Configurações
        </button>
        <button className="btn ghost" onClick={() => void c?.toggleFullscreen()}>
          Tela cheia
        </button>
        <div className="row">
          <VoiceChip />
        </div>
        <button className="btn ghost" onClick={() => void c?.close('user')}>
          Sair da Atividade
        </button>
      </div>
    </div>
  );
}

type Tab = 'controles' | 'video' | 'acessibilidade' | 'audio';

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useStore(settingsStore, (x) => x);
  const [tab, setTab] = useState<Tab>('controles');
  const [listening, setListening] = useState<BindableAction | null>(null);
  const set = (p: Partial<Settings>) => settingsStore.set(p);
  const slider = (label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string = (v) => v.toFixed(2)) => (
    <label className="setting">
      <span>
        {label}: <b>{fmt(s[key] as number)}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={s[key] as number} onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<Settings>)} />
    </label>
  );
  const toggle = (label: string, key: keyof Settings) => (
    <label className="setting">
      <span>{label}</span>
      <input type="checkbox" checked={s[key] as boolean} onChange={(e) => set({ [key]: e.target.checked } as Partial<Settings>)} />
    </label>
  );
  const bindKey = (e: React.KeyboardEvent) => {
    if (!listening) return;
    e.preventDefault();
    if (e.code !== 'Escape') set({ keybinds: { ...s.keybinds, [listening]: e.code } });
    setListening(null);
  };
  return (
    <div className="screen" onKeyDown={bindKey}>
      <div className="panel settings" role="dialog" aria-labelledby="set-title">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="set-title" style={{ margin: 0 }}>
            Configurações
          </h2>
          <button className="btn small ghost" onClick={onClose}>
            Fechar
          </button>
        </div>
        <div className="tabs" role="tablist">
          {(['controles', 'video', 'acessibilidade', 'audio'] as Tab[]).map((t) => (
            <button key={t} className="btn small ghost" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {{ controles: 'Controles', video: 'Vídeo', acessibilidade: 'Acessibilidade', audio: 'Áudio' }[t]}
            </button>
          ))}
        </div>
        {tab === 'controles' ? (
          <>
            {slider('Sensibilidade do mouse', 'sensitivity', 0.2, 3, 0.05)}
            {toggle('Inverter eixo vertical', 'invertY')}
            <label className="setting">
              <span>Forma Pião</span>
              <select value={s.flowMode} onChange={(e) => set({ flowMode: e.target.value as Settings['flowMode'] })}>
                <option value="hold">Segurar</option>
                <option value="toggle">Alternar</option>
              </select>
            </label>
            <label className="setting">
              <span>Mapa tático</span>
              <select value={s.mapMode} onChange={(e) => set({ mapMode: e.target.value as Settings['mapMode'] })}>
                <option value="hold">Segurar</option>
                <option value="toggle">Alternar</option>
              </select>
            </label>
            {(Object.keys(ACTION_LABELS) as BindableAction[]).map((a) => (
              <div className="setting" key={a}>
                <span>{ACTION_LABELS[a]}</span>
                <button className={`keybtn ${listening === a ? 'listening' : ''}`} onClick={() => setListening(a)}>
                  {listening === a ? 'Pressione uma tecla…' : keyName(s.keybinds[a])}
                </button>
              </div>
            ))}
            <button className="btn small ghost" onClick={() => set({ keybinds: DEFAULT_SETTINGS.keybinds })}>
              Restaurar teclas padrão
            </button>
          </>
        ) : null}
        {tab === 'video' ? (
          <>
            <label className="setting">
              <span>Qualidade gráfica</span>
              <select value={s.quality} onChange={(e) => set({ quality: e.target.value as Settings['quality'] })}>
                <option value="baixa">Baixa (GPU integrada)</option>
                <option value="media">Média</option>
                <option value="alta">Alta</option>
              </select>
            </label>
            <label className="setting">
              <span>Limite de FPS</span>
              <select value={s.fpsCap} onChange={(e) => set({ fpsCap: Number(e.target.value) as Settings['fpsCap'] })}>
                <option value={0}>Sem limite (vsync)</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
                <option value={120}>120</option>
              </select>
            </label>
            {slider('Campo de visão (°)', 'fov', 55, 95, 1, (v) => String(v))}
            {slider('Deslocamento do ombro', 'shoulder', -0.9, 0.9, 0.05)}
            {slider('Tamanho do HUD', 'hudScale', 0.8, 1.4, 0.05)}
          </>
        ) : null}
        {tab === 'acessibilidade' ? (
          <>
            <label className="setting">
              <span>Paleta das turmas</span>
              <select value={s.palette} onChange={(e) => set({ palette: e.target.value as Settings['palette'] })}>
                {Object.entries(PALETTES).map(([k, p]) => (
                  <option key={k} value={k}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {toggle('Padrões na tinta (listras ▲ / pontos ●)', 'paintPatterns')}
            {toggle('Reduzir tremor da câmera', 'reduceShake')}
            {toggle('Reduzir clarões e partículas', 'reduceFlashes')}
            <p className="muted" style={{ fontSize: 12 }}>
              A cor é só apresentação: trocar a paleta não altera o dono lógico da tinta. As turmas também são identificadas por símbolo (▲ Urucum, ● Anil).
            </p>
          </>
        ) : null}
        {tab === 'audio' ? (
          <>
            {slider('Volume geral', 'volumeMaster', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
            {slider('Efeitos', 'volumeSfx', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
            {slider('Música', 'volumeMusic', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
            {toggle('Silenciar o jogo', 'muted')}
            <p className="muted" style={{ fontSize: 12 }}>
              O volume da voz é controlado pelo aplicativo (host), não pelo jogo.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

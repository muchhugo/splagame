import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { uiStore } from '../app/uiStore';
import { ACTION_LABELS, DEFAULT_GAMEPAD, DEFAULT_SETTINGS, PALETTES, rebind, settingsStore, type BindableAction, type GamepadSettings, type Settings } from '../app/settings';
import { keyName, useHints } from '../app/hints';
import { PAD_ACTIONS, PAD_ACTION_LABELS, RUMBLE, buttonGlyph, familyName, gamepadHub, type PadAction } from '../game/input/gamepad';
import { padCapture } from './gamepadNav';
import { getController } from './App';
import { VoiceChip } from './VoiceChip';
import { endTutorial, restartTutorial, skipStep, tutorialStore } from '../app/tutorial';

/** Menu (Esc). A partida continua para todos enquanto ele está aberto. */
export function Menu() {
  const settingsOpen = useStore(uiStore, (s) => s.settingsOpen);
  const screen = useStore(uiStore, (s) => s.screen);
  const tutorial = useStore(tutorialStore, (t) => t.active);
  const c = getController();
  if (settingsOpen) return <SettingsPanel onClose={() => uiStore.set({ settingsOpen: false, ...(screen !== 'match' ? { menuOpen: false } : {}) })} />;
  return (
    <div className="screen settings-screen" onKeyDown={(e) => e.key === 'Escape' && c?.resumeGame()}>
      <div className="panel menu" role="dialog" aria-modal="true" aria-labelledby="menu-title">
        <h2 id="menu-title" className="menu-title">
          Menu
        </h2>
        {screen === 'match' ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>A partida continua enquanto este menu está aberto.</p> : null}
        <button className="btn primary big" onClick={() => c?.resumeGame()} autoFocus>
          {screen === 'match' ? 'Voltar ao jogo' : 'Fechar'}
        </button>
        <button className="btn ghost" onClick={() => uiStore.set({ settingsOpen: true })}>
          Configurações
        </button>
        <button className="btn ghost" onClick={() => void c?.toggleFullscreen()}>
          Tela cheia
        </button>
        {tutorial ? (
          <div className="row">
            <button className="btn small ghost" onClick={() => skipStep()}>
              Pular etapa do treino
            </button>
            <button className="btn small ghost" data-sfx="back" onClick={() => endTutorial()}>
              Encerrar treino
            </button>
          </div>
        ) : (
          <button className="btn ghost" onClick={() => restartTutorial(getController()?.tutorialContext())}>
            {screen === 'match' ? 'Refazer o treino rápido' : 'Refazer o treino na próxima rodada'}
          </button>
        )}
        <div className="row">
          <VoiceChip />
        </div>
        <button className="btn ghost" data-sfx="back" onClick={() => void c?.close('user')}>
          Sair da Atividade
        </button>
      </div>
    </div>
  );
}

type Tab = 'jogo' | 'graficos' | 'audio' | 'controles' | 'toque' | 'acessibilidade';
const TAB_LABELS: Record<Tab, string> = { jogo: 'Jogo', graficos: 'Gráficos', audio: 'Áudio', controles: 'Controles', toque: 'Toque', acessibilidade: 'Acessibilidade' };

/**
 * Configurações em painel grande, com categorias claras. O cenário fica atrás, escurecido
 * e desfocado de leve. Teclado, controle (L1/R1 trocam de categoria) e toque.
 */
function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useStore(settingsStore, (x) => x);
  const hints = useHints();
  const screen = useStore(uiStore, (x) => x.screen);
  const [tab, setTab] = useState<Tab>(() => (hints.device === 'controle' ? 'controles' : hints.device === 'toque' ? 'toque' : 'jogo'));
  const [input, setInput] = useState<'teclado' | 'controle'>(() => (hints.device === 'controle' ? 'controle' : 'teclado'));
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
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const bindKey = (e: React.KeyboardEvent) => {
    if (!listening) {
      if (e.code === 'Escape') onClose();
      return;
    }
    e.preventDefault();
    // tecla já usada por outra ação: as duas trocam (nunca ficam duas ações na mesma tecla)
    if (e.code !== 'Escape') set({ keybinds: rebind(s.keybinds, listening, e.code) });
    setListening(null);
  };
  return (
    <div className="screen settings-screen" onKeyDown={bindKey}>
      <div className="panel settings" role="dialog" aria-modal="true" aria-labelledby="set-title">
        <header className="set-head">
          <h2 id="set-title">Configurações</h2>
          <button className="round-btn" data-sfx="back" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>
        <div className="set-body">
          <nav className="set-tabs" role="tablist" aria-label="Categorias" aria-orientation="vertical">
            {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
              <button key={t} className={`set-tab ${tab === t ? 'on' : ''}`} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {TAB_LABELS[t]}
              </button>
            ))}
          </nav>
          <section className="set-page" key={tab}>
            {tab === 'jogo' ? (
              <>
                <h3 className="hub-h">Câmera e HUD</h3>
                {slider('Campo de visão (°)', 'fov', 55, 95, 1, (v) => String(v))}
                {slider('Deslocamento do ombro', 'shoulder', -0.9, 0.9, 0.05)}
                {slider('Tamanho do HUD', 'hudScale', 0.8, 1.4, 0.05)}
                <h3 className="hub-h">Ações</h3>
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
                <h3 className="hub-h">Treino</h3>
                <button className="btn small ghost" onClick={() => restartTutorial(getController()?.tutorialContext())}>
                  {screen === 'match' ? 'Refazer o treino rápido agora' : 'Refazer o treino na próxima rodada'}
                </button>
              </>
            ) : null}
            {tab === 'graficos' ? (
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
                <label className="setting">
                  <span>Resolução interna</span>
                  <select value={s.resolution} onChange={(e) => set({ resolution: Number(e.target.value) })}>
                    <option value={0}>Automática (pela qualidade)</option>
                    <option value={1}>100% (nativa)</option>
                    <option value={0.85}>85%</option>
                    <option value={0.7}>70%</option>
                    <option value={0.5}>50%</option>
                  </select>
                </label>
                {toggle('Pós-processamento (antisserrilhado e brilho)', 'postFx')}
                <label className="setting">
                  <span>Partículas de tinta</span>
                  <select value={s.particles} onChange={(e) => set({ particles: e.target.value as Settings['particles'] })}>
                    <option value="normal">Normais</option>
                    <option value="reduzidas">Reduzidas</option>
                  </select>
                </label>
                <p className="muted small">Na qualidade baixa, o palco do lobby mostra até 3 pessoas por turma (a lista mostra todo mundo).</p>
              </>
            ) : null}
            {tab === 'audio' ? (
              <>
                {slider('Volume geral', 'volumeMaster', 0, 1, 0.05, pct)}
                {slider('Efeitos', 'volumeSfx', 0, 1, 0.05, pct)}
                {slider('Música', 'volumeMusic', 0, 1, 0.05, pct)}
                {toggle('Silenciar o jogo', 'muted')}
                <p className="muted small">O volume da voz é controlado pelo aplicativo (host), não pelo jogo.</p>
              </>
            ) : null}
            {tab === 'controles' ? (
              <>
                <div className="seg" role="radiogroup" aria-label="Dispositivo">
                  <button role="radio" aria-checked={input === 'teclado'} className={input === 'teclado' ? 'on' : ''} onClick={() => setInput('teclado')}>
                    Teclado e mouse
                  </button>
                  <button role="radio" aria-checked={input === 'controle'} className={input === 'controle' ? 'on' : ''} onClick={() => setInput('controle')}>
                    Controle
                  </button>
                </div>
                {input === 'teclado' ? (
                  <>
                    {slider('Sensibilidade do mouse', 'sensitivity', 0.2, 3, 0.05)}
                    {toggle('Inverter eixo vertical', 'invertY')}
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
                ) : (
                  <GamepadTab />
                )}
              </>
            ) : null}
            {tab === 'toque' ? (
              <>
                {slider('Sensibilidade da câmera no toque', 'touchSens', 0.3, 3, 0.05)}
                {slider('Tamanho dos botões', 'touchScale', 0.8, 1.4, 0.05, pct)}
                {slider('Opacidade dos botões', 'touchOpacity', 0.35, 1, 0.05, pct)}
                {toggle('Trocar os lados (analógico à direita)', 'touchSwap')}
                <p className="muted small">Os controles de toque aparecem em aparelhos com tela de toque. Ainda não foram verificados em celular físico.</p>
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
                {toggle('Reduzir animações da interface', 'reduceMotion')}
                <p className="muted small">A cor é só apresentação: trocar a paleta não altera o dono lógico da tinta. As turmas também são identificadas por símbolo (▲ e ●), além da cor.</p>
              </>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Configurações › Controle: sensibilidade, zonas mortas, curva, vibração, mira assistida e botões. */
function GamepadTab() {
  const g = useStore(settingsStore, (x) => x.gamepad);
  const mapMode = useStore(settingsStore, (x) => x.mapMode);
  const hints = useHints();
  const [listening, setListening] = useState<PadAction | null>(null);
  const [live, setLive] = useState('');
  const setPad = (p: Partial<GamepadSettings>) => settingsStore.set((st) => ({ gamepad: { ...st.gamepad, ...p } }));
  const pad = hints.pad;
  const glyph = (i: number) => buttonGlyph(hints.family, i);

  // remapeamento: o próximo botão apertado vai para a ação; Esc ou 6 s cancelam
  useEffect(() => {
    if (!listening) return;
    const timer = setTimeout(() => setListening(null), 6000);
    padCapture.fn = (button) => {
      settingsStore.set((st) => ({ gamepad: { ...st.gamepad, binds: rebind(st.gamepad.binds, listening, button) } }));
      setListening(null);
    };
    const esc = (e: KeyboardEvent) => e.code === 'Escape' && (e.stopPropagation(), setListening(null));
    window.addEventListener('keydown', esc, true);
    return () => {
      clearTimeout(timer);
      padCapture.fn = null;
      window.removeEventListener('keydown', esc, true);
    };
  }, [listening]);

  // leitura ao vivo, para conferir controles genéricos ou sem mapeamento padrão
  useEffect(() => {
    const t = setInterval(() => {
      const f = gamepadHub.frame;
      const down = f.pressed.map((p, i) => (p ? glyph(i) : null)).filter(Boolean);
      setLive(gamepadHub.active ? `Esquerdo (${f.lx.toFixed(2)}, ${f.ly.toFixed(2)}) · Direito (${f.rx.toFixed(2)}, ${f.ry.toFixed(2)}) · ${down.length ? down.join(' + ') : 'nenhum botão'}` : '');
    }, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hints.family]);

  const range = (label: string, key: keyof GamepadSettings, min: number, max: number, step: number, fmt: (v: number) => string) => (
    <label className="setting">
      <span>
        {label}: <b>{fmt(g[key] as number)}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={g[key] as number} onChange={(e) => setPad({ [key]: Number(e.target.value) } as Partial<GamepadSettings>)} />
    </label>
  );
  const check = (label: string, key: keyof GamepadSettings) => (
    <label className="setting">
      <span>{label}</span>
      <input type="checkbox" checked={g[key] as boolean} onChange={(e) => setPad({ [key]: e.target.checked } as Partial<GamepadSettings>)} />
    </label>
  );
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <>
      <p className="muted" style={{ fontSize: 13, margin: 0 }} aria-live="polite">
        {pad
          ? `Conectado: controle ${familyName(pad.family)}${pad.standard ? '' : ' (sem mapeamento padrão: confira os botões abaixo)'}${pad.rumble ? '' : ' · este navegador não oferece vibração para ele'}.`
          : 'Nenhum controle detectado. Conecte por USB ou Bluetooth e aperte qualquer botão: o navegador só mostra o controle depois do primeiro botão.'}
      </p>
      {live ? (
        <p className="muted" style={{ fontSize: 12, margin: 0, fontVariantNumeric: 'tabular-nums' }}>
          {live}
        </p>
      ) : null}
      {check('Usar controle', 'enabled')}
      <label className="setting">
        <span>Ícones dos botões</span>
        <select value={g.preset} onChange={(e) => setPad({ preset: e.target.value as GamepadSettings['preset'] })}>
          <option value="auto">Automático{pad ? ` (${familyName(pad.family)})` : ''}</option>
          <option value="xbox">Xbox</option>
          <option value="playstation">PlayStation</option>
          <option value="nintendo">Nintendo</option>
          <option value="generico">Genérico</option>
        </select>
      </label>
      {range('Sensibilidade horizontal', 'sensX', 0.2, 3, 0.05, (v) => v.toFixed(2))}
      {range('Sensibilidade vertical', 'sensY', 0.2, 3, 0.05, (v) => v.toFixed(2))}
      {check('Inverter eixo vertical', 'invertY')}
      {check('Inverter eixo horizontal', 'invertX')}
      {range('Zona morta do analógico esquerdo', 'deadzoneLeft', 0.02, 0.4, 0.01, pct)}
      {range('Zona morta do analógico direito', 'deadzoneRight', 0.02, 0.4, 0.01, pct)}
      <label className="setting">
        <span>Curva de resposta da câmera</span>
        <select value={g.curve} onChange={(e) => setPad({ curve: e.target.value as GamepadSettings['curve'] })}>
          <option value="linear">Linear</option>
          <option value="padrao">Padrão (suave no centro)</option>
          <option value="precisa">Precisa (mais lenta no centro)</option>
        </select>
      </label>
      {check('Vibração', 'vibration')}
      {range('Intensidade da vibração', 'vibrationIntensity', 0, 1, 0.05, pct)}
      <button
        className="btn small ghost"
        disabled={!pad?.rumble || !g.vibration}
        onClick={() => {
          const p = RUMBLE.teste;
          gamepadHub.rumble(p.ms, p.weak * g.vibrationIntensity, p.strong * g.vibrationIntensity);
        }}
      >
        Testar vibração
      </button>
      {check('Assistência de mira (leve)', 'aimAssist')}
      {range('Força da assistência', 'aimAssistStrength', 0, 1, 0.05, pct)}
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        A assistência só desacelera a câmera perto de um adversário que você já está vendo e puxa a mira muito de leve enquanto você mira. Ela nunca mira sozinha nem mostra quem está escondido.
      </p>
      <strong style={{ marginTop: 6 }}>Botões</strong>
      {PAD_ACTIONS.map((a) => (
        <div className="setting" key={a}>
          <span>{PAD_ACTION_LABELS[a]}</span>
          <button className={`keybtn ${listening === a ? 'listening' : ''}`} onClick={() => setListening(listening === a ? null : a)}>
            {listening === a ? 'Aperte um botão do controle… (Esc cancela)' : glyph(g.binds[a])}
          </button>
        </div>
      ))}
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Fixos: {glyph(12)}/{glyph(13)}/{glyph(14)}/{glyph(15)} navegam nos menus e escolhem o companheiro no mapa ({mapMode === 'hold' ? 'segure o botão do mapa' : 'abra o mapa'}), {glyph(hints.family === 'nintendo' ? 1 : 0)} confirma, {glyph(hints.family === 'nintendo' ? 0 : 1)} volta, {glyph(4)}/{glyph(5)} trocam de aba. Botão já usado por outra ação: as duas trocam.
      </p>
      <button className="btn small ghost" onClick={() => settingsStore.set({ gamepad: DEFAULT_GAMEPAD })}>
        Restaurar padrão do controle
      </button>
    </>
  );
}

import type { ReactNode } from 'react';
import { MORINGA, RODA_DE_OLEIRO, WEAPONS } from '@borrifo/game-content';
import { useStore } from '../app/store';
import { settingsStore } from '../app/settings';
import { uiStore } from '../app/uiStore';
import { keyName, pressText, useHints, type HintAction } from '../app/hints';
import { STEPS, endTutorial, skipStep, tutorialStore, type StepId } from '../app/tutorial';
import { hudStore } from '../game/hud';

const TITLES: Record<StepId, string> = {
  andar: 'Andar',
  camera: 'Olhar em volta',
  disparar: 'Usar a ferramenta',
  pintar: 'Pintar o chão',
  forma: 'Forma Pião',
  recarregar: 'Recarregar',
  mapa: 'Mapa tático',
  moringa: MORINGA.name,
  especial: RODA_DE_OLEIRO.name,
};

/**
 * Cartão do treino rápido: fica num canto, não captura o ponteiro nem pausa a
 * partida. O texto muda com o dispositivo (tecla, botão ou gesto).
 */
export function Tutorial() {
  const t = useStore(tutorialStore, (x) => x);
  const hints = useHints();
  const locked = useStore(uiStore, (s) => s.pointerLocked);
  const flowMode = useStore(settingsStore, (s) => s.flowMode);
  const fireAlt = useStore(settingsStore, (s) => s.keybinds.fireAlt);
  const special = useStore(hudStore, (s) => s.special);
  const ink = useStore(hudStore, (s) => s.ink);
  const weapon = WEAPONS[useStore(hudStore, (s) => s.weaponId)].name;
  if (!t.active) return null;
  const step = STEPS[t.step];
  const k = (a: HintAction) => <kbd>{hints.label(a)}</kbd>;
  const d = hints.device;
  const hold = flowMode === 'hold' ? 'Segure' : 'Aperte';
  const body: Record<StepId, ReactNode> = {
    andar: d === 'toque' ? <>Arraste o {k('move')} à esquerda para andar.</> : <>Ande com {k('move')}.</>,
    camera:
      d === 'teclado' ? (
        <>Mova o {k('look')} para olhar em volta{locked ? '' : ' (clique na arena para capturar o ponteiro)'}.</>
      ) : d === 'controle' ? (
        <>Gire a câmera com {k('look')}.</>
      ) : (
        <>{k('look')} para girar a câmera.</>
      ),
    disparar:
      d === 'teclado' ? (
        <>
          {k('fire')} (ou <kbd>{keyName(fireAlt)}</kbd>) usa o {weapon}.
        </>
      ) : (
        <>
          Segure {k('fire')} para usar o {weapon}.
        </>
      ),
    pintar: <>Mire no chão e pinte com {k('fire')}: vence quem cobrir mais área no fim.</>,
    forma:
      d === 'toque' ? (
        <>Segure {k('flow')} para virar Forma Pião: você desliza e fica escondido na sua tinta.</>
      ) : (
        <>
          {hold} {k('flow')} para virar Forma Pião: você desliza e fica escondido na sua tinta.
        </>
      ),
    recarregar: (
      <>
        Na Forma Pião, fique sobre a tinta da sua turma até o tanque encher ({Math.round(ink)}%).
      </>
    ),
    mapa: d === 'toque' ? <>Toque em {k('map')} para ver o território e os companheiros.</> : <>Abra o mapa tático com {k('map')}.</>,
    moringa: <>{pressText(hints.label('secondary'), d)} para arremessar a {MORINGA.name}.</>,
    especial:
      special >= 100 ? (
        <>A {RODA_DE_OLEIRO.name} está pronta: {pressText(hints.label('special'), d)}.</>
      ) : (
        <>
          Pintar enche a {RODA_DE_OLEIRO.name} ({Math.floor(special)}%). Quando encher, use com {k('special')}.
        </>
      ),
  };
  return (
    <aside className="tutorial" aria-live="polite" aria-label="Treino rápido">
      <div className="tut-head">
        <span>
          Treino rápido · {t.step + 1}/{STEPS.length}
        </span>
        <span className="tut-bar" aria-hidden="true">
          <i style={{ width: `${Math.round(t.progress * 100)}%` }} />
        </span>
      </div>
      <strong>{TITLES[step]}</strong>
      <p>{body[step]}</p>
      <div className="row">
        <button className="btn small ghost" data-sfx="none" onClick={() => skipStep()}>
          Pular etapa
        </button>
        <button className="btn small ghost" data-sfx="back" onClick={() => endTutorial()}>
          Encerrar treino
        </button>
      </div>
      {d === 'controle' || (d === 'teclado' && locked) ? <span className="muted tut-foot">{`${d === 'controle' ? hints.label('menu') : 'Esc'} abre o menu, onde também dá para pular ou encerrar o treino`}</span> : null}
    </aside>
  );
}

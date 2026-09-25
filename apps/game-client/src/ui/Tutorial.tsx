import type { ReactNode } from 'react';
import { MORINGA, RODA_DE_OLEIRO, WEAPONS } from '@borrifo/game-content';
import { useStore } from '../app/store';
import { settingsStore } from '../app/settings';
import { uiStore } from '../app/uiStore';
import { keyName, pressText, useHints, type HintAction } from '../app/hints';
import { endTutorial, skipStep, tutorialStore, type StepId } from '../app/tutorial';
import { BUFFS, CORREIO } from '@borrifo/game-content';
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
  buff: 'Embalo e Fôlego',
  mutirao: 'Mutirão',
  capsula: 'Pegar a cápsula',
  entrega: 'Entregar na estação',
};

/**
 * Cartão do treino rápido: fica num canto, não captura o ponteiro nem pausa a
 * partida. O texto muda com o dispositivo (tecla, botão ou gesto).
 */
export function Tutorial() {
  // campos separados e já arredondados como aparecem: o treino atualiza o progresso a cada
  // quadro e o HUD atualiza tanque e especial a 15 Hz; o cartão só redesenha quando o que
  // ele mostra muda (antes: todo quadro, ~8 KB de JSX por quadro no perfil de alocações)
  const active = useStore(tutorialStore, (x) => x.active);
  const stepIdx = useStore(tutorialStore, (x) => x.step);
  const steps = useStore(tutorialStore, (x) => x.steps);
  const pct = useStore(tutorialStore, (x) => Math.round(x.progress * 100));
  const hints = useHints();
  const locked = useStore(uiStore, (s) => s.pointerLocked);
  const flowMode = useStore(settingsStore, (s) => s.flowMode);
  const fireAlt = useStore(settingsStore, (s) => s.keybinds.fireAlt);
  const special = useStore(hudStore, (s) => Math.floor(s.special));
  const ink = useStore(hudStore, (s) => Math.round(s.ink));
  const weapon = WEAPONS[useStore(hudStore, (s) => s.weaponId)].name;
  if (!active) return null;
  const step = steps[stepIdx];
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
    buff: (
      <>
        Passe por um pickup: Embalo (setas laranja) dá +{Math.round((BUFFS.embalo.speedMul - 1) * 100)}% de velocidade por {BUFFS.embalo.duration} s; Fôlego (gota azul) acelera a recarga por {BUFFS.folego.duration} s. Um de cada vez.
      </>
    ),
    mutirao: <>Pinte áreas novas perto de um companheiro, ao mesmo tempo: os dois ganham o Mutirão (recarga mais rápida por alguns segundos).</>,
    capsula: <>Encoste na cápsula dourada (o feixe mostra onde ela está). Com ela, o {'Pião-Guia'} fica indisponível e todos veem você.</>,
    entrega: (
      <>
        Pinte a estação ativa (anel no chão) até {Math.round(CORREIO.stationPaintShare * 100)}% com a sua cor e fique dentro dela com a cápsula por {CORREIO.deliverSeconds} s.
      </>
    ),
  };
  return (
    <aside className="tutorial" aria-live="polite" aria-label="Treino rápido">
      <div className="tut-head">
        <span>
          Treino rápido · {stepIdx + 1}/{steps.length}
        </span>
        <span className="tut-bar" aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
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

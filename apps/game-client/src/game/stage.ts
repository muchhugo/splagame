import { createStore } from '../app/store';
import type { StageTag } from './render/LobbyStage';

/** Estado do palco do lobby para a interface (etiquetas projetadas ~20 Hz). */
export interface StageState {
  tags: StageTag[];
  /** Quantos de cada turma ficaram fora do palco (o painel lista todo mundo). */
  hidden: [number, number];
  /** Apresentação de abertura em curso. */
  intro: boolean;
}

export const stageStore = createStore<StageState>({ tags: [], hidden: [0, 0], intro: false });

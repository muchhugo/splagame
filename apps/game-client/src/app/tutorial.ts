/**
 * Treino rápido: nove exercícios que acontecem DENTRO da partida, sem pausar
 * nada nem bloquear a tela. Cada etapa detecta sozinha que o jogador fez o
 * gesto (andou, girou a câmera, pintou o chão…) a partir do estado real do
 * jogo. Pode ser pulado a qualquer momento e refeito pelo menu. A conclusão
 * fica salva por versão nas preferências (settings.tutorialDone).
 */
import { createStore } from './store';
import { settingsStore } from './settings';
import { pushNotice } from './uiStore';

/** v2: buffs, Mutirão e Correio do Ara. Quem concluiu a v1 faz só as etapas novas. */
export const TUTORIAL_VERSION = 2;

export type StepId = 'andar' | 'camera' | 'disparar' | 'pintar' | 'forma' | 'recarregar' | 'mapa' | 'moringa' | 'especial' | 'buff' | 'mutirao' | 'capsula' | 'entrega';
/** Etapas básicas (qualquer modo). */
export const STEPS: readonly StepId[] = ['andar', 'camera', 'disparar', 'pintar', 'forma', 'recarregar', 'mapa', 'moringa', 'especial'];

export interface TutorialContext {
  mode: 'territorio' | 'correio';
  /** Há aliado na equipe (Mutirão não se aplica em 1 × 1). */
  allies: boolean;
  /** Só as etapas acrescentadas depois da versão já concluída. */
  onlyNew?: boolean;
}

/** Sequência do treino para o contexto da rodada: básicas + mecânicas do modo que se aplicam. */
export function stepsFor(ctx?: TutorialContext): StepId[] {
  if (!ctx) return [...STEPS];
  const extra: StepId[] = ['buff'];
  if (ctx.allies) extra.push('mutirao');
  if (ctx.mode === 'correio') extra.push('capsula', 'entrega');
  return ctx.onlyNew ? extra : [...STEPS, ...extra];
}

export interface TutorialState {
  active: boolean;
  steps: StepId[];
  step: number;
  /** 0..1 da etapa atual. */
  progress: number;
  skipped: StepId[];
  /** Tempo na etapa atual (s), para mostrar uma dica extra se demorar. */
  stepTime: number;
}

export const tutorialStore = createStore<TutorialState>({ active: false, steps: [...STEPS], step: 0, progress: 0, skipped: [], stepTime: 0 });

/** Uma leitura do jogo (a cada ~66 ms, vinda do runtime). */
export interface TutorialSample {
  pos: readonly [number, number, number];
  yaw: number;
  pitch: number;
  ink: number;
  /** 0 = Forma Bibelô, 1 = Forma Pião. */
  form: number;
  submerged: boolean;
  firing: boolean;
  alive: boolean;
  mapOpen: boolean;
  /** Contadores monotônicos do próprio jogador. */
  thrown: number;
  specials: number;
  buffs?: number;
  mutiroes?: number;
  capsules?: number;
  deliveries?: number;
  mode?: string;
}

interface Acc {
  last: TutorialSample | null;
  base: TutorialSample | null;
  value: number;
  /** Rebase (rodada nova, troca de mapa): recomeça as leituras sem perder o avanço. */
  keep: boolean;
}
const acc: Acc = { last: null, base: null, value: 0, keep: false };

/**
 * Rodada nova ou mapa novo: as leituras (posição do spawn, contadores do runtime, que
 * voltam a zero) recomeçam do ponto atual, sem conceder nem exigir nada a mais.
 */
export function tutorialRebase() {
  acc.last = null;
  acc.base = null;
  acc.keep = true;
}

const NEEDED: Record<StepId, number> = {
  andar: 4, // metros
  camera: 1.5, // rad
  disparar: 0.8, // s disparando
  pintar: 1.4, // s disparando olhando para o chão
  forma: 0.6, // s na Forma Pião
  recarregar: 18, // % de pigmento recuperado imerso
  mapa: 1,
  moringa: 1,
  especial: 1,
  buff: 1,
  mutirao: 1,
  capsula: 1,
  entrega: 1,
};

/** Soma o avanço da etapa com a leitura nova. Pura quanto ao `acc` recebido (testável). */
export function stepGain(step: StepId, prev: TutorialSample, cur: TutorialSample, base: TutorialSample, dt: number): number {
  // eliminado não avança (exceto o mapa, que também serve enquanto espera reaparecer)
  if (!cur.alive && step !== 'mapa') return 0;
  switch (step) {
    case 'andar':
      // teleporte (reaparecer, Pião-Guia) não conta como andar
      return Math.min(1, Math.hypot(cur.pos[0] - prev.pos[0], cur.pos[2] - prev.pos[2]));
    case 'camera': {
      const dy = Math.atan2(Math.sin(cur.yaw - prev.yaw), Math.cos(cur.yaw - prev.yaw));
      return Math.abs(dy) + Math.abs(cur.pitch - prev.pitch);
    }
    case 'disparar':
      return cur.firing && cur.form === 0 ? dt : 0;
    case 'pintar':
      return cur.firing && cur.form === 0 && cur.pitch > 0.28 ? dt : 0;
    case 'forma':
      return cur.form === 1 ? dt : 0;
    case 'recarregar':
      // encher o tanque também completa (com o tanque quase cheio, +18% seria impossível)
      if (cur.form === 1 && cur.submerged && cur.ink >= 99) return NEEDED.recarregar;
      return cur.form === 1 && cur.submerged && cur.ink > prev.ink ? cur.ink - prev.ink : 0;
    case 'mapa':
      return cur.mapOpen ? 1 : 0;
    case 'moringa':
      return cur.thrown > base.thrown ? 1 : 0;
    case 'especial':
      return cur.specials > base.specials ? 1 : 0;
    case 'buff':
      return (cur.buffs ?? 0) > (base.buffs ?? 0) ? 1 : 0;
    case 'mutirao':
      return (cur.mutiroes ?? 0) > (base.mutiroes ?? 0) ? 1 : 0;
    case 'capsula':
      return (cur.capsules ?? 0) > (base.capsules ?? 0) ? 1 : 0;
    case 'entrega':
      return (cur.deliveries ?? 0) > (base.deliveries ?? 0) ? 1 : 0;
  }
}

export function tutorialTick(sample: TutorialSample, dt: number) {
  const st = tutorialStore.get();
  if (!st.active) {
    acc.last = null;
    return;
  }
  const step = st.steps[st.step];
  if (!acc.last || !acc.base) {
    acc.last = sample;
    acc.base = sample;
    if (!acc.keep) acc.value = 0;
    acc.keep = false;
    return;
  }
  acc.value += stepGain(step, acc.last, sample, acc.base, dt);
  acc.last = sample;
  const progress = Math.min(1, acc.value / NEEDED[step]);
  if (progress >= 1) nextStep(false);
  else tutorialStore.set({ progress, stepTime: st.stepTime + dt });
}

function nextStep(skipped: boolean) {
  const st = tutorialStore.get();
  acc.last = null;
  acc.base = null;
  acc.value = 0;
  const skippedList = skipped ? [...st.skipped, st.steps[st.step]] : st.skipped;
  if (st.step + 1 >= st.steps.length) {
    tutorialStore.set({ active: false, step: st.steps.length, progress: 1, skipped: skippedList, stepTime: 0 });
    onFinished?.(skippedList.length === 0);
    return;
  }
  tutorialStore.set({ step: st.step + 1, progress: 0, skipped: skippedList, stepTime: 0 });
}

let onFinished: ((allDone: boolean) => void) | null = null;

/** Começa (ou recomeça) o treino. `finished` é chamado ao terminar ou encerrar. */
export function startTutorial(finished: (allDone: boolean) => void, ctx?: TutorialContext) {
  onFinished = finished;
  acc.last = null;
  acc.base = null;
  acc.value = 0;
  tutorialStore.set({ active: true, steps: stepsFor(ctx), step: 0, progress: 0, skipped: [], stepTime: 0 });
}

export function skipStep() {
  if (tutorialStore.get().active) nextStep(true);
}

export function endTutorial() {
  if (!tutorialStore.get().active) return;
  tutorialStore.set({ active: false, progress: 0, stepTime: 0 });
  onFinished?.(false);
}

let autoStarted = false;

/** Primeira rodada de quem ainda não fez o treino desta versão: começa sozinho (uma vez por sessão). */
export function maybeAutoStartTutorial(ctx: TutorialContext) {
  const done = settingsStore.get().tutorialDone;
  if (autoStarted || tutorialStore.get().active || done >= TUTORIAL_VERSION) return;
  autoStarted = true;
  // quem já fez a v1 não repete o básico: só buffs, Mutirão e o que o modo trouxer
  startTutorial(saveTutorialDone, { ...ctx, onlyNew: done >= 1 });
}

/** Pelo menu: refazer quando quiser (sequência completa do modo atual). */
export function restartTutorial(ctx?: TutorialContext) {
  autoStarted = true;
  startTutorial(saveTutorialDone, ctx);
}

function saveTutorialDone(allDone: boolean) {
  settingsStore.set({ tutorialDone: TUTORIAL_VERSION });
  pushNotice(allDone ? 'Treino concluído! Dá para refazer pelo menu.' : 'Treino encerrado. Dá para refazer pelo menu.', 'good', 4500);
}

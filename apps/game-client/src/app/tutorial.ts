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

export const TUTORIAL_VERSION = 1;

export type StepId = 'andar' | 'camera' | 'disparar' | 'pintar' | 'forma' | 'recarregar' | 'mapa' | 'moringa' | 'especial';
export const STEPS: readonly StepId[] = ['andar', 'camera', 'disparar', 'pintar', 'forma', 'recarregar', 'mapa', 'moringa', 'especial'];

export interface TutorialState {
  active: boolean;
  step: number;
  /** 0..1 da etapa atual. */
  progress: number;
  skipped: StepId[];
  /** Tempo na etapa atual (s), para mostrar uma dica extra se demorar. */
  stepTime: number;
}

export const tutorialStore = createStore<TutorialState>({ active: false, step: 0, progress: 0, skipped: [], stepTime: 0 });

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
}

interface Acc {
  last: TutorialSample | null;
  base: TutorialSample | null;
  value: number;
}
const acc: Acc = { last: null, base: null, value: 0 };

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
};

/** Soma o avanço da etapa com a leitura nova. Pura quanto ao `acc` recebido (testável). */
export function stepGain(step: StepId, prev: TutorialSample, cur: TutorialSample, base: TutorialSample, dt: number): number {
  // eliminado não avança (exceto o mapa, que também serve enquanto espera reaparecer)
  if (!cur.alive && step !== 'mapa') return 0;
  switch (step) {
    case 'andar':
      return Math.hypot(cur.pos[0] - prev.pos[0], cur.pos[2] - prev.pos[2]);
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
      return cur.form === 1 && cur.submerged && cur.ink > prev.ink ? cur.ink - prev.ink : 0;
    case 'mapa':
      return cur.mapOpen ? 1 : 0;
    case 'moringa':
      return cur.thrown > base.thrown ? 1 : 0;
    case 'especial':
      return cur.specials > base.specials ? 1 : 0;
  }
}

export function tutorialTick(sample: TutorialSample, dt: number) {
  const st = tutorialStore.get();
  if (!st.active) {
    acc.last = null;
    return;
  }
  const step = STEPS[st.step];
  if (!acc.last || !acc.base) {
    acc.last = sample;
    acc.base = sample;
    acc.value = 0;
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
  const skippedList = skipped ? [...st.skipped, STEPS[st.step]] : st.skipped;
  if (st.step + 1 >= STEPS.length) {
    tutorialStore.set({ active: false, step: STEPS.length, progress: 1, skipped: skippedList, stepTime: 0 });
    onFinished?.(skippedList.length === 0);
    return;
  }
  tutorialStore.set({ step: st.step + 1, progress: 0, skipped: skippedList, stepTime: 0 });
}

let onFinished: ((allDone: boolean) => void) | null = null;

/** Começa (ou recomeça) o treino. `finished` é chamado ao terminar ou encerrar. */
export function startTutorial(finished: (allDone: boolean) => void) {
  onFinished = finished;
  acc.last = null;
  acc.base = null;
  acc.value = 0;
  tutorialStore.set({ active: true, step: 0, progress: 0, skipped: [], stepTime: 0 });
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
export function maybeAutoStartTutorial() {
  if (autoStarted || tutorialStore.get().active || settingsStore.get().tutorialDone >= TUTORIAL_VERSION) return;
  autoStarted = true;
  startTutorial(saveTutorialDone);
}

/** Pelo menu: refazer quando quiser. */
export function restartTutorial() {
  autoStarted = true;
  startTutorial(saveTutorialDone);
}

function saveTutorialDone(allDone: boolean) {
  settingsStore.set({ tutorialDone: TUTORIAL_VERSION });
  pushNotice(allDone ? 'Treino concluído! Dá para refazer pelo menu.' : 'Treino encerrado. Dá para refazer pelo menu.', 'good', 4500);
}

import { describe, expect, it } from 'vitest';
import { STEPS, endTutorial, skipStep, startTutorial, tutorialStore, tutorialTick, type TutorialSample } from '../src/app/tutorial';

const base: TutorialSample = { pos: [0, 0, 0], yaw: 0, pitch: 0, ink: 100, form: 0, submerged: false, firing: false, alive: true, mapOpen: false, thrown: 0, specials: 0 };
const dt = 1 / 15;

/** Repete a mesma alteração por n leituras. */
function run(n: number, f: (i: number) => Partial<TutorialSample>) {
  for (let i = 0; i < n; i++) tutorialTick({ ...base, ...f(i) }, dt);
}

describe('treino rápido', () => {
  it('cada etapa só avança com o gesto certo, na ordem', () => {
    let finished: boolean | null = null;
    startTutorial((all) => (finished = all));
    const cur = () => STEPS[tutorialStore.get().step];
    tutorialTick(base, dt);
    // parado não avança
    run(30, () => ({}));
    expect(cur()).toBe('andar');
    run(40, (i) => ({ pos: [i * 0.15, 0, 0] }));
    expect(cur()).toBe('camera');
    run(20, (i) => ({ yaw: i * 0.1 }));
    expect(cur()).toBe('disparar');
    // disparar na Forma Pião não conta
    run(20, () => ({ firing: true, form: 1 }));
    expect(cur()).toBe('disparar');
    run(15, () => ({ firing: true }));
    expect(cur()).toBe('pintar');
    // disparar olhando para o horizonte não é "pintar o chão"
    run(30, () => ({ firing: true, pitch: 0 }));
    expect(cur()).toBe('pintar');
    run(25, () => ({ firing: true, pitch: 0.5 }));
    expect(cur()).toBe('forma');
    run(12, () => ({ form: 1 }));
    expect(cur()).toBe('recarregar');
    // encher o tanque imerso na própria tinta
    run(30, (i) => ({ form: 1, submerged: true, ink: 40 + i }));
    expect(cur()).toBe('mapa');
    run(2, () => ({ mapOpen: true }));
    expect(cur()).toBe('moringa');
    tutorialTick(base, dt);
    run(2, () => ({ thrown: 1 }));
    expect(cur()).toBe('especial');
    tutorialTick(base, dt);
    run(2, () => ({ specials: 1 }));
    expect(tutorialStore.get().active).toBe(false);
    expect(finished).toBe(true);
  });

  it('pular etapa e encerrar funcionam e não bloqueiam', () => {
    let finished: boolean | null = null;
    startTutorial((all) => (finished = all));
    skipStep();
    expect(STEPS[tutorialStore.get().step]).toBe('camera');
    expect(tutorialStore.get().skipped).toEqual(['andar']);
    endTutorial();
    expect(tutorialStore.get().active).toBe(false);
    expect(finished).toBe(false);
  });

  it('morto não avança', () => {
    startTutorial(() => {});
    tutorialTick(base, dt);
    run(40, (i) => ({ pos: [i * 0.3, 0, 0], alive: false }));
    expect(STEPS[tutorialStore.get().step]).toBe('andar');
    endTutorial();
  });
});

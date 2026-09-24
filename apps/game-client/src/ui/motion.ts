import { useLayoutEffect, type RefObject } from 'react';
import { gsap } from 'gsap';
import { settingsStore } from '../app/settings';

/**
 * Animação de interface com GSAP, sempre com limpeza (gsap.context → revert ao
 * desmontar) e respeitando "reduzir movimento" (preferência do sistema OU a opção do
 * jogo). Sem movimento, os elementos aparecem no estado final, sem esperar nada.
 * Microinterações simples (hover, press) ficam no CSS.
 */
export function motionAllowed(): boolean {
  if (settingsStore.get().reduceMotion) return false;
  return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** Entrada escalonada dos filhos marcados com [data-enter] dentro de `ref`. */
export function useEnter(ref: RefObject<HTMLElement | null>, deps: unknown[] = [], opts: { y?: number; stagger?: number; duration?: number } = {}) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !motionAllowed()) return;
    const ctx = gsap.context(() => {
      gsap.from(el.querySelectorAll('[data-enter]'), {
        y: opts.y ?? 14,
        opacity: 0,
        duration: opts.duration ?? 0.35,
        stagger: opts.stagger ?? 0.05,
        ease: 'power2.out',
        clearProps: 'transform,opacity',
      });
    }, el);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** "Pop" curto de um elemento (contagem, Mutirão!, vitória). */
export function usePop(ref: RefObject<HTMLElement | null>, key: unknown, strength = 1) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !motionAllowed()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(el, { scale: 1 + 0.5 * strength, opacity: 0.2 }, { scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(2.2)', clearProps: 'transform,opacity' });
    }, el);
    return () => ctx.revert();
  }, [key, ref, strength]);
}

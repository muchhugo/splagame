import { useEffect, useRef, useState } from 'react';
import { getController } from './App';

/**
 * Controles de toque (prioridade 2). Implementados, mas NÃO verificados em
 * Android/iOS reais — só aparecem em dispositivos com ponteiro grosso.
 */
export function TouchControls() {
  const [enabled] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
  const stick = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const state = useRef({ mx: 0, my: 0, fire: false, flow: false, stickId: -1, lookId: -1, lx: 0, ly: 0 });
  useEffect(() => {
    if (!enabled) return;
    const rt = () => getController()?.runtime;
    const onLook = (e: PointerEvent) => {
      const s = state.current;
      if (e.type === 'pointerdown' && e.clientX > innerWidth / 2 && s.lookId < 0 && !(e.target as HTMLElement).closest('button')) {
        s.lookId = e.pointerId;
        s.lx = e.clientX;
        s.ly = e.clientY;
      } else if (e.type === 'pointermove' && e.pointerId === s.lookId) {
        rt()?.input.touchLook(e.clientX - s.lx, e.clientY - s.ly);
        s.lx = e.clientX;
        s.ly = e.clientY;
      } else if ((e.type === 'pointerup' || e.type === 'pointercancel') && e.pointerId === s.lookId) s.lookId = -1;
    };
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.addEventListener(t, onLook as EventListener);
    return () => {
      for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.removeEventListener(t, onLook as EventListener);
      rt()?.input.setTouch(0, 0, false, false);
    };
  }, [enabled]);
  if (!enabled) return null;
  const push = () => {
    const s = state.current;
    getController()?.runtime?.input.setTouch(s.mx, s.my, s.fire, s.flow);
  };
  const onStick = (e: React.PointerEvent) => {
    const el = stick.current!;
    const r = el.getBoundingClientRect();
    const s = state.current;
    if (e.type === 'pointerdown') {
      s.stickId = e.pointerId;
      el.setPointerCapture(e.pointerId);
    }
    if (e.pointerId !== s.stickId) return;
    if (e.type === 'pointerup' || e.type === 'pointercancel') {
      s.stickId = -1;
      s.mx = s.my = 0;
    } else {
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const l = Math.max(1, Math.hypot(dx, dy));
      s.mx = dx / l;
      s.my = -dy / l;
    }
    if (knob.current) knob.current.style.transform = `translate(${s.mx * 45}px, ${-s.my * 45}px)`;
    push();
  };
  const hold = (key: 'fire' | 'flow') => ({
    onPointerDown: () => {
      state.current[key] = true;
      push();
    },
    onPointerUp: () => {
      state.current[key] = false;
      push();
    },
    onPointerCancel: () => {
      state.current[key] = false;
      push();
    },
  });
  const tap = (a: 'jump' | 'secondary' | 'special') => ({ onPointerDown: () => getController()?.runtime?.input.touchAction(a) });
  return (
    <div className="touch">
      <div className="stick" ref={stick} onPointerDown={onStick} onPointerMove={onStick} onPointerUp={onStick} onPointerCancel={onStick} aria-label="Analógico de movimento">
        <div className="knob" ref={knob} />
      </div>
      <div className="tbtns">
        <button {...tap('special')}>Roda</button>
        <button {...tap('secondary')}>Moringa</button>
        <button {...tap('jump')}>Pular</button>
        <button {...hold('flow')}>Pião</button>
        <button {...hold('fire')} style={{ gridColumn: 'span 2', width: '100%', borderRadius: 32 }}>
          Usar
        </button>
      </div>
    </div>
  );
}

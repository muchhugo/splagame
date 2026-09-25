/**
 * Navegação de interface pelo controle: direcional/analógico esquerdo movem o
 * foco (espacialmente), A confirma, B volta, LB/RB trocam de aba, Start abre ou
 * fecha o menu. Sliders e listas mudam de valor com ←/→. Só age fora do
 * gameplay (menu, lobby, resultados…); dentro da partida quem lê o controle é
 * o InputManager, e o mapa tático cuida da própria seleção.
 */
import { PAD, gamepadHub } from '../game/input/gamepad';
import { deviceStore, effectiveFamily } from '../game/input/device';
import { settingsStore } from '../app/settings';
import { uiStore } from '../app/uiStore';
import { getController } from './App';

/** Remapeamento em andamento (Configurações › Controle): recebe o próximo botão. */
export const padCapture: { fn: ((button: number) => void) | null } = { fn: null };

type Dir = 'up' | 'down' | 'left' | 'right';

function uiMode(): boolean {
  const u = uiStore.get();
  return u.menuOpen || u.settingsOpen || u.screen !== 'match';
}

const SEL = 'button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]):not(canvas)';

function navRoot(): HTMLElement {
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role=dialog], [role=alertdialog]')].filter((d) => !d.closest('.tacmap'));
  return dialogs[dialogs.length - 1] ?? document.body;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(SEL)].filter((el) => el.getClientRects().length > 0 && !el.closest('.touch') && getComputedStyle(el).visibility !== 'hidden');
}

function center(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Próximo elemento na direção: menor distância no eixo principal, penalizando o desvio lateral. */
export function spatialNext(from: { x: number; y: number }, dir: Dir, candidates: Array<{ x: number; y: number }>): number {
  let best = -1;
  let bestScore = Infinity;
  candidates.forEach((c, i) => {
    const dx = c.x - from.x;
    const dy = c.y - from.y;
    const main = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    const side = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (main <= 2) return;
    const score = main + side * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

function adjust(el: HTMLElement, step: number): boolean {
  if (el instanceof HTMLInputElement && el.type === 'range') {
    const st = Number(el.step) || 1;
    const v = Math.min(Number(el.max), Math.max(Number(el.min), Number(el.value) + step * st));
    setNativeValue(el, String(Math.round(v / st) * st));
    return true;
  }
  if (el instanceof HTMLSelectElement) {
    const i = Math.min(el.options.length - 1, Math.max(0, el.selectedIndex + step));
    if (i !== el.selectedIndex) setNativeValue(el, el.options[i].value);
    return true;
  }
  return false;
}

function move(dir: Dir) {
  const root = navRoot();
  const list = focusables(root);
  if (!list.length) return;
  const cur = document.activeElement as HTMLElement | null;
  const inside = cur && list.includes(cur);
  if (!inside) {
    (root.querySelector<HTMLElement>('[autofocus]') ?? list[0]).focus();
    return;
  }
  if ((dir === 'left' || dir === 'right') && adjust(cur, dir === 'right' ? 1 : -1)) return;
  const others = list.filter((e) => e !== cur);
  const i = spatialNext(center(cur), dir, others.map(center));
  const target = i >= 0 ? others[i] : null;
  if (target) {
    target.focus();
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function switchTab(step: number) {
  const tabs = [...navRoot().querySelectorAll<HTMLElement>('[role=tablist] [role=tab]')];
  if (!tabs.length) return;
  const cur = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
  const next = tabs[(cur + step + tabs.length) % tabs.length];
  next.click();
  next.focus();
}

function back() {
  const target = (document.activeElement as HTMLElement | null) ?? navRoot();
  // o menu e as configurações já fecham com Esc; o evento sintético não muda o "último dispositivo"
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
}

let installed = false;
const DPAD: Partial<Record<number, Dir>> = { [PAD.CIMA]: 'up', [PAD.BAIXO]: 'down', [PAD.ESQ]: 'left', [PAD.DIR]: 'right' };

export function installGamepadNav() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  let held: Dir | null = null;
  let nextAt = 0;
  deviceStore.subscribe(() => document.documentElement.classList.toggle('pad-nav', deviceStore.get().device === 'controle'));
  gamepadHub.subscribe((e) => {
    if (e.type !== 'press') return;
    if (padCapture.fn) {
      padCapture.fn(e.button);
      return;
    }
    if (!uiMode()) return;
    // o aperto é da interface: o jogo ignora (sem pular ao confirmar "Voltar ao jogo",
    // sem o botão Menu reabrir o menu que acabou de fechar)
    e.consumed = true;
    // direcional pelo evento (um toque rápido não se perde num quadro lento); segurar repete no laço abaixo
    const d = DPAD[e.button];
    if (d) {
      move(d);
      held = d;
      nextAt = performance.now() + 380;
      return;
    }
    const s = settingsStore.get();
    const nintendo = effectiveFamily(s.gamepad.preset, gamepadHub.active) === 'nintendo';
    const confirmBtn = nintendo ? PAD.LESTE : PAD.SUL;
    const backBtn = nintendo ? PAD.SUL : PAD.LESTE;
    const u = uiStore.get();
    if (e.button === confirmBtn) {
      const el = document.activeElement as HTMLElement | null;
      if (el && el !== document.body && focusables(navRoot()).includes(el)) {
        if (el instanceof HTMLSelectElement) adjust(el, el.selectedIndex === el.options.length - 1 ? -el.selectedIndex : 1);
        else el.click();
      } else move('down');
    } else if (e.button === backBtn) back();
    else if (e.button === PAD.LB) switchTab(-1);
    else if (e.button === PAD.RB) switchTab(1);
    else if (e.button === s.gamepad.binds.menu) {
      if (u.menuOpen || u.settingsOpen) getController()?.resumeGame();
      else if (u.screen === 'lobby' || u.screen === 'results' || u.screen === 'waiting') uiStore.set({ menuOpen: true });
    }
  });

  // segurar direcional ou analógico esquerdo repete (rolar a lista)
  const loop = () => {
    requestAnimationFrame(loop);
    if (padCapture.fn || !uiMode() || !gamepadHub.active) {
      held = null;
      return;
    }
    const f = gamepadHub.frame;
    let dir: Dir | null = null;
    if (gamepadHub.isPressed(PAD.CIMA)) dir = 'up';
    else if (gamepadHub.isPressed(PAD.BAIXO)) dir = 'down';
    else if (gamepadHub.isPressed(PAD.ESQ)) dir = 'left';
    else if (gamepadHub.isPressed(PAD.DIR)) dir = 'right';
    else if (Math.hypot(f.lx, f.ly) > 0.6) dir = Math.abs(f.lx) > Math.abs(f.ly) ? (f.lx > 0 ? 'right' : 'left') : f.ly > 0 ? 'down' : 'up';
    const now = performance.now();
    if (dir !== held) {
      held = dir;
      if (dir) {
        move(dir);
        nextAt = now + 380;
      }
    } else if (dir && now >= nextAt) {
      move(dir);
      nextAt = now + 120;
    }
  };
  requestAnimationFrame(loop);
}

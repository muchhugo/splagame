import type { GameModeId, WeaponId } from '@borrifo/game-contracts';

/**
 * Ícones próprios do jogo (SVG desenhado aqui, sem fonte de ícones nem asset externo).
 * Traço grosso e cantos redondos, no mesmo idioma dos adesivos do HUD. `currentColor`
 * pinta o traço; `--ic-fill` o miolo.
 */
type P = { size?: number; className?: string };
const base = (size: number, className = '') => ({
  width: size,
  height: size,
  viewBox: '0 0 48 48',
  className: `ic ${className}`,
  'aria-hidden': true,
  focusable: false,
});

export function ToolIcon({ weapon, size = 48, className }: P & { weapon: WeaponId }) {
  if (weapon === 'rodo')
    return (
      <svg {...base(size, className)}>
        {/* rodo: cabo inclinado e lâmina larga com borracha */}
        <path d="M31 5 L20 30" stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none" />
        <rect x="6" y="28" width="30" height="9" rx="3" transform="rotate(-8 21 32)" fill="var(--ic-fill, #f2b34a)" stroke="currentColor" strokeWidth="3.5" />
        <path d="M8 40 q13 -4 27 -4" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" fill="none" />
        <circle cx="37" cy="14" r="3" fill="var(--ic-accent, #fff4e6)" />
      </svg>
    );
  if (weapon === 'estilingue')
    return (
      <svg {...base(size, className)}>
        {/* estilingue: forquilha de madeira e elástico esticado com a gota de tinta */}
        <path d="M24 44 V26 M24 26 L13 9 M24 26 L35 9" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M13 10 Q24 30 35 10" stroke="var(--ic-accent, #fff4e6)" strokeWidth="2.5" fill="none" />
        <path d="M24 16 c4 4 4 8 0 9 c-4 -1 -4 -5 0 -9z" fill="var(--ic-fill, #f2b34a)" stroke="currentColor" strokeWidth="2.5" />
      </svg>
    );
  return (
    <svg {...base(size, className)}>
      {/* esguicho: garrafa de apertar com bico e jato */}
      <path d="M14 18 h14 l3 6 v16 a4 4 0 0 1 -4 4 h-12 a4 4 0 0 1 -4 -4 v-16z" fill="var(--ic-fill, #f2b34a)" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M18 18 v-5 h6 v5 M21 13 l8 -6" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="35" cy="6" r="2.5" fill="currentColor" />
      <circle cx="40" cy="10" r="2" fill="currentColor" />
      <path d="M15 30 h13" stroke="var(--ic-accent, #fff4e6)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ModeIcon({ mode, size = 48, className }: P & { mode: GameModeId }) {
  if (mode === 'correio')
    return (
      <svg {...base(size, className)}>
        {/* cápsula do Correio com asinhas de arara */}
        <rect x="13" y="12" width="22" height="26" rx="11" fill="var(--ic-fill, #f2b34a)" stroke="currentColor" strokeWidth="3.5" />
        <path d="M13 25 h22" stroke="currentColor" strokeWidth="3" />
        <path d="M13 20 q-9 -2 -9 6 q5 -3 9 1 M35 20 q9 -2 9 6 q-5 -3 -9 1" fill="var(--ic-accent, #fff4e6)" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <circle cx="24" cy="31" r="2.5" fill="currentColor" />
      </svg>
    );
  return (
    <svg {...base(size, className)}>
      {/* território: rolinho de pintura cobrindo o chão */}
      <path d="M5 40 q10 -8 19 -2 t19 -3 v8 h-38z" fill="var(--ic-fill, #f2b34a)" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <rect x="10" y="8" width="26" height="11" rx="5" fill="var(--ic-accent, #fff4e6)" stroke="currentColor" strokeWidth="3.5" />
      <path d="M36 13 h5 v10 h-15 v8" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function GearIcon({ size = 22, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path
        d="M24 6 l4 1 1 5 4 2 4-3 3 3-3 4 2 4 5 1 1 4-1 4-5 1-2 4 3 4-3 3-4-3-4 2-1 5-4 1-4-1-1-5-4-2-4 3-3-3 3-4-2-4-5-1-1-4 1-4 5-1 2-4-3-4 3-3 4 3 4-2 1-5z"
        fill="var(--ic-fill, transparent)"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="24" r="6" fill="none" stroke="currentColor" strokeWidth="3.5" />
    </svg>
  );
}

export function InviteIcon({ size = 22, className }: P) {
  return (
    <svg {...base(size, className)}>
      <circle cx="19" cy="16" r="7" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <path d="M5 41 c1 -9 7 -13 14 -13 s13 4 14 13" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M38 14 v14 M31 21 h14" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function RotateIcon({ dir, size = 22, className }: P & { dir: -1 | 1 }) {
  return (
    <svg {...base(size, className)} style={dir > 0 ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M38 24 a14 14 0 1 1 -5 -10.7" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M35 5 v10 h-10" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckIcon({ size = 18, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M9 25 l9 9 l21 -21" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CrownIcon({ size = 18, className }: P) {
  // anfitrião: chapéu de palha com fita (quem organiza a sala)
  return (
    <svg {...base(size, className)}>
      <ellipse cx="24" cy="32" rx="20" ry="6" fill="var(--ic-fill, #f2c65a)" stroke="currentColor" strokeWidth="3" />
      <path d="M13 31 q0 -16 11 -16 q11 0 11 16" fill="var(--ic-fill, #f2c65a)" stroke="currentColor" strokeWidth="3" />
      <path d="M13.5 27 h21" stroke="var(--ic-accent, #e1352b)" strokeWidth="4" />
    </svg>
  );
}

export function MicIcon({ muted, size = 18, className }: P & { muted?: boolean }) {
  return (
    <svg {...base(size, className)}>
      <rect x="17" y="5" width="14" height="24" rx="7" fill="var(--ic-fill, transparent)" stroke="currentColor" strokeWidth="3.5" />
      <path d="M10 22 a14 14 0 0 0 28 0 M24 36 v7" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      {muted ? <path d="M8 6 L40 42" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /> : null}
    </svg>
  );
}

export function BotIcon({ size = 18, className }: P) {
  // bot: moringa de barro com olhinhos (o mascote dos bots)
  return (
    <svg {...base(size, className)}>
      <path d="M19 6 h10 v6 c8 3 11 9 11 16 c0 9 -7 15 -16 15 s-16 -6 -16 -15 c0 -7 3 -13 11 -16z" fill="var(--ic-fill, #c87a4f)" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="19" cy="27" r="3" fill="currentColor" />
      <circle cx="29" cy="27" r="3" fill="currentColor" />
    </svg>
  );
}

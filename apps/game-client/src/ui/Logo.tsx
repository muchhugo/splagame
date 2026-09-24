import { GAME_NAME } from '@borrifo/game-contracts';

/** Marca original: gota com pião estilizado + nome em letras arredondadas. */
export function Logo({ size = 64 }: { size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.18 }} aria-label={GAME_NAME}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="lg-gota" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff7a3d" />
            <stop offset="1" stopColor="#f24a1c" />
          </linearGradient>
        </defs>
        <path d="M32 4c10 13 20 23 20 35a20 20 0 0 1-40 0C12 27 22 17 32 4z" fill="url(#lg-gota)" />
        <path d="M22 40a10 10 0 0 0 20 0c0-3-4-5-10-5s-10 2-10 5z" fill="#fff4e6" />
        <path d="M24 41h16" stroke="#3346e8" strokeWidth="3" strokeLinecap="round" />
        <circle cx="32" cy="50" r="2.6" fill="#3346e8" />
        <circle cx="25" cy="24" r="4" fill="#fff4e6" opacity=".55" />
      </svg>
      <span style={{ fontSize: size * 0.62, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1, textShadow: '0 4px 0 rgba(0,0,0,.35)' }}>
        Borri<span style={{ color: '#6f7cff' }}>fo</span>
      </span>
    </div>
  );
}

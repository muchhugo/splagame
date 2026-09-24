import { useState } from 'react';
import type { LobbyPlayer } from '@borrifo/game-contracts';
import { avatarHue, avatarSrc, initials, type VoiceInfo } from '../app/profiles';

/** Avatar (se permitido) ou iniciais, com anel discreto quando a pessoa fala na chamada. */
export function Avatar({ player, voice, size = 28 }: { player: Pick<LobbyPlayer, 'displayName' | 'avatarUrl' | 'userId' | 'isBot' | 'playerId'>; voice?: VoiceInfo; size?: number }) {
  const [broken, setBroken] = useState(false);
  const src = broken ? null : avatarSrc(player);
  const hue = avatarHue(player.userId ?? `bot-${player.playerId}`);
  return (
    <span className={`avatar${voice?.speaking ? ' speaking' : ''}`} style={{ width: size, height: size, background: `hsl(${hue} 32% 34%)` }} aria-hidden="true">
      {src ? <img src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={() => setBroken(true)} /> : <span>{player.isBot ? '🏺' : initials(player.displayName)}</span>}
    </span>
  );
}

/** Ícone de voz ao lado do nome: falando, mudo ou nada (fora da chamada). */
export function VoiceBadge({ voice }: { voice?: VoiceInfo }) {
  if (!voice) return null;
  if (voice.speaking) return <span className="vbadge speaking" title="Falando" aria-label="falando">🔊</span>;
  if (voice.muted) return <span className="vbadge muted" title="Microfone desligado" aria-label="microfone desligado">🔇</span>;
  return <span className="vbadge" title="Na chamada" aria-label="na chamada">🎙️</span>;
}

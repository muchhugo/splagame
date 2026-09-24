/**
 * Perfis na interface: liga cada jogador (userId verificado pelo servidor) ao
 * participante da chamada do host (userId ?? id) para mostrar mudo/falando, e
 * decide entre avatar e iniciais. Nada aqui vem como HTML: nomes são texto.
 */
import type { LobbyPlayer } from '@borrifo/game-contracts';
import { sanitizeAvatarUrl } from '@borrifo/game-contracts';
import type { VoiceState } from '@borrifo/activity-sdk';
import { CLIENT_CONFIG } from '../config';
import { useStore } from './store';
import { uiStore } from './uiStore';

export interface VoiceInfo {
  speaking: boolean;
  muted: boolean;
}

/** userId → estado de voz. Só existe para quem está na chamada do host. */
export function voiceByUser(voice: VoiceState): Map<string, VoiceInfo> {
  const m = new Map<string, VoiceInfo>();
  if (!voice.connected) return m;
  for (const p of voice.participants) m.set(p.userId ?? p.id, { speaking: p.speaking && !p.muted, muted: p.muted });
  return m;
}

export function useVoiceByUser(): Map<string, VoiceInfo> {
  const voice = useStore(uiStore, (s) => s.voice);
  return voiceByUser(voice);
}

/** Iniciais do nome (até 2), para quando não há avatar. */
export function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  const first = [...parts[0]][0] ?? '';
  const second = parts.length > 1 ? ([...parts[parts.length - 1]][0] ?? '') : ([...parts[0]][1] ?? '');
  return (first + second).toUpperCase();
}

/** Cor neutra estável por usuário, fora das cores das turmas (não confunde com time). */
export function avatarHue(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  // faixas evitadas: laranja do Urucum (~20°) e azul/violeta do Anil (~230–260°)
  const allowed = [[80, 170], [290, 340]] as const;
  const span = allowed.reduce((a, [x, y]) => a + (y - x), 0);
  let v = h % span;
  for (const [x, y] of allowed) {
    if (v < y - x) return x + v;
    v -= y - x;
  }
  return 120;
}

export function avatarSrc(p: Pick<LobbyPlayer, 'avatarUrl'>): string | null {
  return sanitizeAvatarUrl(p.avatarUrl, CLIENT_CONFIG.avatarHosts);
}

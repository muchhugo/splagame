import type { GameModeId, LobbyState, RoundResult, WelcomeMessage } from '@borrifo/game-contracts';
import type { ActivityContext, VoiceState } from '@borrifo/activity-sdk';
import { VOICE_NOT_CONFIGURED } from '@borrifo/activity-sdk';
import { createStore } from './store';

export type Screen = 'boot' | 'standalone' | 'connecting' | 'lobby' | 'match' | 'results' | 'waiting' | 'error' | 'closed';
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'lost';

export interface ErrorInfo {
  title: string;
  message: string;
  actions: Array<'retry' | 'close' | 'reload'>;
}

export interface Notice {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'good';
}

export interface UiState {
  screen: Screen;
  boot: { progress: number; label: string };
  error: ErrorInfo | null;
  context: ActivityContext | null;
  connection: ConnectionState;
  rttMs: number | null;
  welcome: WelcomeMessage | null;
  lobby: LobbyState | null;
  result: RoundResult | null;
  notices: Notice[];
  voice: VoiceState;
  menuOpen: boolean;
  settingsOpen: boolean;
  mapOpen: boolean;
  pointerLocked: boolean;
  sceneReady: boolean;
  audioState: string;
  /** Troca de mapa entre rodadas (tela de carregamento com nome e variante). */
  mapLoading: { name: string; variant: string; progress: number } | null;
  /** Modo da rodada atual (vem do round.loading). */
  roundMode: GameModeId;
  /** Ferramenta escolhida e ainda não confirmada pelo servidor (a vitrine mostra na hora). */
  pendingWeapon: import('@borrifo/game-contracts').WeaponId | null;
}

export const uiStore = createStore<UiState>({
  screen: 'boot',
  boot: { progress: 0, label: 'Preparando o forno…' },
  error: null,
  context: null,
  connection: 'idle',
  rttMs: null,
  welcome: null,
  lobby: null,
  result: null,
  notices: [],
  voice: VOICE_NOT_CONFIGURED,
  menuOpen: false,
  settingsOpen: false,
  mapOpen: false,
  pointerLocked: false,
  pendingWeapon: null,
  sceneReady: false,
  audioState: 'locked',
  mapLoading: null,
  roundMode: 'territorio',
});

let noticeId = 1;
export function pushNotice(text: string, kind: Notice['kind'] = 'info', ttlMs = 3500) {
  const id = noticeId++;
  uiStore.set((s) => ({ notices: [...s.notices.slice(-3), { id, text, kind }] }));
  setTimeout(() => uiStore.set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })), ttlMs);
}

export function showError(e: ErrorInfo) {
  uiStore.set({ screen: 'error', error: e });
}

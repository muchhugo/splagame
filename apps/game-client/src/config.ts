/** Configuração pública do cliente (nada secreto: tudo aqui vai para o bundle). */
export const CLIENT_CONFIG = {
  gameServerUrl: import.meta.env.VITE_GAME_SERVER_URL ?? 'http://localhost:2567',
  allowedHostOrigins: (import.meta.env.VITE_ALLOWED_HOST_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  labBackendUrl: import.meta.env.VITE_LAB_BACKEND_URL ?? 'http://localhost:3000',
  standaloneDevHostEnabled: __ENABLE_STANDALONE_DEV_HOST__,
  /** Hosts https de onde o jogo aceita carregar avatares (defesa extra; o servidor já filtra). Vazio = iniciais. */
  avatarHosts: (import.meta.env.VITE_AVATAR_HOSTS ?? '')
    .split(',')
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean) as string[],
};

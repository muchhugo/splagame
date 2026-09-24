/// <reference types="vite/client" />
declare const __ENABLE_STANDALONE_DEV_HOST__: boolean;
interface ImportMetaEnv {
  readonly VITE_GAME_SERVER_URL?: string;
  readonly VITE_ALLOWED_HOST_ORIGINS?: string;
  readonly VITE_LAB_BACKEND_URL?: string;
}

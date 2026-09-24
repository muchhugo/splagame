/** Convenção de unidades: 1 unidade de mundo = 1 metro. Eixo Y para cima. */
export const WORLD_UNITS_PER_METER = 1;

/** Passo fixo da simulação autoritativa (Hz). Valor de teste, não garantia. */
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
/** Frequência de snapshots de estado para os clientes (Hz). */
export const SNAPSHOT_RATE = 15;
export const TICKS_PER_SNAPSHOT = Math.round(TICK_RATE / SNAPSHOT_RATE);

/** Até 8 × 8: dezesseis participantes ATIVOS por rodada (humanos + bots). */
export const MAX_TEAM_SIZE = 8;
export const MAX_PLAYERS = MAX_TEAM_SIZE * 2;
/** Pessoas na sala além dos ativos ficam na fila/espectadores (limite fixo, sem vagas ocultas). */
export const MAX_ROOM_HUMANS = MAX_PLAYERS + 4;

/** Janela de reconexão (s). Ao expirar durante a partida, o slot vira bot. */
export const RECONNECT_WINDOW_SECONDS = 20;

/** Limites de fila e taxa de entradas por cliente. */
export const INPUT_QUEUE_MAX = 6;
/** Após N ticks sem entrada nova, movimento e disparo são neutralizados. */
export const INPUT_STALE_TICKS = 6;
export const MAX_CLIENT_MESSAGES_PER_SECOND = 90;

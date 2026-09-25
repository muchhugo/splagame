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
/**
 * Fila por jogador no servidor. Cabe a rajada de um quadro lento do cliente (a previsão
 * roda até 15 passos por quadro de 500 ms) sem descartar entradas reais (e suas ações).
 */
export const INPUT_QUEUE_MAX = 16;
/** Após N ticks sem entrada nova, movimento e disparo são neutralizados. */
export const INPUT_STALE_TICKS = 6;
/**
 * Fila vazia: o servidor ESPERA até N ticks pela entrada (sem simular o jogador) e depois
 * recupera um passo extra por tick enquanto houver entradas na fila. Cada entrada é
 * simulada uma vez, na ordem, como a previsão do cliente; o total de passos nunca passa
 * do total de ticks (sem ganho de velocidade).
 */
export const INPUT_HOLD_TICKS = 15;
/**
 * Atraso máximo acumulado da linha do tempo do jogador em relação ao servidor (ticks
 * esperados ainda não recuperados). Passos + atraso = ticks decorridos: não há ganho de
 * velocidade; o teto só limita o quanto o jogador pode ficar "para trás" para os outros.
 */
export const INPUT_HOLD_DEBT_MAX = 20;
export const MAX_CLIENT_MESSAGES_PER_SECOND = 90;

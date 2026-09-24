import type { GameModeId } from '@borrifo/game-contracts';

/**
 * Parâmetros dos modos, buffs e do combo cooperativo, centralizados (valores de
 * protótipo, ajustáveis após teste). Buffs e combo são ligados por modo, nunca
 * condicionados à cor visual da equipe.
 */
export interface ModeDefinition {
  id: GameModeId;
  name: string;
  short: string;
  /** Duração própria do modo (s); null usa a configuração do servidor (território). */
  durationSeconds: number | null;
  objective: boolean;
  buffs: boolean;
  mutirao: boolean;
}

export const MODES: Record<GameModeId, ModeDefinition> = {
  territorio: { id: 'territorio', name: 'Território', short: 'Pinte mais chão que a outra turma.', durationSeconds: null, objective: false, buffs: true, mutirao: true },
  correio: { id: 'correio', name: 'Correio do Ara', short: 'Leve a cápsula de pigmento até a estação ativa.', durationSeconds: 240, objective: true, buffs: true, mutirao: true },
};

export const CORREIO = {
  /** Entregas que encerram a rodada antes do tempo. */
  targetDeliveries: 5,
  pickupRadius: 1.1,
  /** Raio da área demarcada da estação (m). */
  stationRadius: 1.8,
  /** Fração da área da estação que precisa estar com a tinta da equipe do portador. */
  stationPaintShare: 0.6,
  /** Tempo contínuo do portador na estação preparada. */
  deliverSeconds: 1.2,
  /** Cápsula caída e abandonada volta ao centro após este prazo. */
  dropReturnSeconds: 10,
  /** Duração do estado "retornando" (animação/aviso) antes de ficar disponível. */
  returningSeconds: 1.5,
  /** Pausa após uma entrega, com a próxima estação já anunciada. */
  deliveredPauseSeconds: 2.5,
  /** Posse contínua máxima: impede guardar a cápsula fora de alcance para travar a partida. */
  maxCarrySeconds: 45,
  /** Espera antes de a cápsula aparecer pela primeira vez na rodada. */
  firstSpawnSeconds: 3,
} as const;

export type BuffKind = 'embalo' | 'folego';

export const BUFFS = {
  embalo: { speedMul: 1.15, duration: 6 },
  folego: { inkMul: 1.25, duration: 8 },
  pickupRadius: 1.0,
  respawnSeconds: 20,
  /** Primeira aparição na rodada (depois da contagem). */
  firstSpawnSeconds: 10,
} as const;

export const MUTIRAO = {
  /** Área convertida por participante (m²), de outra cor ou neutra para a da equipe. */
  minArea: 2,
  windowSeconds: 3,
  /** Diâmetro aproximado do setor comum (m). */
  sectorDiameter: 6,
  inkMul: 1.1,
  duration: 4,
  cooldown: 20,
  /** A mesma célula não financia outra ativação dentro desta janela (s). */
  cellReuseSeconds: 30,
} as const;

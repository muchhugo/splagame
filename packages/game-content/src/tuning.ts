/**
 * Valores de balanceamento PROVISÓRIOS e próprios deste projeto.
 * Unidades: metros, segundos, pontos de vida/pigmento. Não são reproduções
 * de nenhum jogo existente; ajustar após testes (docs/game-design.md).
 */

export interface MovementTuning {
  walkSpeed: number;
  walkSpeedOwnInk: number;
  walkSpeedEnemyInk: number;
  flowSpeedOwnInk: number;
  flowSpeedNeutral: number;
  flowSpeedEnemyInk: number;
  groundAccel: number;
  groundDecel: number;
  airAccel: number;
  gravity: number;
  maxFallSpeed: number;
  jumpSpeed: number;
  jumpSpeedFlowOwn: number;
  jumpSpeedEnemyInk: number;
  coyoteTime: number;
  climbSpeed: number;
  climbSlideSpeed: number;
  wallJumpOut: number;
  wallJumpUp: number;
  ledgeVaultUp: number;
  ledgeVaultForward: number;
  climbDetachPush: number;
  combatToFlowTime: number;
  flowToCombatTime: number;
  capsuleRadius: number;
  capsuleHalfHeight: number;
  stepHeight: number;
  maxSlopeDeg: number;
  combatHitHeight: number;
  flowHitHeight: number;
  hitRadius: number;
  /** Altura do cano da ferramenta acima dos pés. */
  muzzleHeight: number;
  muzzleForward: number;
  muzzleRight: number;
}

export const MOVEMENT: MovementTuning = {
  walkSpeed: 5.5,
  walkSpeedOwnInk: 5.9,
  walkSpeedEnemyInk: 2.4,
  flowSpeedOwnInk: 8.0,
  flowSpeedNeutral: 3.3,
  flowSpeedEnemyInk: 1.5,
  groundAccel: 44,
  groundDecel: 52,
  airAccel: 14,
  gravity: 22,
  maxFallSpeed: 30,
  jumpSpeed: 7.4,
  jumpSpeedFlowOwn: 8.8,
  jumpSpeedEnemyInk: 4.6,
  coyoteTime: 0.1,
  climbSpeed: 6.2,
  climbSlideSpeed: 0.6,
  wallJumpOut: 4.2,
  wallJumpUp: 7.0,
  ledgeVaultUp: 6.4,
  ledgeVaultForward: 3.4,
  climbDetachPush: 1.6,
  combatToFlowTime: 0.12,
  flowToCombatTime: 0.16,
  capsuleRadius: 0.36,
  capsuleHalfHeight: 0.42,
  stepHeight: 0.36,
  maxSlopeDeg: 46,
  combatHitHeight: 1.55,
  flowHitHeight: 0.75,
  hitRadius: 0.42,
  muzzleHeight: 1.12,
  muzzleForward: 0.42,
  muzzleRight: 0.26,
};

export interface InkTuning {
  capacity: number;
  refillSubmerged: number;
  regenIdle: number;
  regenDelay: number;
  lowThreshold: number;
}

export const INK: InkTuning = {
  capacity: 100,
  /** Recarga na forma de fluxo sobre tinta própria (por segundo). */
  refillSubmerged: 40,
  /** Regeneração lenta fora da tinta própria, sem consumo recente (por segundo). */
  regenIdle: 4,
  regenDelay: 1.0,
  lowThreshold: 20,
};

export interface HealthTuning {
  maxHp: number;
  regenDelay: number;
  regenRate: number;
  /** Dano ambiental da tinta inimiga (por segundo). Não letal. */
  enemyInkDps: number;
  /** Piso de vida do dano ambiental: a eliminação exige dano ofensivo. */
  enemyInkFloor: number;
  respawnDelay: number;
  spawnProtection: number;
  /** Tinta deixada no local da eliminação, na cor de quem eliminou. */
  deathSplatRadius: number;
}

export const HEALTH: HealthTuning = {
  maxHp: 100,
  regenDelay: 1.6,
  regenRate: 30,
  enemyInkDps: 12,
  enemyInkFloor: 35,
  respawnDelay: 4,
  spawnProtection: 2.5,
  deathSplatRadius: 1.5,
};

export interface MatchTuning {
  durationSeconds: number;
  countdownSeconds: number;
  loadingTimeoutSeconds: number;
  finishingSeconds: number;
  resultsTimeoutSeconds: number;
}

export const MATCH: MatchTuning = {
  durationSeconds: 180,
  countdownSeconds: 3,
  loadingTimeoutSeconds: 15,
  finishingSeconds: 2.5,
  resultsTimeoutSeconds: 60,
};

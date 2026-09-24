import type { WeaponId } from '@borrifo/game-contracts';

/** Campos comuns a todas as ferramentas principais. */
interface WeaponBase {
  id: WeaponId;
  name: string;
  role: string;
  description: string;
}

/** Emissor contínuo — referência de equilíbrio. */
export interface AutomaticWeaponDefinition extends WeaponBase {
  kind: 'automatic';
  fireInterval: number;
  inkCost: number;
  damage: number;
  projectileSpeed: number;
  /** Tempo de voo reto antes da gravidade agir. */
  straightTime: number;
  gravity: number;
  maxLife: number;
  spreadDeg: number;
  airSpreadDeg: number;
  paintRadius: number;
  dripRadius: number;
  moveSpeedFactor: number;
  projectileRadius: number;
}

/** Aplicador de contato. */
export interface ContactWeaponDefinition extends WeaponBase {
  kind: 'contact';
  swingWindup: number;
  swingRecover: number;
  flickCost: number;
  flickCount: number;
  flickSpreadDeg: number;
  flickSpeed: number;
  flickUp: number;
  flickGravity: number;
  flickDamage: number;
  flickMaxDamagePerTarget: number;
  flickPaintRadius: number;
  flickLife: number;
  swingMoveFactor: number;
  dragSpeed: number;
  dragInkPerSecond: number;
  bladeWidth: number;
  bladeReach: number;
  bladeHeight: number;
  contactDamage: number;
  contactMinSpeed: number;
  contactCooldown: number;
  stripPaintRadius: number;
}

/** Concentrador de carga. */
export interface ChargeWeaponDefinition extends WeaponBase {
  kind: 'charge';
  chargeTime: number;
  minCharge: number;
  minCost: number;
  maxCost: number;
  minDamage: number;
  maxDamage: number;
  minRange: number;
  maxRange: number;
  chargingMoveFactor: number;
  impactPaintMin: number;
  impactPaintMax: number;
  trailSpacing: number;
  trailRadius: number;
  fireRecovery: number;
  /** Raio efetivo do projétil contra jogadores (m). */
  hitInflate: number;
}

export type WeaponDefinition = AutomaticWeaponDefinition | ContactWeaponDefinition | ChargeWeaponDefinition;

export const ESGUICHO: AutomaticWeaponDefinition = {
  id: 'esguicho',
  kind: 'automatic',
  name: 'Esguicho',
  role: 'Versátil',
  description: 'Jatos rápidos de alcance médio. Pinta bem e segura a linha de frente.',
  fireInterval: 0.115,
  inkCost: 1.05,
  damage: 28,
  projectileSpeed: 32,
  straightTime: 0.2,
  gravity: 34,
  maxLife: 1.3,
  spreadDeg: 3.2,
  airSpreadDeg: 8,
  paintRadius: 0.95,
  dripRadius: 0.55,
  moveSpeedFactor: 0.78,
  projectileRadius: 0.14,
};

export const RODO: ContactWeaponDefinition = {
  id: 'rodo',
  kind: 'contact',
  name: 'Rodo',
  role: 'Contato e cobertura',
  description: 'Arraste para puxar uma faixa larga de pigmento. Toque para lançar um leque curto.',
  swingWindup: 0.28,
  swingRecover: 0.24,
  flickCost: 8,
  flickCount: 5,
  flickSpreadDeg: 22,
  flickSpeed: 17,
  flickUp: 2.2,
  flickGravity: 26,
  flickDamage: 38,
  flickMaxDamagePerTarget: 120,
  flickPaintRadius: 0.8,
  flickLife: 0.75,
  swingMoveFactor: 0.45,
  dragSpeed: 4.4,
  dragInkPerSecond: 8,
  bladeWidth: 2.2,
  bladeReach: 0.95,
  bladeHeight: 1.2,
  contactDamage: 120,
  contactMinSpeed: 2.0,
  contactCooldown: 0.5,
  stripPaintRadius: 0.32,
};

export const ESTILINGUE: ChargeWeaponDefinition = {
  id: 'estilingue',
  kind: 'charge',
  name: 'Estilingue',
  role: 'Longo alcance',
  description: 'Estique o elástico para concentrar pigmento e solte um disparo certeiro.',
  chargeTime: 0.95,
  minCharge: 0.2,
  minCost: 4,
  maxCost: 18,
  minDamage: 35,
  maxDamage: 140,
  minRange: 9,
  maxRange: 20,
  chargingMoveFactor: 0.42,
  impactPaintMin: 0.6,
  impactPaintMax: 1.3,
  trailSpacing: 1.1,
  trailRadius: 0.5,
  fireRecovery: 0.3,
  hitInflate: 0.08,
};

export const WEAPONS: Record<WeaponId, WeaponDefinition> = {
  esguicho: ESGUICHO,
  rodo: RODO,
  estilingue: ESTILINGUE,
};

export interface SecondaryDefinition {
  id: 'moringa';
  name: string;
  description: string;
  inkCost: number;
  throwSpeed: number;
  throwUp: number;
  gravity: number;
  fuse: number;
  maxFlight: number;
  bounceDamping: number;
  maxBounces: number;
  paintRadius: number;
  damageInner: number;
  damageInnerRadius: number;
  damageOuter: number;
  damageRadius: number;
  cooldown: number;
  radius: number;
}

export const MORINGA: SecondaryDefinition = {
  id: 'moringa',
  name: 'Moringa',
  description: 'Moringa de barro cheia de pigmento. Racha ao cair e estoura após um instante.',
  inkCost: 55,
  throwSpeed: 13,
  throwUp: 3.5,
  gravity: 22,
  fuse: 0.75,
  maxFlight: 1.4,
  bounceDamping: 0.35,
  maxBounces: 3,
  paintRadius: 3.0,
  damageInner: 110,
  damageInnerRadius: 1.1,
  damageOuter: 30,
  damageRadius: 2.8,
  cooldown: 0.5,
  radius: 0.18,
};

export interface SpecialDefinition {
  id: 'roda';
  name: string;
  description: string;
  /** Pontos necessários; 1 ponto = 1 m² convertido para a própria equipe. */
  pointsRequired: number;
  throwSpeed: number;
  throwUp: number;
  gravity: number;
  deployTime: number;
  waveCount: number;
  waveInterval: number;
  waveDuration: number;
  waveRadius: number;
  waveDamage: number;
  waveVerticalBand: number;
  hp: number;
  lifetime: number;
  hitRadius: number;
  /** Fração da carga perdida ao ser eliminado (se não estiver cheia). */
  deathLossFraction: number;
  maxFlight: number;
}

export const RODA_DE_OLEIRO: SpecialDefinition = {
  id: 'roda',
  name: 'Roda de Oleiro',
  description: 'Lance uma roda de oleiro que gira no chão e solta ondas de pigmento. Pode ser quebrada.',
  pointsRequired: 150,
  throwSpeed: 11,
  throwUp: 4,
  gravity: 22,
  deployTime: 0.45,
  waveCount: 4,
  waveInterval: 0.9,
  waveDuration: 0.7,
  waveRadius: 6.0,
  waveDamage: 40,
  waveVerticalBand: 1.6,
  hp: 90,
  lifetime: 4.2,
  hitRadius: 0.65,
  deathLossFraction: 0.4,
  maxFlight: 1.6,
};

export interface TacticalTravelDefinition {
  name: string;
  prepTime: number;
  flightTime: number;
  arcHeight: number;
  maxDestinationSearch: number;
}

export const PIAO_GUIA: TacticalTravelDefinition = {
  name: 'Pião-Guia',
  prepTime: 1.0,
  flightTime: 1.15,
  arcHeight: 9,
  maxDestinationSearch: 2.5,
};

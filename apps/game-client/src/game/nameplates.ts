/**
 * Regra de visibilidade dos nomes sobre os personagens. Aliados aparecem até
 * através de paredes (a posição deles já é pública no mapa tático). Adversários
 * só com linha de visão livre e fora da tinta: o nome — e o indicador de fala
 * junto dele — nunca revela quem está escondido atrás de parede ou submerso.
 */
export const NAMEPLATE = { allyRange: 32, enemyRange: 28 } as const;

export interface PlateCheck {
  ally: boolean;
  alive: boolean;
  submerged: boolean;
  dist: number;
  /** Linha de visão livre da câmera até a cabeça. */
  los: boolean;
}

export function nameplateVisible(c: PlateCheck): boolean {
  if (!c.alive) return false;
  if (c.ally) return c.dist <= NAMEPLATE.allyRange;
  return !c.submerged && c.los && c.dist <= NAMEPLATE.enemyRange;
}

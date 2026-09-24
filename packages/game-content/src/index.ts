export * from './tuning';
export * from './equipment';
export * from './mapSpec';
export * from './palette';
export * from './modes';
export * from './maps/kit';
export { TOCA_DO_ARA } from './maps/tocaDoAra';
export { CLUBE_DA_MARE } from './maps/clubeDaMare';
import { TOCA_DO_ARA } from './maps/tocaDoAra';
import { CLUBE_DA_MARE } from './maps/clubeDaMare';
import { computeMapHash, cyrb53, type MapSpec, type MapVariant } from './mapSpec';

/** Famílias de mapa jogáveis, cada uma com três variantes autorais de tamanho. */
export const MAP_FAMILIES: ReadonlyArray<{ id: string; name: string; variants: Record<MapVariant, MapSpec> }> = [
  { id: 'toca-do-ara', name: 'Toca do Ara', variants: TOCA_DO_ARA },
  { id: 'clube-da-mare', name: 'Clube da Maré', variants: CLUBE_DA_MARE },
];

/** Todas as variantes por id (ex.: 'toca-do-ara.padrao'). */
export const MAPS: Record<string, MapSpec> = Object.fromEntries(MAP_FAMILIES.flatMap((f) => Object.values(f.variants).map((m) => [m.id, m])));
export const MAP_FAMILY_IDS = MAP_FAMILIES.map((f) => f.id);
export const DEFAULT_MAP_ID = TOCA_DO_ARA.padrao.id;

/**
 * Variante pelo total de participantes ATIVOS da rodada (humanos + bots), não pelo
 * número de pessoas na chamada: 2–4 compacta, 5–8 padrão, 9–16 ampliada.
 */
export function variantFor(activePlayers: number): MapVariant {
  if (activePlayers <= 4) return 'compacto';
  if (activePlayers <= 8) return 'padrao';
  return 'ampliado';
}

export function mapFor(familyId: string, activePlayers: number): MapSpec {
  const f = MAP_FAMILIES.find((x) => x.id === familyId) ?? MAP_FAMILIES[0];
  return f.variants[variantFor(activePlayers)];
}

/**
 * Hash do CATÁLOGO inteiro (todas as variantes): cliente e servidor precisam da mesma
 * versão de todos os mapas para que qualquer escolha do servidor seja carregável.
 */
export const CATALOG_HASH = cyrb53(
  Object.values(MAPS)
    .map((m) => `${m.id}:${computeMapHash(m)}`)
    .sort()
    .join('|'),
);

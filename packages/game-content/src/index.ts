export * from './tuning';
export * from './equipment';
export * from './mapSpec';
export * from './palette';
export { PATIO_DA_OLARIA } from './maps/patioDaOlaria';
import { PATIO_DA_OLARIA } from './maps/patioDaOlaria';
import type { MapSpec } from './mapSpec';

export const MAPS: Record<string, MapSpec> = {
  [PATIO_DA_OLARIA.id]: PATIO_DA_OLARIA,
};
export const DEFAULT_MAP_ID = PATIO_DA_OLARIA.id;

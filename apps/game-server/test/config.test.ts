import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const base = { NODE_ENV: 'test', MATCH_AUTH_MODE: 'dev-hs256', DEV_MATCH_CREDENTIAL_SECRET: 'x'.repeat(40) } as NodeJS.ProcessEnv;

describe('configuração numérica validada', () => {
  it('valores válidos e padrões', () => {
    const c = loadConfig(base);
    expect(c.roundDurationSeconds).toBe(180);
    expect(c.correioDurationSeconds).toBe(240);
    expect(c.reconnectWindowSeconds).toBe(20);
    expect(loadConfig({ ...base, ROUND_DURATION_SECONDS: '90' }).roundDurationSeconds).toBe(90);
  });
  it('recusa valor malformado ou fora da faixa (rodada que nunca acabaria, limitador que sempre libera)', () => {
    for (const [k, v] of [
      ['ROUND_DURATION_SECONDS', '3m'],
      ['ROUND_DURATION_SECONDS', '0'],
      ['JOIN_RATE_PER_SECOND', 'NaN'],
      ['JOIN_RATE_BURST', '-1'],
      ['GAME_SERVER_PORT', '70000'],
      ['RECONNECT_WINDOW_SECONDS', 'Infinity'],
    ])
      expect(() => loadConfig({ ...base, [k]: v } as NodeJS.ProcessEnv), `${k}=${v}`).toThrow(new RegExp(k));
  });
});

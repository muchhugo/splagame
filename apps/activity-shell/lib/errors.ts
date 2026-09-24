/** Erro de domínio do backend do laboratório: status HTTP + código estável + mensagem em pt-BR. */
export class LabError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Cabeçalhos extras da resposta (ex.: Retry-After). */
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'LabError';
  }
}

export const PRODUCTION_REFUSAL =
  'Laboratório de desenvolvimento desativado: NODE_ENV=production. Credenciais e logins de desenvolvimento nunca valem em produção.';

export function assertNotProduction(nodeEnv: string | undefined): void {
  if (nodeEnv === 'production') throw new LabError(403, 'dev_disabled_in_production', PRODUCTION_REFUSAL);
}

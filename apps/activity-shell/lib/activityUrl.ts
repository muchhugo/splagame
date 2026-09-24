/** Monta a URL do iframe: o nonce e a sessão vão no fragmento (nunca chegam a servidores). */
export function buildActivitySrc(activityUrl: string, nonce: string, activitySessionId: string): string {
  const u = new URL(activityUrl);
  u.hash = `nonce=${encodeURIComponent(nonce)}&sid=${encodeURIComponent(activitySessionId)}`;
  return u.href;
}

/** Novo id de sessão da Atividade: `sess-` + 8 hex. */
export function newActivitySessionId(): string {
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  return `sess-${Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

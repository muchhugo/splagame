# 0008 — Credencial HS256 só em desenvolvimento; JWKS para host real

**Contexto.** O laboratório precisa emitir credenciais sem infraestrutura. O briefing exige que
credenciais de desenvolvimento nunca autorizem produção e que modos mock não sejam ativados por
parâmetro de URL.

**Decisão.**
- `MATCH_AUTH_MODE=dev-hs256`: segredo local (`pnpm setup:env`), emissor
  `trivo-activities-lab:dev`, TTL de 60 s (máximo de 120 s), `jti` anti-replay. O servidor **não
  inicia** com `NODE_ENV=production` nesse modo.
- `MATCH_AUTH_MODE=jwks`: chave pública do backend do host, com emissor configurado (o de
  desenvolvimento é recusado).
- Os endpoints de desenvolvimento do host recusam produção. A rota *standalone* só existe em
  build de desenvolvimento do jogo e com `LAB_ENABLE_STANDALONE=1` no backend.

**Consequência.** Uma credencial de laboratório não funciona num servidor de produção. O host
real precisa publicar um JWKS e emitir as mesmas claims.

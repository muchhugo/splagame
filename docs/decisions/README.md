# Registros de decisão (ADRs)

Decisões curtas: contexto, decisão e consequência. Os desvios da stack proposta no briefing
estão marcados.

| # | Decisão | Desvio? |
|---|---|---|
| [0001](0001-laboratorio-independente.md) | Laboratório independente com host fictício | — |
| [0002](0002-cliente-vite-separado-do-shell.md) | Jogo em Vite + React numa origem separada do shell Next.js | parcial |
| [0003](0003-mensagens-simples-sem-schema.md) | Mensagens simples e tinta em binário próprio, sem `Schema` do Colyseus | — |
| [0004](0004-sem-compensacao-de-latencia.md) | Sem compensação de latência no primeiro marco | — |
| [0005](0005-alcance-do-estilingue.md) | Alcance do Estilingue em 20 m | — |
| [0006](0006-persistencia-jsonl.md) | Resultado em JSONL idempotente, sem PostgreSQL/Drizzle | **sim** |
| [0007](0007-sem-colisao-entre-jogadores.md) | Sem colisão física entre jogadores | — |
| [0008](0008-modos-de-autenticacao.md) | Credencial HS256 só em desenvolvimento; JWKS para host real | — |
| [0009](0009-fisica-compartilhada-rapier.md) | Rapier compat no servidor e no cliente, com reconciliação | — |
| [0010](0010-arte-procedural.md) | Arte e som gerados por código | — |

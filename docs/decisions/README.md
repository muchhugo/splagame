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
| [0006](0006-persistencia-jsonl.md) | Resultado em JSONL idempotente (laboratório; substituído em produção pelo 0016) | **sim** |
| [0007](0007-sem-colisao-entre-jogadores.md) | Sem colisão física entre jogadores | — |
| [0008](0008-modos-de-autenticacao.md) | Credencial HS256 só em desenvolvimento; JWKS para host real | — |
| [0009](0009-fisica-compartilhada-rapier.md) | Rapier compat no servidor e no cliente, com reconciliação | — |
| [0010](0010-arte-procedural.md) | Arte gerada por código (o som mudou, ver 0011) | — |
| [0011](0011-efeitos-sonoros-gravados.md) | Efeitos sonoros gravados (CC0) no lugar da síntese | — |
| [0012](0012-transporte-colyseus-voz-livekit.md) | Gameplay continua no Colyseus; LiveKit só na voz do host (benchmark isolado) | — |
| [0013](0013-tokens-e-pares-de-cores.md) | Tokens de cor em três conjuntos; par de equipe escolhido pelo servidor por rodada | — |
| [0014](0014-controle-gamepad.md) | Controle pela Gamepad API, lido a ~8 ms, glifos por família | — |
| [0015](0015-entrada-uma-vez-na-ordem.md) | Cada entrada simulada uma vez e na ordem: esperar e recuperar em vez de repetir e descartar | — |
| [0016](0016-resultados-postgres-drizzle.md) | Resultados no PostgreSQL com Drizzle, idempotência no banco | — |

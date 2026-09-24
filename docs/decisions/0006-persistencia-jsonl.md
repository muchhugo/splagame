# 0006 — Resultado em JSONL idempotente, sem PostgreSQL/Drizzle (desvio)

**Contexto.** O briefing propõe PostgreSQL + Drizzle para os dados persistentes. O ambiente não
tinha banco disponível, e o único dado persistente do primeiro marco é o resultado da rodada.

**Decisão.** Interface `ResultSink` no servidor de partidas, com idempotência por
`(matchId, roundId)`. No laboratório, `JsonlResultSink` grava um arquivo local
(`RESULTS_FILE`). Os testes usam `MemoryResultSink`. Rodadas interrompidas são gravadas como
`interrupted`, sem vencedor.

**Consequência.** **Não é persistência de produção.** Um host real precisa de uma
implementação sobre o banco dele (Drizzle/Postgres ou evento para o backend do Trivo), com
constraint única por `(matchId, roundId)`. A interface já separa isso do resto do servidor.

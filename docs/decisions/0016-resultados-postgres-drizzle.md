# 0016 — Resultados no PostgreSQL com Drizzle (substitui o 0006 em produção)

**Contexto.** O [0006](0006-persistencia-jsonl.md) deixou o resultado da rodada num JSONL
local, com idempotência só na memória do processo. Isso não serve para produção: dois
processos, ou um reinício no meio da gravação, podem duplicar ou perder a rodada.

**Decisão.**

- `PostgresResultSink` (`apps/game-server/src/db/`), com Drizzle sobre `pg`. Tabela
  `round_results` com **índice único em `(match_id, round_id)`** e
  `INSERT … ON CONFLICT DO NOTHING RETURNING id`. A idempotência é do banco e vale entre
  processos e reinícios.
- Migrações geradas pelo `drizzle-kit` a partir do esquema (`apps/game-server/drizzle/`) e
  aplicadas explicitamente (`pnpm --filter @borrifo/game-server db:migrate`), nunca na subida.
- Na subida, o servidor confere conexão e tabela e falha com mensagem clara se faltarem.
- `RESULT_SINK=postgres` (padrão em `NODE_ENV=production`) exige `DATABASE_URL`;
  `RESULT_SINK=jsonl` é recusado em produção. O laboratório continua no JSONL.
- Pool pequeno (4) e tempo limite de 5 s por comando. Falha do banco vira erro, e a sala
  registra `result.persist_failed` e segue (a rodada não cai por causa do banco).
- Só o necessário vai para o banco: sessão da Atividade, partida, rodada, mapa, modo,
  estado, vencedor, unidades, percentuais, entregas e, por jogador, id da sala, turma, bot,
  área, eliminações e quedas. **Sem nome de exibição nem id do Trivo.**

**Testes.** `apps/game-server/test/postgresSink.test.ts` roda num PostgreSQL de verdade
(PGlite, o Postgres em WASM, no processo), com as mesmas migrações. Cobre:

- gravar e repetir;
- dez gravações simultâneas de dois "servidores" no mesmo banco (uma linha);
- falha do banco;
- uma rodada completa pelo servidor real;
- as regras de configuração.

**Não validado.** Um PostgreSQL gerenciado de verdade (rede, TLS, credenciais, backup,
retenção). Nada foi publicado nem contratado. O host real também pode preferir mandar o
resultado como evento ao backend do Trivo, e a interface `ResultSink` continua permitindo
isso.

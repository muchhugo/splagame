# 0001 — Laboratório independente com host fictício

**Contexto.** O briefing pede para trabalhar num laboratório, sem modificar o Trivo principal nem
substituir o Arapark. O repositório de trabalho (`muchhugo/splagame`) estava **vazio**, sem
nenhum commit, e esta sessão não tem acesso a outro repositório. Não havia código de
Atividades, autenticação ou LiveKit do Trivo para inspecionar.

**Decisão.** Monorepo pnpm próprio, com o jogo e um **host de desenvolvimento**
(`apps/activity-shell`) que implementa o contrato de Atividade descrito no briefing. Usuários,
canal e comunidade do host são fictícios e rotulados como tal na interface.

**Consequência.** O contrato foi exercitado de ponta a ponta, mas só contra este host. A
integração com o Trivo real continua pendente e não verificada. O caminho previsto está em
`docs/activity-integration.md`.

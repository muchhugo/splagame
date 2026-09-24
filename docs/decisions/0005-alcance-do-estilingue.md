# 0005 — Alcance do Estilingue em 20 m

**Contexto.** No Pátio da Olaria v2, com alcance de 24 m, havia posições na praça central com
linha de tiro até pontos de spawn, o que permitiria "acampar" o spawn adversário.

**Decisão.** `ESTILINGUE.maxRange = 20`. O teste `map.test.ts` verifica que, de uma grade de pontos de
olho no topo da praça, nenhum spawn fica com linha de visão livre dentro do alcance máximo do
Estilingue, a ferramenta de maior alcance.

**Consequência.** O Estilingue controla corredores e a praça, mas não o spawn. Qualquer mudança
no mapa ou no alcance precisa manter o teste passando.

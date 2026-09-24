# 0013: Tokens de cor em três conjuntos e pares de equipe escolhidos pelo servidor

**Contexto.** O briefing pede o logo do Trivo como referência de paleta, com três conjuntos de
tokens (marca/interface, equipes, cenário), cores de equipe variáveis por rodada e nenhuma
regra baseada em RGB. Pede também que uma arara azul no fundo não pareça um jogador da equipe
azul. O SVG chegou como `trivo logo.svg` (commit 4e77adc).

**Decisão.**
- `packages/game-content/src/palette.ts` é a fonte única:
  - `TRIVO_SVG` guarda os preenchimentos exatos do arquivo. Um teste lê o SVG e compara.
    Não foram confirmados como paleta oficial.
  - `UI_TOKENS` e `SCENERY_TOKENS` definem interface e cenário; o cenário é dessaturado.
  - `TEAM_PAIRS` define os pares: Urucum × Anil, Açaí × Mate e Pitanga × Jenipapo.
- O servidor escolhe o par por rodada (`pickTeamPair`, rotação a partir de uma semente da
  sala). Ele vai no `ROUND_LOADING` e no `LobbyState`, para quem entra ou reconecta.
  `TeamId` continua sendo a identidade; nomes e cores vêm do par.
- As paletas de acessibilidade (alto contraste, daltonismo) remapeiam **localmente** cores e
  nomes, sem mudar o dono da tinta.
- A separação é medida no espaço OKLab, com daltonismo simulado (Viénot, Brettel e Mollon).
  O teste exige:
  - distância entre as equipes > 0,3, e > 0,2 sob protanopia, deuteranopia e tritanopia;
  - distância da cor de equipe ao cenário e à marca > 0,08.

**Consequência.**
- A medição mostrou que as bandeirinhas antigas tinham quase a cor da tinta
  (ΔE ≈ 0,045); passaram a usar os tokens de cenário.
- O terceiro par proposto (Caju) coincidia com o amarelo da marca (ΔE 0,018) e foi trocado.
- A interface usa o amarelo da marca nos botões principais.
- O mural da arara, as roupas por par e o redesign completo das telas continuam pendentes
  (fases 1 e 2).

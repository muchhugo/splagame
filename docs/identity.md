# Identidade — Borrifo

> **Nome de desenvolvimento, provisório.** Não houve pesquisa de marca.
> A única verificação feita foi uma busca web preliminar
> (`"Borrifo" jogo game`, 24/09/2026), que não mostrou nenhum jogo com esse nome.
> Isso **não** significa que o nome esteja juridicamente disponível. A pesquisa
> de marca e de direitos precisa ser feita por profissionais antes de qualquer
> exploração comercial.

## Configuração centralizada

`packages/game-contracts/src/identity.ts` concentra `GAME_NAME`, `GAME_SLUG`, `GAME_ID`,
`GAME_VERSION` e a versão do protocolo. Interface, README, logs e o contrato da Atividade
usam essas constantes, então não renomeie o projeto espalhando strings pelo código.

| Constante | Valor |
|---|---|
| `GAME_NAME` | Borrifo |
| `GAME_SLUG` | borrifo |
| `GAME_ID` | `trivo.lab.activity.borrifo` |

## Conceito

**Borrifo** (de *borrifar*, espalhar gotas) é um jogo social competitivo de disputa
territorial por pigmento, jogado em equipes de até quatro participantes.

### Universo

Numa olaria de beira de estrada, os **Bibelôs** ganham vida. São autômatos pequenos, de
cerâmica esmaltada e polímero, com um **miolo** de pigmento no peito. Depois que o forno
esfria, duas turmas de bibelôs disputam o pátio da olaria cobrindo tudo com o pigmento
da sua turma. Quem manchar mais chão quando o sino tocar leva a fornada.

- **Forma Bibelô (combate):** bípede, com cabeça-vaso, corpo de cerâmica e braços de
  polímero que seguram a ferramenta.
- **Forma Pião (fluxo):** o bibelô recolhe os membros no casco e vira um pião mecânico.
  Ele gira sobre a ponta e desliza pelo pigmento da própria turma, recarrega o miolo e
  sobe paredes pintadas, grudado pela rotação. Não há referência a criaturas marinhas:
  a metáfora é o brinquedo de corda brasileiro.

### Turmas (equipes)

A identidade lógica é o `TeamId` (0 ou 1). Nome, cor e padrão são apresentação. O **servidor
escolhe um par por rodada**, e a paleta de acessibilidade pode remapear localmente cores e
nomes, sem mudar o dono lógico da tinta. O símbolo acompanha o `TeamId` em todos os pares
(▲ para 0, ● para 1).

| Par (`TEAM_PAIRS`) | TeamId 0 | TeamId 1 | Origem dos nomes |
|---|---|---|---|
| `urucum-anil` | Urucum `#ff6414` | Anil `#4a3dff` | pigmentos naturais: semente do urucum, índigo do anil |
| `acai-mate` | Açaí `#9b3df2` | Mate `#35c46a` | fruto do açaí, erva-mate |
| `pitanga-jenipapo` | Pitanga `#c81e3c` | Jenipapo `#5fe6ea` | fruto da pitanga; o jenipapo dá tinta azul-esverdeada |

Os pares foram escolhidos por medição, não a olho (`palette.test.ts`). As duas equipes ficam
a mais de 0,3 no OKLab (> 0,2 sob protanopia, deuteranopia e tritanopia simuladas), e cada cor
de equipe fica a mais de 0,08 do cenário e da marca.

### Marca: referência ao Trivo

O logo chegou como `trivo logo.svg` (commit 4e77adc). É a arara do Trivo, e serve de
**referência de paleta e de forma, não de carimbo**: o logo não é repetido pelo cenário. Os
tokens ficam em `packages/game-content/src/palette.ts` (`TRIVO_SVG`, `UI_TOKENS`,
`SCENERY_TOKENS`), em três conjuntos separados:

| Conjunto | Uso | Valores |
|---|---|---|
| Marca e interface | Destaque dos botões principais, barra de carga, foco | Os preenchimentos **exatos do arquivo**: `#003fcc`, `#002ba0`, `#0034b4`, `#008e32`, `#febd00`, `#fbfaf9`. **Não foram confirmados como paleta oficial do Trivo**; são o que o SVG recebido contém |
| Equipes | Tinta, roupa, efeitos, marcadores, placar, mapa, resultado | `TEAM_PAIRS` (acima) |
| Cenário | Bandeirinhas, toldos, madeira e a futura arara ambiental | Tons dessaturados (`SCENERY_TOKENS`), para não parecer tinta nem jogador |

A primeira medição mostrou que as bandeirinhas antigas tinham quase a cor da tinta
(ΔE ≈ 0,045); agora usam os tokens de cenário. O botão principal usa o amarelo da marca com
texto escuro, porque as cores de equipe mudam por rodada e não servem de cor de interface.

### Nomes de equipamentos (todos originais)

| Arquétipo | Nome no jogo | Ideia visual |
|---|---|---|
| Emissor contínuo | **Esguicho** | bomba de jardim de latão com reservatório de vidro |
| Aplicador de contato | **Rodo** | rodo largo de borracha, de puxar água de quintal |
| Concentrador de carga | **Estilingue** | estilingue de forquilha que estica um elástico de pigmento |
| Dispositivo arremessável | **Moringa** | pequena moringa de barro cheia de pigmento, que racha e estoura |
| Habilidade especial | **Roda de Oleiro** | roda de oleiro lançada ao chão que gira e solta ondas de pigmento |
| Deslocamento tático | **Pião-Guia** | o bibelô se lança girando até um companheiro |

### Arena

**Pátio da Olaria**: pátio de uma olaria de beira de estrada, com uma **praça central elevada**
(ponte de madeira sobre uma passagem inferior) e a estátua de um bibelô girando devagar num
pedestal de azulejo. Tem varanda elevada ao norte, tablado ao sul, fornos com chaminés
fumegando, varais, muretas e um galpão para cada turma, com duas saídas e uma roda de oleiro
girando no telhado. Letreiros "OLARIA BORRIFO" e "PÁTIO" nos muros, bandeirinhas, potes e
árvores no entorno ajudam na orientação.

### Direção de arte

Cartoon vibrante, amigável e um pouco cômico, sem ser infantil nem paródia. Tem identidade
própria: as referências externas serviram só para cor, luz e atmosfera.

- **Cel shading suave** nos personagens e ferramentas (duas faixas de luz e contorno discreto).
  No cenário é mais sutil, com sombras levemente frias e oclusão que marca o contato com o chão.
- **Luz de dia clara e agradável:** céu azul com nuvens desenhadas, sol quente e névoa aérea
  leve. Nem escuro nem lavado.
- **Cor intensa onde importa:** tinta, personagens e destaques. O cenário usa terracota, madeira,
  pedra clara, tijolo e azulejo branco e azul, com materiais foscos, não plásticos.
- **Tinta molhada estilizada:** bordas orgânicas, leve relevo, brilhos pequenos e contidos,
  respingos com gotas satélites. Um padrão opcional (listras para o ▲, pontos para o ●)
  atende quem não diferencia cores.
- **Bibelôs:** cabeça grande, olhos com pupila e sobrancelhas, tanque de vidro nas costas que
  mostra o nível de tinta, botas na cor da turma e ferramentas com reservatórios exagerados.
- **Peças modulares simples com acabamento:** caixotes com moldura e marca gráfica, muretas de
  tijolo, rampas de pedra e madeira, fornos de azulejo.
- **Legibilidade de combate em primeiro lugar:** partículas limitadas, tremor de câmera leve e
  desligável, nada sobre a mira, personagem colado na câmera esmaecido e cores de turma sempre
  distinguíveis do chão sem tinta.
- Interface em português brasileiro, com tipografia arredondada (Fredoka, OFL), cantos
  generosos, contorno de "adesivo" nos elementos do HUD, superfícies de barro e destaque no
  amarelo da arara (marca). As cores de equipe só aparecem onde há equipe.

### Som

- **Efeitos:** gravações reais baixadas, todas CC0 (ver `AUDIO_CREDITS.md`), escolhidas para
  combinar com o visual cartoon:
  - respingos, slime, lama e bolhas para a tinta;
  - tapas úmidas para dano;
  - barro e louça para a Moringa;
  - woosh giratório para a Roda de Oleiro;
  - apito de êmbolo para o Pião-Guia e a carga do Estilingue;
  - passos de pedra e madeira;
  - sino de verdade para "quando o sino tocar".
  Jingles curtos de pizzicato e steel drum marcam início, vitória, derrota e empate. Nada soa
  como tiro realista ou explosão militar.
- **Música:** trilha generativa própria, com percussão inspirada em ritmos brasileiros em
  compasso próprio. Nada imita melodias ou sons de outros jogos.

## O que evitar

Nenhum nome, personagem, silhueta, logo, som, mapa ou interface deve lembrar a obra de
referência mecânica. As mecânicas (disputa de território por tinta, forma de
deslocamento, recarga na própria tinta) são implementadas com apresentação, números e
nomes próprios.

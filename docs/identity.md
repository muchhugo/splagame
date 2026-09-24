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

A identidade lógica é o `TeamId` (0 ou 1). Nome, símbolo e cor são apresentação: a
paleta de acessibilidade troca as cores, mas nunca o dono lógico.

| TeamId | Nome | Símbolo | Cor padrão | Origem do nome |
|---|---|---|---|---|
| 0 | Urucum | ▲ triângulo | laranja-avermelhado | pigmento natural da semente do urucum |
| 1 | Anil | ● círculo | azul-índigo | pigmento natural do anil (índigo) |

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

**Pátio da Olaria**: pátio de chão de terracota com fornos de queima, varais de secagem,
um galpão para cada turma, uma varanda elevada e uma chaminé central. A decoração inclui
bandeirinhas, telhas empilhadas e moringas.

### Direção de arte

- 3D estilizado, com geometria moderada, cerâmica esmaltada (brilho especular suave),
  terracota fosca, madeira e latão.
- Luz de fim de tarde (sol baixo e quente, céu em gradiente) com sombras suaves
  pré-calculadas no cenário.
- Tinta com bordas orgânicas, leve relevo e brilho moderado. Um padrão opcional
  (listras para Urucum, pontos para Anil) atende quem não diferencia cores.
- Interface em português brasileiro, com tipografia arredondada (Fredoka, OFL), cantos
  generosos e cores de barro e anil.

### Som

Todo o som é sintetizado em tempo real com WebAudio a partir de parâmetros originais,
sem nenhuma amostra externa. A trilha é gerativa, com percussão inspirada em ritmos
brasileiros em compasso próprio. Nada imita melodias ou sons de outros jogos.

## O que evitar

Nenhum nome, personagem, silhueta, logo, som, mapa ou interface deve lembrar a obra de
referência mecânica. As mecânicas (disputa de território por tinta, forma de
deslocamento, recarga na própria tinta) são implementadas com apresentação, números e
nomes próprios.

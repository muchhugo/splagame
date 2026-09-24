# Design do jogo

Os valores abaixo são **provisórios** e próprios deste projeto (`packages/game-content`). Eles
foram ajustados em partidas com bots, não em testes com pessoas.

## Loop

1. Lobby: escolher equipe (Urucum ▲ ou Anil ●) e ferramenta, e marcar "Pronto". O anfitrião
   inicia, e as vagas vazias podem virar bibelô-bots.
2. Rodada de 3 minutos no Pátio da Olaria: cobrir o chão com a cor da própria equipe. Paredes são
   pintáveis e escaláveis, mas **não pontuam**.
3. Eliminar adversários tira ritmo deles e deixa uma mancha na cor de quem eliminou, mas **não dá
   ponto direto**. Ganha quem tiver mais chão ao soar o sino.
4. Resultados com percentuais, área em m² e estatísticas por jogador. Todos votam revanche, ou o
   anfitrião volta ao lobby.

## Duas formas

| | Forma Bibelô (combate) | Forma Pião (fluxo) |
|---|---|---|
| Silhueta | alta, alvo de 1,55 m | baixa, alvo de 0,75 m |
| Na tinta própria | 5,9 m/s | **8,0 m/s**, recarga rápida (40/s), sobe paredes pintadas |
| No chão neutro | 5,5 m/s | 3,3 m/s |
| Na tinta inimiga | 2,4 m/s, pulo menor, dano gradual | 1,5 m/s |
| Atirar | sim | não (pedir disparo sai do fluxo e só atira depois da transição) |
| Transição | 0,12 s para fluxo | 0,16 s para combate |

- Submerso na própria tinta, o jogador fica pouco visível para o adversário (5% parado, 14% em
  movimento), mas **nunca invisível** dentro de tinta inimiga.
- **Escalada:** na forma Pião, contra uma parede com tinta própria na face tocada, sobe a
  6,2 m/s. No topo, sai com um salto de borda (sem teleporte). Perde a aderência se o inimigo
  pinta a face.

## Pigmento, vida e reaparecimento

| Parâmetro | Valor |
|---|---|
| Tanque | 100 |
| Recarga submerso (tinta própria) | 40/s |
| Regeneração fora da tinta (após 1 s sem gastar) | 4/s |
| Vida | 100; regenera 30/s após 1,6 s sem dano |
| Tinta inimiga no chão | 12/s de dano, **nunca abaixo de 35**: eliminar exige dano ofensivo |
| Reaparecimento | 4 s; proteção de 2,5 s, que termina ao sair da área de spawn e não renova |

## Ferramentas

| | Esguicho (automático) | Rodo (contato) | Estilingue (carga) |
|---|---|---|---|
| Papel | pintar e pressionar a média distância | abrir caminho no chão e emboscar | controle de linha a longa distância |
| Ataque | jato a cada 0,115 s, 28 de dano, custo 1,05 | balanço (0,28 s de preparação) lança 5 gotas de 38 de dano, custo 8; arrasto pinta uma faixa de 2,2 m e causa 120 de dano por contato | carga de 0,95 s: 35 a 140 de dano, alcance de 9 a **20 m**, custo 4 a 18 |
| Movimento ao usar | 78% | 45% no balanço; arrasto a 4,4 m/s | 42% carregando |
| Sinal ao adversário | jato visível | balanço visível | **mira visível** para todos enquanto carrega |

O alcance máximo do Estilingue foi reduzido de 24 para 20 m para que nenhuma posição da praça
central alcance os pontos de spawn (há um teste que verifica isso). Ver
[ADR 0005](decisions/0005-alcance-do-estilingue.md).

## Dispositivo, especial e deslocamento

- **Moringa (Q):** moringa de barro arremessada, com custo de 55 de pigmento. Quica até 3 vezes e
  estoura após 0,75 s: pinta um raio de 3 m, causa 110 de dano no centro (1,1 m) e 30 até 2,8 m.
  A explosão **não atravessa paredes**, nem para pintar nem para ferir. Exige a forma de combate.
- **Roda de Oleiro (E):** carrega com **150 m² de área conquistada** (neutra ou inimiga; repintar
  a própria cor não conta). É lançada ao chão, onde gira e solta 4 ondas de pigmento (raio de
  6 m, 40 de dano por onda). Um anel no chão avisa o alcance ao adversário. Tem 90 de vida e pode
  ser destruída. Morrer antes de usá-la perde 40% da carga parcial.
- **Pião-Guia (mapa tático, Tab):** clique num aliado para se lançar até ele girando. São 1 s de
  preparação (visível e cancelável se o aliado cai) e 1,15 s de voo em arco. O pouso procura um
  ponto livre perto do aliado. Adversários nunca aparecem no mapa tático.

## Bots

Os bots rodam no servidor e geram `PlayerInput` pelas **mesmas regras** dos humanos: custo,
cadência, física e tinta. Eles navegam por um grafo derivado do mapa (nós a cada ~1 m, arestas
de caminhada, rampa ou queda). Não veem através de paredes e ignoram inimigos submersos a
distância. Alternam entre pintar território, recarregar, perseguir e fugir, e usam Moringa e
especial. Servem para preencher vagas e testar, não como adversário competitivo.

## Arena: Pátio da Olaria (v2)

Pátio de olaria com simetria de ponto (cada equipe tem a mesma área pontuável):

```text
            varanda elevada (rampas nas duas pontas, parapeito)
   ┌───────────────────────────────────────────────────────────┐
   │ galpão  │ varais/mureta │      PRAÇA CENTRAL      │ varais │ galpão │
   │ Urucum  │  forno +      │  elevada (2,4 m), ponte  │ forno  │ Anil   │
   │ 2 saídas│  chaminé      │  de madeira, estátua     │        │ 2 saídas│
   │ (rampas)│  pilar/muro   │  giratória, passagem     │        │        │
   │         │               │  inferior, rampas O/S    │        │        │
   └───────────────────────────────────────────────────────────┘
            tablado com rampas (lado sul)  ·  caixotes e potes como cobertura
```

- **Centro disputado:** praça elevada com ponte de madeira sobre uma **passagem inferior** (rota
  protegida por baixo). A estátua no pedestal quebra a linha de visão no topo.
- **Rotas laterais:** varanda elevada ao norte e tablado ao sul, cada um com duas rampas.
  Corredores entre os dois têm varais e muretas baixas (1 m) que quebram linhas longas sem virar
  labirinto.
- **Saídas da base:** cada galpão tem rampas frontais e laterais (8 no total, testado). O spawn
  fica de frente para uma saída, com 3 m livres.
- **Tinta como rota:** fornos, muros e pilares têm faces pintáveis. Escalar dá acesso à praça, à
  varanda e aos atalhos sem passar pelas rampas.
- **Orientação:** letreiros "OLARIA BORRIFO" e "PÁTIO" nos muros, estátua giratória no centro,
  chaminés com fumaça e roda de oleiro no telhado de cada galpão.
- Alturas moderadas (1 a 3 m), sem quedas mortais nem água.

Testes do desenho em `packages/game-simulation/test/map.test.ts`: spawns livres e voltados a
uma saída; praça, varanda, tablado e passagem inferior alcançáveis caminhando; oito rampas de
galpão; sem linha de tiro da praça aos spawns dentro do alcance máximo; simetria de área.

## Direção de arte

Cartoon vibrante e amigável, cômico sem ser infantil, com identidade própria (ver
[identity.md](identity.md)):

- **Cel shading suave** nos personagens e equipamentos (duas faixas de luz, contorno discreto).
  No cenário é mais sutil, com sombras frias e oclusão pré-calculada que marca o contato com o chão.
- **Luz de dia clara**, com céu de nuvens desenhadas e névoa aérea leve. Não é escura nem lavada.
- **Cor intensa na tinta, nos personagens e nos destaques.** O cenário usa tons quentes e
  foscos: terracota, madeira, pedra clara e azulejo branco e azul.
- **Tinta molhada estilizada**, com brilho pequeno e contido. Os demais materiais são foscos, não
  plásticos.
- **Modelos simples com acabamento intencional:** caixotes com moldura e marca gráfica, cabeça
  grande, olhos e sobrancelhas expressivos, tanque de vidro nas costas mostrando o nível de tinta,
  ferramentas com reservatórios exagerados.
- **Efeitos com personalidade e sem prejudicar o combate:** respingos orgânicos, partículas
  limitadas e reduzidas perto da câmera, tremor de câmera leve e desligável, e personagem colado
  na câmera esmaecido para não tapar a mira.

## Acessibilidade

Paletas alternativas (alto contraste e daltonismo), padrões na tinta, redução de tremor e de
flashes, escala do HUD, `prefers-reduced-motion` no HUD, remapeamento de teclas, modos segurar
ou alternar para o fluxo e o mapa, sensibilidade, inversão de eixo e FOV.

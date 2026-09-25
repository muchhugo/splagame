# Design do jogo

Os valores abaixo são **provisórios** e próprios deste projeto (`packages/game-content`). Eles
foram ajustados em partidas com bots, não em testes com pessoas.

## Loop

1. Lobby: escolher visual, ferramenta e equipe preferida, e marcar "Pronto". Quem organiza
   escolhe o modo, o mapa (ou a rotação) e a formação (Flex ou 1 × 1 a 8 × 8). O lobby mostra
   a formação real antes do início, com bots identificados e fila.
2. Rodada na Toca do Ara ou no Clube da Maré. No **Território** (3 min), vence quem cobrir
   mais chão com a cor da própria equipe; paredes são pintáveis e escaláveis, mas **não
   pontuam**. No **Correio do Ara** (4 min ou 5 entregas), vence quem entregar mais vezes a
   cápsula numa estação preparada com a própria tinta. Ver [mapas-e-modos.md](mapas-e-modos.md).
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

- Submerso na própria tinta, o jogador fica pouco visível para o adversário por perto (5%
  parado, 14% em movimento, com ondulação acima de 1,5 m/s) e **oculto** parado ou devagar
  longe de todo adversário (mais de 3,5 m): nesse caso o servidor nem manda a posição. Levar
  dano, pegar buff, fazer Mutirão, carregar a cápsula ou andar rápido revelam. **Nunca
  invisível** dentro de tinta inimiga. Detalhes em [networking.md](networking.md#filtragem-por-interesse-quem-está-imerso).
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

## Arenas

O antigo Pátio da Olaria evoluiu para a **Toca do Ara**, e o segundo mapa é o **Clube da
Maré**. Cada um tem três variantes de tamanho (compacta, padrão e ampliada), escolhidas pelo
servidor pelo total de participantes ativos. O desenho, os lugares nomeáveis e os testes
estão em [mapas-e-modos.md](mapas-e-modos.md).

Princípios mantidos nas seis variantes, todos testados:

- simetria de ponto;
- centro disputado;
- rotas laterais;
- pelo menos duas saídas por base;
- spawn de frente para a saída;
- paredes pintáveis como atalho;
- nenhuma linha de tiro do centro até o spawn;
- nenhum poço sem saída.

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

### Animação: solta, desleixada e legível

Os personagens se mexem com uma energia de boneco de posto, controlada. O desleixo é
**só apresentação**: a camada (`looseLayer` em `CharacterView.ts`) nunca muda posição, rumo,
hitbox, colisão, previsão nem direção da mira. Ela lê a velocidade e a aceleração pela
posição renderizada e move molas amortecidas:

- **Corrida:** braço livre com balanço exagerado e cotovelo mole; o tronco atrasa e torce na
  curva e se inclina na aceleração.
- **Mudança brusca:** ao frear forte, uma derrapada curta: tronco para trás, braços jogados e
  pés compensando.
- **Salto e aterrissagem:** no ar, pernas pedalando e braços para cima; ao pousar, squash
  proporcional à altura da queda.
- **Idle:** corpo largado, peso trocando de quadril, balanço lento e uma mexida ocasional.
- **Secundários:** cabeça e rabo de cavalo em molas próprias, com limite de ângulo para não
  atravessar o corpo.
- **Dano, vitória e derrota:** o dano dá um tranco nas molas; a vitória rebola e sacode os
  braços; a derrota deixa os braços pendurados e a cabeça balançando.

**Foco competitivo.** Ao atirar, carregar, arrastar ou girar a ferramenta, e também na viagem
tática, escalando ou no Pião, o fator de foco sobe em cerca de 60 ms. O exagero cai então para
20%, e o braço da ferramenta fica na pose de mira. Quando a ação acaba, o foco volta devagar
(cerca de 0,3 s), sem estalo. A silhueta de disparo e a de mira ficam iguais às de antes.

A vitrine de desenvolvimento tem poses com movimento real (`freada`, `curva` e
`aterrissagem`), que rodam em passo fixo e congelam logo depois do evento.

## Interface fora da partida

Os menus acontecem sobre a arena em 3D, com o grupo no palco. O lobby é o hub social da
Atividade: não há XP, carreira nem perfil próprio, porque a identidade vem do Trivo.
Detalhes, decisões e validação estão em [menus.md](menus.md).

## Cores das equipes por rodada

O servidor escolhe um par de apresentação a cada rodada (Urucum × Anil, Açaí × Mate, Pitanga
× Jenipapo, em rotação a partir de uma semente da sala). Tinta, roupa, efeitos, placar, mapa
e resultado mudam juntos. Os nomes das turmas acompanham o par. Ver
[identity.md](identity.md#turmas-equipes).

## Controles e treino

- **Teclado e mouse**, **controle** e **toque** funcionam juntos. Trocar no meio da partida não
  pausa nada, e as dicas na tela passam a mostrar a tecla, o botão ("Y", "△", "X" no
  Nintendo) ou o gesto.
- **Controle, layout padrão pela posição física:**

  | Entrada | Ação |
  |---|---|
  | L (analógico esquerdo) | move |
  | R (analógico direito) | câmera |
  | RT | usa a ferramenta |
  | LB | Forma Pião |
  | LT | ação contextual: Moringa; no mapa, confirma o Pião-Guia |
  | A | pula |
  | RB | Moringa |
  | Y | Roda de Oleiro |
  | View | mapa |
  | Menu | menu |
  | R3 | recentraliza a câmera |

  Tudo é remapeável, e remapear para um botão ocupado troca as duas ações. No mapa, o
  direcional escolhe o companheiro.
- **Mira assistida (só controle):** leve e desligável. Ela desacelera a câmera perto de um
  adversário visível e puxa a mira um pouco enquanto o jogador mira ou anda; nunca mira
  sozinha.
- **Vibração:** curta, em disparo (no começo da rajada), dano, Moringa, especial, aterrissagem
  forte e eliminação. Tem intensidade ajustável e nunca é contínua.
- **Treino rápido:** 9 etapas dentro da primeira partida: andar, olhar, usar a ferramenta,
  pintar o chão, Forma Pião, recarregar, mapa, Moringa e Roda.
  - Cada etapa é detectada pelo próprio jogo, e o texto segue o dispositivo em uso.
  - Não pausa nem bloqueia; dá para pular a etapa ou encerrar.
  - Pode ser refeito pelo menu, e a conclusão fica salva por versão.

## Acessibilidade

Paletas alternativas (alto contraste e daltonismo, com nomes próprios, remapeando o par da
rodada só neste aparelho), padrões na tinta, redução de tremor e de flashes, escala do HUD,
`prefers-reduced-motion` no HUD e no treino, remapeamento de teclas e de botões do controle,
modos segurar ou alternar para o fluxo e o mapa, sensibilidade (mouse e controle, por eixo),
inversão de eixo e FOV.

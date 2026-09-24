# Mapas, variantes, formação e modos

Esta página descreve o que está **implementado** e como é testado. O que depende de uma
pessoa jogando, de um aparelho físico ou do Trivo real está marcado à parte, no fim.

## Mapas como dados

Cada variante é um `MapSpec` em `packages/game-content/src/maps/`. A mesma especificação
alimenta:

- a física (Rapier);
- a tinta e a área pontuável;
- o grafo de navegação dos bots;
- os objetivos (cápsula, estações e pickups);
- o cliente: geometria, materiais e decoração.

O `MapSpec` tem os campos `family`, `variant`, `players` (faixa de participantes ativos) e
`objectives`.

O `computeMapHash` cobre geometria, spawns, zonas protegidas, objetivos e variante.
Decoração e iluminação ficam fora do hash, porque não mudam colisão nem pontuação. O
`CATALOG_HASH` cobre todas as variantes.

### Kit de peças (`maps/kit.ts`)

Peças reutilizáveis para mapas futuros:

- `arena` (piso com recorte opcional e muros);
- `teamBase` (base elevada com escudo, duas rampas frontais, saídas laterais, paletes e
  telhado; 8 spawns voltados para as rampas);
- `centralPlaza` (praça com passagem de baixo);
- `platform` (plataforma com rampas nas duas pontas, nunca beco);
- `hallBuilding` (prédio com corredor atravessável e telhado pontuável);
- `bleachers` (degraus de escada);
- `wallX`, `wallZ` e `crate`.

`assembleMap` monta o mapa por **simetria de ponto**: a metade oeste é definida e a leste
é a rotação de 180°. Assim, as oportunidades das duas equipes são equivalentes.

### Toca do Ara

É um centro comunitário e oficina criativa, evolução do antigo Pátio da Olaria. Lugares
nomeáveis:

- **mural** (muros norte e sul, arara original pintada);
- **totem** (centro, sobre o pedestal);
- **passagem de baixo** (sob a ponte da praça);
- **varanda**, **oficina** (reboco colorido, mirante escalável) e **bancadas**;
- na ampliada, também **horta**, com canteiros e estufa elevada, e **quadra**, com
  arquibancada.

As divisórias altas são cobogós. O relevo é só sombreado e o colisor é sólido: não parece
dar para atirar através deles. A arara ambiental voa acima de 9 m e pousa no muro. Em
qualidade baixa ela fica pousada.

### Clube da Maré

É um clube de bairro brasileiro com piscina **vazia**: o fundo é jogável e pontuável, e não
há água, afogamento nem física aquática. Outras peças:

- a **torre** central, alcançada por uma passarela de cada equipe que sai da borda e deixa
  passar por baixo, ou escalando depois de pintar;
- **vestiário** com corredor atravessável e telhado alcançado por escada externa;
- **quiosque** com balcão, geladeira e freezer;
- **arquibancada**, guarda-sóis e, na ampliada, **toboágua** e **lanchonete**.

As cores e os materiais são próprios: coral, menta, ladrilho hidráulico de contraste baixo
e pastilha de piscina. O desenho não reproduz layout, nomes internos nem assets de mapas de
outros jogos.

O ritmo também é diferente: o centro é um poço disputado de baixo para cima, e as laterais
são prédios com telhado.

### Variantes

| Variante | Participantes ativos (com bots) | Toca do Ara | Clube da Maré |
|---|---|---|---|
| Compacta | 2–4 | 40 × 26 m, praça baixa, varandinha | 38 × 24 m, piscina rasa com boia central |
| Padrão | 5–8 | 62 × 42 m | 60 × 40 m, torre e passarelas |
| Ampliada | 9–16 | 80 × 56 m, horta, quadra, oficina com corredor | 80 × 54 m, toboágua, lanchonete, arquibancada maior |

O servidor escolhe a variante pelo total **ativo** da rodada (`variantFor`), nunca pelo
número de pessoas na chamada. A família vem da escolha de quem organiza (uma fixa, ou
rotação a cada rodada).

A escolha acontece em `startRound`: mudar o tamanho do grupo afeta só a rodada seguinte.
O `round.loading` leva `mapId`, `mapHash` e `mode`. O cliente confere o hash da variante,
recria a cena se o mapa mudou (o áudio já desbloqueado é reaproveitado) e só então confirma
o carregamento. Por isso a contagem começa com todos no mesmo mapa. O ingresso confere o
hash do catálogo inteiro.

### Testes de desenho, em todas as variantes

`packages/game-simulation/test/map.test.ts` roda em cada uma das 6 variantes e verifica:

- 8 spawns por turma com espaço livre e 3 m de saída à frente;
- pelo menos duas saídas por base;
- cápsula, estações e pickups alcançáveis caminhando a partir das duas bases, **com
  volta** (nenhum poço sem saída);
- nenhum objetivo em zona protegida;
- toda área pontuável elevada alcançável caminhando, ou escalando quando as paredes são
  pintáveis;
- nenhuma linha de tiro, dentro do alcance máximo, do centro disputado até os spawns;
- área pontuável igual nas duas metades;
- ids de bloco únicos.

Esses testes pegaram quatro problemas reais durante o desenho, todos corrigidos:

- linhas de tiro do centro até o spawn nas duas compactas;
- telhados e torre sem nós de navegação: nós em rampas íngremes ficavam colados no plano;
  corrigido no `NavGraph`;
- a torre do Clube virava beco na volta;
- um balcão baixo demais no Clube compacto.

## Formação flexível (1 × 1 a 8 × 8)

A formação é calculada por `apps/game-server/src/formation.ts`, uma função pura com 17
testes. As regras:

- **Flex:** com bots, ⌈n/2⌉ por equipe, e a menor é completada com bots identificados;
  sem bots, ⌊n/2⌋ por equipe, e quem sobra vai para a fila.
- **Limite fixo k × k:** com bots, completa até k; sem bots, joga até k por equipe,
  sempre equilibrado.
- **Uma pessoa:** sem bots não começa ("ative os bots para treinar"); com bots, treino
  1 × 1.
- **Prioridade:** quem ficou mais vezes na fila joga primeiro na revanche; depois vale a
  ordem de chegada. A preferência de equipe é respeitada enquanto houver vaga.
- **Capacidade:** até 16 ativos e 20 pessoas na sala (4 na fila). A 21ª é recusada.

O lobby mostra o **plano real** antes do início: tamanho, humanos e bots por equipe,
quem fica na fila, mapa e variante. Quem fica na fila recebe um aviso (`queued`) e vê a
tela de espera. Quem chega com a rodada em andamento espera a próxima. Queda de conexão
usa a janela de reconexão; ao expirar, o slot vira bot. A formação nunca é refeita no
meio da rodada.

## Modos

### Território

É o modo preservado. Vence quem tiver mais área pontuável no fim, e empate é empate.
Buffs e Mutirão também valem nele.

### Correio do Ara

Implementado em `match/modes.ts` (`CorreioMode`), com os parâmetros em
`game-content/src/modes.ts`:

| Regra | Implementação |
|---|---|
| Estados | `aguardando` → `disponivel` → `carregada` ⇄ `caida` → `em_entrega` → `entregue` → `disponivel`; caída e abandonada → `retornando` → `disponivel` |
| Posse | Um de cada vez. Na coleta simultânea leva o mais próximo, e o empate exato vai para o menor id (determinístico) |
| Estação | Neutra, anunciada a todos; a sequência do servidor alterna os lados (pares oeste/leste) |
| Entrega | 60% da área demarcada (raio de 1,8 m) com a tinta da equipe do portador **e** 1,2 s contínuo dentro. Sair ou perder a tinta recomeça o tempo |
| Mobilidade | O portador anda, pinta e usa as rotas; o **Pião-Guia é recusado** (`travel_carrying`) |
| Informação pública | Portador e posição da cápsula vão para todos (feixe vertical, flag `PFLAG_CARRIER`) |
| Queda | Eliminação, saída ou queda de conexão solta a cápsula no último ponto de chão. Sem chão válido, ela retorna. Abandonada por 10 s, retorna |
| Travamento | Posse contínua máxima de 45 s, depois volta ao centro: ninguém prende a partida guardando a cápsula |
| Pontuação e fim | 1 ponto por entrega; 5 entregas encerram a rodada. No tempo (4 min), vence quem entregou mais; igualdade é empate, independente da área pintada |
| Depois do fim | Nada pontua: `finish()` é idempotente e o passo não roda |

Os bots disputam a cápsula (os dois mais próximos de cada equipe), levam-na à estação e
giram pintando a área demarcada. Um aliado prepara a estação. As regras são as mesmas dos
humanos, e só usam informação pública.

### Buffs Embalo e Fôlego

| | Efeito | Duração |
|---|---|---|
| Embalo | +15% na velocidade **horizontal**; não muda hitbox, projéteis, viagem tática nem colisão | 6 s |
| Fôlego | +25% na **recarga** de pigmento; não recarrega além do tanque, nem durante o atraso após atacar | 8 s |

Regras de coleta e duração:

- Um buff ativo por vez; pegar outro substitui o anterior, e o evento traz o substituído.
- Eliminação e fim da rodada removem o efeito; reconectar não reinicia a duração, porque
  o estado fica no slot.
- Não há coleta através de parede nem dentro da proteção de spawn.
- Na coleta simultânea, só um recebe.
- Os pickups aparecem pela primeira vez aos 10 s e reaparecem 20 s depois de pegos, com
  aviso sonoro.

Os multiplicadores entram no **estado previsto** (`speedMul` e `inkRegenMul` no snapshot
próprio). A previsão do cliente anda igual ao servidor, sem correções extras.

### Mutirão (combo cooperativo)

Ativação: dois aliados convertem cada um **≥ 2 m²** (de neutro ou adversário para a própria
cor) em até **3 s**, com as áreas no mesmo setor. O setor é definido assim: os centroides
das duas conversões ficam a até 6 m um do outro.

Efeitos e limites:

- os dois ganham **+10% de recarga por 4 s**;
- recarga de **20 s** por participante;
- a mesma célula não financia outra ativação por **30 s**;
- não acumula com o Fôlego: vale o maior;
- não se aplica em 1 × 1, porque não há aliado;
- não depende de voz.

O resultado conta os Mutirões por pessoa, e a interface mostra "Mutirão!".

Com 16 ativos, o custo do Correio, dos buffs e do Mutirão fica dentro do tick (ver
[performance.md](performance.md)).

## Treino

O treino rápido (v2) é o **mesmo sistema** da v1, estendido:

- às 9 etapas básicas soma **buffs**, **Mutirão** (só com aliado) e, no Correio, **pegar a
  cápsula** e **entregar**;
- quem concluiu a v1 faz só as etapas novas;
- cada etapa avança apenas com o evento real correspondente.

## O que não foi validado

Nada disto foi jogado por um grupo de pessoas: o balanceamento das distâncias, tempos e
bônus é de protótipo. Também não houve teste em celular físico, com controle físico nem no
Trivo real.

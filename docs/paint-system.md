# Sistema de tinta

A tinta é **estado de jogo**, não decalque. O servidor guarda um dono por célula lógica, e disso
dependem o placar, a velocidade, a recarga, a escalada, o dano ambiental e o resultado. O
cliente só desenha o que o servidor confirmou.

## Superfícies e células

- Tudo deriva do mesmo `MapSpec` (`packages/game-content`). `buildFaces` gera as faces dos
  blocos (caixas e rampas), e `PaintLayout.build` gera as superfícies pintáveis. Servidor e
  cliente constroem o **mesmo layout**, conferido pelo hash do mapa no ingresso e no carregamento.
- Cada face tem uma política: `score` (piso que pontua), `paint` (pintável, não pontua; por
  exemplo paredes) ou `none` (não pintável; por exemplo o azulejo do pedestal).
- Célula de **0,25 m** (`cellSize`). A área de cada célula é medida em unidades inteiras com
  **4 × 4 subamostras** (16 unidades = célula cheia). Células cortadas por borda, rampa ou
  pegada de objeto têm peso proporcional. Nada de ponto flutuante acumulado no placar.
- Chunks de 16 × 16 células, que são a unidade de versão e de envio de deltas. Além da versão
  por chunk, o estado tem uma sequência global (`paintSeq`) que ordena os deltas.

Números do Pátio da Olaria v2:

| Item | Valor |
|---|---|
| Superfícies pintáveis | 276 (62 pisos, 214 paredes) |
| Células | 72.226 |
| Chunks | 561 |
| Área pontuável | 651.622 unidades × 0,00390625 m² = **2.545,4 m²** |
| Simetria | as duas metades têm área pontuável idêntica (testado) |

Pisos em alturas diferentes (praça, ponte, varanda, chão) são superfícies distintas, e uma não
pinta a outra.

## Aplicação (`PaintState`)

- `paintSplat` pinta um "borrão" (blob) em torno do ponto de impacto, no plano da superfície
  atingida:
  - **Oclusão:** cada célula candidata só é pintada se não houver sólido entre o centro do
    impacto e ela (raycast Rapier, com cache por célula). A tinta não atravessa parede nem pinta
    o outro lado.
  - **Alongamento:** tiros oblíquos esticam o borrão na direção do disparo (até 1,55 ×).
  - **Satélites:** gotas menores em volta, deslocadas para a frente, cada uma com a própria
    checagem de oclusão. É o que dá o respingo orgânico em vez de círculos perfeitos.
  - **Borda irregular:** ruído determinístico por semente, então o servidor e o teste reproduzem
    o mesmo desenho.
- Contadores incrementais `teamUnits[0|1]`: pintar neutro soma, pintar inimigo transfere e
  repintar a própria cor não altera nada.
- A carga do especial é calculada a partir das unidades **conquistadas** (neutro ou inimigo →
  própria), não de repintura.
- Cada célula alterada marca o chunk como sujo. Ao descarregar os deltas, a versão do chunk e a
  sequência global sobem.

## Consulta para gameplay

`floorAt`, `cellAt` e `ownerAt` respondem, para uma posição e normal, qual célula está sob o
jogador ou sob a parede tocada:

- **Forma Pião:** velocidade alta na tinta própria, baixa no neutro e muito baixa na inimiga.
  Recarga rápida só submersa na própria tinta.
- **Escalada:** exige tinta própria **na face tocada**. Tinta do outro lado da parede não serve.
  Perde a aderência quando o inimigo toma a face.
- **Tinta inimiga no chão:** reduz a velocidade e o pulo, impede a regeneração e causa dano
  gradual **não letal** (piso de 35 de vida).

## Pontuação e resultado

Área final = `teamUnits × areaPerUnit`. O vencedor sai da comparação das **unidades inteiras**,
e o empate só acontece com igualdade exata. Os percentuais mostrados são arredondados para
exibição, e os valores internos exatos ficam no `RoundResult`.

## Sincronização

Formato em `packages/game-contracts/src/paintWire.ts`:

- **Snapshot** (`paint.snap`): `contextTag` (hash de `matchId` e hash do mapa), `roundId`,
  `paintSeq` (sequência global de tinta no instante do corte), versão de cada chunk e dono de
  cada célula em **RLE**. Rejeita dados corrompidos ou truncados. Enviado ao carregar a rodada,
  ao reconectar e sob pedido (`paint.resync`).
- **Delta** (`paint.delta`): `contextTag`, `roundId`, intervalo `fromSeq → toSeq` e, por chunk
  alterado, `baseVersion → newVersion` com os pares (célula, valor). No máximo 12.000 células
  por mensagem; o excedente vai na próxima. Sai junto com o snapshot de estado (15 Hz), só
  quando há mudança.
- **`PaintReplica`** (cliente):
  - aplica o snapshot e, depois dele, os deltas em ordem;
  - guarda em buffer limitado os deltas que chegam antes do snapshot e descarta os que o
    snapshot já cobre (`toSeq <= paintSeq`);
  - ignora deltas de outra rodada ou contexto;
  - se a versão base de um chunk não confere (lacuna), volta a `awaiting_snapshot` e pede
    ressincronização.

Medições (rodada de 60 s com 8 clientes, laboratório):

| Item | Tamanho |
|---|---|
| Snapshot inicial (mapa limpo) | 587 B |
| Snapshot no meio da rodada | 7,2 KB |
| Delta médio / p95 / máximo | 132 B / 282 B / 528 B |
| Ressincronização sob pedido (ida e volta local) | 21 ms |

No teste de integração, a réplica reconstruída no cliente a partir do snapshot e dos deltas
confere **exatamente** com as unidades do resultado do servidor. Dois navegadores reais na
mesma sessão chegaram ao mesmo hash de tinta.

## Renderização (cliente)

- O cenário usa um **atlas lógico**, uma textura com um texel por célula:
  - R e G: cobertura das equipes, derivada do dono da célula;
  - B: sol pré-calculado (raycast Rapier em direção ao sol);
  - A: oclusão ambiente pré-calculada.
- Quando chega delta, só os chunks alterados são reescritos na textura
  (`engine.updateTextureData` parcial).
- O shader do cenário amostra o atlas com filtragem bilinear e corta com `smoothstep` somado a
  ruído, o que dá bordas orgânicas a partir de células quadradas. Por cima vêm um leve relevo,
  um brilho molhado discreto (reflexos pequenos, sem estourar) e ondulação animada.
- **Acessibilidade:** padrão opcional (listras para uma equipe, pontos para a outra) e paletas
  alternativas. A cor é só apresentação, e a regra usa o `TeamId`.
- Tinta pintada só pelo cliente não existe. O que aparece antes da confirmação são partículas e
  gotas visuais, sem mudança de dono de célula.

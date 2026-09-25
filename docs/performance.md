# Desempenho

> Todas as medições foram feitas **neste ambiente de laboratório**: container Linux, Intel Xeon
> 2,1 GHz com 4 núcleos, Node 22.22.2, Chromium 141 **sem GPU** (SwiftShader, renderização por
> CPU), servidor e clientes na mesma máquina, mapa Pátio da Olaria v2, em 24/09/2026. Elas
> **não** indicam capacidade de produção nem FPS em computadores reais.

## Metas (§24 do briefing) e situação

| Meta | Situação |
|---|---|
| 60 FPS em desktop de referência | **Não medido.** Não houve GPU; o FPS com SwiftShader (~4) não tem relação com hardware real |
| 30 FPS em mobile | **Não medido** |
| Servidor a 30 Hz sem atraso acumulado | Atendido no laboratório: tick p99 de 2,4 ms num orçamento de 33,3 ms (8 jogadores) |
| Recursos comprimidos ≤ 25 MB | Atendido: ~2,9 MB gzip no carregamento inicial |
| Sem crescimento contínuo de memória | Atendido no que foi medido (60 s de partida e abrir/fechar 10×); não houve sessão longa |

## Execução autônoma: antes e depois (24/09/2026)

**Método.** O cliente é medido com `e2e/desempenho.mjs`: partida standalone real com bots,
chamadas de desenho contadas envolvendo `drawElements`/`drawArrays` do WebGL, intervalo
entre quadros, malhas, materiais, texturas e heap JS, amostrados por 8 s em cada rodada.

- **"Antes"** foi medido no commit `13e8e95`, com Pátio da Olaria, 4 × 4 e a interface
  antiga, rodando numa worktree congelada.
- **"Depois"** foi medido no código atual.
- Máquina e navegador são os mesmos, com **SwiftShader**: com 3 a 4 quadros por segundo,
  cada janela tem só 20 a 30 quadros. Por isso o intervalo de quadro serve apenas como
  referência relativa, e as **contagens** (desenhos, malhas, materiais) são o dado
  comparável.

| Cenário | Mapa | Desenhos/quadro p50 (p95) | Malhas (ativas) | Materiais | Texturas | Heap |
|---|---|---|---|---|---|---|
| Antes 4 × 4 | Pátio da Olaria | 330–348 (≤ 383) | 416 (213–253) | 99–104 | 4 | 214–269 MB |
| Depois 4 × 4 | Toca do Ara padrão | 369–372 (≤ 411) | 479–481 (251–298) | 123–126 | 8 | 220–245 MB |
| Depois 8 × 8, sem LOD | Toca do Ara ampliada | 581–624 (≤ 695) | 854–860 (507–536) | 144–152 | 8 | 257–258 MB |
| **Depois 8 × 8, com LOD** | Toca do Ara ampliada | **495 (588)** | 853 (533) | 143 | 8 | 254 MB |

- Em 4 × 4, os mapas novos, os personagens e o cenário custam cerca de 12% a mais em
  desenhos por quadro. As texturas extras (4 → 8) são o mural, as placas e o letreiro.
- O **LOD por distância** nos personagens reduziu os desenhos em 8 × 8 de cerca de 600
  para 495 por quadro (−17%): o contorno some a partir de 20 m, e os detalhes do rosto e
  da ferramenta a partir de 18 m.
- **Materiais entre rodadas:** o crescimento pequeno (+1 a +8) vem de materiais criados na
  primeira vez que algo aparece (um tom de pele novo, pools de efeitos), e é limitado pelo
  número de tipos. Materiais próprios de cada personagem (sombra, bolha, marcador) são
  liberados ao trocar de rodada; o diff de nomes entre três rodadas confirma isso. O
  `e2e/gameplay.mjs` continua verificando os pools.
- **Não há afirmação de 60 FPS.** Não houve GPU real.

### Servidor com até 16 participantes

`scripts/bench-tick.ts` roda a simulação autoritativa com bots durante 30 s simulados:
passo completo, sem transporte.

| Mapa | Modo | Ativos | Tick p50 | p95 | p99 | Máx. | Snapshot médio por cliente |
|---|---|---|---|---|---|---|---|
| Toca do Ara compacta | Território | 4 | 0,33 ms | 1,11 ms | 2,31 ms | 9,4 ms | 641 B |
| Toca do Ara padrão | Território | 8 | 0,42 ms | 0,98 ms | 1,65 ms | 5,2 ms | 818 B |
| Toca do Ara ampliada | Território | 16 | 1,01 ms | 1,85 ms | 3,00 ms | 4,8 ms | 1 250 B |
| Clube da Maré ampliada | Território | 16 | 0,91 ms | 1,71 ms | 2,55 ms | 6,2 ms | 1 260 B |
| Toca do Ara ampliada | Correio | 16 | 0,83 ms | 1,48 ms | 2,02 ms | 4,8 ms | 1 349 B |
| Clube da Maré ampliada | Correio | 16 | 0,86 ms | 1,49 ms | 2,06 ms | 5,0 ms | 1 354 B |

- O orçamento é de 33,3 ms por tick, a 30 Hz. Com 16 ativos, o p99 fica abaixo de 3,1 ms.
- O snapshot de 16 jogadores tem cerca de 1,3 KB em JSON, antes da codificação do
  transporte; a 15 Hz, dá cerca de 20 KB/s por cliente.
- O tick e o snapshot continuam como estavam (30 Hz e 15 Hz): não houve motivo medido para
  mudar.

## Servidor

`pnpm --filter @borrifo/game-server load-test`: servidor real e clientes headless pelo
WebSocket, no mesmo processo, com rodada de 60 s e entradas a 30 Hz (andar, girar, atirar).
O tempo medido é o `fixedStep` inteiro: simulação, codificação e envio.

| Cenário | Tick p50 | p95 | p99 | Máximo | CPU do processo |
|---|---|---|---|---|---|
| 8 humanos headless | 0,82 ms | 1,56 ms | 2,38 ms | 8,15 ms | 6,8% de um núcleo (servidor + 8 clientes) |
| 1 humano + 7 bots | 0,82 ms | 1,52 ms | 2,36 ms | 19,6 ms | 6,3% de um núcleo |

- Nenhum tick passou do orçamento de 33,3 ms. O pico de 19,6 ms com bots é isolado (provável
  replanejamento de rota ou coleta de lixo).
- Os resultados foram idênticos em todos os clientes (`todosConcordam: true`).

## Banda de gameplay por cliente

Mesma medição, bytes da aplicação no WebSocket, sem voz:

| Cenário | Download | Upload |
|---|---|---|
| 8 humanos | 91,7 kbit/s (máx. 92,7) | 9,8 kbit/s |
| 1 humano + 7 bots | 102,8 kbit/s | 9,8 kbit/s |

| Tinta | Tamanho |
|---|---|
| Snapshot inicial (mapa limpo) | 587 B |
| Snapshot no meio da rodada | 7,2 KB |
| Deltas (544 em 60 s): média / p95 / máximo | 132 B / 282 B / 528 B |
| Ressincronização sob pedido (local) | 21 ms |

A banda de voz do LiveKit é separada e **não foi medida**.

## Cliente

### Build de produção (`pnpm --filter @borrifo/game-client build`)

| Arquivo | Tamanho | gzip |
|---|---|---|
| `babylon-*.js` | 7.068 KB | 1.548 KB |
| `rapier-*.js` (WASM embutido) | 2.852 KB | 1.094 KB |
| `index-*.js` (jogo, UI, rede, áudio, controle, treino, perfis) | 725 KB | 230 KB |
| CSS | 18 KB | 5 KB |
| Fontes Fredoka (3 pesos, woff2) | 49 KB | — |
| **Total do carregamento inicial** | ≈ 10,7 MB | **≈ 2,9 MB** |
| Efeitos sonoros (`public/audio/sfx`, baixados depois da abertura) | ≈ 1,3 MB (62 MP3 + 4 WAV de loop) | — (MP3 já é comprimido) |

O pacote do Babylon é importado pela raiz `@babylonjs/core` e leva a engine inteira. Importar
por subcaminhos reduziria bastante esse arquivo; isso fica como próximo passo.

### Cena e memória (60 s de partida, 1 humano + 7 bots, andando e atirando)

| t | FPS (SwiftShader) | Heap JS | Malhas | Malhas ativas | Materiais | Texturas |
|---|---|---|---|---|---|---|
| 10 s | 4,4 | 209,5 MB | 367 | 233 | 159 | 4 |
| 30 s | 3,9 | 207,8 MB | 367 | 222 | 160 | 4 |
| 60 s | 4,1 | 205,4 MB | 370 | 160 | 161 | 4 |

Resolução interna de 1113 × 626 (janela de 1280 × 720, qualidade "média").

Correções feitas a partir destas medições:

- **Vazamento de materiais:** cada Moringa e Roda de Oleiro criava materiais nunca liberados,
  e a contagem subia de 161 para 175 em 60 s. Agora há materiais compartilhados por equipe, e a
  contagem fica estável.
- **Chamadas de desenho:** a decoração estática é fundida por material. As malhas na cena caíram
  de 479 para 365; o restante é quase todo das peças articuladas dos 8 personagens.
- **Fumaça:** buffers pré-alocados, sem alocação por quadro, e uma coluna por chaminé.
- **Aba oculta ou Atividade suspensa:** a cena deixa de ser desenhada, e rede e estado seguem a
  ~4 Hz.

### Áudio

- Efeitos decodificados uma vez em `AudioBuffer`; cada disparo cria só uma fonte e um ganho,
  mais um panner se for posicional.
- Até 24 vozes simultâneas, com limite por efeito (separado entre som do próprio jogador e som
  do mundo), roubo da voz menos audível e intervalo mínimo contra disparos duplicados. Numa
  partida com 7 bots, o máximo medido foi 12 vozes e 5 loops.
- Passos de outros jogadores só até 15 m. Impactos passam por um orçamento por segundo.

### Orçamentos aplicados no código

- Pools de partículas com teto: 320 gotas, 1.200 respingos, 96 anéis.
- Impactos perto da câmera são reduzidos. Feixes do Estilingue são limitados a 10 e miras a uma
  por jogador.
- Atualização **parcial** da textura de tinta (só os chunks alterados).
- Sombras e oclusão do cenário são pré-calculadas no carregamento (sem shadow map em tempo real).
- Limite de FPS configurável (30/60/120) e qualidade baixa/média/alta.

## Transporte: LiveKit Data × Colyseus (benchmark isolado)

Medido em loopback, com o mesmo tráfego sintético do jogo. Com 16 jogadores, o atraso do
snapshot ficou em p50 0,25 / p99 0,53 ms no Colyseus e p50 6,15 / p99 20,06 ms no LiveKit
Data (com o salto pelo SFU e a pilha WebRTC). A banda de descida é a mesma (136 kbit/s por
cliente). Nenhum dos dois perdeu mensagens, e a voz no mesmo SFU não teve buracos acima de
40 ms. Tabelas, método e limites em [livekit-transporte.md](livekit-transporte.md).

## Custos das entradas e dos nomes (nesta entrega)

- **Controle:** `navigator.getGamepads()` a cada ~8 ms só com controle conectado (500 ms sem
  controle). A leitura é um *snapshot* de alguns números por controle; não foi medida
  separadamente, mas não aparece acima do ruído no CPU da página em SwiftShader.
- **Nomes sobre os personagens:**
  - até 15 elementos DOM posicionados com `transform` a cada quadro, sem layout;
  - raycast de linha de visão só para adversários, no máximo 10 vezes por segundo cada.
- **Mira assistida:** até 8 raycasts por quadro (um por adversário a ≤ 36 m), só com controle
  e na forma de combate.

## Próximas medições necessárias

1. FPS e tempo de quadro numa GPU real (desktop de referência) nas três qualidades.
2. Sessão longa (várias revanches) com heap e contagens.
3. Carga com várias salas por processo, para achar o limite por núcleo.
4. Latência, jitter e perda emulados (por exemplo `tc netem`) para validar previsão e interpolação.
5. Mobile real.

## Alocações por quadro (25/09/2026)

`e2e/alocacoes.mjs`: amostragem de heap do V8 pelo DevTools (inclui objetos já coletados),
partida 8 × 8 com bots, 10 s, SwiftShader a ~12 fps, build de desenvolvimento (React com
JSX de desenvolvimento). Cada alocação é atribuída à função **do nosso código** mais
próxima na pilha. Três execuções de cada lado, alternando antes e depois na mesma
máquina; a variação entre execuções é grande (a mesma versão deu 412 e 525 KB/quadro).

- **Total alocado por quadro:** antes 412 / 525 / 432 KB (mediana 432); depois 310 / 310 /
  354 KB (mediana 310), **cerca de −28%**.
- **Shaders compilados no meio da partida** (primeiros 25 s, `e2e/shaders.mjs` contando o
  processamento de shader no protótipo do `Effect`): **7 → 1**. Nas medições de 10 s do
  depois, 0.

| Onde (nosso código mais próximo) | Antes (KB/quadro) | Depois (KB/quadro) |
| --- | --- | --- |
| `frame` (GameRuntime.ts) | 117.4 | 84.7 |
| `reconcile` (LocalPredictor.ts) | 38.3 | 20.6 |
| `(anônima)` (ToonMaterial.ts) | 37.4 | 31.5 |
| `step` (LocalPredictor.ts) | 28.1 | 17.7 |
| `computeAim` (GameRuntime.ts) | 20.0 | 15.6 |
| `update` (CharacterView.ts) | 19.3 | 19.4 |
| `Hud` (Hud.tsx) | 16.1 | 17.6 |
| `(anônima)` (Hud.tsx) | 11.5 | 12.1 |
| `update` (Effects.ts) | 11.6 | 7.0 |
| `impact` (Effects.ts) | 10.4 | 7.0 |
| `onPaintDelta` (GameRuntime.ts) | 9.1 | 9.4 |
| `sample` (RemoteInterpolator.ts) | 8.9 | 0.0 |
| `Tutorial` (Tutorial.tsx) | 8.4 | 0.0 |
| `looseLayer` (CharacterView.ts) | 8.3 | 7.5 |
| `updateView` (GameRuntime.ts) | 7.0 | 6.0 |
| `bind` () | 4.6 | 4.4 |
| `sunAt` (GameRuntime.ts) | 4.6 | 1.9 |
| `(anônima)` (MatchConnection.ts) | 4.4 | 4.2 |

O que foi feito, cada item com a medição que o justificou:

- **`ToonMaterial.isReady`:** o `ShaderMaterial` refazia a lista de defines e a juntava
  numa string a cada verificação de cada malha, a cada quadro. Agora a resposta fica
  guardada por configuração enquanto o efeito do submesh for o mesmo e estiver pronto
  (taxa de acerto medida: 96%). Congelar o material não serve: ele é compartilhado entre
  personagens com estado por malha no bind.
- **Shaders dos efeitos:** a Moringa, a Roda, o feixe, a mira e o marcador compilavam no
  primeiro uso. Pior: o motor descarta o efeito quando o último usuário some, então cada
  Moringa nova (a anterior já explodida) podia recompilar. Agora os modelos reais são
  compilados na carga e ficam vivos, e Moringas e Rodas são reutilizadas por tipo e turma
  em vez de criadas e descartadas a cada arremesso.
- **Consultas de piso e parede** (`PaintLayout.floorAt`/`wallAt`, 5× por passo, no servidor
  e na previsão): rascunhos e contas em escalares. A matemática de segmento × cápsula
  (acertos no servidor e mira no cliente) também ficou em escalares; um teste confere
  resultado **idêntico bit a bit** em 20 000 casos (`mathEquivalence.test.ts`).
- **Interpolador:** a mesma amostra é pedida pelo render, pela mira (a cada passo
  previsto), pela mira assistida e pelas etiquetas. Agora ela é calculada uma vez por tick
  de render, num objeto reutilizado por jogador, e há um tick de render por quadro.
- **Mira:** parou de copiar o estado inteiro do jogador a cada passo só para achar o cano.
- **Cartão do treino:** redesenhava todo quadro (o progresso muda a cada quadro). Agora
  assina só o que mostra, já arredondado.
- **Partículas e projéteis visuais:** criação em escalares, lista compactada no lugar.
  Raycast com um raio reutilizado. `lastPos` e os vetores do corpo solto são atualizados
  no lugar.

**Não mexido (sem ganho claro ou fora do nosso código):**

- o bind do `ToonMaterial` (~31 KB/quadro): é o valor por malha que tem de ir ao shader;
  a maior parte é número em ponto flutuante embalado nos níveis baixos do JIT;
- o render do Babylon (culling e iteradores, ~85 KB/quadro): código do motor;
- o HUD em React (~30 KB/quadro, JSX de desenvolvimento): o build de produção é mais leve
  e não foi medido aqui;
- os deltas de tinta (~9 KB/quadro): dado de rede decodificado.

**Não validado:** GPU real e build de produção (as medições são SwiftShader e build de
desenvolvimento, que é o que expõe os ganchos de teste). O efeito em travadas de GC não
foi medido diretamente; o que se mediu é o volume alocado e as compilações.


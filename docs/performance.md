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
| `index-*.js` (jogo, UI, rede, áudio) | 689 KB | 217 KB |
| CSS | 15 KB | 4 KB |
| Fontes Fredoka (3 pesos, woff2) | 49 KB | — |
| **Total do carregamento inicial** | ≈ 10,7 MB | **≈ 2,9 MB** |

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

### Orçamentos aplicados no código

- Pools de partículas com teto: 320 gotas, 1.200 respingos, 96 anéis.
- Impactos perto da câmera são reduzidos. Feixes do Estilingue são limitados a 10 e miras a uma
  por jogador.
- Atualização **parcial** da textura de tinta (só os chunks alterados).
- Sombras e oclusão do cenário são pré-calculadas no carregamento (sem shadow map em tempo real).
- Limite de FPS configurável (30/60/120) e qualidade baixa/média/alta.

## Próximas medições necessárias

1. FPS e tempo de quadro numa GPU real (desktop de referência) nas três qualidades.
2. Sessão longa (várias revanches) com heap e contagens.
3. Carga com várias salas por processo, para achar o limite por núcleo.
4. Latência, jitter e perda emulados (por exemplo `tc netem`) para validar previsão e interpolação.
5. Mobile real.

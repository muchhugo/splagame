# Rede

## Transporte

- Colyseus 0.18 sobre WebSocket (`@colyseus/ws-transport` no servidor, `@colyseus/sdk` no
  cliente). É um transporte confiável e ordenado: perda de pacote na rede vira **atraso**
  (retransmissão TCP), não mensagem perdida.
- Matchmaking HTTP com CORS restrito às origens permitidas (`GAME_ALLOWED_ORIGINS`). O upgrade
  de WebSocket recusa origens de navegador fora da lista; em produção, também recusa quem não
  envia `Origin`.
- `maxPayload` de 64 KiB, `maxMessagesPerSecond` de 90 e rate limit de ingresso por IP
  (rajada de 10, 1 por segundo). Quem abusa é desconectado com o código `4102`.
- Não se usa o `Schema` do Colyseus. As mensagens são objetos simples (msgpack do próprio
  Colyseus) e a tinta vai em binário próprio ([ADR 0003](decisions/0003-mensagens-simples-sem-schema.md)).

## Taxas

| Item | Valor |
|---|---|
| Passo da simulação autoritativa | 30 Hz (`TICK_RATE`) |
| Snapshot de estado | 15 Hz (a cada 2 ticks) |
| Deltas de tinta | junto com o snapshot, só quando há chunks alterados |
| Entrada do cliente | 1 mensagem por tick previsto (30 Hz) |
| Atraso de interpolação de remotos | 3 ticks (~100 ms) |

## Mensagens

Cliente → servidor (`C2S`): `in` (entrada binária compacta), `lobby.team`, `lobby.weapon`,
`lobby.ready`, `lobby.bots`, `lobby.start`, `round.loaded`, `results.vote`, `paint.resync`,
`ping`. Todas as mensagens de controle passam por schema zod `.strict()`; campos extras,
valores fora do enum, `NaN` ou `Infinity` são rejeitados.

Servidor → cliente (`S2C`): `welcome`, `lobby`, `round.loading`, `round.countdown`,
`round.start`, `round.result`, `snap`, `paint.snap` (binário), `paint.delta` (binário), `notice`,
`pong`.

### Snapshot (`snap`)

```text
t    tick do servidor          ack  última sequência de entrada aplicada deste cliente
ph   fase da sala              tl   ms restantes da fase
me   estado completo do próprio jogador (posição, velocidade, forma, pigmento, vida,
     carga, cooldowns, escalada, deslocamento tático…) — insumo da reconciliação
pl   remotos em tuplas compactas [id, x, y, z, yaw, pitch, forma, flags, vida, carga, vx, vz]
     (posições em centímetros inteiros, ângulos em milirradianos)
ob   objetos de mundo (Moringa armada, Roda de Oleiro ativa)
ev   eventos desde o último snapshot (disparo, impacto, acerto, eliminação, reaparecimento…)
sc   placar parcial em unidades internas
```

### Entrada (`in`)

`sequence`, `clientTick`, `moveX`, `moveY` (normalizados; a diagonal é limitada a 1), `yaw`,
`pitch` (com limite), `heldButtons` (disparo, fluxo, pulo…) e `pressedActions` discretas
(Moringa, especial, Pião-Guia com alvo), deduplicadas por sequência. O servidor:

- descarta sequências já vistas ou antigas;
- mantém fila de até 6 entradas por jogador;
- aplica **compensação de dívida de entrada**: se o cliente enviou em rajada, o servidor
  consome entradas extras nos ticks seguintes, sem acelerar o jogador além do que um tick
  permite;
- depois de 6 ticks sem entrada nova, neutraliza movimento e disparo, para que um cliente
  parado não fique andando.

## Previsão e reconciliação

- O cliente roda `stepPlayer` (a **mesma função** do servidor, com a mesma física Rapier e o
  mesmo `MapSpec`) para o próprio personagem, em passo fixo de 30 Hz.
- Cada snapshot traz `me` e `ack`. O `LocalPredictor` descarta as entradas confirmadas, aplica o
  estado autoritativo e reaplica as pendentes. A diferença visual vira um deslocamento que
  **decai** em vez de teletransportar.
- A física não é considerada determinística entre navegador e servidor. As correções medidas no
  laboratório (mesma máquina) foram de 6 a 14 mm ao caminhar e de ~30 cm só na transição de
  contagem para corrida. Isso não prova o comportamento sob latência real.
- Disparos, tinta e dano **não** são previstos como verdade: o cliente toca efeitos locais de
  disparo e espera o servidor confirmar impacto, tinta e dano.

## Remotos

`RemoteInterpolator` guarda um pequeno buffer e renderiza 3 ticks atrás, interpolando posição
e ângulos. Sem amostra nova, ele segura a última, sem extrapolar sem limite.

## Sem compensação de latência

O servidor calcula acertos no presente, sem rebobinar posições. Com latência alta, quem atira
precisa liderar o alvo. É uma limitação consciente
([ADR 0004](decisions/0004-sem-compensacao-de-latencia.md)).

## Reconexão

- O SDK reconecta sozinho após queda de rede (`onDrop` → `onReconnect`) e bufferiza mensagens.
  O servidor mantém o slot por 20 s (`allowReconnection`).
- Na volta, o servidor reenvia `welcome` (`resumed: true`) e `lobby`; se a rodada está em
  andamento, também `round.loading`, o snapshot completo de tinta e `round.start`.
- Reabrir a Atividade com **nova credencial** na mesma sessão devolve o mesmo slot e encerra a
  conexão antiga.
- Janela expirada durante a rodada: o slot vira bot da mesma equipe. Fora da rodada, o jogador
  sai.

## Tinta pela rede

Ver [paint-system.md](paint-system.md#sincronização). Resumo: snapshot binário completo
(RLE) ao entrar, reconectar ou pedir ressincronização; deltas binários por chunk, com versão
por chunk; o cliente pede `paint.resync` ao detectar lacuna.

## Banda medida (laboratório, não produção)

`pnpm --filter @borrifo/game-server load-test` (servidor real + 8 clientes WebSocket, mesma
máquina, rodada de 60 s):

| Métrica | 8 humanos | 1 humano + 7 bots |
|---|---|---|
| Download por cliente | 91,7 kbit/s (média), 92,7 kbit/s (máx.) | 102,8 kbit/s |
| Upload por cliente | 9,8 kbit/s | 9,8 kbit/s |

A banda de voz (LiveKit) é separada e **não foi medida**: não houve servidor LiveKit. Mais
números em [performance.md](performance.md).

## Não verificado

- Latência, jitter e perda reais (não houve emulação de rede neste ambiente).
- Clientes em máquinas e redes diferentes.
- Comportamento com proxies ou balanceadores na frente do WebSocket.

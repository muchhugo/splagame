# LiveKit como transporte do gameplay? Revisão, benchmark e decisão

> **Decisão (set/2026): manter o Colyseus como servidor autoritativo e transporte do
> gameplay.** O LiveKit continua sendo só a voz, e ela pertence ao host (Trivo). O
> benchmark isolado mostra que o LiveKit Data *consegue* levar o tráfego de 16 jogadores,
> mas ele **não substitui um servidor de jogo**. Ele acrescenta um salto (cliente → SFU →
> autoridade → SFU → cliente) e, para ser usado pela Atividade, esbarraria na regra de que
> o iframe não recebe o `Room`, tokens nem objetos do SDK (§10.6 do briefing). Nada foi
> migrado e a implementação atual não foi tocada. O benchmark fica no repositório para
> reavaliar com rede real ([`tools/bench-transport`](../tools/bench-transport/src/run.ts)).

Condições desta revisão:
- A documentação oficial (`docs.livekit.io`, `livekit.io`) estava **bloqueada pela rede
  desta sessão**. As afirmações abaixo vêm de três fontes:
  - trechos das páginas oficiais obtidos por busca;
  - o **código-fonte dos SDKs instalados** (`livekit-client` 2.22.3, `@livekit/rtc-node`
    1.1.0, `livekit-server-sdk` 2.19.1);
  - issues e PRs do GitHub.

  Cada ponto indica a fonte. Onde algo é **inferência**, está escrito assim.
- Os números são de um **servidor LiveKit local** (v1.13.7, compilado do código oficial,
  `--dev`). Tudo rodou **em loopback**, na mesma máquina de 4 vCPUs, **sem latência, jitter
  ou perda de rede reais** (`tc`/netem não está disponível aqui). Eles comparam o custo
  próprio de cada transporte, não o desempenho numa rede de verdade.

## 1. O que a documentação permite

| Recurso | O que é | Limites e garantias | Fonte |
|---|---|---|---|
| **Data packets** (`publishData`) | Mensagens binárias pelo SFU, para todos ou para `destinationIdentities`, com `topic` | **Confiável:** ordenado e com retransmissão; limite recomendado de 16 KiB por causa do SCTP (o SDK limita o payload útil a 15 KiB). **Lossy:** enviado uma vez, sem ordem garantida; recomenda-se ≤ 1300 bytes, porque acima do MTU o pacote é fragmentado e perder qualquer fragmento perde o pacote | [Data packets](https://docs.livekit.io/home/client/data/packets/), [DataPublishOptions](https://docs.livekit.io/reference/client-sdk-js/types/DataPublishOptions.html) |
| **Data streams** (`sendText`, `streamBytes`) | Texto e arquivos grandes, divididos em partes automaticamente | Para conteúdo maior e menos frequente, não para estado a 15 Hz | [Text streams](https://docs.livekit.io/transport/data/text-streams/) |
| **RPC** (`performRpc`) | Pedido e resposta entre participantes | Payload de até 15 KiB (`RpcError.MAX_DATA_BYTES = 15360` no SDK) e tempo limite padrão de 10 s | [RPC](https://docs.livekit.io/transport/data/rpc/), SDK `livekit-client` 2.22.3 |
| **Data tracks** | Fluxo contínuo lossy, com baixa latência | Quadros **reordenados no assinante** (entregues na ordem de publicação). O SFU só encaminha para quem assina. Cada quadro pode levar um timestamp de 64 bits. Uma assinatura nova só recebe quadros publicados depois dela. Existe no `livekit-client` 2.22.3 (`publishDataTrack`, `tryPush`), **mas não no `@livekit/rtc-node` 1.1.0** (conferido no pacote instalado) | [Data tracks](https://docs.livekit.io/transport/data/data-tracks/), [Data overview](https://docs.livekit.io/transport/data/) |
| **Estado sincronizado** (atributos do participante, metadados da sala) | Estado pequeno e pouco frequente: presença, preferências, configuração | Não serve para posição a 15 Hz | [State synchronization](https://docs.livekit.io/transport/data/state/), [Participant attributes](https://docs.livekit.io/home/client/state/participant-attributes/) |
| **Lado servidor** | `RoomService` (enviar dados, metadados, remover participante) pelo `livekit-server-sdk`. Um processo Node pode **entrar na sala como participante** com `@livekit/rtc-node` (é o modelo dos agents) e ser oculto com a permissão `hidden` | Dado enviado pelo `RoomService.sendData` chega **sem identidade de remetente**, e no `rtc-node` o evento pode nem disparar | [Server SDK JS](https://docs.livekit.io/reference/server-sdk-js/), [rtc-node](https://docs.livekit.io/reference/client-sdk-node/), [node-sdks#586](https://github.com/livekit/node-sdks/issues/586), [Tokens e permissões](https://docs.livekit.io/frontends/reference/tokens-grants/) |
| **Identidade do remetente** | O SFU atribui a identidade de quem publicou; um cliente não se passa por outro | Exceção: agents podem publicar em nome de outro participante (transcrições). Houve correção nessa lógica na v1.9.1 | [participant.go](https://github.com/livekit/livekit/blob/master/pkg/rtc/participant.go), [client-sdk-js#2092](https://github.com/livekit/client-sdk-js/pull/2092), [release v1.9.1](https://github.com/livekit/livekit/releases/tag/v1.9.1) |
| **Controle de fluxo** | O SDK web usa duas marcas por canal: acima da alta, quem envia espera o buffer esvaziar | Confiável: 64 KiB / 1 MiB. Lossy: 8 KiB / 256 KiB, com portão de descarte de cerca de 100 ms. É **backpressure local de cada remetente**; não há controle de congestionamento de jogo | Fonte do `livekit-client` 2.22.3 (`reliableDataChannelWaterMarkLow/High`, `lossyDataChannelWaterMark*`) |
| **Reconexão** | *Resume* (reata a sinalização e mantém a conexão de mídia) × *full reconnect* (nova conexão) | No resume, o canal confiável **reenvia o que o outro lado não confirmou** (`resendReliableMessagesForResume`). No full reconnect, começa do zero: o que estava em trânsito se perde | [Connecting](https://docs.livekit.io/intro/basics/connect/), [RoomEvent](https://docs.livekit.io/reference/client-sdk-js/enums/RoomEvent.html), fonte do SDK |
| **Escala da sala** | 16 participantes é pouco para uma sala do LiveKit. O SFU faz o *fan-out* | O custo cresce com N² quando cada jogador precisa dos dados de todos. No desenho com autoridade, cresce com N (um snapshot por jogador) | [Rooms, participants, tracks](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/) |
| **Preço (Cloud)** | A descida é cobrada a partir de US$ 0,12/GB (a subida não). Minutos de conexão a partir de US$ 0,0005/min | Valores públicos em set/2026; conferir antes de decidir | [Pricing (blog)](https://blog.livekit.io/towards-a-future-aligned-pricing-model/), [KB de preços](https://kb.livekit.io/articles/3947254704-understanding-livekit-cloud-pricing) |

## 2. O que ela não oferece

- **Não é servidor de jogo.** Não há simulação autoritativa, tick, física, validação de
  entradas, compensação de latência, antitrapaça nem ciclo de vida de partida. O próprio
  LiveKit, ao descrever estado de jogo por canais de dados, **recomenda um servidor de jogo
  em produção** ([blog: real-time audio and video in the metaverse](https://blog.livekit.io/real-time-audio-and-video-in-the-metaverse/)).
  O produto de estado sincronizado cobre atributos e metadados, não simulação.
- **Pacote lossy grande é frágil.** Acima de cerca de 1300 bytes ele fragmenta, e basta
  perder um fragmento para perder tudo. O snapshot do jogo precisa caber nesse limite ou ser
  dividido pelo jogo.
- **Confiável e ordenado implica bloqueio em fila sob perda** (*head-of-line*, porque o SCTP
  entrega em ordem). É **inferência** a partir do comportamento de SCTP ordenado; aqui não
  foi medido com perda real.
- **Full reconnect zera o canal confiável.** Eventos confiáveis em trânsito, como
  eliminação, fim de rodada ou equipe, precisam de reenvio pelo jogo (número de sequência ou
  estado completo após reentrar), como o Colyseus já faz com `afterJoinSync`.
- **Node sem data tracks.** No `rtc-node` 1.1.0, uma autoridade em Node só tem *data
  packets* lossy e confiáveis, não o primitivo pensado para fluxo contínuo.

## 3. O LiveKit pode substituir o Colyseus só como transporte?

**Tecnicamente, sim.** O benchmark levou entradas a 30 Hz, snapshots por jogador a 15 Hz e
tinta confiável a 9 Hz para 16 jogadores, sem perda, pelo SFU local (tabela na §7). Mas ele
substituiria **o WebSocket, não o servidor**: a lógica da sala Colyseus
(autenticação, lobby, equipes, rodada, simulação Rapier, tinta, pontuação, reconexão) teria
de ir para um processo novo, que entra na sala LiveKit como participante oculto.

## 4. Um processo autoritativo continua necessário?

**Sim, sem exceção.** O SFU só encaminha bytes. Alguém precisa validar entradas, simular,
decidir acertos, eliminações e pintura, e manter o placar. Se esse papel fosse dos clientes,
um cliente adulterado decidiria o resultado. O desenho *Client → LiveKit Data → Game
Authority Service → MatchSimulation* é viável, mas o **Game Authority Service é o mesmo
servidor que já existe**, com outro transporte.

## 5. Arquitetura recomendada

```text
Atividade (iframe, origem própria)                 Host (Trivo)
  jogo ── WSS (Colyseus) ──► servidor de partidas     └─ chamada LiveKit (única captura de microfone)
  jogo ◄── bridge (MessageChannel, nonce) ── estado de voz filtrado: quem fala, mudo, userId
```

Colyseus continua dono do gameplay. A voz continua do host, que controla a mídia e entrega
à Atividade só o `VoiceState`. Implementado nesta entrega:
- `VoiceParticipant.userId` liga participante e jogador.
- A Atividade nunca recebe `Room`, token, tracks ou objetos do SDK.
- Fechar o jogo não sai da chamada. Validado em `e2e/voz.mjs` com LiveKit local e mídia
  simulada do Chromium.

**Por que não o LiveKit no iframe:** para o jogo usar o LiveKit Data, sobram três
caminhos, todos piores:

| Caminho | Problema |
|---|---|
| Passar o `Room` do host para o iframe | Proibido pelo briefing (§10.6). Quebra o isolamento de origem e dá ao jogo controle sobre a mídia da chamada |
| Segunda conexão LiveKit só de dados, com token próprio (`canPublishData`, sem mídia) | Cada pessoa vira **dois participantes** na sala da chamada: a lista do Trivo precisa filtrar, os minutos de conexão dobram e duas conexões WebRTC disputam CPU e rede no celular (§17). Na prática é uma "chamada paralela" de dados |
| Túnel pelo host (jogo → `postMessage` → host → LiveKit) | Acopla o jogo ao `Room` do host, põe o *event loop* da interface do Trivo no caminho de 30 a 45 mensagens/s por jogador e acrescenta a latência do bridge |

### Comparação obrigatória

| Critério | Colyseus atual (WebSocket, autoritativo) | LiveKit Data + Game Authority Service | Evidência |
|---|---|---|---|
| Latência | Direto cliente ⇄ servidor. Loopback, 16 jogadores: snapshot p99 0,53 ms | Dois saltos, com o SFU no meio. Loopback, 16 jogadores: snapshot p99 20 ms | §7 (medido); rede real não medida |
| Confiável | TCP: ordenado, com reenvio em nível de mensagem após reconectar (`afterJoinSync`) | SCTP ordenado com retransmissão; replay no resume e perda no full reconnect | Fonte do SDK; §2 |
| Lossy | Não existe: tudo é TCP, com bloqueio em fila sob perda | Existe (≤ 1300 B por pacote); data tracks só no cliente web | Docs; `rtc-node` 1.1.0 |
| Frequência de snapshots | 15 Hz por jogador, sem recusa | 15 Hz por jogador, 0 de 4832 recusados; portão de descarte de cerca de 100 ms no lossy | §7 |
| 16 jogadores | 3,6% de CPU e p99 < 1,5 ms | Funciona; CPU total cerca de 30× maior (SFU e pilhas WebRTC) | §7 |
| Reconexão | Queda de socket até o próximo snapshot: cerca de 250 ms (200 ms são o atraso do SDK); slot mantido por 20 s | Resume de 76 a 200 ms; full reconnect de cerca de 150 ms, mas o canal confiável recomeça do zero | §7 |
| Autoridade | É o próprio servidor (simulação Rapier, validação, pontuação) | Precisa de um processo autoritativo participante; o SFU só encaminha | §4 |
| Proteção contra cliente adulterado | Entradas saneadas e *rate limit* no servidor; o cliente só fala com a sala | O SFU garante a identidade de quem envia, mas o cliente pode mandar dados para todos (filtrar no destino); a validação continua na autoridade | [participant.go](https://github.com/livekit/livekit/blob/master/pkg/rtc/participant.go); §6 |
| Banda | Igual para o mesmo tráfego (136 kbit/s de descida por cliente com 16 jogadores) | Igual; no Cloud, a descida é cobrada | §7; preços públicos |
| Integração com o Trivo | Não mexe na chamada; a Atividade só usa o bridge | Esbarra na regra de não passar o `Room` ao iframe; exige conexão extra ou túnel pelo host | §5 |
| Mobile | Um WebSocket por jogador | Uma conexão WebRTC a mais se for separada da voz (bateria e CPU) | Inferência; não medido em aparelho |
| Electron | WebSocket padrão | WebRTC no Electron funciona, mas é uma segunda conexão ao lado da voz do host | Inferência |
| Escalabilidade | Uma sala por sessão; escala horizontal de salas (Colyseus + *presence*) | O SFU escala a mídia; a autoridade continua precisando escalar à parte | Docs Colyseus e LiveKit |
| Complexidade operacional | Um serviço já implantado e testado | SFU (ou Cloud) + serviço de autoridade + reescrita do protocolo e da reconexão | §8 |

## 6. Riscos de migrar

1. O `rtc-node` 1.1.0 **não tem data tracks**. A autoridade em Node ficaria nos *data
   packets*.
2. Dados enviados pelo servidor (`RoomService`) chegam **sem identidade**
   ([#586](https://github.com/livekit/node-sdks/issues/586)). A autoridade precisa ser
   participante, não chamada de API.
3. **Superfície de spam entre clientes.** Com `canPublishData`, um cliente pode mandar
   dados para qualquer um da sala, não só para a autoridade. Cada cliente teria de descartar
   o que não veio da autoridade.
4. O **full reconnect zera o canal confiável**. O jogo precisa de reenvio próprio.
5. **Custo na nuvem.** No LiveKit Cloud, toda a descida do gameplay é cobrada. O tráfego
   sintético de 16 jogadores dá cerca de 136 kbit/s por cliente (§7), cerca de 49 MB por
   rodada de 3 min. Pelo preço de tabela, isso é cerca de US$ 0,006 de banda por rodada, mais
   minutos de conexão se houver conexão separada. É estimativa, não conta real.
6. **Autoridade continua obrigatória.** Migrar não reduz a infraestrutura de servidor de
   jogo, só troca o transporte. "Reduzir dependências" não se sustenta: o briefing pede
   explicitamente não decidir só por isso.
7. **Conflito com a posse da chamada pelo host** (§5 acima).
8. **Latência extra.** Todo pacote faz dois saltos (cliente → SFU → autoridade). Com a
   autoridade longe do SFU, isso soma RTT de rede real, que não foi medido aqui.

## 7. Benchmark isolado (proposto e executado)

`tools/bench-transport/src/run.ts` gera o **mesmo tráfego sintético** pelos dois
transportes. Tamanhos e taxas vêm do jogo real
([docs/performance.md](performance.md), [docs/networking.md](networking.md)):

| Tráfego | Taxa | Tamanho | Colyseus | LiveKit Data |
|---|---|---|---|---|
| Entrada do jogador | 30 Hz | 40 B | `sendBytes` | lossy, só para a autoridade |
| Snapshot por jogador | 15 Hz | 380 + 40·N B (≤ 1200) | `sendBytes` | lossy, `destinationIdentities` |
| Tinta | 9 Hz | 130 B (520 a cada 10) | `broadcastBytes` | confiável, broadcast |
| Ping (RTT) | 4 Hz | 13 B | confiável | lossy **e** confiável |

- **Autoridade LiveKit:** processo `rtc-node` que entra na sala como participante
  `hidden` e responde os pings pelo mesmo canal.
- **Clientes LiveKit:** 4 processos filhos (`LK_PROCS=4`), para que o custo dos 16
  WebRTC não caia no *event loop* da autoridade. Há também a matriz com todos no mesmo
  processo.
- **Colyseus:** sala mínima com `onMessageBytes`.
- **Condições:** 2 s de aquecimento e 20 s de medição por cenário. Relógio comum entre
  processos (`performance.timeOrigin + now()`). CPU e memória vêm de `/proc`.
- **Reconexão:** medida depois do resumo, sem contaminar as métricas.
  - LiveKit: `simulateScenario` (resume de sinalização e full reconnect).
  - Colyseus: queda do socket com código 4010 e reconexão automática do SDK. Cerca de
    200 ms disso é o atraso de nova tentativa do próprio SDK.
- **Impacto no áudio:** um participante publica um tom de 48 kHz em quadros de 10 ms. Outro
  conta quadros e buracos, com e sem 16 jogadores de dados no mesmo SFU.

### Resultados (loopback, 4 vCPUs Xeon 2,1 GHz, Node 22.22.2, LiveKit 1.13.7 `--dev`, 20 s por cenário)

Os resultados brutos estão em
[`results/matriz-clientes-4-processos.json`](../tools/bench-transport/results/matriz-clientes-4-processos.json).
Na tabela, CPU é a porcentagem de um núcleo: para o LiveKit, a soma do processo da
autoridade, do SFU e dos clientes.

| Jogadores | Transporte | Atraso do snapshot p50 / p95 / p99 (ms) | Jitter (desvio, ms) | Tinta p50 / p99 (ms) | RTT confiável p50 / p99 (ms) | RTT lossy p50 / p99 (ms) | Perda | Entradas na autoridade | Descida por cliente | CPU | Reconexão |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | Colyseus | 0,23 / 0,36 / 0,54 | 0,34 | 0,28 / 1,96 | 0,38 / 1,42 | — | 0% | 100% | 68 kbit/s · 28 msg/s | 3,7 | queda de socket 246 ms |
| 2 | LiveKit | 1,32 / 2,23 / 3,95 | 0,72 | 1,17 / 3,07 | 2,35 / 5,97 | 2,11 / 5,18 | 0% | 100% | 69 kbit/s · 32 msg/s | 8,6 + 7,3 + 13,6 | resume 155 ms · full 150 ms |
| 4 | Colyseus | 0,19 / 0,36 / 0,50 | 0,09 | 0,28 / 0,63 | 0,34 / 0,83 | — | 0% | 100% | 78 kbit/s · 28 msg/s | 3,5 | 215 ms |
| 4 | LiveKit | 1,73 / 3,08 / 4,47 | 0,72 | 1,30 / 4,69 | 2,23 / 5,70 | 2,01 / 5,29 | 0% | 100% | 78 kbit/s · 32 msg/s | 13,6 + 12,2 + 24,6 | 76 ms · 156 ms |
| 8 | Colyseus | 0,17 / 0,29 / 0,64 | 0,11 | 0,25 / 0,69 | 0,32 / 1,05 | — | 0% | 100% | 97 kbit/s · 28 msg/s | 2,9 | 266 ms |
| 8 | LiveKit | 2,95 / 5,41 / 7,24 | 1,36 | 1,60 / 6,35 | 3,05 / 9,71 | 2,39 / 8,31 | 0% | 100% | 98 kbit/s · 32 msg/s | 21,0 + 20,3 + 33,9 | 200 ms · 161 ms |
| 16 | Colyseus | 0,25 / 0,39 / 0,53 | 0,09 | 0,36 / 1,21 | 0,49 / 1,48 | — | 0% | 100% | 136 kbit/s · 28 msg/s | 3,6 | 256 ms |
| 16 | LiveKit | 6,15 / 14,72 / 20,06 | 4,19 | 2,51 / 14,34 | 5,81 / 25,71 | 4,58 / 24,34 | 0% | 100% | 136 kbit/s · 32 msg/s | 34,6 + 30,1 + 56,9 | 181 ms · 153 ms |

- **Envio de snapshots:** 0 de 4832 recusados pelo SDK com 16 jogadores. O custo do tick da
  autoridade LiveKit ficou em p50 0,42 ms e p99 2,9 ms para enviar 16 snapshots.
- **Memória com 16 jogadores:** 174 MB na autoridade, 117 MB no SFU e 795 MB somados nos 4
  processos de clientes. Cada `rtc-node` carrega uma pilha WebRTC; num navegador real, cada
  jogador tem só a sua.
- **Snapshots pelo canal confiável** (16 jogadores, `SNAP_RELIABLE=1`): p50 5,87 / p99
  19,07 ms. Sem perda de rede, é praticamente igual ao lossy
  ([`livekit-16-snapshots-confiaveis.json`](../tools/bench-transport/results/livekit-16-snapshots-confiaveis.json)).
- **Todos os clientes no mesmo processo da autoridade:** com 16 jogadores, p50 5,47 / p99
  16,2 ms e 76% de CPU só nesse processo. Com clientes separados, a latência é parecida, o
  que indica que o custo vem do salto pelo SFU e da pilha WebRTC, não de um *event loop*
  saturado
  ([`matriz-clientes-mesmo-processo.json`](../tools/bench-transport/results/matriz-clientes-mesmo-processo.json)).

**Áudio**, com um falante e um ouvinte (esperado: 100 quadros/s):

| Cenário | Quadros/s | Buracos > 40 ms | Maior intervalo | Intervalo p99 |
|---|---|---|---|---|
| Só voz | 100 | 0 | 15 ms | 10,7 ms |
| Voz + dados de 16 jogadores no mesmo SFU | 100 | 0 | 19 ms | 12,4 ms |

A outra execução (clientes no mesmo processo) deu 0 buracos e maior intervalo de 37 ms.
Nestas condições, os dados não cortaram a voz.

**Leitura:**
- Em loopback, os dois transportes ficam abaixo de um quadro a 60 FPS até 8 jogadores.
- Com 16 jogadores, o LiveKit chega a p99 de 20 ms no snapshot e 26 ms no RTT, contra
  menos de 1,5 ms do Colyseus, por causa do salto extra e da pilha WebRTC.
- A banda é a mesma, porque o tráfego é o mesmo. O LiveKit gasta muito mais CPU no
  conjunto, com o SFU como processo a mais.
- Nada aqui favorece a migração. Com rede real, o salto extra (cliente → SFU → autoridade)
  soma RTT de rede: é **inferência** e precisa de medição.

### O que ainda falta medir (proposta)

- **Rede real:** clientes em navegadores (`livekit-client`) em máquinas separadas, com
  netem (RTT de 40 a 150 ms, jitter de 10 a 30 ms, perda de 1 a 5%), e o SFU e a autoridade
  na mesma região e em regiões diferentes.
- **LiveKit Cloud** numa conta de teste autorizada (nunca produção), para medir o custo
  real do salto até a borda.
- **Celular** com voz e jogo ao mesmo tempo, medindo FPS, temperatura e cortes de áudio.
- **Reconexão sob perda:** eventos confiáveis perdidos no full reconnect e como o jogo se
  recupera.

## 8. Plano de migração (só se os dados justificarem)

Nenhuma etapa começa antes que a anterior prove ganho. **A implementação Colyseus não é
apagada** até a alternativa funcionar comprovadamente em produção.

1. **Pré-requisito do host:** o Trivo decide se aceita uma conexão de dados por jogador
   (§5). Sem isso, para aqui.
2. **Protótipo atrás de *flag*:**
   - `MatchSimulation` vira um processo participante oculto;
   - o cliente fala por uma interface de transporte (`sendInput`, `onSnapshot`, `onEvent`)
     com duas implementações;
   - o que for confiável leva número de sequência e reenvio próprio (join, equipe,
     equipamento, início, habilidades, eliminações, fase, respawn, resultado);
   - o que for lossy leva o movimento e os snapshots, que o jogo mantém abaixo de 1300 B.
3. **Tráfego sombra:** as duas vias em paralelo por algumas partidas, comparando o
   mesmo estado.
4. **A/B em rede real.** Critério de saída:
   - RTT p95 ≤ Colyseus + 10 ms;
   - p99 do snapshot ≤ 50 ms;
   - voz sem regressão;
   - custo por partida aceito.
5. **Troca gradual**, com o Colyseus disponível como volta rápida.

## 9. Posse da chamada (§14) e voz sem cortes (§17)

Hoje o jogo não abre chamada, não captura microfone, não recebe o `Room` e não controla
volume nem mídia. Fechar a Atividade mantém a pessoa na chamada. Isso foi verificado em
`e2e/voz.mjs`, com LiveKit local e mídia **simulada** do Chromium; não foi testado com
microfone físico nem com LiveKit Cloud. Os indicadores de fala seguem o estado do host.

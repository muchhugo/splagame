# Arquitetura

## Visão geral

```text
┌──────────── Host (apps/activity-shell, Next.js) ────────────┐
│ Página do host   ── cria e remove o iframe (sandbox)        │
│  • ActivityHost (bridge)          • voz LiveKit (do host)   │
│ Backend do host (Route Handlers)                            │
│  • sessão de dev (cookie assinado) • ACL do canal           │
│  • credencial de partida (JWT 60 s) • token LiveKit (privado)│
└──────────────┬──────────────────────────────────────────────┘
               │ postMessage (handshake com origem + nonce) → MessageChannel privado
┌──────────────▼──────── Atividade (apps/game-client) ────────┐
│ React: lobby, HUD, menus, resultados (fora do loop 3D)      │
│ GameRuntime (Babylon.js WebGL2): cena, câmera, efeitos, som │
│ LocalPredictor: mesma stepPlayer do servidor (Rapier)       │
│ MatchConnection (@colyseus/sdk)                             │
└──────────────┬──────────────────────────────────────────────┘
               │ WebSocket (Colyseus); credencial no corpo do POST de matchmaking
┌──────────────▼────── Servidor de partidas (apps/game-server) ┐
│ ArenaRoom: uma sala por activitySessionId, única autoridade  │
│ MatchSimulation @ 30 Hz: física, tinta, dano, objetos, bots  │
│ Snapshots @ 15 Hz · tinta em snapshot + deltas binários      │
│ ResultSink idempotente (JSONL no laboratório)                │
└──────────────────────────────────────────────────────────────┘
```

## Pacotes e fronteiras

| Pacote | Responsabilidade | Não pode |
|---|---|---|
| `game-contracts` | Identidade (`GAME_NAME`…), constantes de rede, mensagens e schemas zod, saneamento de entradas, codificação binária da tinta | depender de DOM, engine ou física |
| `game-content` | `MapSpec` do Pátio da Olaria, ferramentas, balanceamento, hash do mapa | conter lógica de simulação |
| `game-simulation` | Geometria derivada do mapa, `PhysicsWorld` (Rapier), `stepPlayer`, `PaintLayout`/`PaintState`/`PaintReplica`, `MatchSimulation`, bots (`NavGraph`, `BotBrain`) | importar Babylon, React ou DOM (testes rodam em Node) |
| `activity-sdk` | Contrato host ⇄ Atividade: `ActivityHost`, `ActivityClient`, envelope, schemas | conhecer o jogo |
| `voice-adapter` | Visão limitada da voz do host (`HostVoiceAdapter`, `NullVoiceAdapter`) | criar captura de microfone ou receber o objeto `Room` |
| `test-utils` | `HeadlessClient` pelo transporte real, credenciais de teste | ser importado por código de produção |
| `game-server` | Salas Colyseus, autenticação da credencial, rate limit, persistência | confiar em estado vindo do cliente |
| `game-client` | Renderização, previsão, interpolação, UI, áudio | decidir acerto, dano, tinta ou resultado |
| `activity-shell` | Host de **laboratório**: iframe, bridge, credenciais de dev, voz LiveKit | ser tratado como o Trivo |

## Autoridade

O servidor é a única autoridade de escrita. O cliente envia apenas **intenção**: eixo de
movimento normalizado, yaw e pitch, botões mantidos e ações discretas numeradas
(`PlayerInput` em `game-contracts/src/input.ts`). O servidor:

- saneia a entrada: rejeita `NaN` e `Infinity`, limita faixas, descarta sequência antiga e
  limita a fila (`INPUT_QUEUE_MAX`, `INPUT_STALE_TICKS`);
- simula movimento, colisão, pigmento, disparo, projéteis, tinta, dano, eliminação,
  reaparecimento, carga do especial e cronômetro;
- nunca aceita posição, velocidade, vida, tinta ou resultado vindos do cliente.

O cliente roda a mesma `stepPlayer` só para **prever** o próprio movimento e reconcilia com o
estado autoritativo (ver [networking.md](networking.md)). Tinta, dano e acertos exibidos antes
da confirmação são apenas efeitos visuais.

## Máquina de estados da sala

```text
lobby ──start (anfitrião; humanos prontos)──▶ loading ──todos carregaram / 15 s──▶ countdown (3 s)
  ▲                                                                                  │
  │                                                                                  ▼
  └──── voto "lobby" do anfitrião / 60 s ◀── results ◀── finishing (2,5 s) ◀── running (180 s)
                                               │
                                               └── todos os humanos votam "revanche" ──▶ loading (nova rodada, tinta zerada)
```

- `loading` confere o hash do mapa. Um cliente com mapa diferente recebe aviso e não joga.
- A rodada fecha **exatamente uma vez** (`MatchSimulation.finish`), congela o estado e gera
  `RoundResult` com as unidades internas exatas. O empate é real, sem desempate por arredondamento.
- O resultado é persistido de forma idempotente por `(matchId, roundId)`.
- Se a sala é descartada no meio de uma rodada, ela é registrada como `interrupted`, sem
  vencedor.

## Sessão, identidade e vagas

- Uma sala por `activitySessionId` (`filterBy`). O `onAuth` estático valida a credencial no
  **POST de matchmaking** (corpo, não URL) antes de qualquer WebSocket.
- `userId` vem do `sub` da credencial. Se o mesmo usuário reentrar, ele retoma o próprio slot, e
  a conexão antiga é encerrada; não surge um segundo jogador.
- Até 8 humanos (4 por equipe). Vagas livres podem ser preenchidas por bots (opção do anfitrião).
- Quem chega com a rodada em andamento aguarda a próxima e não controla ninguém.
- Queda de rede abre uma janela de reconexão de 20 s. Se ela expira durante a rodada, o slot
  vira bot da mesma equipe; o usuário pode retomá-lo ao voltar.
- Se o anfitrião sai, outro humano é promovido.

## Fluxo de abertura da Atividade

1. O host cria o iframe com `sandbox="allow-scripts allow-same-origin allow-pointer-lock"`
   e `allow="fullscreen; autoplay; gamepad"`. Não há câmera nem microfone. O nonce e a sessão
   vão no **fragmento** da URL (não chegam a servidores nem a logs de acesso).
2. O jogo envia `ACTIVITY_HELLO` ao `window.parent` com a origem explícita do host. O host
   confere a origem, `event.source` e o nonce, e responde `ACTIVITY_INIT` transferindo uma porta
   de `MessageChannel`. A partir daí tudo passa pela porta privada.
3. O jogo pede `ACTIVITY_REQUEST_MATCH_CREDENTIAL`. O backend do host verifica a sessão, o
   usuário e a ACL do canal, e emite a credencial.
4. O jogo conecta ao servidor de partidas, recebe `welcome` e `lobby` e informa
   `ACTIVITY_SESSION_STATE_CHANGED`.
5. Ao fechar, o host envia `ACTIVITY_CLOSE_REQUESTED`. O jogo sai da sala, libera engine, física,
   áudio e ouvintes e responde `ACTIVITY_CLOSED`; o host então remove o iframe. A chamada de voz
   é do host e não é afetada.

Detalhes do contrato em [activity-integration.md](activity-integration.md).

## Renderização (cliente)

- Babylon.js 9 com WebGL2 obrigatório. Sem WebGL2, aparece uma mensagem clara e o host recebe
  `ACTIVITY_ERROR`.
- O cenário é uma malha única gerada do mesmo `MapSpec` com `ShaderMaterial` próprio. A tinta
  vem de um **atlas lógico** (R/G = cobertura das equipes por célula, B = sol pré-calculado,
  A = oclusão ambiente), atualizado parcialmente por chunk.
- Personagens e equipamentos usam material toon próprio. A decoração estática é fundida por
  material para reduzir chamadas de desenho.
- React controla só menus e HUD. O loop 3D escreve direto em alguns nós do DOM (retículo,
  marcador de acerto, vinheta de dano) sem passar pelo estado React a cada quadro.

# Integração como Atividade

> **Situação:** o contrato está implementado nos dois lados (`packages/activity-sdk`) e foi
> testado com o host de **laboratório** (`apps/activity-shell`), em testes unitários e no
> Chromium. **Não houve integração com o Trivo real**: este repositório não tem acesso a ele, e
> o repositório de trabalho estava vazio quando o projeto começou. A voz via LiveKit está
> implementada no host de laboratório, mas **não foi testada com um servidor LiveKit real**.

## Papéis

| Quem | Responsável por | Não faz |
|---|---|---|
| Host (Trivo; aqui, `activity-shell`) | Criar e remover o iframe; sessão e identidade do usuário; ACL do canal; emitir a credencial curta de partida no **backend**; ser dono da chamada LiveKit | Simular gameplay |
| Atividade (`game-client`) | Jogo, UI e conexão ao servidor de partidas; pedir credencial ao host; refletir o estado de voz | Guardar segredos; capturar microfone; decidir permissão |
| Servidor de partidas | Validar a credencial (emissor, audiência, sessão, validade, `jti`); ser a autoridade da partida | Confiar em qualquer identidade que não venha da credencial |

## Handshake e canal privado

1. O host cria o iframe com a URL da Atividade e um **fragmento** `#nonce=…&session=…`.
   O fragmento não é enviado ao servidor HTTP, então não aparece em logs de acesso.
2. A Atividade (`ActivityClient.connect`) envia `ACTIVITY_HELLO` a `window.parent`, com
   `targetOrigin` igual a uma das origens permitidas (`VITE_ALLOWED_HOST_ORIGINS`).
   **Nunca `'*'`.**
3. O host (`ActivityHost`) só aceita a mensagem se:
   - `event.origin` for a origem esperada da Atividade;
   - `event.source` for o `contentWindow` daquele iframe;
   - o nonce for o gerado para aquela abertura;
   - o envelope passar no schema (versão, tamanho dos campos, tipo conhecido).
4. O host responde `ACTIVITY_INIT` (contexto e estado de voz) e **transfere uma porta de
   `MessageChannel`**. A Atividade confere origem, fonte e nonce e passa a usar só a porta.
5. Pedidos têm `id` e resposta `replyTo`, com timeout. Mensagens malformadas, de nonce errado ou
   de tipo desconhecido são descartadas sem derrubar nada.

## Mensagens

Host → Atividade: `ACTIVITY_INIT`, `ACTIVITY_CONTEXT_UPDATED`, `ACTIVITY_VISIBILITY_CHANGED`,
`ACTIVITY_RESIZE`, `ACTIVITY_SUSPEND`, `ACTIVITY_RESUME`, `ACTIVITY_CLOSE_REQUESTED`,
`VOICE_STATE_UPDATED`, `RESPONSE`.

Atividade → host: `ACTIVITY_HELLO`, `ACTIVITY_READY`, `ACTIVITY_LOADING_PROGRESS`,
`ACTIVITY_ERROR`, `ACTIVITY_REQUEST_MATCH_CREDENTIAL`, `ACTIVITY_REQUEST_INVITE`,
`ACTIVITY_REQUEST_FULLSCREEN`, `ACTIVITY_REQUEST_CLOSE`, `ACTIVITY_REQUEST_VOICE_ACTION`,
`ACTIVITY_SESSION_STATE_CHANGED`, `ACTIVITY_CLOSED`.

Os schemas zod estão em `packages/activity-sdk/src/protocol.ts`. O envelope é
`{ v: 1, type, nonce, id?, replyTo?, payload }`.

### Contexto (`ActivityContext`)

`activityId`, `activitySessionId`, `matchId?`, `channelId?`, `communityId?`,
`viewer { id, displayName, avatarUrl? }`,
`capabilities { canCreateMatch, canJoinMatch, canInvite, canUseVoice }`, `locale`, `theme`,
`hostKind` (`trivo` | `lab-dev` | `standalone-dev`, apenas diagnóstico; **não concede nada**).

As capacidades vêm do host, mas a permissão real é conferida no backend (ACL) e no servidor de
partidas (claim `cap.join`).

## Credencial de partida

- Emitida pelo **backend do host** ao receber `ACTIVITY_REQUEST_MATCH_CREDENTIAL`, depois de
  verificar a sessão do usuário, se ele pertence ao roster e se é membro do canal.
- JWT com `sub` (usuário), `sid` (activitySessionId), `name`, `cap { join, create }`, `iss`,
  `aud = borrifo-match-server`, `iat`, `exp` (60 s; o servidor aceita no máximo 120 s) e `jti`.
- Vai ao servidor de partidas no **corpo do POST de matchmaking** do Colyseus. Nunca vai na
  URL, e os logs removem campos com nomes como `token`, `credential` e `secret`.
- O servidor confere assinatura, emissor, audiência, validade, sessão, `cap.join` e `jti`
  (anti-replay). Os erros viram códigos (`expired`, `replayed`, `wrong_session`, `forbidden`,
  `invalid_credential`) sem vazar detalhes.

### Modos de autenticação do servidor de partidas

| `MATCH_AUTH_MODE` | Uso | Chave | Emissor |
|---|---|---|---|
| `dev-hs256` | Laboratório local | `DEV_MATCH_CREDENTIAL_SECRET` (segredo local gerado por `pnpm setup:env`) | `trivo-activities-lab:dev` |
| `jwks` | Host real | `MATCH_CREDENTIAL_JWKS_URL` (chave pública do backend do host; ES256, RS256 ou EdDSA) | `MATCH_CREDENTIAL_ISSUER` |

`dev-hs256` com `NODE_ENV=production` **impede a inicialização**. No modo `jwks`, o emissor de
desenvolvimento também é recusado. Os endpoints de desenvolvimento do host (`/api/lab/*`)
recusam `NODE_ENV=production`. A rota *standalone* exige `LAB_ENABLE_STANDALONE=1`, fora de
produção e a partir da origem exata `LAB_GAME_ORIGIN`; no cliente, ela só existe em build de
desenvolvimento. **Nenhum modo mock é ativado por parâmetro de URL.**

## Voz (LiveKit)

- A conexão LiveKit é do **host** (`apps/activity-shell/lib/client/voice.ts`). O token é
  gerado no backend (`/api/lab/livekit-token`, `livekit-server-sdk`) com TTL de 10 min, só para
  membros do canal, e permite publicar apenas o **microfone** (sem câmera nem tela).
  `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` nunca saem do servidor.
- A Atividade recebe só `VoiceState` (dados puros: disponível, conectado, mudo, participantes
  falando). O objeto `Room` não atravessa o iframe, e o iframe **não recebe permissão de câmera
  nem de microfone** (`allow="fullscreen; autoplay; gamepad"`).
- `ACTIVITY_REQUEST_VOICE_ACTION`:
  - `toggle_mute` só é aceito se o usuário já ativou o microfone pelo botão do host
    (consentimento explícito). Desligar é sempre aceito.
  - `join` e `leave` são recusados: entrar ou sair da chamada é decisão do usuário no host.
- Fechar a Atividade não sai da chamada. O jogo não publica um segundo microfone.
- Sem `LIVEKIT_*`, o estado é `available: false, reason: 'not_configured'`, e o jogo e o host
  mostram "Voz não configurada neste ambiente". **Não há voz simulada.**

**Não verificado:** conexão a um servidor LiveKit, publicação e recepção de áudio, indicadores
de fala, reconexão de mídia e o comportamento de "fechar a Atividade mantém a chamada" com
mídia real. O código segue a API instalada (`livekit-client` 2.22.3), mas nada disso foi
exercitado.

## Ciclo de vida

| Evento | Comportamento |
|---|---|
| Abrir | Iframe criado, handshake, carregamento com progresso (`ACTIVITY_LOADING_PROGRESS`), `ACTIVITY_READY` |
| Aba oculta / `ACTIVITY_SUSPEND` | Renderização pausa; a conexão continua (o servidor segue autoritativo) |
| `ACTIVITY_CLOSE_REQUESTED` | O jogo sai da sala, libera engine, física, áudio e ouvintes e envia `ACTIVITY_CLOSED`; o host remove o iframe |
| Reabrir na mesma sessão | Nova credencial; o servidor devolve o **mesmo slot** e encerra a conexão antiga |
| Usuário sem acesso | Backend responde 403; o jogo mostra "Sem acesso a esta partida" e envia `ACTIVITY_ERROR` |

## Como um host real integraria

1. Servir o `game-client` numa **origem própria**, diferente do host. `allow-same-origin` no
   sandbox só é seguro por causa disso.
2. Configurar no host a origem da Atividade e, no build do jogo, `VITE_ALLOWED_HOST_ORIGINS`
   com a origem do host. Enviar o cabeçalho `Content-Security-Policy: frame-ancestors <host>` ao
   servir o jogo (em desenvolvimento, o Vite já envia).
3. Implementar `ActivityHost` (ou o equivalente) com a mesma verificação de origem, fonte e nonce.
4. Emitir a credencial no backend com uma chave assimétrica e publicar o JWKS. Rodar o servidor
   de partidas com `MATCH_AUTH_MODE=jwks`.
5. Reaproveitar a conexão LiveKit existente do host e repassar apenas `VoiceState`.

Nada disso foi feito contra o Trivo. Os passos acima são o caminho previsto, não verificado.

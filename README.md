# Borrifo — laboratório de Atividade

**Borrifo** (nome provisório de desenvolvimento, ver [docs/identity.md](docs/identity.md)) é um
jogo 3D original de disputa territorial por pigmento, em equipes de até 4 × 4, feito para
rodar como **Atividade** incorporada a um host (o Trivo) e, em desenvolvimento, de forma
independente.

Este repositório é um **laboratório separado**. Ele não contém nem modifica o Trivo
principal, não substitui o Arapark e não publica nada. O "host" daqui é um host de
desenvolvimento fictício (`apps/activity-shell`), que implementa o mesmo contrato que um host
real precisaria implementar.

> Estado resumido:
> - Partida jogável de ponta a ponta com servidor autoritativo. 2 navegadores reais e 8
>   conexões headless foram validados na mesma sala.
> - O contrato de Atividade e o host de laboratório foram testados no Chromium.
> - A voz pelo host foi testada com um **servidor LiveKit local e mídia simulada do
>   Chromium**. Não houve microfone físico nem LiveKit Cloud.
> - Controle (gamepad), treino rápido, perfis com apelido e indicador de fala foram testados
>   com **controle simulado e toque emulado**.
>
> O plano do briefing mestre está em [docs/plano-evolucao.md](docs/plano-evolucao.md). Os
> detalhes estão em [docs/implementation-status.md](docs/implementation-status.md).

## Requisitos

| Ferramenta | Versão usada nos testes |
|---|---|
| Node.js | 22.22.2 |
| pnpm | 10.33.0 |
| Navegador | Chromium com WebGL2 (testado via Playwright + SwiftShader) |

Nenhum serviço pago é necessário para jogar localmente. PostgreSQL e LiveKit **não** são
obrigatórios (ver "Limitações").

## Instalar e rodar

```bash
pnpm install
pnpm setup:env      # cria .env a partir de .env.example, com segredos locais aleatórios
pnpm dev            # servidor de partidas + cliente do jogo + host de laboratório
```

| Componente | URL | Pacote |
|---|---|---|
| Host de laboratório (Next.js) | <http://localhost:3000> | `apps/activity-shell` |
| Cliente do jogo (Vite) | <http://localhost:5173> | `apps/game-client` |
| Servidor de partidas (Colyseus) | <http://localhost:2567> (`/healthz`) | `apps/game-server` |

`pnpm dev:game` sobe só o servidor e o cliente, sem o host.

### Jogar pela Atividade (caminho principal)

1. Abra <http://localhost:3000>.
2. Escolha um usuário de desenvolvimento (Ana, Bruno…). `Hugo` existe para testar "sem acesso" (403).
3. Clique **Abrir Borrifo**. O host cria o iframe, faz o handshake e entrega uma credencial de
   partida de 60 s, emitida no backend do laboratório.
4. No lobby, escolha a ferramenta e clique **Começar partida**. As vagas livres são preenchidas
   por bibelô-bots, que podem ser desligados.

### Teste com duas sessões (duas pessoas na mesma sala)

O cookie de sessão do laboratório é compartilhado entre abas da mesma origem, então use
**origens diferentes**:

1. Janela A: <http://localhost:3000>, usuário **Ana**, sessão `sessao-dev-1`, **Abrir Borrifo**.
2. Janela B (anônima, ou <http://127.0.0.1:3000>): usuário **Bruno**, mesma sessão `sessao-dev-1`, **Abrir Borrifo**.
3. Ambos aparecem no mesmo lobby. Bruno marca "Pronto" e Ana, a anfitriã, inicia.

Também dá para abrir o jogo direto em <http://localhost:5173> (rota *standalone* de
desenvolvimento, que escolhe usuário e sessão na própria página). Essa rota só existe em build
de desenvolvimento e no backend com `LAB_ENABLE_STANDALONE=1`. Ela não é ativada por parâmetro
de URL.

### Controles (desktop)

| Ação | Tecla padrão |
|---|---|
| Mover | W A S D |
| Mirar | mouse (clique na arena para capturar o ponteiro) |
| Disparar | botão esquerdo (alternativa: F) |
| Forma Pião (fluxo): nadar, recarregar, escalar tinta própria | Shift esquerdo (segurar ou alternar) |
| Pular | Espaço |
| Moringa (dispositivo) | Q |
| Roda de Oleiro (especial) | E |
| Mapa tático e Pião-Guia (clique num aliado) | Tab |
| Menu e configurações | Esc |

Todas as teclas são remapeáveis no menu. Também há paletas de acessibilidade, padrões na
tinta, redução de tremor e flashes, escala do HUD, sensibilidade, FOV e volume.

### Controle (gamepad)

Xbox, PlayStation, Nintendo e genéricos (Web Gamepad API, USB ou Bluetooth): conecte e aperte
qualquer botão. As dicas na tela passam a mostrar os botões do seu controle.

| Ação | Botão padrão (posição física) |
|---|---|
| Mover / câmera | analógico esquerdo / direito |
| Usar a ferramenta | RT |
| Forma Pião | LB |
| Ação contextual (Moringa; no mapa, confirma o Pião-Guia) | LT |
| Pular | A (✕ no PlayStation) |
| Moringa | RB |
| Roda de Oleiro | Y (△) |
| Mapa tático (direcional escolhe o companheiro) | View / Create |
| Menu | Menu / Options |
| Recentralizar a câmera | R3 |

A aba **Configurações › Controle** tem:
- sensibilidade por eixo, inversão, zonas mortas e curva de resposta;
- vibração com intensidade;
- mira assistida leve, que pode ser desligada;
- ícones por família e remapeamento;
- leitura ao vivo dos botões.

Os menus são navegados com o direcional (A confirma, B volta, LB/RB trocam de aba). Foi testado
só com um **controle simulado** no Chromium.

### Toque

Analógico virtual, arrastar à direita para a câmera, e botões para usar a ferramenta, Pião,
pular, Moringa, Roda, Mapa e Menu. Foi verificado só num **contexto móvel emulado**, **não em
aparelho real**.

### Treino rápido

Na primeira partida, um cartão no canto ensina 9 gestos, detectados pelo próprio jogo, com o
texto do dispositivo em uso. Não pausa; pode ser pulado e refeito pelo menu.

## Testes e verificações

```bash
pnpm test                                        # vitest: simulação, rede real, contrato, host, controle, perfis, cores
pnpm typecheck                                   # TypeScript estrito em todos os pacotes
pnpm e2e                                         # Playwright (com `pnpm dev`): host ⇄ Atividade, 2 navegadores, controle e treino
E2E_SWIFTSHADER=1 pnpm e2e                       # o mesmo, sem GPU (containers/CI)
pnpm e2e:audio                                   # efeitos sonoros numa partida real + cobertura (≈8 min)
pnpm e2e:voz                                     # voz pelo host com LiveKit LOCAL + mídia simulada (ver docs/testing.md)
pnpm --filter @borrifo/bench-transport bench     # benchmark isolado LiveKit Data × Colyseus (ver docs/livekit-transporte.md)
pnpm --filter @borrifo/game-server load-test     # carga local: servidor real + 8 clientes WebSocket
CLIENTS=1 pnpm --filter @borrifo/game-server load-test   # 1 humano + 7 bots
pnpm build                                       # builds de produção
```

O que cada suíte cobre, e o que **não** cobre, está em [docs/testing.md](docs/testing.md). As
medições estão em [docs/performance.md](docs/performance.md).

## Configuração: público × privado

`.env.example` documenta cada variável. Em resumo:

- **Privado** (servidor e backend do laboratório): `DEV_MATCH_CREDENTIAL_SECRET`,
  `LAB_SESSION_SECRET`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `MATCH_CREDENTIAL_JWKS_URL`…
  Nunca vão para o bundle, para a URL ou para os logs.
- **Público** (entra no bundle do jogo): apenas `VITE_*` (URL do servidor de partidas, origens de
  host permitidas, URL do backend do laboratório). Nada secreto.
- `MATCH_AUTH_MODE=dev-hs256` é **recusado** com `NODE_ENV=production`. Um host real usa
  `MATCH_AUTH_MODE=jwks`, com a chave pública do emissor.
- LiveKit é opcional. Sem `LIVEKIT_*`, o host e o jogo mostram "Voz não configurada neste
  ambiente". Nada é simulado.

## Estrutura

```text
apps/
  activity-shell/   Next.js 16 — host de laboratório (iframe, bridge, credenciais, voz LiveKit no host)
  game-client/      Vite + React 19 + Babylon.js 9 (WebGL2) — o jogo que roda dentro da Atividade
  game-server/      Node + Colyseus 0.18 — salas autoritativas, 30 Hz
packages/
  game-contracts/   identidade, protocolo, entradas saneadas, codificação binária da tinta
  game-content/     MapSpec do Pátio da Olaria, ferramentas e balanceamento
  game-simulation/  física Rapier, movimento, tinta, dano, rodada e bots (sem DOM)
  activity-sdk/     contrato host ⇄ Atividade (handshake, MessageChannel, schemas)
  voice-adapter/    visão limitada da voz do host para o jogo
  test-utils/       cliente headless pelo transporte real, credenciais de teste
docs/               arquitetura, integração, rede, tinta, design, testes, desempenho, status, ADRs
```

## Documentação

- [docs/implementation-status.md](docs/implementation-status.md): o que está implementado, testado, parcial ou não iniciado.
- [docs/plano-evolucao.md](docs/plano-evolucao.md): fases do briefing mestre, dependências e estado.
- [docs/livekit-transporte.md](docs/livekit-transporte.md): LiveKit como transporte? Documentação, benchmark e decisão.
- [docs/architecture.md](docs/architecture.md): componentes, autoridade, máquina de estados.
- [docs/activity-integration.md](docs/activity-integration.md): contrato host ⇄ Atividade, credenciais, voz.
- [docs/networking.md](docs/networking.md): protocolo, previsão, reconciliação, reconexão.
- [docs/paint-system.md](docs/paint-system.md): células lógicas, pontuação, sincronização, renderização.
- [docs/game-design.md](docs/game-design.md): loop, formas, ferramentas, arena, direção de arte.
- [docs/testing.md](docs/testing.md) e [docs/performance.md](docs/performance.md).
- [docs/decisions/](docs/decisions/): ADRs curtos das decisões e dos desvios da stack proposta.
- [ASSET_LICENSES.md](ASSET_LICENSES.md): origem e licença de cada recurso.
- [AUDIO_CREDITS.md](AUDIO_CREDITS.md): cada efeito sonoro, com autor, link, licença (CC0) e alterações.

## Limitações principais

- Efeitos sonoros: gravações CC0 reais, ligadas aos eventos e testadas por instrumentação, mas
  **ainda não ouvidas por uma pessoa** (o ambiente não tem saída de som). Ouça
  `e2e/out/audio-partida.wav` depois de rodar `pnpm e2e:audio`.
- LiveKit: testado com servidor **local** e mídia **simulada**. Faltam microfone físico,
  pessoas ouvindo e LiveKit Cloud. O gameplay continua no Colyseus
  ([ADR 0012](docs/decisions/0012-transporte-colyseus-voz-livekit.md)).
- Controle: só simulado. Faltam controles físicos, Electron e celular.
- Integração com o Trivo real: não feita. Este repositório não tem acesso ao Trivo, e o host
  aqui é fictício.
- Persistência: resultados vão para um arquivo JSONL idempotente, não para PostgreSQL/Drizzle
  (ver [ADR 0006](docs/decisions/0006-persistencia-jsonl.md)).
- Mobile, Safari, Firefox e GPUs reais: não verificados. As capturas e medições de cliente foram
  feitas com renderização por CPU (SwiftShader).
- Sem compensação de latência no servidor para acertos ([ADR 0004](docs/decisions/0004-sem-compensacao-de-latencia.md)).

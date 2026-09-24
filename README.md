# Borrifo — laboratório de Atividade

**Borrifo** (nome provisório de desenvolvimento, ver [docs/identity.md](docs/identity.md)) é um
jogo 3D original de disputa territorial por pigmento, em equipes de até 4 × 4, feito para
rodar como **Atividade** incorporada a um host (o Trivo) e, em desenvolvimento, de forma
independente.

Este repositório é um **laboratório separado**. Ele não contém nem modifica o Trivo
principal, não substitui o Arapark e não publica nada. O "host" daqui é um host de
desenvolvimento fictício (`apps/activity-shell`), que implementa o mesmo contrato que um host
real precisaria implementar.

> Estado resumido: partida jogável de ponta a ponta com servidor autoritativo, 2 navegadores
> reais e 8 conexões headless validados na mesma sala. O contrato de Atividade e o host de
> laboratório foram testados no Chromium. **A voz via LiveKit está implementada no host, mas
> não foi testada com um servidor LiveKit real** (não havia servidor nem credenciais). Detalhes
> em [docs/implementation-status.md](docs/implementation-status.md).

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
tinta, redução de tremor e flashes, escala do HUD, sensibilidade, FOV e volume. Há controles
de toque, mas **não foram verificados em dispositivo móvel real**.

## Testes e verificações

```bash
pnpm test                                        # 80 testes (vitest): simulação, rede real, contrato, host
pnpm typecheck                                   # TypeScript estrito em todos os pacotes
pnpm e2e                                         # Playwright (com `pnpm dev` rodando): host ⇄ Atividade e 2 navegadores
E2E_SWIFTSHADER=1 pnpm e2e                       # o mesmo, sem GPU (containers/CI)
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
- [docs/architecture.md](docs/architecture.md): componentes, autoridade, máquina de estados.
- [docs/activity-integration.md](docs/activity-integration.md): contrato host ⇄ Atividade, credenciais, voz.
- [docs/networking.md](docs/networking.md): protocolo, previsão, reconciliação, reconexão.
- [docs/paint-system.md](docs/paint-system.md): células lógicas, pontuação, sincronização, renderização.
- [docs/game-design.md](docs/game-design.md): loop, formas, ferramentas, arena, direção de arte.
- [docs/testing.md](docs/testing.md) e [docs/performance.md](docs/performance.md).
- [docs/decisions/](docs/decisions/): ADRs curtos das decisões e dos desvios da stack proposta.
- [ASSET_LICENSES.md](ASSET_LICENSES.md): origem e licença de cada recurso.

## Limitações principais

- LiveKit: implementado no host e no adaptador, **não testado com servidor real**.
- Integração com o Trivo real: não feita. Este repositório não tem acesso ao Trivo, e o host
  aqui é fictício.
- Persistência: resultados vão para um arquivo JSONL idempotente, não para PostgreSQL/Drizzle
  (ver [ADR 0006](docs/decisions/0006-persistencia-jsonl.md)).
- Mobile, Safari, Firefox e GPUs reais: não verificados. As capturas e medições de cliente foram
  feitas com renderização por CPU (SwiftShader).
- Sem compensação de latência no servidor para acertos ([ADR 0004](docs/decisions/0004-sem-compensacao-de-latencia.md)).

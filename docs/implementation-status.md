# Estado da implementação

Atualizado em 24/09/2026. Nome do jogo: **Borrifo** (provisório; não renomeie sem atualizar
`packages/game-contracts/src/identity.ts` e [identity.md](identity.md)).

Legenda:

- **Testado:** implementado e exercitado por teste automatizado ou verificação executada, com o
  como indicado.
- **Parcial:** implementado, mas só parte foi exercitada.
- **Laboratório:** funciona contra o host fictício e a infraestrutura local, não contra o
  Trivo real.
- **Não verificado:** código existe, mas não foi executado no cenário real.
- **Não implementado.**

## Por área

| Área | Estado | Evidência / observação |
|---|---|---|
| Identidade centralizada (nome, slug, id, versão) | Testado | `identity.ts`, usada por UI, logs e contrato |
| Arena Pátio da Olaria v2 (praça elevada, passagem inferior, varanda, tablado, galpões com 2 saídas) | Testado | `map.test.ts` (alcance, saídas, linha de tiro, simetria) e tour pela câmera de gameplay |
| Movimento, forma Pião, escalada, salto de borda | Testado | `movement.test.ts` (14) |
| Pigmento, custo, recarga, regeneração | Testado | `movement.test.ts` |
| Dano, eliminação, reaparecimento, proteção de spawn | Testado | `match.test.ts` |
| Tinta lógica (células com peso de área, oclusão, pisos em alturas, placar incremental) | Testado | `paint.test.ts` (10) |
| Sincronização de tinta (snapshot RLE, deltas versionados, ressincronização) | Testado | `paint.test.ts`, `room.test.ts` (réplica confere com o resultado), `network.test.ts`, E2E com 2 navegadores (hash idêntico) |
| Esguicho, Rodo, Estilingue | Testado | `movement.test.ts`, `match.test.ts`; jogados no navegador |
| Moringa (dispositivo) | Testado | Custo e forma de combate; explosão bloqueada por parede |
| Roda de Oleiro (especial) | Parcial | Carga por conquista testada; ondas e destruição exercitadas só em partidas com bots, sem teste dedicado |
| Pião-Guia (deslocamento tático) | Testado | `match.test.ts` (preparar, lançar, pousar, cancelar) |
| Bots no servidor pelas mesmas regras | Testado | Partidas completas em `room.test.ts` e no teste de carga |
| Servidor autoritativo Colyseus a 30 Hz, snapshots a 15 Hz | Testado | `room.test.ts`, `network.test.ts`, teste de carga (p99 de 2,4 ms) |
| Lobby, equipes, anfitrião, prontos, bots opcionais | Testado | `network.test.ts` e E2E |
| Rodada, contagem, término exatamente uma vez, empate real | Testado | `match.test.ts` |
| Resultados e revanche (tinta zerada) | Testado | `network.test.ts` (8 clientes) |
| Reconexão ao mesmo slot; reabrir com nova credencial; slot vira bot após 20 s | Parcial | As duas primeiras testadas em `network.test.ts`; a troca por bot após expirar não tem teste dedicado |
| Entrada no meio da rodada aguarda a próxima | Testado | `network.test.ts` |
| Entradas adversariais (NaN, Infinity, payload enorme, tipos errados, comandos inventados) | Testado | `network.test.ts`, `input.test.ts` |
| Rate limit de ingresso e de mensagens | Testado | `network.test.ts` (429) |
| Previsão local e reconciliação | Parcial | Medida só em rede local (correções de 6 a 14 mm); latência real não testada |
| Interpolação de remotos | Parcial | Vista com 2 navegadores locais; sem jitter real |
| Contrato de Atividade (handshake com origem e nonce, MessageChannel, schemas, timeouts) | Testado | `bridge.test.ts` (8) e `e2e/shell.mjs` |
| Host de laboratório (iframe sandbox, abrir/fechar, contadores de vazamento, erros) | Laboratório | `e2e/shell.mjs`: abrir/fechar 10× sem vazamento |
| Credencial de partida (backend, ACL, TTL, jti, recusa em produção) | Testado | `credential.test.ts` (21) e `network.test.ts` |
| Modo `jwks` (host real) | Não verificado | Implementado em `auth.ts`; sem JWKS real para testar |
| Voz: `VoiceAdapter` e estado "não configurada" | Testado | E2E: o chip mostra "Voz não configurada neste ambiente" |
| Voz: LiveKit no host (token no backend, só microfone, consentimento explícito) | **Não verificado** | Código em `apps/activity-shell/lib/client/voice.ts`; **sem servidor LiveKit** neste ambiente |
| Integração com o Trivo real | **Não implementado** | Sem acesso ao Trivo; ver [ADR 0001](decisions/0001-laboratorio-independente.md) |
| Persistência do resultado | Parcial | JSONL idempotente testado; **PostgreSQL/Drizzle não implementado** ([ADR 0006](decisions/0006-persistencia-jsonl.md)) |
| Renderização WebGL2, shader de tinta, atlas parcial | Testado | Capturas pela câmera de gameplay; só SwiftShader |
| Mensagem clara sem WebGL2 | Parcial | Implementada; não exercitada num navegador sem WebGL2 |
| Direção de arte cartoon (toon, luz, materiais, letreiros, estátua, respingos orgânicos) | Testado | Iterada por capturas; ver [game-design.md](game-design.md#direção-de-arte) |
| HUD, menus, mapa tático, resultados em pt-BR | Testado | Usados nos E2E e nas capturas |
| Áudio procedural (efeitos e trilha gerativa) | Parcial | Inicializa e roda sem erros; **não foi ouvido** (ambiente sem saída de áudio) |
| Acessibilidade (paletas, padrões, redução de tremor e flashes, escala do HUD, remapeamento, reduced-motion) | Parcial | Implementada; não revisada com usuários nem com leitor de tela |
| Pausa ao ocultar ou suspender | Testado | `e2e/gameplay.mjs` (0 quadros oculta) |
| Controles de toque e mobile | Não verificado | `TouchControls.tsx` existe; nenhum dispositivo real |
| Desempenho do cliente numa GPU real | Não verificado | Só SwiftShader (~4 FPS, não representativo) |
| Modos adicionais (§26) | Não implementado | Fase 6 |

## Critérios de aceitação do primeiro marco (§31)

| # | Critério | Situação |
|---|---|---|
| 1 | Nome, identidade e assets com origem documentada | Atendido ([identity.md](identity.md), [ASSET_LICENSES.md](../ASSET_LICENSES.md)); nome sem pesquisa de marca |
| 2 | Abre de forma independente e pelo contrato de Atividade | Atendido no laboratório (standalone de dev e host de laboratório) |
| 3 | Arena original completa e navegável | Atendido |
| 4 | Até 4 × 4, bots opcionais | Atendido |
| 5 | Dois clientes independentes pelo transporte real | Atendido: 2 navegadores (E2E) e 8 clientes headless |
| 6 | Disparo, tinta, dano, eliminação, reaparecimento e cronômetro autoritativos | Atendido |
| 7 | Tinta afeta deslocamento, recarga, escalada e resultado | Atendido |
| 8 | 3 ferramentas, 1 dispositivo e 1 especial funcionando | Atendido (a Roda de Oleiro tem teste parcial) |
| 9 | Resultado territorial consistente entre clientes | Atendido (8 clientes com o mesmo resultado; réplica confere) |
| 10 | Lobby, HUD, resultado, revanche, erro e reconexão | Atendido |
| 11 | Voice adapter respeita a conexão LiveKit do host | Implementado; **LiveKit real não verificado** |
| 12 | Abrir e fechar liberam recursos sem encerrar a chamada | Liberação testada (10×); **"sem encerrar a chamada" não verificado com mídia real** |
| 13 | Testes de simulação, rede, contrato e entradas maliciosas | Atendido (80 testes + E2E) |
| 14 | README permite rodar e testar | Atendido |
| 15 | Itens não testados identificados | Esta página e [testing.md](testing.md) |

## Fases

| Fase | Situação |
|---|---|
| 0: inspeção e decisões | Concluída (repositório vazio; laboratório próprio) |
| 1: primeira partida de ponta a ponta | Concluída |
| 2: multiplayer real e arsenal | Concluída (sem latência real) |
| 3: Atividade e LiveKit | Contrato e host de laboratório concluídos; **LiveKit e Trivo reais pendentes** |
| 4: acabamento | Em grande parte feita (arte, áudio, HUD, acessibilidade); falta playtest com pessoas |
| 5: validação, segurança e operação | Parcial: testes adversariais, carga local e E2E feitos; faltam GPU real, rede emulada, várias salas e persistência de produção |
| 6: modos e conteúdo | Não iniciada |

## Próximo ponto de continuação

Em ordem sugerida, cada item com o critério para considerá-lo feito:

1. **Validar a voz com LiveKit real.** Subir `livekit-server --dev` (documentação oficial do
   LiveKit), preencher `LIVEKIT_URL`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` no `.env`, e abrir
   duas janelas do host com Chromium usando `--use-fake-device-for-media-stream` (dispositivo
   **simulado**, identificar como tal). *Feito quando:* os dois entram na chamada, o indicador de
   fala chega ao jogo, fechar a Atividade mantém a chamada e só existe uma publicação de
   microfone. Arquivos: `apps/activity-shell/lib/client/voice.ts`, novo `e2e/voice.mjs`.
2. **Persistência de produção.** Implementar `ResultSink` sobre PostgreSQL com Drizzle
   (`apps/game-server/src/results.ts`), com constraint única `(match_id, round_id)`, e testar a
   idempotência (PGlite no teste). *Feito quando:* gravar duas vezes o mesmo resultado resulta
   em uma linha, e uma falha do banco gera o log `result.persist_failed` sem derrubar a sala.
3. **Medir numa GPU real.** Rodar `pnpm e2e` sem `E2E_SWIFTSHADER` numa máquina com GPU e
   registrar FPS e tempo de quadro por qualidade em `docs/performance.md`. Se preciso: importar o
   Babylon por subcaminhos (`@babylonjs/core/...`) para reduzir os 1,5 MB gzip e fundir as peças
   estáticas de cada personagem.
4. **Rede sob latência.** Emular 80 a 150 ms, jitter e perda (`tc netem` ou proxy) entre cliente
   e servidor. *Feito quando:* as correções de previsão forem medidas e a interpolação não
   travar; revisar o [ADR 0004](decisions/0004-sem-compensacao-de-latencia.md) com dados.
5. **Testes que faltam:** Roda de Oleiro (ondas, dano, destruição) em `match.test.ts`; slot que
   vira bot após a janela de reconexão em `network.test.ts`.
6. **Integração com o Trivo** (exige acesso e autorização): o host real implementa o
   `ActivityHost` e o endpoint de credencial com JWKS; o servidor de partidas roda em
   `MATCH_AUTH_MODE=jwks`. Seguir [activity-integration.md](activity-integration.md#como-um-host-real-integraria).
   Não fazer merge automático nem tocar produção.
7. **Playtest com pessoas** e ajuste de `packages/game-content/src/tuning.ts` e
   `equipment.ts`, registrando as mudanças em `docs/game-design.md`.
8. **Mobile:** verificar `TouchControls` e desempenho num dispositivo real antes de declarar
   suporte.
9. **Fase 6:** um segundo modo (§26) reaproveitando `MatchSimulation`, só depois dos itens
   acima.

## Observações para quem continuar

- Dev servers: `pnpm dev` (host em 3000, jogo em 5173, servidor em 2567). O `tsx watch` do
  servidor reinicia ao mudar o mapa.
- O modo de inspeção `runtime.debugView = { pos, yaw, pitch }` (só em build de dev, via
  `window.__borrifo.controller.runtime`) posiciona a câmera de gameplay para capturas. Ele não
  move o personagem.
- Ao mudar o mapa, rode `map.test.ts`: ele protege as saídas dos galpões, o acesso às áreas
  elevadas, a segurança do spawn e a simetria.

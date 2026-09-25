# Estado da implementação

Atualizado em 24/09/2026 (execução autônoma: mapas e variantes, formação 1 × 1–8 × 8, Correio do Ara, buffs, Mutirão, personagens, cenário, interface, desempenho, validação). Nome do jogo: **Borrifo** (provisório; não renomeie sem atualizar
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
| Mapas Toca do Ara e Clube da Maré, 3 variantes cada, escolhidos pelo servidor (mapId, variante, hash) | Testado | `map.test.ts` nas 6 variantes (spawns, saídas, alcance com volta, objetivos, linha de tiro, simetria), `paint.test.ts`, `network.test.ts` (mapa e variante no carregamento), E2E (troca de mapa entre rodadas) e capturas `e2e/mapas.mjs`. Ver [mapas-e-modos.md](mapas-e-modos.md) |
| Formação 1 × 1 a 8 × 8 (Flex, limites fixos, ímpares com bots ou fila, prioridade na revanche) | Testado | `formation.test.ts` (17) e `network.test.ts` (20 na sala, 21ª recusada, plano 8 × 8 + 4 na fila, aviso de fila, opções só do anfitrião) |
| Correio do Ara (estados explícitos, posse única, 60% + 1,2 s, Pião-Guia bloqueado, queda, retorno, posse máxima, 5 entregas, empate) | Testado | `modes.test.ts`, incluindo bots entregando no mapa real; E2E e capturas do HUD |
| Buffs Embalo e Fôlego; combo Mutirão | Testado | `modes.test.ts` (+15% medido, recarga +25%, coleta simultânea, parede, proteção, substituição, eliminação; Mutirão: área, setor, recarga, células não reusadas, 1 × 1, máximo com Fôlego) |
| Personagens: duas bases humanas, tons de pele, aparência sincronizada, animações, Forma Pião | Testado | `network.test.ts` (aparência validada), vitrine de poses (`e2e/vitrine.mjs`) e partidas; mesma hitbox para todos |
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
| Voz: LiveKit no host (token no backend, só microfone, consentimento explícito) | Laboratório | `e2e/voz.mjs` com **servidor LiveKit local** (`--dev`, v1.13.7) e mídia **simulada**. Com fala sintética reproduzível, **10/10** execuções completas; com o bipe do Chromium, 2/5 (a detecção do SFU sobre o bipe é bimodal). Diagnóstico por camadas em [execucao-autonoma.md](execucao-autonoma.md#voz-diagnóstico-24092026). Contrato e interface testados de forma determinística (`e2e/voz-interface.mjs`, nomes iguais em contas distintas). **Sem microfone físico nem LiveKit Cloud** |
| Perfis: apelido da comunidade → nome de exibição → usuário; avatar só de host permitido | Testado | `profile.test.ts` (contrato), `profiles.test.ts` (servidor real: prioridade, texto limpo, 24 caracteres, avatar filtrado, apelido novo ao reconectar sem duplicar o jogador) e `e2e/voz.mjs` ("Aninha") |
| Nomes sobre os personagens e indicador de fala discreto | Testado (regra) / Laboratório | A regra de visibilidade tem teste unitário: adversário atrás de parede ou submerso não mostra nome nem fala. Nomes vistos em captura; o anel de fala no placar foi visto no `e2e/voz.mjs` |
| Controle (gamepad): detecção, glifos Xbox/PlayStation/Nintendo/genérico, troca de dispositivo sem pausa, remapeamento, zonas mortas, curva, vibração limitada, mira assistida leve, menus pelo direcional | Laboratório | 14 testes unitários e `e2e/gamepad.mjs` (31 verificações numa partida real) com controle **simulado** (`navigator.getGamepads` falso). **Nenhum controle físico, Electron ou celular** |
| Treino rápido v2 (9 etapas básicas + buffs, Mutirão e Correio conforme o modo; pulável; salvo por versão) | Laboratório | `tutorial.test.ts` e `e2e/tutorial.mjs`: teclado, controle simulado e toque **emulado** (contexto móvel do Playwright) |
| Preferências v2 (esquema validado, migração da v1, armazenamento indisponível) | Testado | `gamepad.test.ts` (valores fora de faixa, JSON quebrado, migração, remapeamento sem conflito) |
| Tokens do Trivo (SVG), pares de cores escolhidos pelo servidor, cenário separado | Testado | `palette.test.ts`: valores exatos do SVG, distância OKLab entre equipes, daltonismo simulado, cenário e marca. `profiles.test.ts`: mesmo par para toda a sala |
| Benchmark LiveKit Data × Colyseus (2/4/8/16) | Laboratório (loopback) | [livekit-transporte.md](livekit-transporte.md); decisão: manter o Colyseus |
| Integração com o Trivo real | **Não implementado** | Sem acesso ao Trivo; ver [ADR 0001](decisions/0001-laboratorio-independente.md) |
| Persistência do resultado | Parcial | JSONL idempotente testado; **PostgreSQL/Drizzle não implementado** ([ADR 0006](decisions/0006-persistencia-jsonl.md)) |
| Renderização WebGL2, shader de tinta, atlas parcial | Testado | Capturas pela câmera de gameplay; só SwiftShader |
| Mensagem clara sem WebGL2 | Parcial | Implementada; não exercitada num navegador sem WebGL2 |
| Direção de arte cartoon (toon, luz, materiais, letreiros, estátua, respingos orgânicos) | Testado | Iterada por capturas; ver [game-design.md](game-design.md#direção-de-arte) |
| HUD, menus, mapa tático, resultados em pt-BR | Testado | Usados nos E2E e nas capturas |
| Menus sobre a arena: lobby hub com palco 3D, vitrine do personagem (ferramenta, base, pele, cabelo, cor), entrada cinematográfica na rodada, configurações em 6 categorias, celular em folha | Laboratório | `e2e/menus.mjs` (dois navegadores e celular **emulado**), `lobbySpot.test.ts`, `appearance.test.ts`; ver [menus.md](menus.md). **Sem celular físico, sem GPU real e sem o Trivo real** |
| Efeitos sonoros gravados (CC0), ligados aos eventos reais | Testado (sem escuta) | 66 arquivos ([AUDIO_CREDITS.md](../AUDIO_CREDITS.md)); `e2e/audio.mjs` e `e2e/audio-cobertura.mjs` verificam carga, disparo por evento, cadência, limite de vozes, loops que param, silenciar, sem clipping e revanche. **Ninguém ouviu ainda**: o ambiente não tem saída de som. A mixagem gravada está em `e2e/out/audio-partida.wav` |
| Música de fundo | Parcial | Trilha generativa própria (fora do escopo da troca por arquivos); não foi ouvida |
| Acessibilidade (paletas, padrões, redução de tremor e flashes, escala do HUD, remapeamento, reduced-motion) | Parcial | Implementada; não revisada com usuários nem com leitor de tela |
| Pausa ao ocultar ou suspender | Testado | `e2e/gameplay.mjs` (0 quadros oculta) |
| Controles de toque e composição mobile (lobby em abas, HUD de toque próprio, áreas seguras) | Laboratório | Capturas com celular **emulado** (Playwright `isMobile`/`hasTouch`, 844 × 390 e 390 × 844); nenhum dispositivo real |
| Desempenho do cliente numa GPU real | Não verificado | Só SwiftShader. Medidos desenhos por quadro, malhas, materiais e heap antes/depois e em 8 × 8 ([performance.md](performance.md)); nenhuma afirmação de FPS |
| Configurações de vídeo com efeito real (qualidade, resolução interna, pós-processamento, partículas, limite de FPS) e redução de animações | Testado | Validação e persistência em `gamepad.test.ts`; aplicadas no runtime |
| Validação agregada | Testado | `pnpm validar` ([testing.md](testing.md)) |
| Modos além de Território e Correio | Não implementado | Fora do escopo desta entrega (briefing §8.5) |

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
| 8 | 3 ferramentas, 1 dispositivo e 1 especial funcionando | Atendido (Roda de Oleiro com testes de ondas, linha de visão, aliado e quebra) |
| 9 | Resultado territorial consistente entre clientes | Atendido (8 clientes com o mesmo resultado; réplica confere) |
| 10 | Lobby, HUD, resultado, revanche, erro e reconexão | Atendido |
| 11 | Voice adapter respeita a conexão LiveKit do host | Laboratório: LiveKit local com mídia simulada (`e2e/voz.mjs`); falta chamada real |
| 12 | Abrir e fechar liberam recursos sem encerrar a chamada | Liberação testada (10×); "sem encerrar a chamada" verificado com LiveKit **local** e mídia **simulada** |
| 13 | Testes de simulação, rede, contrato e entradas maliciosas | Atendido (105 testes + E2E) |
| 14 | README permite rodar e testar | Atendido |
| 15 | Itens não testados identificados | Esta página e [testing.md](testing.md) |

## Fases

| Fase | Situação |
|---|---|
| 0: inspeção e decisões | Concluída (repositório vazio; laboratório próprio) |
| 1: primeira partida de ponta a ponta | Concluída |
| 2: multiplayer real e arsenal | Concluída (latência emulada no laboratório; rede real pendente) |
| 3: Atividade e LiveKit | Contrato e host de laboratório concluídos; **LiveKit e Trivo reais pendentes** |
| 4: acabamento | Em grande parte feita (arte, áudio, HUD, acessibilidade); falta playtest com pessoas |
| 5: validação, segurança e operação | Parcial: testes adversariais, carga local e E2E feitos; rede emulada e persistência em PostgreSQL feitas; faltam GPU real, várias salas e banco gerenciado real |
| 6: modos e conteúdo | Em andamento no laboratório: Correio do Ara, buffs, Mutirão, dois mapas com variantes, formação flexível e banco de espectadores; falta playtest |

## Próximo ponto de continuação

O plano por fases do briefing mestre está em [plano-evolucao.md](plano-evolucao.md). Na
infraestrutura existente, em ordem sugerida:

1. **Voz com microfone físico e LiveKit de teste real.** O fluxo já passa com LiveKit local e
   mídia simulada (`pnpm e2e:voz`, com o host iniciado com `LIVEKIT_*`). *Feito quando:* duas
   pessoas se ouvem, o indicador aponta quem fala no lobby, no placar e sobre o personagem, e
   fechar o jogo mantém a chamada.
2. **Controle físico** (Xbox, DualSense e genérico) no Chrome, no Electron e no celular:
   glifos, vibração e destravamento de áudio pelo botão.
3. **Persistência de produção: feita no laboratório** ([ADR 0016](decisions/0016-resultados-postgres-drizzle.md)).
   `PostgresResultSink` com Drizzle, constraint única `(match_id, round_id)` e testes num
   PostgreSQL de verdade (PGlite). Falta um banco gerenciado real (exige autorização e
   custo; não foi criado).
4. **Medir numa GPU real.** Rodar `pnpm e2e` sem `E2E_SWIFTSHADER` numa máquina com GPU e
   registrar FPS e tempo de quadro por qualidade em `docs/performance.md`. O Babylon já entra
   por subcaminhos (1,5 MB → 443 KB gzip); fundir as peças estáticas de cada personagem
   fica para depois de medir na GPU.
5. **Rede sob latência: feito no laboratório** (`e2e/rede-adversa.mjs`, proxy com 0, 80
   e 150 ms). Nenhuma correção grande; remotos sem congelar com o buffer adaptativo. Falta
   repetir numa GPU real, onde o cliente roda a 60 fps.
6. **Testes que faltavam: feitos.** Roda de Oleiro em `match.test.ts`; vaga que vira bot
   depois da janela de reconexão em `network.test.ts`.
7. **Integração com o Trivo** (exige acesso e autorização): o host real implementa o
   `ActivityHost` e o endpoint de credencial com JWKS; o servidor de partidas roda em
   `MATCH_AUTH_MODE=jwks`. Seguir [activity-integration.md](activity-integration.md#como-um-host-real-integraria).
   Não fazer merge automático nem tocar produção.
8. **Playtest com pessoas** e ajuste de `packages/game-content/src/tuning.ts` e
   `equipment.ts`, registrando as mudanças em `docs/game-design.md`.
9. **Mobile (só na horizontal):** verificar `TouchControls`, a trava de orientação e o
   desempenho num dispositivo real antes de declarar suporte.
10. **Briefing mestre, fases 1, 2, 4 e 5:** redesign das telas, personagens, mapas Toca do Ara e
    Clube da Maré, formação flexível e Correio do Ara ([plano-evolucao.md](plano-evolucao.md)).

## Observações para quem continuar

- Dev servers: `pnpm dev` (host em 3000, jogo em 5173, servidor em 2567). O `tsx watch` do
  servidor reinicia ao mudar o mapa.
- O modo de inspeção `runtime.debugView = { pos, yaw, pitch }` (só em build de dev, via
  `window.__borrifo.controller.runtime`) posiciona a câmera de gameplay para capturas. Ele não
  move o personagem.
- Ao mudar o mapa, rode `map.test.ts`: ele protege as saídas dos galpões, o acesso às áreas
  elevadas, a segurança do spawn e a simetria.

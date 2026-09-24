# Execução autônoma: matriz de requisitos e checkpoints

Especificação: briefing mestre (`TRIVO_GAME_REDESIGN_E_EVOLUCAO.md`), complemento de gamepad,
`CONTINUACAO_TRIVO_MARCO_VISUAL.md` e `TRIVO_EXECUCAO_AUTONOMA_COMPLETA.md`. Branch
`claude/brave-hypatia-uetd3t`, a partir de `c9b275e`.

Estados: **implementado** · **testado no laboratório** · **validado no ambiente real** ·
**bloqueado externamente** · **pendente de implementação**.

## Matriz

Aqui, "testado no laboratório" significa: exercitado por teste automatizado, E2E ou medição
executados neste repositório, com host fictício, LiveKit local, mídia simulada, controle
simulado e celular emulado quando indicado. **Nenhum item chegou a "validado no ambiente
real"**, porque este repositório não tem acesso ao Trivo nem a aparelhos físicos.

| # | Requisito (fonte) | Implementação | Evidência | Estado |
|---|---|---|---|---|
| V1 | Voz: investigar a intermitência sem mascarar (continuação §3; autônoma §9) | Diagnóstico por camadas (`e2e/voz-diagnostico.mjs`, `__labVoiceDiag` só em dev) | Seção "Voz" abaixo | testado no laboratório |
| V2 | Testes determinísticos de contrato/interface separados dos de mídia | `e2e/voz-interface.mjs` (fixture de dev pelo bridge real) | 11/11 verificações; na validação agregada | testado no laboratório |
| V3 | Duas contas com o mesmo nome, associação por `userId` | Roster `joao-silva` e `joao-souza`; atributos `data-player`/`data-speaking` | `voz-interface.mjs` | testado no laboratório |
| V4 | Mídia reproduzível identificada como simulada; todas as repetições registradas | `e2e/fala-sintetica.mjs`, `e2e/voz-repeticoes.mjs` | Fala 10/10, bipe 2/5 (abaixo) | testado no laboratório |
| V5 | Microfone físico, pessoas ouvindo, SFU do Trivo | — | — | bloqueado externamente |
| U1 | Redesign de carga, lobby, seleções, HUD, mapa, placar, resultados, configurações, treino e erros (continuação §4) | `ui/Lobby.tsx`, `Hud.tsx` (modos), `Results.tsx`, `App.tsx` (carga de mapa, fila), `Menu.tsx` | Capturas em `e2e/out/capturas/depois/`, comparáveis às de `antes/` | testado no laboratório |
| U2 | GSAP para sequências, CSS para microinterações, redução de movimento, limpeza | `ui/motion.ts` (`gsap.context` + `revert`; preferência do sistema ou opção "Reduzir animações da interface") | Uso no lobby, no resultado, na contagem de entregas e no Mutirão; opção persistida e testada | testado no laboratório |
| U3 | Composição própria de celular (deitado e em pé), áreas seguras, alvos de 48 px | Lobby em abas com ação fixa; HUD de toque (`[data-device='toque']`); `env(safe-area-inset-*)` | Capturas com celular **emulado** (844 × 390 e 390 × 844). Corrige a sobreposição vista nas capturas "antes" | testado no laboratório (sem aparelho) |
| C1 | Duas bases humanas, escolha cosmética sincronizada pelo servidor, mesma hitbox (§6) | `CharacterView.ts`; `APPEARANCE_IDS` e `lobby.appearance` (enum estrito, só no lobby) | `network.test.ts`; vitrine `e2e/vitrine.mjs` | testado no laboratório |
| C2 | Cor de equipe só em roupa, equipamento e efeitos | Materiais de pele, olhos e cabelo fixos; equipe só em camiseta/jardineira, faixa, tênis, tanque e ferramenta | Vitrine (8 aparências × 2 equipes) | testado no laboratório |
| C3 | Animações de espera, corrida, salto, pouso, disparo, ferramenta, transição, dano, eliminação e celebração; Forma Pião reinterpretada | Pião de madeira pintado, com quem está dentro espiando | Vitrine com 10 poses | testado no laboratório |
| A1 | Materiais, caixas, coberturas, referências brasileiras, mural do Ara, arara ambiental, props reutilizáveis (§7.4) | `props.ts`, `Environment.ts`, materiais novos no shader | `e2e/mapas.mjs` (visão geral, base, centro, lateral e muro das 6 variantes) | testado no laboratório |
| M1 | Toca do Ara e Clube da Maré jogáveis e distintos (§7.1–7.2) | `maps/tocaDoAra.ts`, `maps/clubeDaMare.ts`, kit de peças | `map.test.ts`, partidas nos E2E, capturas | testado no laboratório |
| M2 | Variantes compacta, padrão e ampliada; `mapId`, variante e hash pelo servidor; carga antes da contagem (§7.3) | `variantFor`/`mapFor`, `CATALOG_HASH`, `ensureMap` no cliente | `map.test.ts` (6 variantes), `network.test.ts`, E2E | testado no laboratório |
| F1 | Formação 1 × 1 a 8 × 8; Flex e limites fixos; ímpares, bots, fila, entrada tardia, reconexão (§9) | `formation.ts`; plano no lobby; fila com prioridade | `formation.test.ts` (17), `network.test.ts` (20 na sala, fila, plano) | testado no laboratório |
| G1 | Correio do Ara completo, com estados explícitos (§8.2) | `CorreioMode` | `modes.test.ts` (inclui bots entregando no mapa real) | testado no laboratório |
| G2 | Buffs Embalo e Fôlego (§8.3) | `BuffPickups`; multiplicadores no estado previsto | `modes.test.ts` | testado no laboratório |
| G3 | Combo Mutirão (§8.4) | `MutiraoTracker` | `modes.test.ts` | testado no laboratório |
| G4 | Treino evoluído para os novos modos e mecânicas, sem sistema paralelo | Treino v2 no mesmo `tutorial.ts` | `tutorial.test.ts`, `e2e/tutorial.mjs` | testado no laboratório |
| G5 | Balanceamento com pessoas (playtest) | — | — | bloqueado externamente |
| S1 | Configurações de qualidade, resolução interna, efeitos e volumes com efeito real; persistência e migração | Preferências v2 com `resolution`, `postFx`, `particles` e `reduceMotion`, aplicadas no runtime | `gamepad.test.ts` (saneamento) | testado no laboratório |
| P1 | Desempenho medido antes e depois; sessões longas; limpeza de recursos | `e2e/desempenho.mjs`, `scripts/bench-tick.ts`, LOD por distância | [performance.md](performance.md#execução-autônoma-antes-e-depois-24092026) | testado no laboratório (SwiftShader) |
| P2 | 60 FPS em GPU real; rede adversa real | — | — | bloqueado externamente |
| E1 | Script agregador de validação executado | `scripts/validar.mjs` (`pnpm validar`) | [testing.md](testing.md) | testado no laboratório |

## Decisões tomadas

- **Pátio da Olaria → Toca do Ara.** O briefing permite que a Toca nasça do Pátio. A praça
  com passagem de baixo, a varanda e as bases com quatro saídas foram preservadas. A
  identidade nova vem da oficina de reboco (no lugar do forno), dos cobogós, do mural e
  totem do Ara, da arara ambiental e da vegetação. O Pátio saiu do catálogo; o histórico do
  Git o preserva.
- **Variantes autorais, não escala.** Cada variante tem geometria própria, montada com o
  kit, e passa pelos mesmos testes de desenho.
- **Hash do catálogo no ingresso e hash da variante no carregamento.** O cliente precisa de
  todas as variantes na mesma versão para carregar qualquer escolha do servidor.
- **Troca de mapa recriando a cena.** O motor de áudio desbloqueado é reaproveitado; as
  mensagens de tinta e de fase esperam em fila durante a troca, e os snapshots de posição
  são descartáveis.
- **Buffs no estado previsto.** Os multiplicadores vão no snapshot próprio, para a
  previsão local andar igual ao servidor.
- **Piscina vazia e cobogó sólido.** O briefing não pede física aquática, e a decoração não
  pode sugerir cobertura inexistente.
- **Decoração que cobriria tinta foi descartada** (escada, boias, pintura no deck); a placa da
  oficina fica acima do telhado.
- **Correção de física encontrada no caminho.** O controlador do Rapier 0.20 deixava o
  personagem parado afundar no piso em pontos da diagonal x = z. Foi corrigido com uma
  correção determinística de penetração em `CharacterBody.move`, compartilhada por servidor
  e previsão, com teste de regressão.
- **LOD por distância** nos personagens, para caber 16 em campo.
- **Animação solta só na apresentação.** O pedido de movimento de boneco de posto foi
  implementado como uma camada de molas depois da pose base. Ela não muda raiz, rumo nem
  hitbox, e um fator de foco reduz o exagero a 20% durante mira, disparo e ações de
  precisão. Na vitrine, em SwiftShader, a camada responde: a freada dispara a derrapada, a
  curva gera atraso e torção, o squash chega a 0,26 numa queda de 1,5 m e o foco fica em 1
  no disparo. Os testes e o E2E de partida passaram. **Não foi avaliada por pessoas
  jogando**, então a intensidade é de protótipo.
- **Validação numa worktree isolada** do commit, com pilha própria em portas livres: valida
  o que está commitado e não interfere na pilha de desenvolvimento.

## Voz: diagnóstico (24/09/2026)

**Método:** `e2e/voz-diagnostico.mjs` amostra a cada 50 ms, na janela da Ana, as camadas
abaixo para o participante Bruno. Nada é injetado.

| Camada | O que é medido |
|---|---|
| Nível de saída | `media-source.audioLevel` do microfone do Bruno e bytes enviados |
| Nível recebido | `inbound-rtp.audioLevel` na Ana |
| Host | `isSpeaking` que o SFU envia ao host |
| Bridge | `VoiceState` que chega ao jogo |
| Tela | Indicador renderizado (lobby ou placar) |

**Resultados:**
- **Com o bipe padrão do Chromium** (10 execuções entre as rodadas de diagnóstico):
  - O áudio **chega à Ana em nível alto** em todas: acima de 0,01 em ~90% das amostras,
    máximo 1,0.
  - Mesmo assim, o "falando" do **host** fica bimodal por sessão: ~95% em algumas e 0–10%
    em outras.
  - O **bridge** e a **tela** seguiram o host em todas as amostras do lobby
    (`bridgeSemTela = 0`).
- **Causa localizada no SFU**, pelo código do LiveKit v1.13.7
  (`pkg/sfu/audio/audiolevel.go`):
  - o "falando" usa o nível do cabeçalho RTP `ssrc-audio-level`;
  - a regra é ≥ −35 dBov em ≥ 40% de cada janela de 400 ms;
  - a duração vem do delta de timestamp RTP.

  O bipe periódico fica na borda dessa regra. **Não é** atraso no bridge, no `userId` nem
  na interface.
- **Com fala sintética reproduzível** (`e2e/fala-sintetica.mjs`, 5 execuções):
  - o host marcou "falando" em 74–89% do tempo nas 5, com trocas nas pausas entre sílabas e
    de respiração, como fala real;
  - o lobby seguiu o host (0 divergências);
  - na partida, até 8 amostras (~400 ms) de atraso da tela em relação ao bridge, por causa
    da atualização do HUD sob SwiftShader.
- **Mudança de comportamento:** a fala real tem pausas, então o indicador ganhou "ataque
  rápido, saída suavizada": liga na hora, desliga 350 ms depois da última fala e desliga
  imediatamente ao silenciar (`SpeakingSmoother`).

### Repetições registradas (LiveKit local `--dev`, mídia SIMULADA, SwiftShader)

Todas as execuções entram na conta, inclusive as falhas. A pilha usada fica congelada num
worktree do commit `13e8e95`, em portas próprias (3001/5174/2568). Assim, a edição do código
durante o teste não recarrega as páginas.

| Entrada | Execuções completas | Falhas |
|---|---|---|
| Fala sintética reproduzível (`e2e/fala-sintetica.mjs`) | **10/10** | — |
| Bipe padrão do Chromium | **2/5** | 3 execuções: o ponto de fala do placar não acendeu na partida; em 2 delas também não acendeu ao reabrir a Atividade |

- As falhas com o bipe repetem o padrão bimodal do "falando" no SFU, descrito acima.
- As verificações de mudo, de associação por `userId` e de fechamento passaram em todas as
  execuções.
- **Execução descartada:** uma rodada anterior de repetições foi feita contra o servidor de
  desenvolvimento com recarga automática, enquanto o código era editado. Ela teve 4/6 antes
  de ser interrompida. Não serve como evidência: as páginas recarregavam no meio do teste.
  Por isso foi criado o worktree congelado.
- **Não validado em ambiente real:** a mídia é simulada e o SFU é local. O comportamento com
  microfones e redes reais continua dependente do SFU do Trivo.

## Checkpoints

- **CP0** (`c9b275e`): serviços locais de pé (LiveKit local `--dev`, servidor, cliente e
  host). Capturas "antes" em `e2e/out/capturas/antes/`.
- **CP1** (`b72ce05`, `13e8e95`): voz diagnosticada; testes determinísticos e de mídia
  separados; repetições registradas.
- **CP2** (`1d67985`): personagens com duas bases e aparência sincronizada.
- **CP3** (`5c58626`, `4a0276a`, `db6b9df`): mapas e variantes, formação, modos, buffs,
  Mutirão, servidor e cliente integrados; 202 testes.
- **CP4** (`990935c`): cenário (mural, totem, arara, props).
- **CP5** (`0b9cca5`, `c6a180c`): interface redesenhada, composição de toque, vídeo com
  efeito real; E2E atualizados.
- **CP6** (`e32ce54` e seguintes): desempenho medido, validação agregada executada e
  documentação.

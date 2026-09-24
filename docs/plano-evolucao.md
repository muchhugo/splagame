# Plano de evolução: briefing mestre de redesign

Referência: *TRIVO_GAME_REDESIGN_E_EVOLUCAO.md* (24/09/2026) e o complemento *Gamepad +
revisão da arquitetura LiveKit*. O jogo **evolui**, não recomeça: Babylon.js, React/Vite,
Rapier e Colyseus continuam, porque não há problema concreto que justifique trocar (ver
[livekit-transporte.md](livekit-transporte.md) sobre o transporte). O nome **Borrifo** segue
provisório; pacotes, IDs e protocolo não foram renomeados.

Legenda de estado (a do briefing):
- **implementado:** o código existe e roda;
- **testado no laboratório:** exercitado por teste automatizado ou E2E neste repositório,
  com o host fictício, LiveKit local e mídia simulada quando indicado;
- **validado no ambiente real:** no Trivo, em aparelho físico ou com chamada real. **Nada
  desta lista chegou a esse estado**, porque este repositório não tem acesso ao Trivo nem a
  aparelhos;
- **pendente.**

## Fases, dependências e arquivos

| Fase | Trabalho | Depende de | Onde mexe | Estado |
|---|---|---|---|---|
| 0: inspeção e linha de base | Scripts, build e testes; limites fixos (4×4); custos visuais | — | — | **feito**: 105 testes, typecheck, build e E2E rodados nesta entrega (ver [testing.md](testing.md)) |
| 1: identidade e UI | Tokens do Trivo e design system; motion; lobby, HUD, menus, resultado; composição mobile | SVG do logo (recebido) | `packages/game-content/src/palette.ts`, `apps/game-client/src/ui/*`, `styles.css` | **em andamento**: tokens em três conjuntos, pares de cores escolhidos pelo servidor, botões e barra de carga com a marca e controles adaptativos estão implementados e testados. **Pendente:** redesign completo das telas, GSAP, composição mobile própria e capturas de celular real |
| 2: personagens e mundo | Duas bases humanas, transformação, materiais, decoração brasileira, arara ambiental | 1 (tokens de cenário) | `CharacterView.ts`, `Environment.ts`, `game-content/maps` | **pendente**. Os tokens de cenário existem, e as bandeirinhas já os usam |
| 3: perfis e voz | Apelido contextual, avatar, vínculo de identidade, indicadores, controles delegados, reconexão | Contrato do host | `game-contracts/credential.ts`, `activity-sdk/protocol.ts`, `game-server/auth.ts`, `ArenaRoom.ts`, `app/profiles.ts`, `Avatar.tsx`, nomes no 3D | **testado no laboratório**: regra de nome, avatar com lista de hosts permitidos, `userId` no lobby e na voz, indicador de fala no lobby e no placar, nomes sobre personagens sem revelar escondidos, fechar mantém a chamada. **Pendente:** nomes iguais em contas distintas (existe no servidor, sem teste dedicado), avatar real do Trivo e chamada com microfone físico |
| 4: mapas e formação flexível | Toca do Ara, Clube da Maré, variantes, 1×1 a 8×8 | 2 | `game-content/maps`, `game-simulation`, `ArenaRoom.ts` | **pendente** |
| 5: mecânicas e aprendizado | Correio do Ara, Embalo/Fôlego, Mutirão, bots, **tutorial** | 4 | `game-simulation`, `game-content`, `app/tutorial.ts` | **tutorial testado no laboratório** (9 etapas detectadas pelo jogo; teclado, controle simulado e toque emulado). **Pendente:** Correio do Ara, buffs e Mutirão |
| 6: acabamento e validação | Perfil automático, toque, sessões longas, rede adversa, acessibilidade | Todas | — | **pendente**. Benchmark de transporte feito em loopback |

Complemento (gamepad e LiveKit):

| Item | Estado |
|---|---|
| Gamepad (§1–5) | **Testado no laboratório** com controle **simulado**. Cobre: famílias e glifos, conexão e desconexão, troca de dispositivo sem pausa, remapeamento sem conflito, zonas mortas, curva, sensibilidade X/Y, inversão, vibração limitada, mira assistida leve, navegação de menus, mapa pelo controle e preferências v2 com migração. **Não validado** com controle físico, no Electron ou no celular |
| Tutorial adaptativo (§6) | **Testado no laboratório** (ver acima) |
| Revisão LiveKit (§7–13, §18–19) | **Feita**: pesquisa com fontes, benchmark isolado de 2/4/8/16 jogadores e decisão **manter o Colyseus**. Ver [livekit-transporte.md](livekit-transporte.md) |
| Posse da chamada pelo host (§14) | **Testado no laboratório** (`e2e/voz.mjs`) |
| Perfis e nome (§15) e indicador de fala (§16) | **Testado no laboratório** |
| 60 FPS com voz (§17) | **Pendente**: só SwiftShader. O impacto dos dados sobre a voz no SFU foi medido (sem cortes) |

## Próximos passos, em ordem

1. **Fase 1, restante:**
   - redesign de composição (lobby com prévia do mapa, placar social para 16 jogadores,
     resultados com contribuição individual);
   - motion com GSAP só onde coordenar sequências valer a pena;
   - layout de celular próprio, com alvos de 44 a 48 px e áreas seguras.

   Precisa de uma captura em celular físico para validar.
2. **Fase 2:** as duas bases de personagem e a arara ambiental, com as cores de
   `SCENERY_TOKENS`. O teste já garante distância das cores de equipe.
3. **Fase 4:** mapas como dados (`MapSpec`), `mapId`, variante e hash escolhidos pelo
   servidor. A capacidade flexível exige revisar `MAX_TEAM_SIZE`, os spawns, o placar e a
   banda: o snapshot com 16 jogadores fica perto de 1 KB.
4. **Fase 5:** Correio do Ara e buffs na `MatchSimulation`, com testes de posse e entrega
   únicas.
5. **Validação real:**
   - Trivo com JWKS;
   - chamada com microfone físico;
   - controle físico (Xbox, DualSense e genérico) no Chrome, no Electron e no celular;
   - matriz de 60 FPS.

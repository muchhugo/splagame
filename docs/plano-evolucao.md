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

Estado em 24/09/2026, depois da execução autônoma. A matriz detalhada, com evidência por
requisito, está em [execucao-autonoma.md](execucao-autonoma.md).

| Fase | Trabalho | Estado |
|---|---|---|
| 0: inspeção e linha de base | Scripts, build, testes; limites; custos visuais | **testado no laboratório**. Capturas "antes" em `e2e/out/capturas/antes/`, medição de desempenho da linha de base |
| 1: identidade e UI | Tokens; motion; lobby, HUD, menus, resultado; composição mobile | **testado no laboratório**. Lobby com opções e formação real, HUD dos modos, carga de mapa, resultado por modo, GSAP com redução de movimento, abas no celular e HUD de toque próprio. Capturas desktop e celular **emulado**. Sem celular físico |
| 2: personagens e mundo | Duas bases humanas, Forma Pião, cenário brasileiro, arara | **testado no laboratório**: vitrine de poses (`e2e/vitrine.mjs`), aparência sincronizada pelo servidor, props reutilizáveis, mural, totem e arara ambiental (capturas `e2e/mapas.mjs`) |
| 3: perfis e voz | Apelido, avatar, vínculo, indicadores, delegação, reconexão | **testado no laboratório**. Voz: diagnóstico por camadas, teste determinístico pelo bridge (nomes iguais), fala sintética 10/10 e bipe 2/5 com LiveKit local. Sem microfone físico nem Trivo real |
| 4: mapas e formação | Toca do Ara, Clube da Maré, variantes, 1 × 1 a 8 × 8 | **testado no laboratório**: 6 variantes com testes de desenho, seleção pelo servidor com hash, formação pura testada, fila e bots |
| 5: mecânicas e aprendizado | Correio do Ara, Embalo/Fôlego, Mutirão, bots, treino | **testado no laboratório**: simulação com testes de regra, bots entregando, HUD e treino v2. Balanceamento de protótipo, sem playtest com pessoas |
| 6: acabamento e validação | Desempenho, sessões longas, rede, acessibilidade, validação | **testado no laboratório (parcial)**: `pnpm validar`, desempenho antes/depois (SwiftShader), tick do servidor com 16. Pendentes em ambiente real: GPU, celular, controle físico, rede adversa real e revisão de acessibilidade com usuários |

Complemento (gamepad e LiveKit): os estados da tabela anterior continuam valendo. Controle
**simulado**, LiveKit **local**, e nenhum aparelho físico.

## O que continua fora do alcance deste repositório

- Trivo real (JWKS, perfis e chamada reais);
- aparelhos físicos (celular, controles Xbox, DualSense e genérico, Electron);
- GPU real: não há afirmação de 60 FPS; os números de quadro são de SwiftShader, que é CPU;
- playtest com pessoas, para balancear distâncias, tempos e bônus.

# 0014: Controle pela Web Gamepad API, lido a ~8 ms, com glifos por família

**Contexto.** O complemento pede gamepad como entrada de primeira classe:
- Xbox, PlayStation e genéricos, por USB ou Bluetooth, no navegador, no Electron e no celular;
- detecção de conexão, troca de dispositivo sem pausar e dicas com o botão certo;
- remapeamento, vibração controlada e mira assistida leve.

**Decisão.**
- **Leitura:** um `GamepadHub` por página faz *polling* de `navigator.getGamepads()` a cada
  ~8 ms quando há controle (500 ms quando não há), independente do FPS. A API não tem
  eventos de botão, e ler só no `requestAnimationFrame` perdia toques rápidos em quadros
  lentos; o E2E com SwiftShader mostrou isso. Os gatilhos analógicos usam histerese
  (0,40 para apertar, 0,25 para soltar). O estado é atualizado antes de emitir as bordas.
- **Posição física:** os botões seguem o *standard mapping* do W3C. A família (Xbox,
  PlayStation, Nintendo, genérica) sai do `Gamepad.id` e muda só os **rótulos**. No Nintendo,
  confirmar e voltar trocam de lado. Um controle sem mapeamento padrão gera aviso e uma
  leitura ao vivo na aba Controle.
- **Onde age:** o InputManager soma teclado, toque e controle sem exclusão. O controle só age
  com a partida visível e sem menu; fora disso, a navegação de interface (espacial, com
  repetição) usa o mesmo hub.
- **Mira assistida:**
  - fricção perto do alvo e magnetismo pequeno só quando há entrada do jogador;
  - só alvos que o cliente já desenha (vivos, fora da tinta, sem proteção, com linha de
    visão);
  - ajustável e desligável; o servidor continua validando tudo.
- **Vibração:** `dual-rumble` curto. Cada tipo tem intervalo mínimo e a janela de 1 s fica
  abaixo de 45% de uso: nunca vibra continuamente, nem a cada gota da rajada.
- **Preferências:** v2 com esquema validado e migração da v1; remapear para um botão ocupado
  troca as duas ações.

**Consequência.** Testado com um controle **simulado** no Chromium (`e2e/gamepad.mjs`). Falta
validar com controles físicos (Xbox, DualSense, genérico), no Electron e no celular, e ver se
o navegador aceita o botão do controle como gesto para destravar o áudio. Iframes de outra
origem precisam de `allow="gamepad"`, que o host de laboratório já declara.

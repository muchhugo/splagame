# 0015 — Cada entrada é simulada uma vez e na ordem (esperar e recuperar)

**Contexto.** O servidor avança a 30 Hz e consome uma entrada por tick. Quando a fila
esvaziava, ele repetia a última entrada e, quando as atrasadas chegavam, descartava o
movimento das excedentes. O total de passos batia, mas o **caminho** mudava: a previsão
do cliente simula cada entrada uma vez, na ordem, e passava a divergir do servidor. Na
bancada de previsão (`apps/game-client/test/predictionHarness.ts`, servidor e cliente no
mesmo processo, relógio emulado), isso deu correção p95 de 0,18 a 0,42 m com 30 fps e
80–150 ms de jitter, e de 0,37 m a 10 fps mesmo sem latência. O cliente também perdia
tempo em quadros acima de 100 ms (teto do passo fixo), e o servidor tinha de inventar
esses ticks.

**Decisão.**

- Fila vazia: o servidor **espera** até `INPUT_HOLD_TICKS` (15 ticks, 500 ms) sem simular
  o jogador e soma um tick de atraso (`holdDebt`, teto `INPUT_HOLD_DEBT_MAX` = 20).
- Com atraso e entrada na fila, simula **um passo extra por tick** até zerar o atraso.
- Passos + atraso = ticks decorridos: nunca há ganho de velocidade. Atraso acima do teto
  é tempo que o cliente nunca simulou; é perdoado (não vira parada nem repetição).
- Sem entrada por mais de 15 ticks (queda de verdade), volta a política anterior: repete
  por pouco tempo e depois neutraliza.
- Fila de 16 entradas (`INPUT_QUEUE_MAX`), para caber a rajada de um quadro lento.
- Cliente: a previsão aproveita até 500 ms de um quadro (15 passos), sem perder tempo.
- Cliente: prevê com a entrada **exatamente** como o servidor a decodifica
  (`decodeInput(encodeInput(...))`, mira em milirradianos). Um milésimo de radiano bastava
  para o controlador de personagem decidir diferente numa quina.
- O próprio estado (`SelfSnapshot`) vai sem arredondar (o msgpack já manda float64), com o
  teto de velocidade no ar (`ac`) e os ticks exatos do buff (`bk`); os pickups mandam os
  ticks exatos até aparecer (`tk`).

**Autoridade.** Não muda: o servidor continua simulando tudo, validando e limitando
entradas; só a hora em que cada entrada é consumida mudou.

**Consequências.**

- Na bancada, com 30, 10 e ~5 fps e 80/150 ms com jitter: p95 0,00 m (antes 0,18 a
  0,42 m).
- No navegador (proxy com atraso, SwiftShader a ~5–10 fps): correções acima de 5 cm por
  12 s caíram de ~100 para 0/3/8 (0/80/150 ms), com p95 0.
- Contadores por jogador no log `round.input_stats` (esperas, recuperações, repetições,
  descartes, estouros, neutros, descartes por taxa).
- Custo: um jogador com cliente travado aparece parado para os outros por até 500 ms e
  depois recupera a até 2× por até 20 ticks. Antes ele seguia a última entrada, que
  depois era corrigida.
- "Segurar e despejar" não dá vantagem de velocidade (teste em `match.test.ts`); pode dar
  um avanço visível de até 2× por menos de 0,7 s.
- A física continua **não** garantida como determinística entre navegador e servidor
  (WASM do Rapier é determinístico com as mesmas entradas e o mesmo estado; é isso que as
  mudanças acima garantem, mas não foi provado em outros navegadores e CPUs).

# 0009 — Rapier compat no servidor e no cliente, com reconciliação

**Contexto.** O movimento (degraus, rampas, escalada, borda) precisa ser idêntico o bastante
entre servidor e cliente para a previsão não corrigir o tempo todo. Uma segunda engine de
física no cliente seria proibida pelo briefing.

**Decisão.** `@dimforge/rapier3d-compat` 0.20 (WASM embutido) em `packages/game-simulation`,
usado pelo servidor e pelo cliente com o mesmo `MapSpec` e a mesma `stepPlayer`
(`KinematicCharacterController`). O determinismo entre plataformas **não** é assumido: o
cliente reconcilia com o estado autoritativo e suaviza a diferença.

**Consequência.** Correções medidas de 6 a 14 mm ao caminhar no laboratório. O WASM embutido
soma ~1,1 MB gzip ao bundle.

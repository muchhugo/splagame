# 0003 — Mensagens simples e tinta em binário próprio, sem `Schema` do Colyseus

**Contexto.** O `Schema` do Colyseus sincroniza estado por diff automático. O estado deste jogo
é dominado pela tinta (72 mil células), que precisa de versão por chunk, snapshot e
ressincronização explícitos. Os jogadores precisam de snapshots compactos a 15 Hz com `ack` por
cliente para a reconciliação.

**Decisão.** Protocolo próprio em `packages/game-contracts`: mensagens de controle validadas por
zod, snapshots em objetos compactos (tuplas, centímetros e milirradianos) e tinta em binário
(`encodePaintSnapshot` com RLE e `encodePaintDelta`), enviada com `sendBytes`.

**Consequência.** Controle total do formato e da banda (~92 kbit/s por cliente medidos), e
testes da codificação sem servidor. Em troca, o projeto mantém o próprio versionamento
(`GAMEPLAY_PROTOCOL_VERSION`).

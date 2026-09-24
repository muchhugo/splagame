# 0007 — Sem colisão física entre jogadores

**Contexto.** Colisão entre cápsulas de jogadores complica a previsão (o cliente não conhece a
posição futura dos outros) e gera bloqueios em corredores e rampas.

**Decisão.** Os grupos de colisão do Rapier fazem os personagens colidirem só com o mundo
(`WORLD`), não entre si (`PLAYER`). Os acertos continuam usando cilindros de acerto.

**Consequência.** A previsão local fica estável e ninguém fica preso atrás de um aliado.
Jogadores podem se sobrepor visualmente; o personagem colado na câmera é esmaecido para não
tapar a mira.

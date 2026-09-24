# 0012: Gameplay continua no Colyseus; LiveKit só para a voz do host

**Contexto.** O complemento pediu avaliar se o LiveKit, que o Trivo já usa para voz, poderia
levar o gameplay (Data Packets, Data Streams, RPC, data tracks), no desenho *Client → LiveKit
Data → Game Authority Service → MatchSimulation*, sem assumir que o LiveKit é um servidor de
jogo e sem decidir só para reduzir dependências.

**Decisão.** Manter o Colyseus como servidor autoritativo e transporte. O LiveKit fica só na
voz, que é do host; a Atividade recebe o `VoiceState` pelo bridge. O benchmark isolado
(`tools/bench-transport`) fica no repositório para reavaliar com rede real.

**Por quê** (detalhes e fontes em [livekit-transporte.md](../livekit-transporte.md)):
- O LiveKit não oferece simulação autoritativa. A autoridade continuaria necessária; só o
  transporte mudaria.
- Em loopback, com 16 jogadores, o LiveKit teve snapshot p99 de 20 ms e RTT p99 de 26 ms,
  contra menos de 1,5 ms do Colyseus, e gastou muito mais CPU no conjunto. Não houve perda,
  e a voz no mesmo SFU não teve cortes.
- Usar o LiveKit no iframe exigiria passar o `Room` (proibido), abrir uma segunda conexão
  por jogador na sala da chamada ou fazer um túnel pelo host.
- O `@livekit/rtc-node` 1.1.0 não tem data tracks. Dado enviado pelo servidor chega sem
  identidade. O full reconnect zera o canal confiável.

**Consequência.** Nenhuma migração. A comparação deve ser refeita com clientes em navegador
numa rede real, com netem, e no LiveKit Cloud de teste, antes de qualquer mudança. A
implementação atual não será removida sem uma alternativa comprovada.

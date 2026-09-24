# 0004 — Sem compensação de latência no primeiro marco

**Contexto.** A compensação de latência (rebobinar a posição dos alvos até o instante em que o
atirador viu) melhora a sensação sob latência, mas cria casos como "morrer atrás da parede" e
exige histórico de posições e limites de rebobinagem.

**Decisão.** Os acertos são calculados no presente, no servidor. Os projéteis do jogo têm tempo
de voo visível, o que já pede antecipação do alvo.

**Consequência.** É simples e justo com quem é atingido. Com latência alta, quem atira precisa
liderar mais o alvo. **Não foi testado sob latência real.** Rever depois de medir com rede
emulada.

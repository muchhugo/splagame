# Testes

Todos os resultados abaixo foram obtidos **executando** os comandos neste ambiente, em
24/09/2026: container Linux 6.18, Node 22.22.2, pnpm 10.33.0, Intel Xeon 2,1 GHz com 4
núcleos, Chromium 141 (Playwright 1.56.1) com renderização por CPU (SwiftShader), **sem GPU**.

## Como rodar

```bash
pnpm test          # vitest: unidade + integração pelo transporte real (≈18 s)
pnpm typecheck     # tsc estrito em todos os pacotes
pnpm dev           # (outro terminal) necessário para os testes de navegador
pnpm e2e           # Playwright: host ⇄ Atividade e partida com dois navegadores
E2E_SWIFTSHADER=1 pnpm e2e   # sem GPU (containers/CI)
pnpm --filter @borrifo/game-server load-test   # carga local, ver performance.md
```

Os testes de navegador usam o build de desenvolvimento (que expõe `window.__borrifo` para
inspeção) e gravam capturas em `e2e/out/`.

## Resultado da última execução

`pnpm test`: **80 de 80 passaram**, em 9 arquivos. `pnpm typecheck`: sem erros nos 9 pacotes.
`pnpm e2e` (com `E2E_SWIFTSHADER=1`): **todas as verificações passaram** nos dois scripts.

| Arquivo | Testes | O que cobre |
|---|---|---|
| `packages/game-simulation/test/paint.test.ts` | 10 | área real com pegadas de objetos; células parciais com peso proporcional; paredes pintáveis que não pontuam; azulejo não pintável; impacto → célula nos limites; layout e hash determinísticos; pintura própria, neutra e inimiga com contadores exatos; respingo que não atravessa parede nem pinta a face de trás; pisos em alturas diferentes; snapshot + deltas reconstroem o estado; lacuna e versão pedem ressincronização; RLE compacto que rejeita dados corrompidos |
| `packages/game-simulation/test/movement.test.ts` | 14 | diagonal normalizada; não atravessa paredes nem acumula velocidade; não sobe degrau arbitrário; gravidade, pouso, sem salto duplo; custo, cadência e esgotamento do Esguicho; recarga só submerso na tinta própria; tinta inimiga bloqueia a regeneração; velocidades do fluxo; disparo durante o fluxo espera a transição; escalada com tinta própria e perda de aderência; saída pela borda sem teleporte; não escala com tinta só do outro lado; carga e cancelamento do Estilingue; balanço e arrasto do Rodo; requisitos da Moringa |
| `packages/game-simulation/test/match.test.ts` | 9 | eliminação e estatísticas; aliado não bloqueia nem sofre dano; tinta inimiga não letal; reaparecimento com proteção que não renova; explosão bloqueada por parede; carga do especial só por conquista; fechamento exatamente uma vez; empate real; política de entradas (sequência antiga, fila, entrada ausente); Pião-Guia (preparar, lançar, pousar, cancelar) |
| `packages/game-simulation/test/map.test.ts` | 5 | spawns livres e voltados a uma saída; áreas elevadas e passagem inferior alcançáveis; oito rampas de galpão; nenhuma linha de tiro da praça aos spawns no alcance máximo; simetria de área |
| `packages/game-contracts/test/input.test.ts` | 3 | ida e volta da entrada; limites; `NaN` e `Infinity`; campos extras e enums inválidos |
| `packages/activity-sdk/test/bridge.test.ts` | 8 | handshake (origem, janela pai, nonce); handshake sem resposta expira; pedido de credencial com correlação; capacidade inexistente; erro do backend sem vazar detalhes; mensagens malformadas e tipos desconhecidos descartados; timeout e fechamento limpo; eventos de contexto, visibilidade e voz validados |
| `apps/activity-shell/test/credential.test.ts` | 21 | claims do JWT de desenvolvimento; `jti` único; expiração de 60 s; outro segredo não valida; recusa `NODE_ENV=production`; ACL do canal (403); usuário fora do roster; segredo ausente ou curto; validade máxima; cookie de sessão (12 h) e separação de credencial; rate limit; configuração (LiveKit parcial, standalone desligado em produção); nonce no fragmento |
| `apps/game-server/test/room.test.ts` | 1 | 1 humano + 7 bots jogam uma rodada completa **pelo WebSocket real**; a réplica de tinta reconstruída no cliente confere exatamente com o resultado; resultado persistido uma vez |
| `apps/game-server/test/network.test.ts` | 9 | ingressos simultâneos na mesma sala com equipes equilibradas e anfitrião; bloqueio da 9ª pessoa; troca de equipe e comandos de anfitrião; credencial reutilizada, expirada, de outra sessão, de audiência ou emissor errado e sem permissão; rajada de ingresso (429) sem afetar a sala; queda de rede reconecta ao mesmo slot; reabrir com nova credencial retoma o slot; `NaN`, `Infinity`, payload enorme, tipos errados e comandos inventados não derrubam a sala; **8 clientes** jogam, recebem o mesmo resultado, ressincronizam e fazem revanche com tinta zerada; quem chega no meio da rodada espera a próxima |

### Testes de navegador (`e2e/`)

| Script | Verificações |
|---|---|
| `e2e/shell.mjs` | sandbox do iframe; sem câmera nem microfone; nonce no fragmento; handshake, credencial e lobby (≈4,6 s com SwiftShader); voz "não configurada"; fechar libera host, iframe e ouvintes; **abrir/fechar 10×** sem vazamento; usuário sem acesso vê o erro e o host registra `forbidden`; sem erros de página |
| `e2e/gameplay.mjs` | dois contextos de navegador (Ana e Bruno) no mesmo lobby; partida iniciada pela anfitriã; **hash de tinta idêntico** nas duas réplicas na mesma sequência (última execução: seq 91, unidades 33.933 e 38.148 nos dois); materiais limitados (154 → 164) e texturas estáveis (4 → 4) após ~30 s de jogo; aba oculta não renderiza e retoma ao voltar; sem erros de página |

### Verificação visual

Capturas pela **câmera real de gameplay**: spawn, praça, passagem inferior, topo da praça,
varanda e corredor sul, com o modo de inspeção `runtime.debugView` do build de
desenvolvimento, além de uma captura de jogo normal andando e atirando. Foram usadas para
corrigir: bandeirinhas cruzando a visão, letreiro visto de trás e com texto cortado, pedra
lilás, estátua virada para uma só equipe, fumaça rochosa e só numa chaminé, personagem colado
na câmera tapando a mira, tinta marrom na sombra, brilho estourado, poste bloqueando a visão e
spawn virado para a parede.

## O que **não** foi verificado

- **LiveKit real:** conexão, publicação e recepção de áudio, fala, reconexão de mídia e "fechar
  a Atividade mantém a chamada" com mídia real. Não havia servidor nem credenciais.
- **Trivo real:** nenhum teste contra o host real.
- **GPU real, FPS real, mobile, touch, Safari e Firefox:** só Chromium com SwiftShader.
- **Latência, jitter e perda de rede:** não houve emulação; cliente e servidor na mesma máquina.
- **Muitas salas simultâneas e processos múltiplos:** só uma sala por teste de carga.
- **Pessoas jogando:** o balanceamento foi ajustado só com bots.
- **Postgres/Drizzle:** não implementado (resultado em JSONL, ver ADR 0006).

Compilar sem erros de TypeScript não é tratado como prova de gameplay, integração, desempenho
ou segurança. Cada item acima só é dado como verificado quando foi exercitado.

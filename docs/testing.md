# Testes

Todos os resultados abaixo foram obtidos **executando** os comandos neste ambiente, em
24/09/2026: container Linux 6.18, Node 22.22.2, pnpm 10.33.0, Intel Xeon 2,1 GHz com 4
núcleos, Chromium 141 (Playwright 1.56.1) com renderização por CPU (SwiftShader), **sem GPU**.

## Como rodar

```bash
pnpm test          # vitest: unidade + integração pelo transporte real (≈18 s)
pnpm typecheck     # tsc estrito em todos os pacotes
pnpm dev           # (outro terminal) necessário para os testes de navegador
pnpm e2e           # Playwright: host ⇄ Atividade, 2 navegadores, controle (simulado), treino rápido e menus
pnpm e2e:audio     # Playwright: efeitos sonoros numa partida real (≈5 min) e cobertura por ferramenta
pnpm e2e:voz       # Playwright: voz pelo host com LiveKit LOCAL e mídia simulada (ver abaixo)
E2E_SWIFTSHADER=1 pnpm e2e   # sem GPU (containers/CI)
pnpm --filter @borrifo/game-server load-test   # carga local, ver performance.md
```

Os testes de navegador usam o build de desenvolvimento (que expõe `window.__borrifo` para
inspeção) e gravam capturas em `e2e/out/`.

`pnpm e2e:voz` precisa de um servidor LiveKit local (`livekit-server --dev --bind 127.0.0.1`)
e do host iniciado com `LIVEKIT_URL=ws://127.0.0.1:7880` e com as chaves de desenvolvimento
desse modo nas variáveis de ambiente, nunca no repositório. O `pnpm e2e` espera o host **sem**
LiveKit (verifica "voz não configurada").

O benchmark de transporte fica em `tools/bench-transport`; método e resultados estão em
[livekit-transporte.md](livekit-transporte.md).

## Validação agregada (`pnpm validar --voz --desempenho`)

Rodou em 24/09/2026, numa worktree isolada do commit `e32ce54`, com pilha própria em portas
livres. Usou SwiftShader, LiveKit local em `--dev` e mídia sintética. **Todas as 20 etapas
passaram.** O relatório de máquina fica em `e2e/out/validacao.json`, que não é versionado.

O aviso "com alterações não commitadas" do relatório vem do checkout principal, que na hora
tinha edições em andamento (a camada de animação solta). A worktree validou só o que estava
commitado.

| Etapa | Resultado |
|---|---|
| typecheck (todos os pacotes) | ok |
| vitest | **203 de 203** |
| build de produção | ok |
| vitrines de desenvolvimento fora do bundle | ok (83 arquivos no `dist`) |
| nenhum segredo do `.env` no bundle | ok |
| gancho `__borrifo` ausente em produção | ok |
| fixture e diagnóstico de voz ausentes do host de produção | ok (1472 KB de JS verificados) |
| credencial de desenvolvimento recusada em produção | ok |
| tick com 4, 8 e 16 participantes | p99 de 1,59, 2,0 e 2,17 ms (orçamento de 33,3 ms) |
| shell: host, iframe, handshake, credencial, fechamento | 9 verificações |
| partida com dois humanos, tinta idêntica, limpeza | 10 verificações |
| controle | 31 verificações |
| treino rápido v2 | 22 verificações |
| contrato de voz pelo bridge (mesmo nome, `userId`) | 11 verificações |
| capturas desktop e celular emulado | sem erros de página |
| desempenho do cliente 4×4 e 8×8 | ok ([performance.md](performance.md)) |
| voz com LiveKit local e fala sintética | **5 de 5 execuções completas** |

## Menus sobre a arena (24/09/2026)

Estes resultados vêm da pilha própria em portas livres (servidor, cliente e host), com
SwiftShader:

- `pnpm test`: **212 de 212**, em 18 arquivos. Os testes novos são `lobbySpot.test.ts`
  (palco nas 6 variantes), `appearance.test.ts` (formato, limites e recusa) e o caso de
  cabelo e cor em `network.test.ts`.
- `pnpm -r typecheck`: sem erros.
- `e2e/menus.mjs`: **todas as verificações passaram**. Na primeira execução, quatro
  verificações falharam; os ajustes foram:
  - o seletor de categoria pegava a aba do lobby atrás do diálogo (erro do teste);
  - as turmas só aparecem no 3 e no 2 da contagem (espera ajustada);
  - no celular, a área de giro cobria a alça da folha (**erro da interface**: a ordem das
    camadas foi corrigida);
  - o conteúdo de uma categoria ficava com opacidade 0 no SwiftShader (**erro da
    interface**: a animação de entrada perdeu a opacidade).
- Passaram também `gameplay.mjs`, `tutorial.mjs`, `shell.mjs` e `voz-interface.mjs`.
- `gamepad.mjs` passou, com RB/LB trocando as abas do lobby. Os comandos agora ficam na
  aba Partida.
- `personagens.mjs` passou com 8 aparências distintas numa partida 4 × 4. O teste foi
  atualizado: sozinho com bots, a formação flex é 1 × 1.
- `audio-cobertura.mjs`:
  - primeira execução: duas falhas. O Pião-Guia estava sem aliado (mesmo motivo do 1 × 1,
    teste atualizado para 4 × 4). A carga do Estilingue não soou (`false → false`).
  - isolado e na execução completa seguinte, **tudo passou**, carga incluída
    (`true → false`).
  - a causa da falha única da carga **não foi identificada**. Ela fica registrada aqui, e
    não como "intermitente".
- `capturas.mjs`: sem falhas; as capturas estão em `e2e/out/capturas/menus/`.
- `pnpm validar` (worktree isolada do commit `1e6fd69`, pilha própria em portas livres,
  sem voz nem desempenho): **19 de 19 etapas**. Inclui 212 testes, typecheck, build e as
  verificações de segurança do bundle. No navegador:
  - shell: 9 verificações;
  - partida: 10;
  - controle: 33;
  - treino: 22;
  - **menus: 48**;
  - voz pelo bridge: 11;
  - capturas: sem erros.


Resultados:
- `pnpm test`: **119 de 119 passaram**, em 14 arquivos.
- `pnpm typecheck`: sem erros nos 10 pacotes (inclui `tools/bench-transport`).
- `pnpm build`: ok.
- `pnpm e2e` (com `E2E_SWIFTSHADER=1`): **todas as verificações passaram** nos quatro scripts,
  com 72 verificações (`shell`, `gameplay`, `gamepad`, `tutorial`).
- `pnpm e2e:audio`: **todas passaram** (40 verificações).
- `pnpm e2e:voz`: 3 de 5 execuções completas; ver a tabela.

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
| `apps/game-client/test/gamepad.test.ts` | 18 | família pelo `Gamepad.id` (Xbox, PlayStation, Nintendo, genérico); glifos pela posição física; dicas "E"/"Y"/"△"/"Roda"; zona morta radial sem salto e sem "cruz"; curva de resposta; `GamepadHub` (conexão, bordas, gatilho com histerese, Bluetooth caindo sem evento, último controle assume); vibração nunca contínua; mira assistida (sem alvo nada, parado não puxa, fora da zona e do alcance ignora); preferências v2 (valores adulterados, migração da v1, JSON quebrado, remapear troca as ações); nomes sobre personagens não revelam escondidos; voz ligada por `userId`; iniciais e cor neutra; cores e nomes da rodada × acessibilidade |
| `apps/game-client/test/tutorial.test.ts` | 3 | cada etapa só avança com o gesto certo (disparar na Forma Pião não conta; horizonte não é "pintar o chão"); pular e encerrar; eliminado não avança |
| `packages/game-contracts/test/profile.test.ts` | 3 | prioridade apelido → nome de exibição → usuário; texto limpo (controle, direção, `<` `>`, 24 caracteres, emoji conta 1); avatar só https de host permitido, sem credencial na URL |
| `packages/game-content/test/palette.test.ts` | 12 | tokens de marca = preenchimentos exatos do SVG; por par, distância entre equipes (e sob daltonismo simulado), distância do cenário, da marca e do destaque, nomes; a arara do cenário longe de qualquer azul de equipe; rotação determinística do par |
| `apps/game-server/test/profiles.test.ts` | 3 | pelo servidor real: mesmo par de cores para toda a sala; nome resolvido, limpo e limitado; avatar filtrado (outro host, `javascript:`); apelido novo ao reconectar sem duplicar |
| `apps/game-server/test/network.test.ts` | 9 | ingressos simultâneos na mesma sala com equipes equilibradas e anfitrião; bloqueio da 9ª pessoa; troca de equipe e comandos de anfitrião; credencial reutilizada, expirada, de outra sessão, de audiência ou emissor errado e sem permissão; rajada de ingresso (429) sem afetar a sala; queda de rede reconecta ao mesmo slot; reabrir com nova credencial retoma o slot; `NaN`, `Infinity`, payload enorme, tipos errados e comandos inventados não derrubam a sala; **8 clientes** jogam, recebem o mesmo resultado, ressincronizam e fazem revanche com tinta zerada; quem chega no meio da rodada espera a próxima |

### Testes de navegador (`e2e/`)

| Script | Verificações |
|---|---|
| `e2e/shell.mjs` | sandbox do iframe; sem câmera nem microfone; nonce no fragmento; handshake, credencial e lobby (≈4,6 s com SwiftShader); voz "não configurada"; fechar libera host, iframe e ouvintes; **abrir/fechar 10×** sem vazamento; usuário sem acesso vê o erro e o host registra `forbidden`; sem erros de página |
| `e2e/audio.mjs` | numa partida real: 66 arquivos decodificados sem falha; menus tocam confirmar e voltar; "Silenciar o jogo" zera a saída; contagem soa 3 vezes e o início 1 vez; passos acompanham a animação; cada tiro previsto soa, sem passar da cadência do Esguicho; vozes simultâneas ≤ 24 (medido: 12); loop de nado liga sobre a tinta própria e para ao sair do fluxo; nenhum loop na tela de resultado; sino e jingle de resultado tocam uma vez; revanche segue tocando; ao sair, contexto fechado com 0 loops e 0 vozes; saída mixada **sem clipping** (pico de -2,8 dBFS), gravada em `e2e/out/audio-partida.wav` |
| `e2e/audio-cobertura.mjs` | todos os 35 efeitos e 5 loops do manifesto tocam a partir dos arquivos; acerto e eliminação próprios (eventos injetados no runtime) tocam o som certo uma vez; vitória, derrota e empate sem repetir; tanque baixo e tanque vazio; Pião-Guia (lançamento e pouso); carga do Estilingue soa e para ao soltar; balanço e arrasto do Rodo |
| `e2e/gamepad.mjs` | controle **simulado** (`navigator.getGamepads` falso) numa partida real, 31 verificações: "Controle conectado (Xbox)"; lobby com LS/RS/RT/Y; direcional move o foco; Menu e B abrem e fecham o menu; analógico esquerdo move (6,8 m em 1,5 s) e o direito gira a câmera; RT dispara; **1 pulso** de vibração no começo da rajada (45 ms, `dual-rumble`); HUD com RB; View segurado abre e fecha o mapa; teclado no meio da partida troca as dicas para Q sem pausar; desconectar e conectar um DualSense mostra os avisos e R1; Options, ↓ e ✕ abrem Configurações na aba Controle; R1/L1 trocam de aba; remapeamento salvo em `borrifo.settings.v2`, com troca em caso de conflito; restaurar padrão; testar vibração; sem erros |
| `e2e/tutorial.mjs` | o treino começa sozinho na primeira rodada sem pausar; texto por dispositivo ("W A S D" → "LS" → "Tab"); andar, girar a câmera, disparar, pintar o chão, Forma Pião e mapa concluídos pelo jogo de verdade; pular e encerrar; conclusão salva por versão; contexto **móvel emulado** com toque: "Arraste o Analógico", botão Mapa, mapa cabe na tela deitada, "Fechar" |
| `e2e/voz.mjs` | LiveKit **local** e mídia **simulada** do Chromium: dois usuários na mesma sala; apelido "Aninha"; o jogo não entra na chamada sozinho; microfone desligado ao entrar; participantes com `userId`; "microfone desligado" no lobby; Bruno liga o microfone e Ana vê o anel de fala **no Bruno**; na partida, o ponto do Bruno no placar indica fala; fechar a Atividade mantém Ana na chamada. Última série: **3 de 5 execuções** passaram tudo; nas outras 2, só o indicador no placar falhou dentro de 25 s, e a detecção de fala sobre o bipe do dispositivo falso é intermitente |
| `e2e/menus.mjs` | navegação **real** pelos menus sobre a arena, com dois navegadores na mesma sala e um celular emulado; detalhes em [menus.md](menus.md#validação) |
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

- **Chamada real:** só LiveKit **local** com mídia **simulada**. Nenhum microfone físico,
  ninguém ouvindo, nenhum LiveKit Cloud e nenhuma reconexão de mídia sob rede ruim.
- **Controle físico:** só o controle simulado. Faltam Xbox, DualSense e genérico reais, a
  vibração real e o botão como gesto de áudio.
- **Electron:** não testado.
- **Trivo real:** nenhum teste contra o host real.
- **GPU real, FPS real, mobile, touch real, Safari e Firefox:** só Chromium com SwiftShader. O
  toque foi exercitado num contexto móvel **emulado**, não num aparelho.
- **Latência, jitter e perda de rede:** não houve emulação; cliente e servidor na mesma máquina.
- **Muitas salas simultâneas e processos múltiplos:** só uma sala por teste de carga.
- **Pessoas jogando:** o balanceamento foi ajustado só com bots.
- **Postgres/Drizzle:** não implementado (resultado em JSONL, ver ADR 0006).
- **Escuta dos efeitos sonoros:** o ambiente não tem saída de áudio. A escolha e o equilíbrio
  foram feitos por espectrograma, forma de onda, análise melódica e medição de nível; a
  gravação da mixagem precisa ser ouvida por uma pessoa.

Compilar sem erros de TypeScript não é tratado como prova de gameplay, integração, desempenho
ou segurança. Cada item acima só é dado como verificado quando foi exercitado.

## Rede, banco e caça a bugs (25/09/2026)

Pilha própria em portas livres, SwiftShader:

- `pnpm test`: **219 de 219**, em 19 arquivos. Os testes novos cobrem a Roda de Oleiro
  (ondas, linha de visão, aliado, quebra por tiros), a cápsula largada por quem cai e a
  reposição do fluxo de entradas, a janela de reconexão que vence e vira bot, a entrada
  tardia no banco, a expulsão por abuso (80 INPUT inválidos) e a configuração do servidor
  (`config.test.ts`).
- `pnpm -r typecheck`: sem erros.
- `e2e/rede-adversa.mjs` (proxy TCP com atraso, jitter e picos de retransmissão; duas
  pessoas em zigue-zague por 12 s; cliente a 10 fps no SwiftShader):

  | RTT alvo | RTT medido | correção p95 | correção máx. | grandes (> 2,5 m) | remoto congelado | remoto extrapolado | buffer |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | 0 ms | 3 ms | 0,37 m | 0,40 m | 0 | 2,7% | 0% | 4,8 ticks |
  | 80 ms | 118 ms | 0,38 m | 0,61 m | 0 | 0% | 0% | 7,5 ticks |
  | 150 ms | 190 ms | 0,37 m | 0,53 m | 0 | 0% | 4,3% | 7,5 ticks |

  Antes do buffer adaptativo, os remotos ficavam congelados em 25,7% a 28,9% dos quadros
  com 80 e 150 ms. A correção p95 de ~0,37 m aparece até com RTT 0: a 10 fps o cliente
  manda entradas em rajadas, o servidor repete a última entrada e descarta o excesso, e
  as duas simulações divergem na troca de direção. Numa GPU real (60 fps) as rajadas
  somem; o número a conferir lá é esse.
- `e2e/banco.mjs`: **15 de 15**. Quem entra com a rodada em andamento vai para o banco,
  assiste ao vivo, troca quem acompanha e joga a revanche.
- `e2e/menus.mjs`: **todas as verificações passaram**. O trecho de celular agora é: em pé,
  a tela de girar; deitado, painel lateral, vitrine, ação principal sem sobreposição e
  todas as categorias das configurações alcançáveis. No 8 × 8, nenhuma etiqueta do palco
  fica em cima de outra. O "Valendo!" (1,3 s) é registrado por um observador na página,
  porque a captura de tela no SwiftShader pode durar mais que ele.
- Passaram também, um por vez: `gamepad.mjs`, `gameplay.mjs`, `tutorial.mjs`.


## Previsão local e política de entrada (25/09/2026)

**Bancada sem navegador** (`apps/game-client/test/prediction.test.ts` e
`predictionHarness.ts`): servidor (`MatchSimulation`) e cliente (`LocalPredictor`) no mesmo
processo, a entrada passando pelo mesmo codificador do fio, relógio emulado (quadros do
cliente, ticks do servidor, atraso e jitter da rede). Mede a correção de cada
reconciliação.

| Caso | Antes | Depois |
| --- | --- | --- |
| RTT 0, andando (estado arredondado em mm) | até 0,53 m, 8 correções > 5 cm | 0 |
| Pulos da tinta própria para o chão neutro, 150 ms | 20 > 5 cm, máx. 0,65 m | 0 |
| Embalo (coleta e fim), 150 ms | 33 > 5 cm, p95 0,37 m | 0 |
| 30 fps, 150 ms + jitter | p95 0,37 m, 45 > 25 cm | p95 0,00, 0 |
| 10 fps, 150 ms + jitter | p95 0,37 m, 70 > 25 cm | p95 0,00, 0 |
| ~5 fps (quadros medidos no laboratório), 150 ms + jitter | p95 0,42 m, 121 > 25 cm | p95 0,00, até 3 |

As quatro causas encontradas e corrigidas, em ordem de peso:

1. o servidor repetia a última entrada com a fila vazia e depois descartava as excedentes
   (o caminho divergia) → agora espera e recupera ([ADR 0015](decisions/0015-entrada-uma-vez-na-ordem.md));
2. a previsão usava a mira sem a quantização do fio;
3. o estado próprio chegava arredondado em milímetros (sem economizar banda);
4. faltavam o teto de velocidade no ar e os ticks exatos do buff e dos pickups.

A primeira medição da bancada parecia mostrar divergência mesmo sem latência: era a
bancada perdendo a primeira entrada no tick de contagem (corrigido na bancada, não no
jogo).

**No navegador** (`e2e/rede-adversa.mjs`, proxy TCP, SwiftShader a ~5–10 fps, 12 s de
zigue-zague de duas pessoas):

| RTT alvo | Antes: > 5 cm / p95 / máx. | Depois: > 5 cm / p95 / máx. |
| --- | --- | --- |
| 0 ms | 100 / 0,37 m / 0,40 m | 0 / 0 / 0 |
| 80 ms | 108 / 0,38 m / 0,61 m | 3 / 0 / 1,10 m |
| 150 ms | 56 / 0,37 m / 0,53 m | 8 / 0 / 0,81 m |

As poucas que sobram vêm de quadros acima de 500 ms no SwiftShader compartilhado (o
servidor registra 5 a 25 passos neutros por rodada em `round.input_stats`). Isso ainda
**não foi medido** numa GPU real nem num celular.

## Pilha própria para testes de navegador (25/09/2026)

`e2e/stack.mjs` sobe servidor de partidas, cliente Vite e um backend mínimo de credencial
(só o endpoint standalone de desenvolvimento, só para a origem do jogo da pilha). O
segredo de desenvolvimento é gerado na hora, e a pilha encerra os processos ao sair.
`node e2e/stack.mjs` a deixa de pé até Ctrl+C; `alocacoes.mjs` a usa por conta própria.
Com ela passaram (SwiftShader): `gameplay`, `tutorial`, `menus`, `banco`, `gamepad`,
`personagens` e `capturas`.

- `personagens.mjs`: o orçamento de malhas por personagem passou a ser medido em regime
  (três amostras, o mínimo de cada um). Na troca de forma as duas formas ficam ligadas por
  um instante, e uma amostra caiu nesse instante (44 > 40).
- `capturas.mjs`: a captura em pé só carrega a página (a tela de girar cobre a entrada).
- `pnpm test`: **244 de 244**.


## Resultados no PostgreSQL (25/09/2026)

- `apps/game-server/test/postgresSink.test.ts`: **5 de 5**, num PostgreSQL de verdade
  (PGlite, no processo) com as migrações de produção. Cobre idempotência, dez gravações
  simultâneas de dois "servidores" (uma linha), falha do banco, rodada completa pelo
  servidor real e regras de configuração.
- `pnpm test`: **249 de 249**. `pnpm -r typecheck`: sem erros.

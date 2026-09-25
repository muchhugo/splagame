# Menus sobre a arena

A interface fora da partida acontece **sobre o próprio mapa em 3D**. O lobby é o hub da
Atividade: o grupo aparece fisicamente na cena, e os painéis organizam a sala, a partida
e o personagem de cada pessoa.

Não há home tradicional com "jogar / equipamento / como jogar", e o jogo não tem XP,
carreira nem perfil próprio. A identidade social vem do Trivo: avatar, apelido
contextual, chamada e fala.

As referências visuais recebidas serviram para entender qualidade, hierarquia e a
integração entre interface e mundo 3D. Nomes, logo, ícones, tipografia e composição são
nossos. Os ícones estão em `ui/icons.tsx` (SVG desenhado aqui) e os tokens de cor vêm de
`styles.css` (cores da arara do Trivo e cores das turmas).

## Fluxo

1. **Abertura curta.** Na primeira entrada no lobby da sessão, a câmera faz um sobrevoo
   de cerca de 3,4 s, que termina no grupo, com o nome do lugar sobre a cena.
   - Qualquer tecla, clique, toque ou botão do controle pula a abertura.
   - "Reduzir animações" (ou a preferência do sistema) desliga o sobrevoo.
   - O sobrevoo usa o relógio real: em máquina lenta fica menos fluido, mas não mais longo.
2. **Lobby (hub).** Sobre a arena ficam:
   - no topo, o cartaz da próxima rodada (mapa, variante, modo, tamanho e bots);
   - à esquerda, o painel com as abas **Sala**, **Partida** e **Você**;
   - embaixo, a ação principal ("Estou pronto" ou "Começar partida"), com o contador de
     prontos.
3. **Entrada na rodada.**
   1. A interface **recolhe** para fora da tela, em vez de sumir.
   2. A câmera sai do palco num sobrevoo do mapa, com o cartaz do lugar e do modo.
   3. No começo da contagem, as duas turmas aparecem frente a frente, com os avatares.
   4. O número grande conta 3, 2, 1, enquanto a câmera desce e se mistura com a câmera do
      ombro em cerca de 1,4 s. O campo de visão também é interpolado até o da partida.
   5. Na largada, **"Valendo!"** aparece sobre um respingo desenhado aqui, na cor da sua
      turma.
   6. Tudo isso é sobreposição sem clique: o controle é do jogador desde a largada do
      servidor.
4. **Volta ao lobby.** Os bonecos da rodada saem de cena e o palco volta.

## Palco 3D (`render/LobbyStage.ts`, `render/lobbySpot.ts`)

**Onde fica.** O trecho do mapa é achado por raycast contra o mesmo cenário da física, e
por isso vale para qualquer mapa ou variante sem marcação manual. O trecho precisa ser:

- plano, sem nada acima (grade de topo com 0,5 m), sem decoração por perto e sem caixote
  entre dois pontos;
- visível, sem obstrução, a partir de **todas** as posições que a câmera usa:
  - a câmera geral, a duas distâncias e com os deslocamentos laterais do enquadramento;
  - a câmera da vitrine, a duas distâncias e duas alturas;
- dentro da arena, com a câmera dentro dos limites e sem decoração no caminho.

Os candidatos são pontuados antes (arena ao fundo, profundidade de visão, chão baixo) e
as câmeras (a parte cara) são conferidas só nos melhores. O custo vai de 15 a 120 ms por
mapa. Em mapas apertados, o palco encolhe em degraus (5 níveis). O teste
`apps/game-client/test/lobbySpot.test.ts` roda nas 6 variantes.

**Quem aparece.** Aparecem os humanos da formação real (sem a fila) e os bots
previstos, com as duas turmas lado a lado. A sua turma fica à esquerda, e você fica na
frente, sobre a **tampa de lata de tinta**, com o respingo da sua cor. Cada pessoa aparece
com a ferramenta e o visual que escolheu.

**Animação.**

- idle com a camada solta;
- quem fica pronto dá um pulinho e comemora;
- trocar a ferramenta faz uma pose de apresentação: jato, carga ou balanço, conforme a
  ferramenta;
- trocar o visual dá um "pop" de escala.

**Etiquetas.** Sobre cada cabeça fica uma etiqueta DOM projetada com avatar do Trivo,
nome em texto puro, anfitrião ou pronto, e um anel discreto quando a pessoa fala.

**Com muita gente.** O palco mostra até 5 pessoas por turma, ou 3 na qualidade baixa,
priorizando você, depois quem está pronto, depois as outras pessoas, e por último os bots.
A lista mostra todo mundo. No E2E, um 8 × 8 deixou 10 personagens no palco (6 só na lista),
com 347 malhas ativas.

**Câmera.**

- Movimento lento com leve balanço, amortecido, que reage suave às trocas de aba.
- Lente de 44° no grupo e 34° na vitrine; na partida, vale o campo de visão das
  configurações.
- O enquadramento desloca câmera e alvo juntos, para o grupo cair no espaço livre da
  interface: à direita no desktop e no celular deitado, em cima na janela estreita.

## Aba Você: o personagem de verdade

**Vitrine.** A câmera fecha no próprio personagem, em três quartos, sobre a tampa. O resto
do grupo sai do quadro. O personagem gira por arrasto (mouse ou dedo), pelos botões ⟲ ⟳
ou pelo analógico direito, com inércia curta.

**Ferramenta.** Três cartões grandes com ícone próprio. Ao escolher:

- o modelo 3D troca **na hora**, antes da resposta do servidor (`pendingWeapon`), e faz a
  pose;
- descrição e estatísticas mudam com movimento curto;
- o servidor confirma para todos logo em seguida.

**Visual.** Quatro escolhas:

- base: camiseta ou jardineira;
- cabelo: cachos com faixa, rabo alto, black power ou coquinhos;
- tom de pele: 4;
- cor do cabelo: 6, todas naturais, e nenhuma lembra a cor de uma turma.

O retorno principal é o **modelo 3D**, que atualiza na hora. As miniaturas de base e de
cabelo são **retratos renderizados do próprio modelo**: cada aparência é montada longe do
mapa, desenhada numa textura só com as malhas dela (na proporção da tela, recortada no
quadrado central) e lida de volta. Pele e cor do cabelo usam amostras rápidas.

**Contrato.** A aparência é `[ab][0-3]h[0-3]c[0-5]`. A forma legado `a1` continua válida,
com o cabelo original da base. O servidor valida pelo formato e distribui a todos, e os
bots variam base, tom, cabelo e cor. A hitbox, a altura e o movimento não mudam.

## Configurações

As configurações ficam num painel grande com seis categorias: **Jogo · Gráficos · Áudio ·
Controles · Toque · Acessibilidade**.

- O cenário fica atrás, escurecido e com desfoque leve.
- Controles tem uma escolha interna entre "Teclado e mouse" e "Controle", que abre pelo
  dispositivo em uso.
- Toque tem opções reais: sensibilidade da câmera, tamanho e opacidade dos botões, e
  lados trocados para canhotos.
- L1/R1 trocam de categoria. Esc ou B fecham.

## Celular: só na horizontal

O jogo, no celular, é jogado **deitado**. Em pé (toque como ponteiro principal e
orientação retrato), uma tela cobre tudo e pede para girar o aparelho; onde o navegador
permite, o jogo também pede a trava de orientação em paisagem (`screen.orientation.lock`).
A tela some sozinha quando o aparelho gira, sem recarregar nada.

No celular deitado:

- o painel fica lateral e mais estreito, e o cartaz fica enxuto;
- a cena ocupa o espaço à direita do painel, com o grupo ou o personagem;
- a ação principal fica grande (≥ 48 px) e não encosta no painel.

O layout de **folha** (painel embaixo, recolhido pela alça, carrosséis horizontais)
continua existindo, mas só para janelas estreitas de desktop (ponteiro fino).

## Banco (entrada com a partida em andamento)

Quem entra com a rodada já rolando fica **no banco**: assiste ao vivo, sem personagem
próprio, e joga a próxima rodada.

- A câmera acompanha alguém sozinha; E/→ e Q/← trocam, V (ou o botão) mostra a visão
  geral. No toque (ou navegando com o controle), os botões da faixa fazem o mesmo.
- O HUD mostra tempo e placar; mira, tanque e vida ficam escondidos.
- Nada do banco move alguém nem trava o ponteiro; o servidor não manda eventos pessoais.
- Validado em `e2e/banco.mjs`.

## O que foi preservado

Nada disto mudou gameplay, servidor de partida (além de validar e distribuir a aparência
nova), perfis, voz, controle, toque ou acessibilidade. Os seletores usados pelos testes de
voz (`.slot[data-player]`, `.slot .avatar.speaking`) continuam valendo. O palco e as
câmeras de apresentação só existem fora da rodada, e a simulação não sabe que eles existem.

## Validação

`e2e/menus.mjs` navega pelos menus de verdade, com dois navegadores na mesma sala e um
celular emulado. Todas as verificações passaram em SwiftShader:

- abertura e pulo da abertura;
- palco ativo, com você e quem entra;
- etiqueta sobre o personagem e lista legível;
- reação a "pronto" e contador;
- opções da partida (só quem organiza muda);
- vitrine: ferramenta instantânea e depois confirmada; retratos renderizados do modelo;
  cabelo e cor instantâneos e sincronizados; giro por arrasto;
- seis categorias de configuração, uma opção de toque salva, Esc fecha;
- entrada na rodada: interface recolhe, cartaz, palco liberado, turmas, contagem,
  "Valendo!", campo de visão da partida;
- volta ao lobby sem sobras da rodada;
- 8 × 8 com o palco limitado;
- celular em pé: tela de girar o aparelho;
- celular deitado: painel lateral, vitrine, ação grande sem sobreposição.

As capturas ficam em `e2e/out/capturas/menus/`.

**Ainda não validado:**

- celular e controle físicos;
- GPU real: as medições são de SwiftShader;
- o Trivo real;
- pessoas jogando juntas.

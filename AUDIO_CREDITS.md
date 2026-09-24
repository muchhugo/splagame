# Créditos de áudio

Todos os efeitos sonoros do Borrifo vêm de **gravações e efeitos prontos baixados** de
bibliotecas públicas, todos em **CC0 1.0 (domínio público)**. O CC0 dispensa atribuição e
permite uso comercial, mas os autores estão creditados abaixo. **Nenhum efeito é sintetizado
por código.** A música de fundo, fora do escopo desta etapa, continua sendo a trilha
generativa do próprio projeto.

- Originais usados, sem alteração, com os arquivos de licença que vieram junto:
  `assets/audio/source/`.
- Versões editadas que o jogo carrega: `apps/game-client/public/audio/sfx/`.
- Edição reproduzível: `scripts/audio/build_sfx.py` (`pip install soundfile numpy scipy`).

## Pacotes, autores e licenças

| Pacote | Autor | Origem | Licença | Como foi verificada |
|---|---|---|---|---|
| Impact Sounds (1.0) | Kenney (Kenney Vleugels) | <https://kenney.nl/assets/impact-sounds> | CC0 1.0 | `License.txt` original do pacote (preservado) |
| Interface Sounds (1.0) | Kenney | <https://kenney.nl/assets/interface-sounds> | CC0 1.0 | `License.txt` original do pacote (preservado) |
| Music Jingles | Kenney | <https://kenney.nl/assets/music-jingles> | CC0 1.0 | `License.txt` original do pacote (preservado) |
| 40 CC0 water / splash / slime SFX | rubberduck | <https://opengameart.org/content/40-cc0-water-splash-slime-sfx> | CC0 1.0 | Página de origem no OpenGameArt (título e descrição CC0); o pacote não traz arquivo de licença, então incluímos o texto do CC0 1.0 |
| 25 CC0 mud sfx | rubberduck | <https://opengameart.org/content/25-cc0-mud-sfx> | CC0 1.0 | Idem |
| 100 CC0 SFX | rubberduck | <https://opengameart.org/content/100-cc0-sfx> | CC0 1.0 | Idem |
| Micro Pack – Melon (encomendado por CaptSubtle) | Benjamin Burnes (Abstraction) | <https://ben-burnes.gumroad.com/l/MicroPacks2021> | CC0 1.0 | `_README.txt` original: "These sounds are public domain (Creative Commons 0)" (preservado) |
| Bottle Plops (abr. 2021) | Benjamin Burnes | idem | CC0 1.0 | `_README.txt` original (preservado) |
| Micro Pack – Organic Wooshes (sugerido por NazdyNate) | Benjamin Burnes | idem | CC0 1.0 | `_README.txt` original (preservado) |
| Slide Whistle (ago. 2021) | Benjamin Burnes | idem | CC0 1.0 | `_README.txt` original (preservado) |

### Como os arquivos foram obtidos

A rede desta sessão de desenvolvimento **bloqueou** `kenney.nl`, `opengameart.org`,
`freesound.org`, `pixabay.com`, `itch.io` e `archive.org`. Os pacotes acima foram baixados da
compilação pública <https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds> (commit
`f2b6264f9ab89fabc266914c3654685d68c5a39b`), que redistribui os pacotes CC0 com seus arquivos de
licença. Como os sites originais estavam inacessíveis, **não foi possível comparar byte a byte**
com os downloads oficiais. A licença de cada pacote foi conferida pelos arquivos que vieram
junto e, no caso do rubberduck, pela página de origem. Antes de um lançamento, vale baixar de
novo das fontes oficiais e comparar.

Não há nenhum som de Splatoon, Zelda ou outro jogo comercial.

## Efeito por efeito

Alterações comuns a todos os arquivos:
- mixagem para mono e reamostragem para 44,1 kHz;
- corte no ataque e na duração útil, com fade de entrada e saída;
- filtro passa-altas;
- nivelamento pelo volume momentâneo (50 ms), com limitador de pico em -1 dBFS;
- codificação em MP3 (efeitos) ou WAV PCM 16 bits (loops sem emenda).

Nas gravações de celular do rubberduck também foi aplicado um expansor suave, que abaixa o
chiado de fundo entre os eventos. Alterações específicas estão na última coluna.

| Arquivo do jogo | Evento | Fonte (pacote / arquivo) | Alterações específicas |
|---|---|---|---|
| `esguicho-1..4` | disparo do Esguicho | rubberduck water: `splash_09`, `splash_10`, `splash_12`; rubberduck mud: `mud_24` | cortados em 0,13–0,15 s |
| `rodo-1`, `rodo-2` | balanço do Rodo | Organic Wooshes: `Swish 1` / `Swish 2` + rubberduck water: `splash_03` / `splash_14` | camadas (woosh + respingo, +50 ms), compressão leve |
| `estilingue-1`, `estilingue-2` | disparo do Estilingue | Organic Wooshes: `Slash` + Melon: `Slap the Melon 1` / `3` + rubberduck water: `splash_10` / `splash_09` | três camadas; no 2, `Slash` afinado a 0,9× |
| `impacto-1..5` | tinta atingindo o cenário | rubberduck water: `slime_04`, `slime_07`, `slime_13`, `slime_16`; rubberduck mud: `mud_22` | 0,3 s, compressão leve |
| `acerto` | acerto em adversário | Kenney Interface: `drop_001` | — |
| `dano-1`, `dano-2` | receber dano | Melon: `Slap the Melon 3` / `2` + rubberduck water: `slime_01` / `slime_08` | camadas, compressão leve |
| `eliminou` | eliminação feita | rubberduck 100: `plop_02` + Kenney Interface: `drop_004` | camadas (+35 ms) |
| `splat-1`, `splat-2` | eliminação (splat) | rubberduck water: `splash_04`, `splash_08` | 0,6–0,75 s, compressão leve |
| `passo-pedra-1..5` | passos em pedra/terracota | Kenney Impact: `footstep_concrete_000..004` | — |
| `passo-madeira-1..5` | passos em madeira | Kenney Impact: `footstep_wood_000..004` | cortados em 0,2 s |
| `passo-tinta-1..4` | passos e aterrissagem na tinta | rubberduck mud: `mud_24`, `mud_11`, `mud_06`, `mud_25` | cortados em 0,12–0,14 s |
| `pulo-1`, `pulo-2` | salto | Organic Wooshes: `Swish 4`, `Swish 1` | — |
| `aterrissa-1..3` | aterrissagem | Kenney Impact: `impactSoft_medium_000..002` | — |
| `mergulho` | entrar na Forma Pião | rubberduck water: `splash_12` | 0,32 s, compressão leve |
| `emerge` | sair da Forma Pião | rubberduck 100: `plop_01` | — |
| `tanque-baixo` | pigmento acabando | Bottle Plops: `Plop - Sputter 1` | primeiro jato (0,45 s) |
| `tanque-vazio` | disparar sem pigmento | Bottle Plops: `Plop - Wheeze 2` | primeiro trecho (0,42 s) |
| `recarga-cheia` | tanque cheio na tinta | rubberduck water: `bubble_01` | — |
| `moringa-lanca` | arremesso da Moringa | Organic Wooshes: `Swish 2` | — |
| `moringa-estoura` | Moringa estourando | rubberduck 100: `pot_01` + `dishes_02` + rubberduck water: `splash_06` | três camadas (barro, louça, respingo) |
| `roda-lanca` | lançar a Roda de Oleiro | Organic Wooshes: `Twirl Smol 3` | 1 s |
| `roda-onda-1`, `roda-onda-2` | ondas da Roda | rubberduck water: `splash_07`, `splash_11` | 0,8 s, compressão leve |
| `piao-lanca` | Pião-Guia: lançamento | Slide Whistle: `Fast Rise Fall` | — |
| `piao-pousa` | Pião-Guia: pouso | rubberduck water: `splash_03` + Kenney Impact: `impactSoft_heavy_000` | camadas |
| `reaparece` | reaparecimento | rubberduck water: `bubble_02` | — |
| `carga` | Estilingue carregando (interrompível) | Slide Whistle: `Fast Rise` | — |
| `ui-confirma` | confirmar (interface) | Kenney Interface: `confirmation_001` | — |
| `ui-volta` | voltar/cancelar (interface) | Kenney Interface: `back_002` | — |
| `negado` | ação indisponível | Kenney Interface: `error_004` | — |
| `contagem` | contagem regressiva | rubberduck 100: `bell_02` | 0,5 s |
| `inicio` | início da rodada | Kenney Music Jingles: `jingles_PIZZI04` | — |
| `fim-sino` | fim da rodada ("o sino tocou") | rubberduck 100: `bell_01` | 1,3 s |
| `vitoria` | vitória | Kenney Music Jingles: `jingles_STEEL10` | — |
| `derrota` | derrota | Kenney Music Jingles: `jingles_PIZZI07` | — |
| `empate` | empate | Kenney Music Jingles: `jingles_PIZZI03` | — |
| `especial-pronto` | Roda de Oleiro pronta | Kenney Music Jingles: `jingles_PIZZI16` | — |
| `loop-nado` | nadar na própria tinta | rubberduck water: `loop_water_01` | emenda em crossfade de 150 ms |
| `loop-tinta-inimiga` | pisando em tinta inimiga | rubberduck water: `loop_bubbles_02` | 3,6 s + emenda |
| `loop-rodo` | arrasto do Rodo | rubberduck water: `loop_water_02` | trecho de 1,5–4,7 s, passa-baixas de 4 kHz, emenda |
| `loop-roda` | Roda de Oleiro girando no chão | Organic Wooshes: `Twirl 4` | trecho pulsante (0,12–1,62 s), emenda de 120 ms |

Na reprodução, o jogo também aplica pequenas variações aleatórias de afinação (até ±10%) e
de volume, e sorteia entre as variações sem repetir a anterior.

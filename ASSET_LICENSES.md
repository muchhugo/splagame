# Origem e licença dos recursos

O Borrifo não usa modelos, texturas, músicas, ícones ou logos de terceiros. Todo recurso
visual é **gerado por código deste repositório**. As exceções são os **efeitos sonoros**
(gravações CC0 baixadas; ver [AUDIO_CREDITS.md](AUDIO_CREDITS.md)), a fonte tipográfica e as
bibliotecas listadas abaixo.

## Recursos visuais

| Recurso | Origem | Onde |
|---|---|---|
| Arenas Toca do Ara e Clube da Maré (3 variantes cada) | Geometria gerada a partir do `MapSpec` do projeto, montada com o kit de peças próprio | `packages/game-content/src/maps/{kit,tocaDoAra,clubeDaMare}.ts`, `packages/game-simulation/src/map/geometry.ts`, `apps/game-client/src/game/render/LevelRenderer.ts` |
| Materiais do cenário (terracota, tijolo, madeira, azulejo, pedra, reboco, ladrilho hidráulico, pastilha, cimento; cobogó em relevo), tinta, céu | Shaders GLSL próprios, sem texturas externas | `apps/game-client/src/game/render/shaders.ts` |
| Personagens (duas bases humanas, quatro tons de pele, Forma Pião), ferramentas, objetos | Primitivas do Babylon.js (esfera, cilindro, cápsula, caixa, torno, tubo) montadas por código | `apps/game-client/src/game/render/CharacterView.ts`, `effects/Effects.ts` |
| Material toon dos personagens | Shader próprio | `apps/game-client/src/game/render/ToonMaterial.ts` |
| Entorno e props (árvores, bananeiras, palmeiras, casas, morros, bandeirinhas, vasos, guarda-sóis, mastro, totem e arara ambiental, placas e letreiros) | Primitivas e `DynamicTexture` desenhada em canvas por código | `apps/game-client/src/game/render/Environment.ts`, `props.ts` |
| Mural do Ara (duas variantes) | Ilustração **original** desenhada em canvas por código (arara estilizada própria, folhagem e morro). Não reproduz o logo do Trivo | `apps/game-client/src/game/render/props.ts` (`buildMural`) |
| Cápsula, estações e pickups dos modos | Primitivas e ícones próprios (setas do Embalo, gota do Fôlego) | `apps/game-client/src/game/render/ModeView.ts` |
| Arte dos cartões de mapa e visual no lobby | SVG escrito à mão no código | `apps/game-client/src/ui/Lobby.tsx` |
| Logo do jogo | SVG escrito à mão no código | `apps/game-client/src/ui/Logo.tsx` |
| Interface | CSS próprio | `apps/game-client/src/ui/styles.css`, `apps/activity-shell/app/globals.css` |

## Referência de marca (não empacotada)

| Recurso | Origem | Como é usado |
|---|---|---|
| `trivo logo.svg` (arara do Trivo) | Enviado ao repositório pelo responsável pelo projeto (commit 4e77adc); marca do Trivo, **não é um recurso livre** | Só como **referência de cor e forma**. As cores dos preenchimentos foram copiadas como tokens (`packages/game-content/src/palette.ts`, conferidos por teste). O arquivo **não entra no bundle** do jogo, o markup não é inserido nas páginas, e o logo não é reproduzido no cenário |

## Som

- **Efeitos sonoros:** 66 arquivos editados a partir de gravações e efeitos prontos
  **CC0 1.0** de Kenney, rubberduck (OpenGameArt) e Benjamin Burnes. Autor, origem, licença e
  alterações de cada um estão em [AUDIO_CREDITS.md](AUDIO_CREDITS.md). Os originais e os
  arquivos de licença que vieram com eles estão em `assets/audio/source/`.
- **Música de fundo:** trilha generativa própria (WebAudio), sem amostras externas.

## Fonte

| Fonte | Pacote | Licença | Observação |
|---|---|---|---|
| Fredoka (pesos 500, 600 e 700, subconjunto latino) | `@fontsource/fredoka` 5.3.0 | SIL Open Font License 1.1 | Copyright 2016 The Fredoka Project Authors. Empacotada localmente no bundle, sem requisição a CDN. |

## Bibliotecas de runtime

| Biblioteca | Versão | Licença |
|---|---|---|
| @babylonjs/core | 9.28.0 | Apache-2.0 |
| @dimforge/rapier3d-compat | 0.20.0 | Apache-2.0 |
| @colyseus/core, @colyseus/ws-transport | 0.18.16, 0.18.3 | MIT |
| @colyseus/sdk | 0.18.4 | MIT |
| react, react-dom | 19.3.0 | MIT |
| next | 16.3.6 | MIT |
| livekit-client | 2.22.3 | Apache-2.0 |
| livekit-server-sdk | 2.19.1 | Apache-2.0 |
| jose | 6.2.12 | MIT |
| zod | 4.6.5 | MIT |
| express | 5.2.1 | MIT |
| gsap | 3.15.0 | GreenSock Standard "no charge" License (<https://gsap.com/standard-license>): uso gratuito, inclusive comercial. Não é uma licença OSI |

Ferramentas de desenvolvimento (Vite 8.3.1, Vitest 5.0.1, TypeScript 5.9.3, tsx 4.23.15) são
MIT ou Apache-2.0 e não entram no bundle.

## Referências de direção de arte

As capturas de tela de outros jogos, enviadas como referência de cor, luz e atmosfera, **não
estão no repositório** e não foram copiadas, traçadas nem usadas como textura. Nenhum nome,
personagem, silhueta, logo, som, mapa ou interface de outro jogo foi reproduzido.

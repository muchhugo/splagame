# Origem e licença dos recursos

O Borrifo não usa modelos, texturas, sons, músicas, ícones ou logos de terceiros. Todo recurso
visual e sonoro é **gerado por código deste repositório**. As exceções são a fonte tipográfica e
as bibliotecas listadas abaixo.

## Recursos visuais

| Recurso | Origem | Onde |
|---|---|---|
| Arena (blocos, rampas, pisos) | Geometria gerada a partir do `MapSpec` do projeto | `packages/game-content/src/maps/patioDaOlaria.ts`, `packages/game-simulation/src/map/geometry.ts`, `apps/game-client/src/game/render/LevelRenderer.ts` |
| Materiais do cenário (terracota, tijolo, madeira, azulejo, pedra), tinta, céu | Shaders GLSL próprios, sem texturas externas | `apps/game-client/src/game/render/shaders.ts` |
| Personagens (Bibelôs), ferramentas, objetos | Primitivas do Babylon.js (esfera, cilindro, caixa, torno) montadas por código | `apps/game-client/src/game/render/CharacterView.ts`, `effects/Effects.ts` |
| Material toon dos personagens | Shader próprio | `apps/game-client/src/game/render/ToonMaterial.ts` |
| Entorno (árvores, casas, morros, bandeirinhas, estátua, letreiros) | Primitivas e `DynamicTexture` desenhada em canvas por código | `apps/game-client/src/game/render/Environment.ts` |
| Logo do jogo | SVG escrito à mão no código | `apps/game-client/src/ui/Logo.tsx` |
| Interface | CSS próprio | `apps/game-client/src/ui/styles.css`, `apps/activity-shell/app/globals.css` |

## Som

Todo o som é sintetizado em tempo real com WebAudio (osciladores, ruído, filtros e envelopes),
com trilha gerativa própria. **Nenhuma amostra de áudio externa** é baixada ou empacotada.
O código fica em `apps/game-client/src/game/audio/`.

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

Ferramentas de desenvolvimento (Vite 8.3.1, Vitest 5.0.1, TypeScript 5.9.3, tsx 4.23.15) são
MIT ou Apache-2.0 e não entram no bundle.

## Referências de direção de arte

As capturas de tela de outros jogos, enviadas como referência de cor, luz e atmosfera, **não
estão no repositório** e não foram copiadas, traçadas nem usadas como textura. Nenhum nome,
personagem, silhueta, logo, som, mapa ou interface de outro jogo foi reproduzido.

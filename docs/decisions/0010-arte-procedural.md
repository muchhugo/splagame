# 0010 — Arte e som gerados por código

> **Atualização:** os efeitos sonoros passaram a ser gravações CC0 baixadas
> ([ADR 0011](0011-efeitos-sonoros-gravados.md)). A arte segue gerada por código.

**Contexto.** O briefing exige identidade própria, assets com origem documentada e nada copiado
de outros jogos. O pedido de direção de arte pede modelos simples com acabamento intencional,
sem dependências pesadas.

**Decisão.** Todo o visual sai de primitivas do Babylon e de shaders próprios (cenário, tinta,
céu, material toon). Placas e letreiros usam `DynamicTexture` desenhada em canvas. O som é
sintetizado com WebAudio. A única fonte externa empacotada é a Fredoka (OFL-1.1).

**Consequência.** Não há pendência de licença de assets, e o download é pequeno. O acabamento
depende de código: detalhes finos (rostos, texturas pintadas à mão) custam mais do que com
modelos importados. Um pipeline de modelos glTF pode ser adicionado depois, com a origem
registrada em `ASSET_LICENSES.md`.

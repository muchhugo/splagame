# Áudio: originais

`source/` guarda, **sem alteração**, as gravações CC0 usadas nos efeitos do jogo, uma pasta por
pacote, com o arquivo de licença que veio de cada fonte (`License.txt`, `_README.txt` ou, nos
pacotes do rubberduck que não trazem licença, uma cópia do texto do CC0 1.0).

As versões editadas que o jogo carrega ficam em `apps/game-client/public/audio/sfx/` e são
geradas por:

```bash
pip install soundfile numpy scipy
pnpm audio:build        # python3 scripts/audio/build_sfx.py
```

O script só corta, filtra, combina camadas, nivela e codifica, sem sintetizar som. Ele também
grava `build-report.json` com duração, pico e volume de cada arquivo. Autores, links e
alterações estão em `AUDIO_CREDITS.md`, na raiz do projeto.

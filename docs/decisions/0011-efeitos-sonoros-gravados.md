# 0011: Efeitos sonoros gravados (CC0) no lugar da síntese

**Contexto.** Os efeitos eram sintetizados por código no WebAudio. O pedido é usar arquivos
reais de bibliotecas conhecidas, com licença clara e compatível com uso comercial, integrados
aos eventos reais e coerentes com a direção cartoon. A rede da sessão bloqueou `kenney.nl`,
`opengameart.org`, `freesound.org`, `pixabay.com` e `itch.io`.

**Decisão.**
- Usar só pacotes **CC0 1.0** (Kenney, rubberduck, Benjamin Burnes), obtidos de uma
  compilação pública no GitHub que preserva os arquivos de licença. Registrar autor, origem,
  licença e alterações em `AUDIO_CREDITS.md` e guardar os originais em `assets/audio/source/`.
- Editar tudo com um script reproduzível (`scripts/audio/build_sfx.py`): cortes, filtros,
  camadas, nivelamento pelo volume momentâneo e limitador de pico, sem nenhuma síntese.
- Efeitos em **MP3** (compatível com todos os navegadores). Loops em **WAV** PCM, para emenda
  sem o atraso do codificador.
- Manter o `AudioEngine`: barramentos, limite e roubo de vozes, espacialização, silenciar e
  volumes. Trocar só a fonte dos efeitos (`samples.ts`, `SampleBank.ts`). Os arquivos baixam
  cedo e são decodificados no primeiro gesto do jogador; uma falha de carga deixa aquele efeito
  mudo, sem travar a partida.
- A **música generativa continua** (fora do escopo desta etapa).

**Consequência.** O cliente passa a baixar ~1,3 MB de áudio depois da abertura (fora do bundle
JS). Os arquivos vieram de um espelho, não das fontes oficiais; antes de um lançamento, vale
baixar de novo das fontes originais e comparar. A escolha foi guiada por espectrogramas, formas
de onda e análise melódica, porque este ambiente não tem saída de som: **ninguém ouviu os
efeitos ainda**.

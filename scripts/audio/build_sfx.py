#!/usr/bin/env python3
"""
Monta os efeitos sonoros do Borrifo a partir das gravações baixadas
(assets/audio/source, todas CC0 — ver AUDIO_CREDITS.md).

Nada aqui sintetiza som: só corta, filtra, combina camadas, ajusta afinação
por reamostragem, nivela e codifica. Reproduzível:

    pip install soundfile numpy scipy
    python3 scripts/audio/build_sfx.py

Saída: apps/game-client/public/audio/sfx/*.mp3 (efeitos) e *.wav (loops sem
emenda) + build-report.json com duração, pico e RMS de cada arquivo.
"""
from __future__ import annotations

import json
from fractions import Fraction
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, resample_poly, sosfilt

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'assets' / 'audio' / 'source'
OUT = ROOT / 'apps' / 'game-client' / 'public' / 'audio' / 'sfx'
SR = 44100

RD = 'rubberduck-40-water-splash-slime'
MUD = 'rubberduck-25-mud'
R100 = 'rubberduck-100-cc0-sfx'
MEL = 'benburnes-melon'
PLOP = 'benburnes-bottle-plops'
WOO = 'benburnes-organic-wooshes'
WHI = 'benburnes-slide-whistle'
KIM = 'kenney-impact-sounds'
KUI = 'kenney-interface-sounds'
KJI = 'kenney-music-jingles'


# ------------------------------------------------------------ utilitários

def load(pack: str, name: str) -> np.ndarray:
    d, sr = sf.read(SRC / pack / name, always_2d=True, dtype='float64')
    m = d.mean(axis=1)
    if sr != SR:
        g = np.gcd(SR, sr)
        m = resample_poly(m, SR // g, sr // g)
    return m


def env(x: np.ndarray, win_s: float = 0.004) -> np.ndarray:
    n = max(1, int(win_s * SR))
    return np.sqrt(np.convolve(x * x, np.ones(n) / n, mode='same'))


def onset(x: np.ndarray, rel_db: float = -22.0, pre_s: float = 0.004) -> int:
    e = env(x)
    thr = e.max() * 10 ** (rel_db / 20)
    i = int(np.argmax(e > thr))
    return max(0, i - int(pre_s * SR))


def seg(x: np.ndarray, start: float | str = 'onset', dur: float | None = None) -> np.ndarray:
    i = onset(x) if start == 'onset' else int(float(start) * SR)
    j = len(x) if dur is None else min(len(x), i + int(dur * SR))
    return x[i:j].copy()


def hp(x: np.ndarray, f: float) -> np.ndarray:
    return sosfilt(butter(2, f, 'highpass', fs=SR, output='sos'), x)


def lp(x: np.ndarray, f: float) -> np.ndarray:
    return sosfilt(butter(2, f, 'lowpass', fs=SR, output='sos'), x)


def gate(x: np.ndarray, thr_db: float = -38.0, depth_db: float = -24.0) -> np.ndarray:
    """Expansor suave: abaixa o chiado de fundo das gravações de celular entre os eventos."""
    e = env(x, 0.01)
    thr = e.max() * 10 ** (thr_db / 20)
    floor = 10 ** (depth_db / 20)
    g = np.clip((e / (thr + 1e-12)) ** 2, floor, 1.0)
    k = max(1, int(0.008 * SR))
    g = np.convolve(g, np.ones(k) / k, mode='same')
    return x * g


def fades(x: np.ndarray, fin: float = 0.002, fout: float = 0.04) -> np.ndarray:
    y = x.copy()
    a = min(len(y), max(1, int(fin * SR)))
    b = min(len(y), max(1, int(fout * SR)))
    y[:a] *= np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    y[-b:] *= np.cos(np.linspace(0, np.pi / 2, b)) ** 2
    return y


def pitch(x: np.ndarray, ratio: float) -> np.ndarray:
    """Afinação por reamostragem (como tocar a fita mais rápido/lento)."""
    fr = Fraction(ratio).limit_denominator(120)
    return resample_poly(x, fr.denominator, fr.numerator)


def mix(*layers: tuple[np.ndarray, float, float]) -> np.ndarray:
    """Camadas (sinal, deslocamento em s, ganho)."""
    n = max(int(off * SR) + len(s) for s, off, _ in layers)
    out = np.zeros(n)
    for s, off, g in layers:
        i = int(off * SR)
        out[i:i + len(s)] += s * g
    return out


def momentary(x: np.ndarray) -> float:
    """Maior RMS em janela de 50 ms (volume percebido de um som curto), em dBFS."""
    e = env(x, 0.05)
    return 20 * np.log10(e.max() + 1e-12)


def limit(x: np.ndarray, ceiling_db: float = -1.0, look_s: float = 0.0015, release_s: float = 0.04) -> np.ndarray:
    """Limitador com antecipação: segura só os picos de poucos milissegundos das
    gravações (sem ceifar), para que variações do mesmo evento soem parecidas."""
    ceil = 10 ** (ceiling_db / 20)
    need = np.minimum(1.0, ceil / np.maximum(np.abs(x), 1e-12))
    n = max(1, int(look_s * SR))
    # mínimo móvel à frente (antecipação) e liberação exponencial
    pad = np.concatenate([need, np.ones(n)])
    ahead = np.array([pad[i:i + n + 1].min() for i in range(len(x))])
    rel = np.exp(-1 / (release_s * SR))
    g = np.empty_like(ahead)
    v = 1.0
    for i, a in enumerate(ahead):
        v = a if a < v else rel * v + (1 - rel) * a
        g[i] = v
    return x * g


def norm(x: np.ndarray, target_db: float, loop: bool, peak_db: float = -1.0, max_limit_db: float = 8.0) -> np.ndarray:
    """Efeitos: nivela pelo volume momentâneo (50 ms), com até `max_limit_db` de
    limitação dos picos. Loops: pelo RMS médio. Nunca passa do teto de pico."""
    if loop:
        level = 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
    else:
        level = momentary(x)
    g = 10 ** ((target_db - level) / 20)
    ceil = 10 ** (peak_db / 20)
    over = np.abs(x).max() * g / ceil
    if over > 10 ** (max_limit_db / 20):
        g /= over / 10 ** (max_limit_db / 20)
    y = x * g
    if np.abs(y).max() > ceil:
        y = limit(y, peak_db)
    return np.clip(y, -ceil, ceil)


def compress(x: np.ndarray, thr_rel_db: float = -16.0, ratio: float = 3.5, release_s: float = 0.05) -> np.ndarray:
    """Compressor simples (ataque ~1 ms): aproxima o volume percebido das variações
    de respingo sem cortar nem saturar os transientes."""
    peak = np.abs(x).max() + 1e-12
    thr = peak * 10 ** (thr_rel_db / 20)
    a = np.abs(x)
    e = np.zeros_like(a)
    att = np.exp(-1 / (0.001 * SR))
    rel = np.exp(-1 / (release_s * SR))
    v = 0.0
    for i, s in enumerate(a):
        c = att if s > v else rel
        v = c * v + (1 - c) * s
        e[i] = v
    g = np.where(e > thr, (thr / np.maximum(e, 1e-12)) ** (1 - 1 / ratio), 1.0)
    return x * g


def loopify(x: np.ndarray, xfade: float = 0.15) -> np.ndarray:
    """Emenda sem clique: o início recebe o fim em crossfade de potência constante."""
    n = int(xfade * SR)
    body = x[: len(x) - n].copy()
    t = np.linspace(0, np.pi / 2, n)
    body[:n] = body[:n] * np.sin(t) + x[len(x) - n:] * np.cos(t)
    return body


def clean(x: np.ndarray, hpf: float = 100.0, gate_db: float | None = -40.0) -> np.ndarray:
    y = hp(x, hpf)
    return gate(y, gate_db) if gate_db is not None else y


# ------------------------------------------------------------ receitas de edição
# Cada saída: (nome, função que devolve o sinal, alvo em dBFS, é loop?).
# Alvo: volume momentâneo (50 ms) nos efeitos; RMS médio nos loops.

def shot(pack, f, dur=0.15):
    return lambda: fades(clean(seg(load(pack, f), 'onset', dur), 180), fout=0.06)


def impact(pack, f, dur=0.3):
    return lambda: fades(compress(clean(seg(load(pack, f), 'onset', dur), 120, -42)), fout=0.09)


def simple(pack, f, dur=None, start='onset', hpf=60.0, gate_db=None, fout=0.03):
    return lambda: fades(clean(seg(load(pack, f), start, dur), hpf, gate_db), fout=fout)


SPEC: list[tuple[str, object, float, bool]] = [
    # ---- combate com tinta
    ('esguicho-1', shot(RD, 'splash_09.ogg'), -12, False),
    ('esguicho-2', shot(RD, 'splash_10.ogg'), -12, False),
    ('esguicho-3', shot(RD, 'splash_12.ogg'), -12, False),
    ('esguicho-4', shot(MUD, 'mud_24.ogg', 0.13), -12, False),
    ('rodo-1', lambda: fades(compress(mix((clean(seg(load(WOO, 'Swish 1.wav'), 'onset', 0.3), 150, None), 0, 0.9), (clean(seg(load(RD, 'splash_03.ogg'), 'onset', 0.34), 150), 0.05, 1.0))), fout=0.08), -11, False),
    ('rodo-2', lambda: fades(compress(mix((clean(seg(load(WOO, 'Swish 2.wav'), 'onset', 0.3), 150, None), 0, 0.9), (clean(seg(load(RD, 'splash_14.ogg'), 'onset', 0.34), 150), 0.05, 1.0))), fout=0.08), -11, False),
    ('estilingue-1', lambda: fades(mix((clean(seg(load(WOO, 'Slash.wav'), 'onset', 0.14), 200, None), 0, 1.0), (clean(seg(load(MEL, 'Slap the Melon 1.wav'), 'onset', 0.22), 80, None), 0.025, 0.8), (clean(seg(load(RD, 'splash_10.ogg'), 'onset', 0.25), 180), 0.04, 0.5)), fout=0.08), -10, False),
    ('estilingue-2', lambda: fades(mix((pitch(clean(seg(load(WOO, 'Slash.wav'), 'onset', 0.14), 200, None), 0.9), 0, 1.0), (clean(seg(load(MEL, 'Slap the Melon 3.wav'), 'onset', 0.22), 80, None), 0.025, 0.8), (clean(seg(load(RD, 'splash_09.ogg'), 'onset', 0.25), 180), 0.04, 0.5)), fout=0.08), -10, False),
    ('impacto-1', impact(RD, 'slime_04.ogg'), -13, False),
    ('impacto-2', impact(RD, 'slime_07.ogg'), -13, False),
    ('impacto-3', impact(RD, 'slime_13.ogg'), -13, False),
    ('impacto-4', impact(RD, 'slime_16.ogg'), -13, False),
    ('impacto-5', impact(MUD, 'mud_22.ogg'), -13, False),
    ('acerto', simple(KUI, 'drop_001.ogg', hpf=200), -13, False),
    ('dano-1', lambda: fades(compress(mix((clean(seg(load(MEL, 'Slap the Melon 3.wav'), 'onset', 0.3), 70, None), 0, 1.0), (clean(seg(load(RD, 'slime_01.ogg'), 'onset', 0.3), 120, -42), 0.012, 0.7))), fout=0.1), -9, False),
    ('dano-2', lambda: fades(compress(mix((clean(seg(load(MEL, 'Slap the Melon 2.wav'), 'onset', 0.3), 70, None), 0, 1.0), (clean(seg(load(RD, 'slime_08.ogg'), 'onset', 0.3), 120, -42), 0.012, 0.7))), fout=0.1), -9, False),
    ('eliminou', lambda: fades(mix((clean(seg(load(R100, 'plop_02.ogg'), 'onset', 0.2), 120, -42), 0, 1.0), (simple(KUI, 'drop_004.ogg', hpf=200)(), 0.035, 0.55)), fout=0.08), -10, False),
    ('splat-1', lambda: fades(compress(clean(seg(load(RD, 'splash_04.ogg'), 'onset', 0.75), 90, -42)), fout=0.2), -10, False),
    ('splat-2', lambda: fades(compress(clean(seg(load(RD, 'splash_08.ogg'), 'onset', 0.62), 90, -42)), fout=0.18), -10, False),
    # ---- movimentação
    *[(f'passo-pedra-{i + 1}', simple(KIM, f'footstep_concrete_00{i}.ogg', hpf=90), -25, False) for i in range(5)],
    *[(f'passo-madeira-{i + 1}', simple(KIM, f'footstep_wood_00{i}.ogg', 0.2, hpf=70), -25, False) for i in range(5)],
    ('passo-tinta-1', shot(MUD, 'mud_24.ogg', 0.12), -18, False),
    ('passo-tinta-2', shot(MUD, 'mud_11.ogg', 0.12), -18, False),
    ('passo-tinta-3', shot(MUD, 'mud_06.ogg', 0.14), -18, False),
    ('passo-tinta-4', shot(MUD, 'mud_25.ogg', 0.14), -18, False),
    ('pulo-1', simple(WOO, 'Swish 4.wav', 0.22, hpf=150), -17, False),
    ('pulo-2', simple(WOO, 'Swish 1.wav', 0.25, hpf=150), -17, False),
    *[(f'aterrissa-{i + 1}', simple(KIM, f'impactSoft_medium_00{i}.ogg', hpf=60), -21, False) for i in range(3)],
    ('mergulho', lambda: fades(compress(clean(seg(load(RD, 'splash_12.ogg'), 'onset', 0.32), 120, -42)), fout=0.1), -13, False),
    ('emerge', simple(R100, 'plop_01.ogg', 0.18, hpf=120, gate_db=-42), -13, False),
    # ---- equipamentos e habilidades
    ('tanque-baixo', simple(PLOP, 'Plop - Sputter 1.wav', 0.45, hpf=120, fout=0.12), -14, False),
    ('tanque-vazio', simple(PLOP, 'Plop - Wheeze 2.wav', 0.42, hpf=150, fout=0.12), -16, False),
    ('recarga-cheia', simple(RD, 'bubble_01.ogg', 0.55, hpf=120, gate_db=-42, fout=0.12), -13, False),
    ('moringa-lanca', simple(WOO, 'Swish 2.wav', 0.4, hpf=120), -14, False),
    ('moringa-estoura', lambda: fades(mix((clean(seg(load(R100, 'pot_01.ogg'), 'onset', 0.3), 90, -42), 0, 0.9), (clean(seg(load(R100, 'dishes_02.ogg'), 'onset', 0.5), 150, -42), 0.02, 0.6), (clean(seg(load(RD, 'splash_06.ogg'), 'onset', 0.45), 100, -42), 0.03, 1.0)), fout=0.15), -9, False),
    ('roda-lanca', simple(WOO, 'Twirl Smol 3.wav', 1.0, hpf=100, fout=0.2), -13, False),
    ('roda-onda-1', lambda: fades(compress(clean(seg(load(RD, 'splash_07.ogg'), 'onset', 0.8), 90, -42)), fout=0.25), -11, False),
    ('roda-onda-2', lambda: fades(compress(clean(seg(load(RD, 'splash_11.ogg'), 'onset', 0.8), 90, -42)), fout=0.25), -11, False),
    ('piao-lanca', simple(WHI, 'Fast Rise Fall.wav', hpf=150, fout=0.1), -13, False),
    ('piao-pousa', lambda: fades(mix((clean(seg(load(RD, 'splash_03.ogg'), 'onset', 0.4), 100, -42), 0, 1.0), (simple(KIM, 'impactSoft_heavy_000.ogg', 0.4, hpf=50)(), 0.0, 0.6)), fout=0.12), -10, False),
    ('reaparece', simple(RD, 'bubble_02.ogg', 0.32, hpf=150, gate_db=-42, fout=0.06), -13, False),
    ('carga', simple(WHI, 'Fast Rise.wav', hpf=150, fout=0.08), -16, False),
    # ---- interface e partida
    ('ui-confirma', simple(KUI, 'confirmation_001.ogg', hpf=150), -15, False),
    ('ui-volta', simple(KUI, 'back_002.ogg', hpf=150), -17, False),
    ('negado', simple(KUI, 'error_004.ogg', hpf=150), -15, False),
    ('contagem', simple(R100, 'bell_02.ogg', 0.5, hpf=300, gate_db=-45, fout=0.15), -15, False),
    ('inicio', simple(KJI, 'jingles_PIZZI04.ogg', hpf=80, fout=0.08), -11, False),
    ('fim-sino', simple(R100, 'bell_01.ogg', 1.3, hpf=250, gate_db=-48, fout=0.3), -12, False),
    ('vitoria', simple(KJI, 'jingles_STEEL10.ogg', hpf=80, fout=0.12), -10, False),
    ('derrota', simple(KJI, 'jingles_PIZZI07.ogg', hpf=80, fout=0.15), -10, False),
    ('empate', simple(KJI, 'jingles_PIZZI03.ogg', hpf=80, fout=0.12), -11, False),
    ('especial-pronto', simple(KJI, 'jingles_PIZZI16.ogg', hpf=80, fout=0.08), -12, False),
    # ---- loops (WAV, emenda sem clique)
    ('loop-nado', lambda: loopify(hp(seg(load(RD, 'loop_water_01.ogg'), 0.0, None), 120)), -24, True),
    ('loop-tinta-inimiga', lambda: loopify(hp(seg(load(RD, 'loop_bubbles_02.ogg'), 0.0, 3.6), 120)), -26, True),
    ('loop-rodo', lambda: loopify(lp(hp(seg(load(RD, 'loop_water_02.ogg'), 1.5, 3.2), 150), 4000)), -26, True),
    ('loop-roda', lambda: loopify(hp(seg(load(WOO, 'Twirl 4.wav'), 0.12, 1.5), 100), 0.12), -22, True),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*'):
        if old.suffix in ('.mp3', '.wav'):
            old.unlink()
    report = {}
    for name, fn, rms_db, is_loop in SPEC:
        y = norm(fn(), rms_db, is_loop)  # type: ignore[operator]
        if is_loop:
            path = OUT / f'{name}.wav'
            sf.write(path, y.astype(np.float32), SR, format='WAV', subtype='PCM_16')
        else:
            path = OUT / f'{name}.mp3'
            sf.write(path, y.astype(np.float32), SR, format='MP3', subtype='MPEG_LAYER_III', bitrate_mode='VARIABLE', compression_level=0.3)
        e = env(y, 0.02)
        act = y[e > e.max() * 10 ** (-30 / 20)]
        report[path.name] = {
            'seconds': round(len(y) / SR, 3),
            'peak_dbfs': round(20 * np.log10(np.abs(y).max() + 1e-12), 1),
            'rms_dbfs': round(20 * np.log10(np.sqrt(np.mean(act ** 2)) + 1e-12), 1),
            'momentary_dbfs': round(momentary(y), 1),
            'bytes': path.stat().st_size,
        }
    (OUT / 'build-report.json').write_text(json.dumps(report, indent=1, ensure_ascii=False) + '\n')
    total = sum(r['bytes'] for r in report.values())
    print(f'{len(report)} arquivos, {total / 1024:.0f} KiB em {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()

"""Звуки станции для Wild Canvas: синтез, без записей. Два варианта, петля без шва.

python -I station_synth.py <папка>  →  station-vent.wav, station-core.wav (моно, 16 кГц, 16 бит, 48 с)

Шум собирается в частотной области (заданный спектр, случайные фазы): запись периодична,
начало продолжает конец. Гул — синусы с целым числом периодов на петлю. Всё глухое:
выше 1 кГц спектр падает на 14 дБ и круче на октаву, выше 3 кГц звука нет.
Громкость — как у остальных записей модуля: 90-й процентиль RMS по окнам 0,4 с = −24,6 дБ.
"""
import os, struct, sys
import numpy as np

SR, SECONDS = 16000, 48
N = SR * SECONDS
T = np.arange(N) / SR
out = sys.argv[1]
os.makedirs(out, exist_ok=True)


def noise(points, seed):
    """Шум с заданным спектром: points — (Гц, дБ), между ними прямая по логарифму частоты."""
    rng = np.random.default_rng(seed)
    f = np.fft.rfftfreq(N, 1 / SR)
    fx, fy = np.log2([p[0] for p in points]), [p[1] for p in points]
    db = np.interp(np.log2(np.maximum(f, 1e-3)), fx, fy, left=-120, right=-120)
    spec = 10 ** (db / 20) * np.exp(2j * np.pi * rng.random(f.size))
    spec[0] = 0
    x = np.fft.irfft(spec, N)
    return x / np.sqrt(np.mean(x * x))


def tone(hz, db, phase=0.0):
    """Синус с целым числом периодов на петлю."""
    k = round(hz * SECONDS)
    return 10 ** (db / 20) * np.sin(2 * np.pi * k * T / SECONDS + phase)


def sway(parts):
    """Медленное дыхание громкости: (периодов на петлю, глубина, фаза)."""
    return 1 + sum(d * np.sin(2 * np.pi * k * T / SECONDS + ph) for k, d, ph in parts)


def level(x):
    w = int(0.4 * SR)
    rms = np.sqrt(np.mean(x[: N // w * w].reshape(-1, w) ** 2, axis=1))
    return 20 * np.log10(np.percentile(rms, 90))


def write(name, x):
    x = x * 10 ** ((-24.6 - level(x)) / 20)
    peak = 20 * np.log10(np.max(np.abs(x)))
    assert peak < -1, peak
    pcm = np.round(x * 32767).astype("<i2")
    path = os.path.join(out, name)
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 36 + pcm.nbytes) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, SR, SR * 2, 2, 16))
        f.write(b"data" + struct.pack("<I", pcm.nbytes) + pcm.tobytes())
    seam = abs(float(x[0] - x[-1])) / max(1e-9, float(np.max(np.abs(np.diff(x)))))
    print(f"{name}: {os.path.getsize(path) / 1e6:.2f} МБ, уровень {level(x):.1f} дБ, пик {peak:.1f} дБ, шов {seam:.2f} от наибольшего шага")
    return x


# 1. Вентиляция: ровный шум воздуха в коробах и два вентилятора, чьи тона медленно бьются.
air = noise([(20, -18), (50, -4), (90, 0), (260, 0), (500, -7), (1000, -21), (2000, -38), (3000, -60), (4000, -90)], 11)
duct = noise([(60, -40), (140, -8), (180, 0), (230, -8), (500, -40)], 12)       # гулкий короб: горб у 180 Гц
vent = air * sway([(3, 0.10, 0.3), (7, 0.06, 1.9), (11, 0.04, 4.0)]) + 0.45 * duct * sway([(2, 0.18, 1.1), (5, 0.08, 2.7)])
vent += tone(97.0, -17) + tone(97.4, -19, 1.0) + tone(194.2, -24, 0.7) + tone(291.0, -31, 2.2) + tone(146.5, -27, 3.1)
write("station-vent.wav", vent)

# 2. Реактор: низкий гул с медленным биением и дыханием, под ним рокот; обертоны до 400 Гц,
# чтобы гул читался и на малых колонках, где основного тона 50 Гц не слышно.
rumble = noise([(18, -10), (35, 0), (110, 0), (220, -9), (450, -22), (900, -37), (1800, -55), (3000, -80)], 21)
hiss = noise([(400, -60), (700, -8), (1100, 0), (1600, -10), (2600, -50)], 22)   # едва слышный ток в шинах
breath = sway([(6, 0.22, 0.0), (1, 0.10, 2.0)])                                    # вдох раз в 8 секунд
hum = (tone(50.0, -6) + tone(50.25, -8, 0.5) + tone(100.0, -11, 1.3) + tone(100.5, -15, 2.9) + tone(150.0, -15, 0.4)
       + tone(200.0, -19, 2.0) + tone(250.0, -22, 5.0) + tone(300.5, -25, 1.0) + tone(400.0, -30, 3.3))
core = 0.8 * rumble * sway([(4, 0.12, 1.0), (9, 0.05, 0.2)]) + hum * breath * 1.6 + 0.02 * hiss
write("station-core.wav", core)

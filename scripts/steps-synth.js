// Шаги по горящей земле — синтез Web Audio, без файлов. Вода и грязь —
// записи в `sounds/` (см. README, авторы).
// Каждый шаг собирается заново из шума и тонов со случайным разбросом, поэтому
// два подряд не звучат одинаково. Звук идёт в контекст окружения Foundry
// (`game.audio.environment`), так что слушается ползунка «Окружение».
//
// fire  — треск углей и шорох пламени; при входе — вспышка «вух».

let noiseBuf = null;

function noise(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 2);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseBuf = b;
  return b;
}

const rnd = (a, b) => a + Math.random() * (b - a);
const Q = 0.0001;

/** Шум через фильтр с огибающей: частота фильтра плывёт от f0 к f1. */
function burst(ctx, out, t, { type = "bandpass", f0, f1 = f0, q = 1, attack = 0.005, decay = 0.2, gain = 0.5 }) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.Q.value = q;
  flt.frequency.setValueAtTime(f0, t);
  flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
  const g = ctx.createGain();
  g.gain.setValueAtTime(Q, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(Q, t + attack + decay);
  src.connect(flt).connect(g).connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + attack + decay + 0.05);
}

/** Тон, скользящий от f0 к f1: пузырь, «глоп», гул. */
function tone(ctx, out, t, { f0, f1 = f0, dur = 0.1, gain = 0.2, type = "sine", attack = 0.003 }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(Q, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(Q, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Пузырь лопается: короткий тон, взлетающий вверх. */
function bubble(ctx, out, t, low = 300, high = 700, gain = 0.12) {
  const f = rnd(low, high);
  tone(ctx, out, t, { f0: f, f1: f * rnd(2, 3), dur: rnd(0.03, 0.06), gain });
}

function crackles(ctx, out, t, n, span, gain = 0.25) {
  for (let k = 0; k < n; k++) {
    burst(ctx, out, t + Math.random() * span, { f0: rnd(1500, 5000), q: rnd(1.5, 4), attack: 0.001, decay: rnd(0.008, 0.02), gain: gain * rnd(0.4, 1) });
  }
}

const VOICES = {
  fire(ctx, out, t, entry) {
    if (entry) burst(ctx, out, t, { f0: 380, f1: 950, q: 0.9, attack: 0.05, decay: 0.5, gain: 0.32 });
    burst(ctx, out, t, { type: "highpass", f0: 2000, f1: 2600, q: 0.6, attack: 0.02, decay: 0.3, gain: 0.08 });
    burst(ctx, out, t, { type: "lowpass", f0: 900, f1: 300, q: 0.8, attack: 0.01, decay: 0.12, gain: 0.2 });
    crackles(ctx, out, t, entry ? 10 : 4 + Math.floor(Math.random() * 3), entry ? 0.5 : 0.3, 0.22);
  }
};

/** Поверхности, у которых звук синтезируется, а не берётся из файлов. */
export const SYNTH = new Set(Object.keys(VOICES));

/**
 * Сыграть шаг. `entry` — первый шаг в эту поверхность: громче и дольше.
 * `ctx`/`out` для проверки без Foundry; по умолчанию — окружение Foundry.
 */
export function playSynth(surface, { rate = 1, entry = false, ctx = game.audio?.environment, out = ctx?.gainNode } = {}) {
  const voice = VOICES[surface];
  if (!voice || !ctx || !out) return;
  // Контекст спит, пока игрок не кликнул по странице: тогда звук всё равно не услышать.
  if (ctx.state === "suspended" && !(ctx instanceof OfflineAudioContext)) return;
  const bus = ctx.createGain();
  // Синтез тише записей: подтянуто до громкости файловых шагов (пик ~0,5–0,8).
  bus.gain.value = 2.2 * 1.6 * (rate > 1 ? 0.9 : 1);
  bus.connect(out);
  voice(ctx, bus, ctx.currentTime + 0.01, entry);
  setTimeout(() => bus.disconnect(), 2500);
}

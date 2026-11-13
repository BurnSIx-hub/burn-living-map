// Шейдеры живых областей. Рисуют не саму воду или лаву — она уже на картинке
// карты, — а то, что в ней движется: блики, рябь, пену у берега, рыбок, жар.
//
// Цвет на выходе с предумноженной прозрачностью: PIXI смешивает как
// `src.rgb + dst.rgb × (1 − src.a)`. Свет кладётся с нулевой прозрачностью
// и потому прибавляется к картинке; тень и туман — обычной прозрачностью.
//
// Координаты — в клетках сцены (`vPos / uGrid`), так что рябь одного размера
// на любой сетке. `uMask` — размытый силуэт области: край тает, а полоса
// между 0 и 1 — это берег, там пена. `uCut` — вырезы: чёткая маска поверх всего,
// берег от неё не меняется, поэтому вода идёт под мостом не прерываясь.

export const VERT = `
attribute vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
varying vec2 vPos;
void main() {
  vPos = aVertexPosition;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

// Высокой точности во фрагментном шейдере у части видеокарт нет: без неё шейдер
// не собирается вовсе, а со средней эффект грубее, но идёт.
const COMMON = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vPos;
uniform sampler2D uMask;
uniform vec4 uBounds;
uniform sampler2D uCut;
uniform float uTime, uGrid, uSpeed, uStrength, uRadius;
uniform float uRipple, uFoam, uCaustic, uGlint, uFish, uGlow, uSparks, uMurk, uBubbles, uDensity, uFlame, uSmoke, uWind;
uniform float uFlow, uStreaks, uSpray, uJet, uSpill;
uniform float uCurrent, uDrift;
uniform vec2 uCenter;
uniform vec2 uFishSeed;
uniform float uFishKind;

// Вход хеша — по модулю 289: у бегущей по течению воды координаты за сессию
// уходят в десятки тысяч клеток, и без этого хеш терял точность — блики и
// барашки выстраивались в пунктирные столбики. Меньше 289 клеток — как было.
float hash(vec2 p) { p = mod(p, 289.0); p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return v;
}
float mask() { return texture2D(uMask, (vPos - uBounds.xy) / uBounds.zw).r; }
float keep() { return 1.0 - texture2D(uCut, (vPos - uBounds.xy) / uBounds.zw).r; }
// Поверх уже набранного: свой цвет с прозрачностью a.
vec4 over(vec4 dst, vec3 c, float a) { return vec4(c * a, a) + dst * (1.0 - a); }
`;

const WATER = COMMON + `
// Блики на дне: преломление ряби, повторённое несколько раз.
float caustic(vec2 p, float t) {
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / 0.005), p.y / (cos(i.y + tt) / 0.005)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}
// Рыбка сверху: тело-овал, хвост веером, плавники; хвост виляет. Ходит петлёй
// радиуса R вокруг c и изредка уходит в глубину.
//
// Вид — по воде (uFishKind): 0 — река и озеро, 1 — море, 2 — пруд с кои.
// Сверху у настоящей рыбы видна спина: тёмная, под цвет дна, светлее к бокам.
// Узнаётся рыба по силуэту и рисунку спины: пятна, полосы, чешуя.
//   река:  форель (стройная, в тёмных крапинах), окунь (короткий, поперечные
//          полосы, рыжие плавники), карп (широкий, бронзовая чешуя), щука
//          (длинная, светлые пятна, спинной плавник у хвоста);
//   море:  скумбрия (сине-зелёная, волнистые полосы), дорада (широкая,
//          серебристая), треска (крупная, пятнистая, светлая боковая линия),
//          сельдь (мелкая, синяя спина, ходит по две-три).
vec4 fish(vec2 p, float t, float i, vec2 c, float R0) {
  float ph = i * 2.39 + 0.7;
  float dir = mod(i, 2.0) < 1.0 ? 1.0 : -1.0;
  float sp = mod(floor(i / 2.0), 4.0);
  bool koi = uFishKind > 1.5;
  bool sea = uFishKind > 0.5 && !koi;
  // Силуэт вида: длина, толщина, где самое широкое место.
  float L = 1.0, W = 0.115, fin = 0.75;
  vec3 back = vec3(0.3), belly = vec3(0.6), finc = vec3(0.3);
  if (koi) {
    L = 1.0 + 0.2 * fract(i * 0.61);
  } else if (!sea) {
    if (sp < 1.0)      { L = 1.0;  W = 0.10;  back = vec3(0.30, 0.31, 0.22); belly = vec3(0.62, 0.58, 0.46); finc = vec3(0.36, 0.33, 0.24); }
    else if (sp < 2.0) { L = 0.75; W = 0.135; back = vec3(0.30, 0.35, 0.18); belly = vec3(0.62, 0.62, 0.40); finc = vec3(0.78, 0.36, 0.16); }
    else if (sp < 3.0) { L = 1.2;  W = 0.15;  back = vec3(0.42, 0.33, 0.18); belly = vec3(0.70, 0.58, 0.34); finc = vec3(0.42, 0.30, 0.18); }
    else               { L = 1.5;  W = 0.075; back = vec3(0.24, 0.31, 0.17); belly = vec3(0.58, 0.60, 0.40); finc = vec3(0.34, 0.34, 0.20); }
  } else {
    if (sp < 1.0)      { L = 0.9;  W = 0.09;  back = vec3(0.12, 0.27, 0.30); belly = vec3(0.70, 0.76, 0.78); finc = vec3(0.30, 0.38, 0.40); }
    else if (sp < 2.0) { L = 0.95; W = 0.165; back = vec3(0.42, 0.45, 0.47); belly = vec3(0.80, 0.82, 0.82); finc = vec3(0.48, 0.48, 0.46); }
    else if (sp < 3.0) { L = 1.35; W = 0.125; back = vec3(0.40, 0.36, 0.25); belly = vec3(0.70, 0.66, 0.54); finc = vec3(0.38, 0.35, 0.26); }
    else               { L = 0.62; W = 0.08;  back = vec3(0.24, 0.34, 0.38); belly = vec3(0.76, 0.80, 0.82); finc = vec3(0.40, 0.46, 0.48); }
  }
  // Сельдь ходит стайкой: вторая и третья рыбка рядом с той же петлёй.
  float mates = sea && sp > 2.5 ? 3.0 : 1.0;
  float swim = (0.22 + 0.08 * fract(i * 0.37)) * (sea && sp > 2.5 ? 1.5 : 1.0) / sqrt(L);
  vec4 best = vec4(0.0);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    if (fk >= mates) break;
    float a = dir * (t * swim + ph) - dir * fk * 0.35;
    float R = R0 * (0.8 + 0.2 * sin(t * 0.09 + ph * 1.7)) + (fk - 1.0) * 0.18 * step(0.5, fk);
    vec2 pos = c + vec2(cos(a), sin(a) * 0.72) * R;
    vec2 fw = normalize(dir * vec2(-sin(a), cos(a) * 0.72));
    vec2 side = vec2(-fw.y, fw.x);
    vec2 d = p - pos;
    float x = dot(d, fw) / L;
    float y = dot(d, side) / L;
    if (abs(x) > 0.75 || abs(y) > 0.35) continue;
    float tail = clamp(0.35 - x, 0.0, 1.2);
    y -= sin(x * 6.0 - t * 8.0 * swim / 0.25 - i - fk) * 0.07 * tail * tail;
    float taper = mix(0.45, 1.0, smoothstep(-0.45, 0.15, x));
    // Голова: у щуки и трески — вытянутая морда, у карпа и дорады — тупая.
    float head = 1.0 - smoothstep(0.2, 0.42, x) * (sp > 2.5 && !sea || sp > 1.5 && sp < 2.5 && sea ? 0.35 : 0.2);
    float body = 1.0 - smoothstep(0.8, 1.0, length(vec2(x / 0.42, y / (W * taper * head))));
    vec2 tq = vec2(x + 0.47, abs(y) - 0.035);
    tq = mat2(0.80, 0.60, -0.60, 0.80) * tq;
    float fan = 1.0 - smoothstep(0.75, 1.0, length(vec2(tq.x / 0.19, tq.y / (0.06 * (W / 0.115)))));
    vec2 fq = vec2(x - 0.1, abs(y) - W * 0.85);
    fq = mat2(0.7, 0.71, -0.71, 0.7) * fq;
    float fins = 1.0 - smoothstep(0.7, 1.0, length(vec2(fq.x / 0.1, fq.y / 0.035)));
    // Спинной плавник — гребень вдоль спины; у щуки сдвинут к хвосту.
    float dorsal = koi ? 0.0 : (1.0 - smoothstep(0.6, 1.0, length(vec2((x - (sp > 2.5 && !sea ? -0.28 : 0.0)) / 0.16, y / 0.018))));
    float m = max(body, max(fan * 0.85, fins * fin));
    vec3 col;
    if (koi) {
      // Кои пятнами: рыжий с белым, золотой, белый с красным; изредка тёмный карп.
      float kind = mod(i, 6.0);
      vec3 base = kind < 2.0 ? vec3(1.0, 0.42, 0.08) : kind < 4.0 ? vec3(1.0, 0.72, 0.18) : vec3(0.97, 0.94, 0.9);
      vec3 spot = kind < 4.0 ? vec3(0.97, 0.94, 0.9) : vec3(0.9, 0.2, 0.1);
      col = mix(base, spot, smoothstep(0.45, 0.6, noise(vec2(x, y) * 7.0 + i * 13.0)));
      col = kind > 5.0 - 0.5 && fract(i * 0.13) < 0.4 ? vec3(0.22, 0.24, 0.2) : col;
    } else {
      // Спина темнее, к бокам светлеет брюхо.
      float edge = smoothstep(0.35, 1.0, abs(y) / (W * taper * head));
      col = mix(back, belly, edge * 0.55);
      vec2 q = vec2(x, y);
      if (!sea && sp < 1.0) {
        col *= 1.0 - 0.45 * smoothstep(0.72, 0.8, noise(q * 34.0 + i * 7.0));
      } else if (!sea && sp < 2.0) {
        col *= 1.0 - 0.4 * smoothstep(0.2, 0.7, sin(x * 30.0 + 1.0)) * smoothstep(-0.3, 0.1, x) * (1.0 - edge * 0.5);
      } else if (!sea && sp < 3.0) {
        vec2 sc = fract(vec2(x * 22.0 + 0.5 * floor(y * 30.0), y * 30.0)) - 0.5;
        col *= 0.9 + 0.18 * smoothstep(0.5, 0.15, length(sc));
      } else if (!sea) {
        col = mix(col, belly * 0.95, 0.55 * smoothstep(0.6, 0.75, noise(q * vec2(26.0, 40.0) + i * 3.0)));
      } else if (sp < 1.0) {
        float wv = sin(x * 40.0 + sin(y * 60.0) * 1.5);
        col *= 1.0 - 0.55 * smoothstep(0.3, 0.8, wv) * (1.0 - edge);
      } else if (sp < 2.0) {
        col *= 1.0 - 0.12 * smoothstep(0.3, 0.9, sin(y * 90.0)) * (1.0 - edge);
        col += vec3(0.08) * edge;
      } else if (sp < 3.0) {
        col *= 0.8 + 0.35 * noise(q * 30.0 + i * 5.0);
        col = mix(col, belly, 0.6 * smoothstep(0.03, 0.0, abs(abs(y) - W * 0.55)) * smoothstep(0.3, -0.1, x));
      } else {
        col += vec3(0.1) * edge;
      }
      col = mix(col, finc, max(fan, max(fins, dorsal)) * (1.0 - body));
      col = mix(col, back * 0.7, dorsal * body * 0.6);
    }
    col = mix(col, col * 0.75, (1.0 - body) * 0.6);
    if (m > best.a) best = vec4(col, m);
  }
  // Две трети времени у поверхности, треть — в глубине, где её не видно.
  float s = fract(t / 30.0 + fract(i * 0.29)) / 0.67;
  float vis = s < 1.0 ? smoothstep(0.0, 0.12, s) * smoothstep(1.0, 0.88, s) : 0.0;
  return vec4(best.rgb, best.a * vis);
}
// Рыбки живут клетками по FISH_CELL клеток сцены: в двух третях клеток своя. Середину
// петли она берёт там, где в клетке глубоко (маска области), — так рыбки есть в любой
// воде: в пруду, озере, извилистой реке, а не только у середины рамки области, которая
// у реки часто на суше. Петля выходит за свою клетку, поэтому смотрим и соседние.
const float FISH_CELL = 4.0;
float maskAt(vec2 q) { return texture2D(uMask, (q * uGrid - uBounds.xy) / uBounds.zw).r; }
// Течение: корабль на ходу стоит, а вода уходит мимо по uDrift. Что выше по
// течению загораживает воду (корпус, остров), то оставляет за собой след.
// Препятствием считается только дыра внутри области: за краем области и в её
// полях вода — иначе след тянулся бы от края карты.
float blocks(vec2 q) {
  vec2 lo = (uBounds.xy / uGrid) + 1.0, hi = ((uBounds.xy + uBounds.zw) / uGrid) - 1.0;
  if (q.x < lo.x || q.y < lo.y || q.x > hi.x || q.y > hi.y) return 0.0;
  return 1.0 - smoothstep(0.15, 0.55, maskAt(q));
}
// След за корпусом: x — бурун прямо за кормой (корпус, снесённый по течению и
// чуть расплывшийся), y — «усы»: края клина в ~20° от носа, как у настоящего
// судна (клин Кельвина), тонкие у корпуса и шире вдали.
vec2 wakeAt(vec2 p, vec2 fd) {
  vec2 sd = vec2(-fd.y, fd.x);
  float core = 0.0, wide = 0.0, inner = 0.0;
  for (int k = 1; k <= 12; k++) {
    float s = float(k) * 1.4;
    float fall = 1.0 - float(k) / 13.0;
    vec2 q = p - fd * s;
    // Бурун уже корпуса (вода сходится за кормой) и вдали чуть шире.
    float nar = max(0.6, 2.4 - s * 0.1);
    core = max(core, min(blocks(q + sd * nar), blocks(q - sd * nar)) * fall * fall);
    wide = max(wide, max(blocks(q + sd * s * 0.36), blocks(q - sd * s * 0.36)) * fall);
    inner = max(inner, max(blocks(q + sd * s * 0.31), blocks(q - sd * s * 0.31)) * fall);
  }
  return vec2(core, clamp(wide - inner, 0.0, 1.0));
}
vec4 school(vec2 p, float t) {
  vec4 o = vec4(0.0);
  vec2 home = floor(p / FISH_CELL);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 cell = home + vec2(float(dx), float(dy));
      // Зерно сцены сдвигает хеш: на каждой карте рыбки свои, на одной — те же у всех.
      float h = hash(cell + 3.7 + uFishSeed);
      if (h < 0.3) continue;
      // Где в клетке вода: середина, потом сетка 3×3 по клетке.
      vec2 c = vec2(-1.0);
      for (int k = 0; k < 9; k++) {
        float n = mod(float(k) + 4.0, 9.0);
        vec2 f = vec2(0.2 + 0.3 * mod(n, 3.0), 0.2 + 0.3 * floor(n / 3.0));
        vec2 q = (cell + f) * FISH_CELL;
        if (c.x < 0.0 && maskAt(q) > 0.65) c = q;
      }
      if (c.x < 0.0) continue;
      float R = 0.6 + 0.4 * hash(cell + 4.4 + uFishSeed);
      if (length(p - c) > R + 1.4) continue;
      vec4 f = fish(p, t, floor(h * 97.0), c, R);
      if (f.a > o.a) o = f;
    }
  }
  return o;
}
void main() {
  float m = mask();
  if (m < 0.01) discard;
  vec2 p0 = vPos / uGrid;
  float t = uTime * uSpeed;
  // Течение сносит весь узор воды: клеток в секунду, по направлению uDrift.
  float cur = uCurrent;
  float dr = radians(uDrift);
  vec2 fd = vec2(cos(dr), sin(dr));
  vec2 p = p0 - fd * t * cur;
  vec2 warp = vec2(fbm(p * 0.7 + vec2(t * 0.35, t * 0.22)), fbm(p * 0.7 + vec2(-t * 0.27, t * 0.33) + 5.2)) - 0.5;
  warp *= uRipple;
  float deep = smoothstep(0.55, 1.0, m);
  // Волны темнее и светлее — вода дышит. На ходу гребни вытягиваются поперёк
  // течения и бегут мимо борта.
  vec2 sp = cur > 0.01 ? vec2(dot(p, fd) * 1.1, dot(p, vec2(-fd.y, fd.x)) * 0.5) : p * 1.1;
  float s1 = fbm(sp + warp * (cur > 0.01 ? 0.7 : 1.5) + vec2(t * 0.05, 0.0));
  float swell = (s1 - 0.5) * uRipple;
  if (cur > 0.01) {
    // Вторая система волн — ветровая рябь наискось, со своей скоростью: вместе
    // с зыбью узор не повторяется и всё время меняется, а не просто плывёт.
    vec2 q2 = mat2(0.8, 0.6, -0.6, 0.8) * (p0 - fd * t * cur * 0.7) * 1.7 + vec2(t * 0.23, -t * 0.17);
    float s2 = fbm(q2 + warp * 0.5);
    swell = (mix(s1, s2, 0.45) - 0.5) * uRipple * (1.0 + min(cur, 2.0) * 0.35);
  }
  // На ходу ложбины мягкие, без резкого края: открытое море, а не кляксы.
  float trough = cur > 0.01 ? smoothstep(0.0, 0.45, -swell) * 0.2 : max(0.0, -swell) * 0.3;
  vec4 o = vec4(0.0, 0.0, 0.0, (0.1 + trough) * deep);
  o.rgb += vec3(0.6, 0.85, 1.0) * (cur > 0.01 ? smoothstep(0.0, 0.4, swell) * 0.03 : max(0.0, swell) * 0.05) * deep;
  // Барашки: редкие белые гребни, плывут с водой.
  if (cur > 0.01) {
    // Барашек вспыхивает и гаснет: поле «жизни» идёт своим ходом, не с водой.
    float life = smoothstep(0.35, 0.75, noise(p0 * 0.6 + vec2(t * 0.31, -t * 0.27)));
    float cap = smoothstep(0.62, 0.78, fbm(sp * 0.9 + 11.0 + vec2(0.0, t * 0.06))) * smoothstep(0.45, 0.85, noise(p * 3.3 + vec2(t * 0.4, 0.0))) * life;
    o = over(o, vec3(0.92, 0.96, 1.0), clamp(cap * 0.4 * min(cur, 2.0), 0.0, 0.6) * deep);
  }
  // Рыбки под водой: тень на дне, тело размыто рябью. На ходу их не видно.
  if (uFish > 0.01 && cur < 0.6) {
    vec2 fp = p0 + warp * 0.12;
    vec4 sh = school(fp - vec2(0.09, 0.12), t);
    o = over(o, vec3(0.0), sh.a * 0.35 * deep * uFish);
    vec4 f = school(fp, t);
    o = over(o, f.rgb * 0.92, f.a * 0.85 * deep * uFish);
  }
  // Блики на дне видны на мелководье; в открытом море на ходу дна не видно.
  float bottom = 1.0 - smoothstep(0.0, 0.5, cur);
  if (bottom > 0.0) o.rgb += vec3(0.85, 1.0, 1.0) * caustic(p * 1.25 + warp * 0.6, t * 0.6 + 23.0) * 0.16 * deep * uCaustic * bottom;
  float glint = pow(noise(p * 9.0 + vec2(t * 1.5, -t)) * noise(p * 14.0 - vec2(t, t * 1.3)), 5.0);
  o.rgb += vec3(1.0) * smoothstep(0.25, 0.5, glint) * 0.3 * deep * uGlint;
  // Пена у берега: в полосе края маски, бегущими волнами.
  float band = smoothstep(0.08, 0.35, m) * (1.0 - smoothstep(0.45, 0.8, m));
  float waves = sin(m * 18.0 - t * 2.6 + fbm(p * 1.6) * 7.0) * 0.5 + 0.5;
  float foam = band * smoothstep(0.5, 0.95, waves * 0.65 + fbm(p * 5.0 + vec2(t * 0.6, 0.0)) * 0.55);
  // На ходу край области — борт: его стена вырезана из воды, а маска размыта
  // на полклетки в обе стороны, так что при m < 0,5 под водой уже фальшборт.
  // Пена, тень и сама вода начинаются от края, а не на досках.
  float hull0 = cur > 0.01 ? 0.3 : 0.0;
  if (cur > 0.01) {
    // Сплошной полосы прибоя на ходу нет — у борта рваная пена вдоль хода
    // (ниже). Ровная полоса вокруг всего корпуса читалась льдом.
    foam = 0.0;
    // Нос режет воду: где течение бьёт в берег, пена шире и гуще.
    vec2 e = vec2(0.3, 0.0);
    vec2 g = vec2(maskAt(p0 + e.xy) - maskAt(p0 - e.xy), maskAt(p0 + e.yx) - maskAt(p0 - e.yx));
    float bow = max(0.0, -dot(g / (length(g) + 1e-4), fd)) * smoothstep(0.0, 0.05, length(g));
    // Пена, вытянутая вдоль хода и бегущая с водой.
    vec2 sd = vec2(-fd.y, fd.x);
    vec2 fl = vec2(dot(p, fd) * 0.8, dot(p, sd) * 2.4);
    float streak = fbm(fl * 1.4 + vec2(0.0, t * 0.15));
    // Вода у самого борта темнее — тень корпуса, корабль сидит в воде, а не лежит на ней.
    o = over(o, vec3(0.0), (1.0 - smoothstep(0.5, 0.78, m)) * 0.3);
    // У борта — тонкая рваная полоса вдоль хода, у носа — бурун шире и гуще:
    // там вода бьёт в борт и пена клубится клочьями, а не тянется штрихами.
    float hullBand = smoothstep(0.32, 0.48, m) * (1.0 - smoothstep(0.66 + 0.14 * bow, 0.82 + 0.12 * bow, m));
    float churn = fbm(p0 * 3.2 + warp * 1.2 + vec2(t * 0.4, -t * 0.3));
    float tear = mix(streak, churn, smoothstep(0.2, 0.7, bow));
    foam = max(foam, hullBand * smoothstep(0.4, 0.66, tear + bow * 0.12) * (0.4 + 0.5 * bow) * min(cur, 2.0));
    // След за кормой: бурун и расходящиеся усы.
    vec2 w = wakeAt(p0, fd);
    // Бурун — клочьями, с завихрением, а не струями.
    vec2 fc = vec2(dot(p, fd) * 1.3, dot(p, sd) * 1.7);
    float froth = fbm(fc * 1.8 + 3.0 + warp * 1.6 + vec2(sin(t * 0.7 + fc.y), cos(t * 0.5 + fc.x)) * 0.25);
    foam = max(foam, w.x * smoothstep(0.48, 0.74, froth + w.x * 0.12) * 0.95 * min(cur, 1.5));
    foam = max(foam, w.y * smoothstep(0.42, 0.64, streak) * 0.7 * min(cur, 1.5));
    o.rgb += vec3(0.4, 0.6, 0.65) * w.x * 0.04 * deep;
  }
  o = over(o, vec3(0.93, 0.97, 1.0), clamp(foam * uFoam, 0.0, 1.0) * 0.6);
  gl_FragColor = o * uStrength * smoothstep(hull0, hull0 + 0.25, m) * keep();
}`;

const LAVA = COMMON + `
void main() {
  float m = mask();
  if (m < 0.01) discard;
  vec2 p = vPos / uGrid;
  float t = uTime * uSpeed * 0.6;
  vec2 w = vec2(fbm(p * 0.6 + t * 0.05), fbm(p * 0.6 - t * 0.04 + 3.0)) - 0.5;
  float n = fbm(p * 1.6 + w * 1.8 + vec2(t * 0.08, -t * 0.05));
  float pulse = 0.7 + 0.3 * sin(t * 2.3 + fbm(p * 1.3) * 6.0);
  float veins = smoothstep(0.52, 0.72, n);
  vec3 hot = mix(vec3(1.0, 0.32, 0.04), vec3(1.0, 0.85, 0.45), smoothstep(0.7, 0.85, n));
  // Корка темнеет, жилы светятся и дышат.
  vec4 o = vec4(0.0, 0.0, 0.0, smoothstep(0.42, 0.25, n) * 0.35);
  o.rgb += hot * (veins * 0.95 + 0.18 * pulse * fbm(p * 0.8 + t * 0.1)) * uGlow;
  // Искры: редкие яркие точки всплывают и гаснут.
  vec2 cell = floor(p * 2.0);
  float h = hash(cell);
  float ph = fract(t * 0.25 + h * 7.0);
  vec2 sp = (cell + vec2(hash(cell + 1.3), hash(cell + 7.1))) / 2.0;
  o.rgb += vec3(1.0, 0.7, 0.3) * smoothstep(0.06, 0.0, length(p - sp)) * (1.0 - ph) * step(0.7, h) * 1.5 * uSparks;
  // Жар на берегу: светится и за краем.
  o.rgb += vec3(1.0, 0.36, 0.06) * (1.0 - smoothstep(0.0, 0.6, m)) * 0.35 * pulse * uGlow;
  gl_FragColor = o * uStrength * smoothstep(0.0, 0.3, m) * keep();
}`;

const SWAMP = COMMON + `
void main() {
  float m = mask();
  if (m < 0.01) discard;
  vec2 p = vPos / uGrid;
  float t = uTime * uSpeed;
  // Муть ползёт: зеленоватые и тёмные пятна.
  float murk = fbm(p * 0.8 + vec2(t * 0.03, t * 0.02));
  vec4 o = vec4(0.0, 0.0, 0.0, clamp(smoothstep(0.45, 0.7, murk) * 0.25 * uMurk, 0.0, 1.0));
  o = over(o, vec3(0.45, 0.55, 0.2), clamp(smoothstep(0.55, 0.3, murk) * 0.12 * uMurk, 0.0, 1.0));
  // Пузыри: в каждой клетке свой, растёт кольцом и лопается.
  for (int k = 0; k < 2; k++) {
    vec2 q = p * (1.4 + float(k) * 0.9) + float(k) * 5.3;
    vec2 cell = floor(q);
    float h = hash(cell);
    float ph = fract(t * (0.18 + 0.12 * h) + h * 9.0);
    vec2 c = cell + 0.25 + 0.5 * vec2(hash(cell + 2.1), hash(cell + 5.7));
    float r = 0.05 + ph * 0.22;
    float d = length(q - c);
    float alive = step(0.78, h) * smoothstep(1.0, 0.85, ph) * uBubbles;
    float ring = smoothstep(0.035, 0.0, abs(d - r)) * alive;
    float cap = smoothstep(r, r * 0.6, d) * alive * (1.0 - ph);
    o.rgb += vec3(0.75, 0.85, 0.55) * ring * 0.3;
    o = over(o, vec3(0.35, 0.42, 0.18), cap * 0.35);
  }
  float glint = pow(noise(p * 8.0 + vec2(t * 0.6, -t * 0.4)), 6.0);
  o.rgb += vec3(0.9, 1.0, 0.8) * smoothstep(0.3, 0.6, glint) * 0.2;
  gl_FragColor = o * uStrength * smoothstep(0.0, 0.3, m) * keep();
}`;

const FOG = COMMON + `
void main() {
  float m = mask();
  if (m < 0.01) discard;
  vec2 p = vPos / uGrid;
  float t = uTime * uSpeed;
  float f = fbm(p * 0.32 + vec2(t * 0.05, t * 0.022)) + fbm(p * 0.9 - vec2(t * 0.03, 0.0)) * 0.25;
  float a = clamp(smoothstep(0.38, 0.85, f) * 0.75 * uDensity, 0.0, 1.0);
  gl_FragColor = vec4(vec3(0.82, 0.85, 0.88) * a, a) * uStrength * m * keep();
}`;

// Водопад: струи бегут по направлению uFlow (градусы, 90 — вниз по экрану).
// Внизу, где вода кончается, — пена, а за край ползут клубы водяной пыли;
// поэтому меш с полями, и в полях рисуется только пыль. Наверху — гладкий
// тёмный перелив: вода переваливает через кромку.
const WATERFALL = COMMON + `
float maskAt(vec2 q) { return texture2D(uMask, (q * uGrid - uBounds.xy) / uBounds.zw).r; }
void main() {
  vec2 p = vPos / uGrid;
  float t = uTime * uSpeed;
  float rad = radians(uFlow);
  vec2 dir = vec2(cos(rad), sin(rad));
  vec2 side = vec2(-dir.y, dir.x);
  float a = dot(p, dir), b = dot(p, side);
  float m = mask();
  // Сколько воды выше по течению: пыль клубится там, куда вода упала.
  float up = max(maskAt(p - dir * 0.5) * 0.9, max(maskAt(p - dir * 1.1) * 0.65, maskAt(p - dir * 1.8) * 0.35));
  float ahead = maskAt(p + dir * 0.45);
  float behind = maskAt(p - dir * 0.45);
  if (m < 0.01 && up < 0.02) discard;
  vec4 o = vec4(0.0);
  float body = smoothstep(0.15, 0.5, m);
  // Струи: шум, вытянутый вдоль течения и бегущий по нему; две скорости.
  float s1 = noise(vec2(b * 7.0, a * 0.55 - t * 2.6));
  float s2 = noise(vec2(b * 15.0 + 3.1, a * 1.1 - t * 4.1));
  float streak = smoothstep(0.55, 0.95, s1 * 0.6 + s2 * 0.55);
  float gap = smoothstep(0.45, 0.15, s1);
  o = over(o, vec3(0.0, 0.03, 0.06), gap * 0.22 * body * uStreaks);
  o.rgb += vec3(0.85, 0.95, 1.0) * streak * 0.42 * body * uStreaks;
  // Верхняя кромка: впереди вода есть, позади нет — гладкий светлый перелив.
  float lip = smoothstep(0.25, 0.6, ahead - behind) * body;
  o = over(o, vec3(0.75, 0.88, 0.95), lip * 0.25 * (0.7 + 0.3 * sin(b * 3.0 + t * 1.3)));
  // Низ: позади вода, впереди уже нет — бурлит пена.
  // Пена шире полосы края маски: смотрим на клетку назад и полклетки вперёд.
  float foot = clamp((maskAt(p - dir * 0.9) - maskAt(p + dir * 0.35)) * 1.8, 0.0, 1.0) * smoothstep(0.02, 0.3, m + up * 0.5);
  float churn = fbm(vec2(b * 2.2, a * 2.2 - t * 1.7)) * 0.6 + fbm(p * 4.5 + vec2(t * 0.9, -t * 1.4)) * 0.5;
  float foam = foot * smoothstep(0.36, 0.7, churn);
  o = over(o, vec3(0.94, 0.97, 1.0), clamp(foam * 0.95 * uSpray, 0.0, 1.0));
  // Водяная пыль за краем: мягкие клубы расходятся вниз и в стороны и тают.
  float beyond = clamp(up - m * 0.6, 0.0, 1.0);
  float puff = fbm(vec2(b * 1.4 + sin(t * 0.3) * 0.3, a * 1.4 - t * 0.8)) * 0.7 + fbm(p * 3.0 - dir * t * 0.6) * 0.4;
  float mist = beyond * smoothstep(0.3, 0.75, puff);
  o = over(o, vec3(0.9, 0.95, 1.0), clamp(mist * 0.65 * uSpray, 0.0, 0.75));
  // Брызги: мелкие яркие капли мелькают у подножия.
  vec2 cell = floor(p * 5.0);
  float h = hash(cell + floor(t * 3.0));
  vec2 c = (cell + vec2(hash(cell + 1.7), hash(cell + 4.3))) / 5.0;
  float drop = smoothstep(0.05, 0.0, length(p - c)) * step(0.8, h) * max(foot, beyond * 0.6);
  o.rgb += vec3(1.0) * drop * 0.5 * uSpray;
  gl_FragColor = o * uStrength * keep();
}`;

// Фонтан сверху, круглый, в три чаши (встроенный фонтан Картографа). Область —
// большая чаша, uRadius — её край; остальное в долях полуразмера всего фонтана H.
// Кольца по картинке: носик 0–0.06, верхняя чаша 0.06–0.17, её бортик 0.17–0.22,
// средняя чаша 0.22–0.29, бортик 0.29–0.36, нижняя чаша 0.36–0.727.
// Из носика бьёт невысокая струя: белое ядро, капли разлетаются и падают в верхнюю
// чашу. Через край каждой чаши вода переливается тонкой плёнкой со струями наружу,
// под бортиком — пена, от неё по чаше расходятся круги: вода идёт от середины к краю.
const FOUNTAIN = COMMON + `
float band(float r, float a, float b) { return smoothstep(a - 0.004, a + 0.006, r) * smoothstep(b + 0.004, b - 0.006, r); }
// Круги по чаше от кольца r0 к r1: гребень светлее, впадина темнее, к краю тают.
vec4 rings(vec4 o, float r, float ang, float r0, float r1, float t, float k) {
  float w = band(r, r0, r1);
  if (w <= 0.0) return o;
  float x = (r - r0) / (r1 - r0);
  float rr = r + 0.006 * (noise(vec2(ang * 7.0, t * 0.6)) - 0.5) + 0.004 * sin(ang * 13.0 + t);
  float wave = sin(rr * k - t * 4.2);
  float fade = exp(-x * 2.4) * w;
  o = over(o, vec3(0.02, 0.06, 0.1), smoothstep(0.2, 1.0, -wave) * 0.16 * fade * uRipple);
  o.rgb += vec3(0.75, 0.9, 1.0) * smoothstep(0.55, 1.0, wave) * 0.22 * fade * uRipple;
  return o;
}
// Перелив через бортик: от r0 до края r1 плёнка воды, струи бегут наружу,
// под краем — пена шириной foam.
vec4 spill(vec4 o, float r, float ang, float r0, float r1, float foam, float t) {
  // Плёнка — лишь по наружной половине бортика: верх камня остаётся сухим.
  float sheet = band(r, r0 + (r1 - r0) * 0.45, r1) * smoothstep(r0 + (r1 - r0) * 0.45, r1 - (r1 - r0) * 0.1, r);
  if (sheet > 0.0) {
    float s1 = noise(vec2(ang * 70.0, r * 50.0 - t * 6.0));
    float s2 = noise(vec2(ang * 150.0 + 2.3, r * 90.0 - t * 9.0));
    float streak = smoothstep(0.6, 0.95, s1 * 0.6 + s2 * 0.5);
    o = over(o, vec3(0.4, 0.6, 0.72), sheet * 0.3 * uSpill);
    o.rgb += vec3(0.85, 0.95, 1.0) * streak * sheet * 0.3 * uSpill;
  }
  float land = band(r, r1, r1 + foam) * (1.0 - smoothstep(r1, r1 + foam, r) * 0.7);
  if (land > 0.0) {
    float churn = fbm(vec2(ang * 22.0, r * 70.0 - t * 2.2)) * 0.65 + noise(vec2(ang * 60.0 + t * 1.3, r * 140.0 - t * 5.0)) * 0.45;
    o = over(o, vec3(0.93, 0.97, 1.0), clamp(land * smoothstep(0.48, 0.8, churn) * 0.7 * uSpill, 0.0, 1.0));
  }
  return o;
}
void main() {
  float m = mask();
  if (m < 0.01) discard;
  vec2 p = vPos / uGrid;
  float t = uTime * uSpeed;
  float H = uRadius / 0.727;
  vec2 q = (p - uCenter) / H;
  float r = length(q);
  float ang = atan(q.y, q.x);
  vec4 o = vec4(0.0);
  // Круги по трём чашам: от места, куда падает вода, к краю чаши.
  o = rings(o, r, ang, 0.06, 0.17, t * 1.3, 260.0);
  o = rings(o, r, ang, 0.22, 0.29, t * 1.15, 230.0);
  o = rings(o, r, ang, 0.36, 0.727, t, 150.0);
  // Блики: редкие мягкие искры вспыхивают и гаснут — по воде, а не по камню.
  float water = band(r, 0.06, 0.17) + band(r, 0.22, 0.29) + band(r, 0.36, 0.727);
  vec2 gq = q * 46.0;
  vec2 gc = floor(gq);
  float gh = hash(gc);
  vec2 gpos = vec2(hash(gc + 2.3), hash(gc + 7.1)) * 0.6 + 0.2;
  float tw = pow(max(sin(t * (1.2 + gh * 1.5) + gh * 40.0), 0.0), 10.0);
  float spark = smoothstep(0.16, 0.0, length(fract(gq) - gpos)) * step(0.72, gh) * tw;
  o.rgb += vec3(1.0) * spark * 0.55 * water * uGlint;
  // Переливы: верхняя чаша в среднюю, средняя в нижнюю.
  o = spill(o, r, ang, 0.17, 0.22, 0.03, t);
  o = spill(o, r, ang, 0.29, 0.36, 0.045, t);
  // Струя из носика: ядро пульсирует, вокруг — зонтик водяной пыли.
  float pulse = 0.85 + 0.15 * sin(t * 3.1) * sin(t * 1.7 + 1.0);
  float core = exp(-pow(r / (0.045 * pulse), 2.0));
  float umb = smoothstep(0.13, 0.03, r) * smoothstep(0.35, 0.8, fbm(vec2(ang * 5.0, r * 30.0 - t * 3.0)));
  o = over(o, vec3(0.9, 0.96, 1.0), clamp((core * 0.9 + umb * 0.35) * uJet, 0.0, 0.95));
  // Капли: из носика наружу, падают в верхнюю чашу и оставляют всплеск.
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float sectors = 18.0 + fk * 7.0;
    float sec = floor((ang / 6.2831853 + 0.5) * sectors);
    float h = hash(vec2(sec, fk * 3.7));
    float life = fract(t * (0.55 + 0.25 * h) + h * 7.0);
    float a0 = ((sec + 0.2 + 0.6 * hash(vec2(sec, fk + 9.1))) / sectors - 0.5) * 6.2831853;
    float reach = 0.1 + 0.05 * hash(vec2(sec + 3.0, fk));
    vec2 d = vec2(cos(a0), sin(a0)) * mix(0.03, reach, life);
    float drop = smoothstep(0.011, 0.0, length(q - d)) * (1.0 - life * 0.5);
    float land = smoothstep(0.85, 1.0, life);
    float splash = smoothstep(0.02, 0.0, abs(length(q - vec2(cos(a0), sin(a0)) * reach) - 0.012 * land)) * land * (1.0 - land) * 4.0;
    o.rgb += vec3(1.0) * (drop * 0.7 + splash * 0.35) * uJet;
  }
  gl_FragColor = o * uStrength * m * keep();
}`;

const BLAZE = `
// Огонь: языки из шума с закруткой бегут вверх по экрану, у основания яркая
// сердцевина, по краю мелкая рвань. q — точка в долях размера огня, d — сколько
// от источника, reach — высота языков. Вверх по экрану языки выше: пламя тянется.
vec4 blaze(vec2 q, float d, float t, float seed, float reach) {
  vec2 w = q * 2.4 + seed;
  vec2 warp = vec2(fbm(w * 1.3 + vec2(0.0, t * 1.4)), fbm(w * 1.3 + vec2(4.7, t * 1.2)));
  w += (warp - 0.5) * 0.9;
  float n = fbm(w * 1.8 + vec2(0.0, t * 2.6));
  float up = clamp(-q.y / max(length(q), 0.001), -1.0, 1.0);
  // Языки врозь, между ними просветы; вверх по экрану выше, книзу ниже.
  float tongue = smoothstep(0.32, 0.72, n);
  float h = reach * (0.1 + 1.25 * tongue) * (0.55 + 0.75 * max(up, 0.0) + 0.25 * up);
  float i = clamp(1.0 - d / max(h, 0.001), 0.0, 1.0);
  // Основание неровное: где языка нет, и у корня огонь слабее.
  i *= 0.45 + 0.55 * smoothstep(0.25, 0.6, n);
  float fine = fbm(w * 5.5 + vec2(0.0, t * 4.5));
  i = clamp(i * (0.6 + 0.8 * fine), 0.0, 1.0);
  vec3 col = mix(vec3(0.5, 0.05, 0.01), vec3(0.92, 0.28, 0.03), smoothstep(0.08, 0.38, i));
  col = mix(col, vec3(1.0, 0.62, 0.14), smoothstep(0.4, 0.72, i));
  col = mix(col, vec3(1.0, 0.9, 0.62), smoothstep(0.86, 1.0, i));
  return vec4(col, smoothstep(0.08, 0.32, i) * (0.75 + 0.25 * smoothstep(0.3, 0.7, i)));
}
`;

// Огонь сверху. Где горит — «топливо» F: у костра пятно в середине области, у
// пожара (`uSpread` → 1) вся область, неровно, с прогоревшими местами.
//
// Сверху пламя растёт к зрителю, и глаз читает его как языки, расходящиеся от
// очага во все стороны: в середине самые высокие и жаркие (белёсо-жёлтые), к краю
// ниже и холоднее (оранжевые, красные), на кончиках — дымная кайма. Поэтому языки
// идут не «вверх по экрану», а наружу от топлива — по убыванию F (у костра это
// лучи от середины, у пожара каждое горящее пятно лижет края во все стороны), с
// креном по ветру. Точка горит, если позади неё (против этого направления) есть
// топливо и шум, бегущий наружу, там достаточно силён; чем дальше от топлива,
// тем сильнее нужен шум. Шум у костра — в полярных координатах (лучи), у пожара —
// сносится наружу двумя сдвинутыми по фазе слоями, чтобы рисунок не растягивался.
// Два слоя языков: длинные медленные и короткие быстрые поверх. Цвет — по жару.
// Под огнём угли и обугленная земля, вокруг отсвет; дым и искры уходят по ветру.
const FIRE = COMMON + `
uniform float uSpread;
float maskAt(vec2 q) { return texture2D(uMask, (q * uGrid - uBounds.xy) / uBounds.zw).r; }
float hash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), u.x);
  float b = mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), u.x);
  float c = mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), u.x);
  float d = mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
float fbm3(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise3(p); p = p * 2.02 + vec3(13.1, 7.7, 3.3); a *= 0.5; }
  return v;
}
// Сколько топлива в точке: 0..1.
float fuel(vec2 q, float t) {
  float rc = clamp(uRadius * 0.6, 0.3, 2.5);
  float camp = smoothstep(rc, rc * 0.25, length(q - uCenter));
  // Пожар: по маске области, пятнами — где-то прогорело, где-то разгорается.
  float patches = smoothstep(0.38, 0.6, fbm(q * 0.55 + vec2(t * 0.03, -t * 0.02)));
  float blaze = smoothstep(0.35, 0.85, maskAt(q)) * patches;
  return mix(camp, blaze, uSpread);
}
vec2 windDir() { float rad = radians(uWind); return vec2(cos(rad), sin(rad)); }
float smoke(vec2 p, vec2 src, float t, float wide) {
  vec2 w = windDir();
  vec2 q = p - src;
  float along = dot(q, w);
  float across = dot(q, vec2(-w.y, w.x));
  if (along < -0.4 - wide) return 0.0;
  float width = 0.3 + wide + along * 0.42;
  float body = exp(-across * across / (width * width)) * smoothstep(-0.3 - wide, 0.35, along) * exp(-max(along, 0.0) * 0.22);
  // Перед очагом (along < 0) делитель не меньше 0,6: иначе у большого очага
  // он уходил в ноль, и шум разлетался лучами из одной точки.
  float puffs = fbm(vec2(along * 1.4 - t * 1.1, across * 1.8 / (0.6 + max(along, 0.0) * 0.4)) + src * 3.1);
  return body * smoothstep(0.22, 0.62, puffs) * smoothstep(8.5 + wide, 5.0 + wide, along);
}
vec3 heatColor(float h) {
  vec3 c = mix(vec3(0.35, 0.03, 0.0), vec3(0.85, 0.18, 0.02), smoothstep(0.0, 0.3, h));
  c = mix(c, vec3(1.0, 0.5, 0.08), smoothstep(0.3, 0.6, h));
  c = mix(c, vec3(1.0, 0.82, 0.35), smoothstep(0.6, 0.85, h));
  return mix(c, vec3(1.0, 0.97, 0.82), smoothstep(0.88, 1.0, h));
}
const float PI2 = 6.2831853;
float hash1(float x) { return fract(sin(x * 12.9898) * 43758.5453); }
// Один очаг сверху: шесть языков-лепестков от середины. У каждого своя длина
// (дрожит), угол (качается) и изгиб; у основания языки широкие и сливаются в
// сплошное пламя, к кончикам сужаются и расходятся. Край рвёт шум, дальние части
// сносит ветром. raw — жар без порога: 1 в середине, к кончикам к нулю.
// turb — шум рваного края (wob, rag, len) в этой точке: один на точку для всех очагов.
// hot — жар середины: у костра выше языков, у очагов пожара ниже, чтобы
// они не горели одинаковыми звёздочками.
float flameAt(vec2 p, vec2 c, float size, float seed, float t, vec3 turb, float hot) {
  vec2 rel = (p - c) / size;
  rel -= windDir() * 0.3 * length(rel);
  float r = length(rel);
  if (r > 1.3) return 0.0;
  float ang = atan(rel.y, rel.x) + (turb.x - 0.5) * 1.0 * r + (turb.y - 0.5) * 0.35 * r;
  float rr = r * (0.84 + 0.3 * turb.z + 0.12 * (turb.y - 0.5));
  float petals = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float hi = hash1(seed * 7.13 + fi * 3.71);
    float a = (fi + 0.6 * hi) / 6.0 * PI2 + 0.35 * sin(t * (0.7 + 0.6 * hi) + hi * 6.2) + 0.7 * rr * (hi - 0.5);
    // Длина дрожит: два синуса разной частоты — дёшево и без повтора на глаз.
    float len = 0.6 + 0.2 * (sin(t * (1.9 + 1.3 * hi) + hi * 20.0) + sin(t * (3.7 + 2.1 * hi) + seed + fi)) * 0.5 + 0.2;
    float dd = abs(mod(ang - a + PI2 * 0.5, PI2) - PI2 * 0.5);
    float x = clamp(rr / len, 0.0, 1.0);
    float wid = 0.66 * pow(1.0 - x, 0.65);
    // Край языка мягкий: очаги вливаются в общее пламя, а не лежат узором.
    float body = (1.0 - smoothstep(wid * 0.3, wid + 0.08, dd)) * smoothstep(len, len * 0.85, rr);
    petals = max(petals, body * (1.0 - x));
  }
  float core = 1.0 - smoothstep(0.0, 0.42, rr);
  // Прожилки: светлые и тёмные струи бегут от середины к кончикам.
  vec2 dir = rel / max(r, 0.25);
  float streak = noise3(vec3(dir * 5.0 + seed, rr * 1.8 - t * 3.2));
  // Середина жарче языков: там пламя выше всего.
  return max(petals, core * hot) * (0.72 + 0.5 * streak);
}
// Весь огонь в точке: у костра — большой очаг и три поменьше вокруг, у пожара —
// сетка очагов по горящим пятнам (у каждой клетки свой, со сдвигом), их языки
// перекрываются в сплошное пламя, по краю — отдельные языки наружу.
float fireAt(vec2 p, float t) {
  float heat = 0.0;
  if (uSpread < 0.5) {
    float rc = clamp(uRadius * 0.6, 0.3, 2.5);
    float reach = 0.55 + rc * 0.95;
    if (length(p - uCenter) > reach * 1.5 + rc) return 0.0;
  vec3 turb = vec3(noise3(vec3(p * 2.6, t * 1.6)), noise3(vec3(p * 9.5, t * 4.0)), noise3(vec3(p * 4.8 + 7.0, t * 2.8)));
    heat = flameAt(p, uCenter, reach, 1.7, t, turb, 1.2);
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float a = fk / 3.0 * PI2 + t * 0.15 + hash1(fk + 4.0) * 2.0;
      // Малые очаги — у середины и слабее: дают лишние языки, а не свои огни.
      vec2 c = uCenter + vec2(cos(a), sin(a)) * rc * 0.28;
      heat = max(heat, flameAt(p, c, reach * 0.7, 9.0 + fk * 4.3, t * 1.15, turb, 1.0) * 0.7);
    }
    return heat;
  }
  // Дальше клетки от области огня нет — там только дым, языки не считаем.
  float m = max(maskAt(p), max(max(maskAt(p + vec2(1.1, 0.0)), maskAt(p - vec2(1.1, 0.0))), max(maskAt(p + vec2(0.0, 1.1)), maskAt(p - vec2(0.0, 1.1)))));
  if (m < 0.02) return 0.0;
  vec3 turb = vec3(noise3(vec3(p * 2.6, t * 1.6)), noise3(vec3(p * 9.5, t * 4.0)), noise3(vec3(p * 4.8 + 7.0, t * 2.8)));
  // Тело пожара: сплошное пламя над топливом, по нему бегут струи — от него
  // очаги ниже дают языки наружу и объём.
  float f = fuel(p, t);
  // Край тела рваный и внутри области, по телу — тёмно-красные провалы и
  // жёлтые сгустки, они переливаются.
  float edge = (noise3(vec3(p * 3.0, t * 1.1)) - 0.5) * 0.35;
  float churn = fbm3(vec3(p * 1.6, t * 0.9));
  float body = smoothstep(0.35, 0.95, f + edge) * (0.25 + 0.75 * smoothstep(0.25, 0.75, churn)) * (0.85 + 0.3 * noise3(vec3(p * 6.0, t * 3.0)));
  heat = body * 0.72;
  float S = 0.9;
  vec2 ip = floor(p / S);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = ip + vec2(float(x), float(y));
      vec2 jit = vec2(hash(cell + 0.37), hash(cell + 5.91));
      vec2 c = (cell + 0.2 + 0.6 * jit) * S;
      float fc = fuel(c, t);
      // Не в каждой клетке очаг, и очаги разные: иначе пожар — обои из звёздочек.
      if (fc < 0.12 || hash(cell + 2.2) < 0.28) continue;
      float size = S * (0.6 + 0.7 * jit.x * jit.x) * mix(0.6, 1.0, fc);
      heat = max(heat, flameAt(p, c, size, jit.y * 31.0 + cell.x * 0.7, t, turb, 0.7 + 0.35 * jit.x) * mix(0.55, 0.88, fc));
    }
  }
  return heat;
}
void main() {
  vec2 p = vPos / uGrid;
  float t = uTime * uSpeed;
  float f0 = fuel(p, t);
  vec2 W = windDir();
  // Отсвет вокруг: топливо, взятое шире, мерцает.
  float near = max(f0, max(max(fuel(p + vec2(0.6, 0.0), t), fuel(p - vec2(0.6, 0.0), t)), max(fuel(p + vec2(0.0, 0.6), t), fuel(p - vec2(0.0, 0.6), t))) * 0.7);
  float flick = 0.82 + 0.18 * noise(vec2(t * 3.1, p.x * 0.3));
  // Дым — под огнём, над землёй.
  float wide = uRadius * 0.55 * uSpread;
  float sm = clamp(smoke(p, uCenter, t, wide) * uSmoke * 0.95, 0.0, 0.88);
  vec4 o = vec4(vec3(0.5, 0.5, 0.53) * sm, sm);
  // Обугленная земля и угли под пожаром.
  float coal = fbm(p * 4.0 + vec2(0.0, t * 0.2));
  o = over(o, vec3(0.06, 0.04, 0.03), f0 * 0.45 * uSpread);
  o.rgb += vec3(1.0, 0.3, 0.05) * f0 * smoothstep(0.5, 0.75, coal) * (0.5 + 0.5 * sin(t * 2.0 + coal * 9.0)) * 0.55;
  float raw = fireAt(p, t);
  // Жар неровный: яркие сгустки и тусклые места.
  float core = noise(p * 4.0 + vec2(t * 1.1, -t * 0.9));
  float h = clamp(raw * (0.85 + 0.3 * core), 0.0, 1.0);
  // Кончики языков темнеют в копоть — мягко, без обводки.
  float soot = smoothstep(0.0, 0.08, raw) * (1.0 - smoothstep(0.06, 0.3, raw));
  o = over(o, vec3(0.1, 0.055, 0.035), soot * 0.18 * uFlame);
  vec3 col = heatColor(h);
  // Кончики полупрозрачные, тело и середина — плотные.
  float a = smoothstep(0.02, 0.45, h) * uFlame;
  // Тело огня — обычной прозрачностью, жар — сложением поверх.
  o = over(o, col, clamp(a * 0.85, 0.0, 1.0));
  o.rgb += col * smoothstep(0.55, 1.0, h) * 0.32 * uFlame;
  // Отсвет на земле.
  o.rgb += vec3(1.0, 0.42, 0.1) * near * (1.0 - h) * 0.22 * flick * uFlame;
  // Искры: подхвачены жаром и ветром, гаснут на лету.
  for (int k = 0; k < 2; k++) {
    float sc = 2.4 + float(k) * 1.7;
    vec2 q = (p - W * t * (0.7 + 0.35 * float(k)) + vec2(sin(t * 0.7 + float(k)) * 0.2, cos(t * 0.6 + float(k)) * 0.2)) * sc;
    vec2 cell = floor(q);
    float hh = hash(cell + float(k) * 3.1);
    vec2 sp = cell + vec2(hash(cell + 1.7), hash(cell + 9.2));
    float life = fract(hh * 7.0 + t * 0.35);
    // Искра летит от огня: позади неё по ветру, на пройденный путь, должно гореть.
    float src = fuel(p - W * (0.3 + life * 1.4), t);
    float spark = smoothstep(0.09, 0.0, length(q - sp)) * step(0.82, hh) * (1.0 - life) * src;
    o.rgb += vec3(1.0, 0.75, 0.3) * spark * 1.2 * uFlame;
  }
  gl_FragColor = o * uStrength * keep();
}`;


// Неон по швам пола: плиты лежат по сетке, поэтому швы — линии сетки, искать
// их на картинке не нужно. Швы чуть тлеют, по части линий бегут импульсы:
// яркая голова и хвост, у каждой линии своё направление, скорость и шаг.
// Свет только прибавляется к картинке (прозрачность 0).
const NEON = COMMON + `
uniform float uPulses, uSeams, uNeonColor;
vec3 neonTint() {
  if (uNeonColor < 0.5) return vec3(0.25, 0.95, 1.0);
  if (uNeonColor < 1.5) return vec3(1.0, 0.3, 0.95);
  return vec3(1.0, 0.72, 0.25);
}
// Импульс на линии номер line в точке s вдоль неё: 0..1.
float pulse(float s, float line, float t) {
  float dir = hash(vec2(line, 7.3)) < 0.5 ? -1.0 : 1.0;
  float sp = 1.0 + 2.2 * hash(vec2(line, 3.1));
  float period = 7.0 + 11.0 * hash(vec2(line, 11.7));
  float u = fract((s * dir - t * sp) / period + hash(vec2(line, 5.9)) * 4.0);
  float b = exp(-(1.0 - u) * period / 0.75) * smoothstep(1.0, 0.992, u);
  return b * step(1.0 - 0.45 * uPulses, hash(vec2(line, 19.9)));
}
void main() {
  float m = mask() * keep();
  if (m < 0.01) { gl_FragColor = vec4(0.0); return; }
  vec2 p = vPos / uGrid;
  vec2 f = abs(fract(p + 0.5) - 0.5);
  vec2 n = floor(p + 0.5);
  float px = 1.0 / uGrid;
  float core = max(0.009, 1.2 * px);
  vec2 line = smoothstep(core + 1.5 * px, core * 0.4, f);
  vec2 halo = exp(-max(f - core, 0.0) / 0.05);
  float t = uTime;
  float pv = pulse(p.y, n.x, t);
  float ph = pulse(p.x, n.y + 101.0, t);
  vec3 c = neonTint();
  float seams = 0.07 * uSeams * max(line.x, line.y) + 0.012 * uSeams * max(halo.x, halo.y);
  float light = pv * (line.x * 1.1 + halo.x * 0.35) + ph * (line.y * 1.1 + halo.y * 0.35);
  vec3 o = c * (seams + light) + vec3(0.85) * (pv * line.x + ph * line.y) * 0.4;
  gl_FragColor = vec4(o * m * uStrength, 0.0);
}`;

// Разлом: трещина в реальности посреди пола. Карта ничего не должна знать —
// разлом рисуется целиком: зубчатая щель вдоль длинной оси области (uAxis,
// полуоси uHalf в клетках), внутри — пустота со звёздами и туманностью, по краю
// раскалённая кромка с цветными тенями, вокруг тёмный ожог, трещины в полу,
// по которым бегут волны света, кольца-волны времени и искры, которые
// затягивает внутрь. Раз в несколько секунд время сбоит: на треть секунды всё
// отматывается назад и прыгает вперёд, кромка расслаивается по цветам.
// uOpen 0..1 — открытие и закрытие (щель растёт от середины к концам).
const RIFT = COMMON + `
uniform vec2 uAxis, uHalf;
uniform float uOpen, uSeed, uRiftGlow, uRiftCracks, uRiftMotes, uRiftColor;
vec3 riftTint() {
  if (uRiftColor < 0.5) return vec3(0.62, 0.38, 1.0);
  if (uRiftColor < 1.5) return vec3(0.3, 0.85, 1.0);
  if (uRiftColor < 2.5) return vec3(1.0, 0.76, 0.3);
  return vec3(1.0, 0.27, 0.35);
}
// Трещины лучами от щели: через каждые 0,8 клетки вдоль оси — своя ломаная наружу,
// с каждой стороны своя длина или её нет. a — вдоль оси, off — от кромки наружу,
// side — сторона. Возвращает силу линии и сколько пройдено от кромки (0..1).
vec2 cracksOf(float a, float off, float side) {
  float best = 0.0, run = 1.0;
  for (int k = -1; k <= 1; k++) {
    float lane = floor(a / 0.8) + float(k);
    float id = lane * side + uSeed;
    if (hash(vec2(id, 47.0)) < 0.3) continue;
    float h = hash(vec2(id, 31.0));
    float len = (0.4 + 1.5 * hash(vec2(id, 5.0))) * (0.6 + 0.4 * min(uHalf.y, 2.0));
    if (off < -0.05 || off > len) continue;
    float s = off * 5.0;
    float zi = floor(s);
    float zz = mix(hash(vec2(zi, id)), hash(vec2(zi + 1.0, id)), fract(s)) - 0.5;
    float jit = noise(vec2(off * 16.0, id)) - 0.5;
    float ac = (lane + 0.2 + 0.6 * h) * 0.8 + zz * 0.3 + jit * 0.05 + off * (h - 0.5) * 0.9;
    float thick = 0.03 * (1.0 - off / len) + 0.007;
    float line = smoothstep(thick, thick * 0.3, abs(a - ac)) * smoothstep(len, len * 0.5, off);
    if (line > best) { best = line; run = off / len; }
  }
  return vec2(best, run);
}
// Середина щели поперёк оси: ломаная по отрезкам, плавный изгиб и мелкая зубчатость.
float spine(float a) {
  float n = max(3.0, uHalf.x * 1.6);
  float s = (a / uHalf.x * 0.5 + 0.5) * n;
  float i = floor(s);
  float zig = mix(hash(vec2(i, uSeed)), hash(vec2(i + 1.0, uSeed)), fract(s)) - 0.5;
  float bend = noise(vec2(a * 0.45 + uSeed, uSeed)) - 0.5;
  float jag = noise(vec2(a * 5.0, uSeed * 1.7)) - 0.5;
  return zig * min(uHalf.y, 1.2) * 0.55 + bend * uHalf.y * 0.5 + jag * 0.08;
}
void main() {
  float m = mask() * keep();
  if (m < 0.01) discard;
  vec2 p = vPos / uGrid;
  vec2 rel = p - uCenter;
  float a = dot(rel, uAxis);
  float b = dot(rel, vec2(-uAxis.y, uAxis.x));
  float t = uTime;
  // Сбой времени: в каждом пятисекундном окне в случайный миг на 0,35 с время идёт назад втрое быстрее.
  float cyc = floor(t / 5.0);
  float at = t - cyc * 5.0;
  float g0 = 1.0 + 3.0 * hash(vec2(cyc, uSeed + 3.1));
  float glitch = step(g0, at) * step(at, g0 + 0.35);
  float tt = t - glitch * (at - g0) * 4.0;
  float open = clamp(uOpen, 0.0, 1.0);
  float flash = 1.0 + 6.0 * open * (1.0 - open);
  vec3 tint = riftTint();
  float flick = 0.85 + 0.15 * noise(vec2(tt * 7.0, uSeed));

  // Щель: ширина сходит на нет к концам, дышит и гуляет.
  float u = a / max(uHalf.x, 0.5);
  float reach = max(open * open * (3.0 - 2.0 * open), 0.001);
  float taper = pow(max(0.0, 1.0 - (u / reach) * (u / reach)), 0.6);
  float breath = 0.85 + 0.15 * sin(tt * 1.7 + u * 3.0);
  float wob = 0.65 + 0.7 * noise(vec2(a * 1.3 + uSeed, tt * 0.25));
  // Рваный край: мелкие зубцы и редкие сколы.
  float tear = 0.78 + 0.34 * noise(vec2(a * 7.0, uSeed + 2.0)) - 0.3 * pow(noise(vec2(a * 13.0, uSeed + 9.0)), 3.0);
  float width = uHalf.y * 0.32 * taper * breath * wob * tear * open;
  float c = spine(a);
  float dist = abs(b - c);
  // Расстояние до щели целиком: за её концами — до кончика.
  float beyond = max(abs(u) - reach, 0.0) * uHalf.x;
  float gap = length(vec2(beyond, max(dist - width, 0.0)));
  float tail = smoothstep(reach + 0.25, reach, abs(u));

  vec4 o = vec4(0.0);
  // Ожог вокруг: пол темнеет и отливает цветом разлома.
  o = over(o, mix(vec3(0.03, 0.0, 0.05), tint * 0.08, 0.5), clamp(exp(-gap / 0.45) * 0.4 * open, 0.0, 1.0));

  // Трещины в полу расходятся от кромки; по ним от щели бегут волны света.
  float side = b - c >= 0.0 ? 1.0 : -1.0;
  vec2 cr = cracksOf(a, dist - width, side) * vec2(tail * open * uRiftCracks, 1.0);
  o = over(o, vec3(0.02, 0.0, 0.03), clamp(cr.x * 0.85, 0.0, 1.0));
  float wave = 0.5 + 0.5 * sin((dist - width) * 6.0 - tt * 3.0);
  o.rgb += tint * cr.x * (0.35 + 1.1 * wave * wave) * (1.0 - cr.y * 0.6) * flick;

  // Волны времени: кольца расходятся от щели.
  for (int k = 0; k < 2; k++) {
    float rp = fract(tt * 0.22 + float(k) * 0.5 + hash(vec2(uSeed, 1.0)));
    float rr = rp * (1.0 + uHalf.y * 1.3);
    float ring = exp(-abs(gap - rr) / 0.05) * (1.0 - rp) * smoothstep(0.0, 0.1, rp);
    o.rgb += tint * ring * 0.3 * uRiftGlow * open;
  }

  // Свечение наружу (до пустоты: внутри щели его закроет темнота).
  o.rgb += tint * exp(-gap / (0.2 + 0.25 * uRiftGlow)) * 0.45 * flick * flash * open * uRiftGlow;

  // Пустота внутри щели: туманность и звёзды плывут против хода времени.
  float inside = smoothstep(width, width - 0.05, dist) * step(0.002, width) * step(abs(u), reach);
  if (inside > 0.0) {
    vec2 v = vec2(a, b - c);
    // Туманность медленно закручивается; второй цвет — дополнительный к цвету разлома.
    float sw = sin(tt * 0.15), cw = cos(tt * 0.15);
    vec2 vr = mat2(cw, -sw, sw, cw) * v;
    float neb = fbm(vr * 1.3 + uSeed);
    float neb2 = fbm(vr * 2.2 - vec2(tt * 0.1, 0.0) + uSeed + 7.0);
    vec3 voidc = vec3(0.005, 0.0, 0.015);
    // Тонкие клочья, не заливка: сквозь щель видна чернота.
    voidc += tint * 0.22 * smoothstep(0.62, 0.9, neb);
    voidc += (vec3(1.0) - tint) * 0.08 * smoothstep(0.66, 0.9, neb2);
    for (int k = 0; k < 2; k++) {
      float z = 6.0 + float(k) * 6.0;
      vec2 sv = v * z + vec2(-tt * (0.35 + float(k) * 0.4), float(k) * 3.7);
      vec2 sc = floor(sv);
      float sh = hash(sc + uSeed + float(k) * 11.0);
      vec2 sp = sc + 0.2 + 0.6 * vec2(hash(sc + 2.3), hash(sc + 5.1));
      float sd = length(sv - sp);
      float tw = (0.6 + 0.4 * sin(tt * 3.0 + sh * 30.0)) * step(0.75, sh);
      // Ядро звезды и мягкий ореол в цвет разлома.
      voidc += (vec3(0.95, 0.95, 1.0) * smoothstep(0.16, 0.0, sd) + tint * 0.35 * smoothstep(0.45, 0.0, sd)) * tw * (1.2 - float(k) * 0.45);
    }
    // У самой кромки пустота подсвечена — видно глубину.
    voidc += tint * pow(smoothstep(width * 0.7, width, dist), 3.0) * 0.35;
    o = over(o, voidc, inside * 0.98);
  }

  // Кромка: три цвета чуть врозь, при сбое расходятся сильнее.
  float ca = 0.012 + glitch * 0.12;
  vec3 rim = vec3(exp(-abs(dist - width - ca) / 0.03), exp(-abs(dist - width) / 0.03), exp(-abs(dist - width + ca) / 0.03));
  o.rgb += rim * mix(vec3(1.0), tint, 0.35) * 1.1 * flick * flash * tail * uRiftGlow;

  // Искры: летят к щели с обеих сторон и гаснут на кромке.
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float lane = floor(a * 1.5 + fk * 0.31);
    float h = hash(vec2(lane + fk * 13.0, uSeed));
    float ph = fract(tt * (0.12 + 0.1 * h) + h * 7.0);
    float sd = hash(vec2(lane, fk + uSeed + 4.0)) < 0.5 ? -1.0 : 1.0;
    float ma = (lane + 0.2 + 0.6 * hash(vec2(lane, fk + 8.0)) - fk * 0.31) / 1.5;
    float mb = c + sd * (width + (1.0 - ph) * (0.6 + uHalf.y * 0.8));
    float dd = length(vec2(a - ma, b - mb));
    float alive = step(0.45, h) * smoothstep(0.0, 0.25, ph) * smoothstep(1.0, 0.85, ph) * smoothstep(reach, reach * 0.7, abs(ma) / max(uHalf.x, 0.5));
    o.rgb += mix(tint, vec3(1.0), 0.5) * smoothstep(0.07, 0.0, dd) * alive * uRiftMotes * open * 1.4;
  }

  // Мягко к краю области: у нарисованной вручную не проступает её контур.
  gl_FragColor = o * uStrength * smoothstep(0.05, 0.95, m);
}`;

export const FRAG = { water: WATER, waterfall: WATERFALL, fountain: FOUNTAIN, lava: LAVA, swamp: SWAMP, fog: FOG, fire: FIRE, neon: NEON, rift: RIFT };

// Горящий токен: кольцо пламени по краю. vPos — точка меша в пикселях от середины
// токена, uRadius — радиус токена в пикселях. Внутри токена пламя только у самого
// края, лицо не закрывает; вокруг — слабый жар.
export const TOKEN_FIRE = COMMON + BLAZE + `
uniform float uPower, uSeed;
void main() {
  vec2 q = vPos / uRadius;
  float d = length(q) - 1.0;
  vec4 f = blaze(q, max(d, 0.0), uTime, uSeed, 0.75 * mix(0.35, 1.0, uPower));
  float inner = smoothstep(-0.12, 0.02, d);
  float a = f.a * inner * uPower;
  vec4 o = vec4(f.rgb * a, a);
  float halo = exp(-max(d, 0.0) * 3.5) * 0.14 * inner * uPower;
  o.rgb += vec3(1.0, 0.45, 0.1) * halo;
  gl_FragColor = o * uStrength;
}`;
export const EFFECTS = Object.keys(FRAG);

/**
 * Что настраивается у каждого эффекта: ключ настройки и пометки, форма `u<Ключ>` в шейдере.
 * `fixed` — не множитель, а величина: у области своя заменяет общую.
 */
export const SPEED = { key: "speed", min: 0.2, max: 3 };
export const PARAMS = {
  water: [{ key: "ripple", max: 2 }, { key: "foam", max: 2 }, { key: "caustic", max: 2 }, { key: "glint", max: 2 }, { key: "fish", max: 1 }, { key: "fishKind", initial: 0, fixed: true, choices: ["river", "sea", "koi"] }, { key: "current", max: 3, step: 0.1, initial: 0, fixed: true }, { key: "drift", max: 360, step: 5, initial: 90, fixed: true }],
  waterfall: [{ key: "streaks", max: 2 }, { key: "spray", max: 2 }, { key: "flow", max: 360, step: 5, initial: 90, fixed: true }],
  fountain: [{ key: "jet", max: 2 }, { key: "spill", max: 2 }, { key: "ripple", max: 2 }, { key: "glint", max: 2 }],
  lava: [{ key: "glow", max: 2 }, { key: "sparks", max: 2 }],
  swamp: [{ key: "murk", max: 2 }, { key: "bubbles", max: 2 }],
  fog: [{ key: "density", max: 2 }],
  neon: [{ key: "pulses", max: 2 }, { key: "seams", max: 2 }, { key: "neonColor", initial: 0, fixed: true, choices: ["cyan", "magenta", "amber"] }],
  rift: [{ key: "riftGlow", max: 2 }, { key: "riftCracks", max: 2 }, { key: "riftMotes", max: 2 }, { key: "riftColor", initial: 0, fixed: true, choices: ["violet", "cyan", "gold", "crimson"] }],
  fire: [{ key: "flame", max: 2 }, { key: "smoke", max: 2 }, { key: "wind", max: 360, step: 5, initial: 210, fixed: true }, { key: "spread", max: 1, step: 0.05, initial: 0, fixed: true }]
};

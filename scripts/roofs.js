// Крыши и значки дверей под ними.
//
// Туман Foundry накрывает всё, что не на линии взгляда, крыши тоже: стены дома
// закрывают взгляд с улицы, и крыша соседнего дома остаётся тёмной. Здесь крыша,
// край которой виден токену, дорисовывается в маску видимости целиком — с земли
// видно крышу, а не то, что под ней (токены и двери внутри по-прежнему проверяются
// по настоящей линии взгляда). Крыша, что сейчас растворилась (под ней свой токен),
// не дорисовывается: внутри видно как обычно.
//
// Виден ли край — решает сам Foundry (`testVisibility`): днём под общим светом
// токен видит всю улицу, а круг его зрения бывает в клетку.
//
// Контур крыши — пометка тайла `outline` (Картограф кладёт её крышам из OSM:
// кольца в долях тайла, двор — `hole`). У повёрнутого дома прямоугольник тайла
// захватывает улицу и чужие дворы: по нему край не виден, а раскрылось бы лишнее.
// Без пометки контур — прямоугольник тайла (свои крыши Картографа такие и есть).
//
// Значок двери под непрозрачной крышей не показывается никому, и Мастеру тоже:
// на крыше он висел поверх черепицы. Дверь в наружной стене остаётся — её край
// выходит из-под крыши. На слое стен видны все.
//
// Створку двери (картинку анимации) Foundry рисует на высоте переднего плана —
// поверх крыш, и закрытые двери торчали из черепицы. Здесь створка лежит на
// земле, как у самого Foundry открытая: под крышами и кронами, но над полом.
//
// Крыша — тайл с затуханием (`occlusion.modes`) и навесом от света или погоды
// (`restrictions`), как выгружает Картограф; крона дерева (`wind`) — не крыша.
// С Картографа 0.2.33 крыша гаснет не над фишкой, а внутри открытой поверхности
// Foundry 14 (режим SURFACE) — см. `opened`.

const MODULE_ID = "burn-living-map";
/** Край крыши — точки на столько клеток наружу от стены. */
const RIM_OUT = 0.4;

function isRoof(tile) {
  const d = tile.document;
  if (d.hidden || !tile.mesh || tile.mesh.destroyed) return false;
  if (d.flags?.[MODULE_ID]?.wind) return false;
  // В v14 режимы — Set, раньше — массив.
  const modes = d.occlusion?.modes;
  if (!(modes?.size ?? modes?.length)) return false;
  return !!(d.restrictions?.light || d.restrictions?.weather);
}

function roofs() {
  if (!canvas.ready || !canvas.tiles) return [];
  return canvas.tiles.placeables.filter(isRoof);
}

/** Точка тайла по долям (0..1 от левого верхнего угла) — на сцену, с поворотом.
 * x, y документа — середина тайла. */
function placer(tile) {
  const d = tile.document;
  const s = d.shape ?? d;
  const { width: w, height: h } = d;
  const r = (((s.rotation ?? d.rotation) || 0) * Math.PI) / 180;
  const [c, sn] = [Math.cos(r), Math.sin(r)];
  return (u, v) => {
    const x = (u - 0.5) * w, y = (v - 0.5) * h;
    return { x: s.x + x * c - y * sn, y: s.y + x * sn + y * c };
  };
}

/** Внутри колец по чётности: двор — снаружи. */
function inRings(rings, p) {
  let c = false;
  for (const { pts } of rings) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
  }
  return c;
}

/** Точки чуть снаружи крыши вдоль каждой стены (и внутрь дворов): видна хоть
 * одна — видна крыша. Шаг — полклетки, но не меньше точки на сторону. */
function rimOf(rings) {
  const g = canvas.grid.size;
  const out = g * RIM_OUT;
  const pts = [];
  for (const { pts: ring } of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1) continue;
      const [nx, ny] = [(b.y - a.y) / len, -(b.x - a.x) / len];
      const steps = Math.max(1, Math.ceil(len / (g / 2)));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const q = { x: p.x + nx * out, y: p.y + ny * out };
        pts.push(inRings(rings, q) ? { x: p.x - nx * out, y: p.y - ny * out } : q);
      }
    }
  }
  return pts;
}

/** Контур крыши на сцене, её край и рамка; считаем заново, только когда тайл
 * сдвинули, повернули или растянули. */
const shapes = new WeakMap();
function shapeOf(tile) {
  const d = tile.document;
  const s = d.shape ?? d;
  const sig = [s.x, s.y, d.width, d.height, s.rotation ?? d.rotation].join(",");
  const old = shapes.get(tile);
  if (old?.sig === sig) return old;
  const at = placer(tile);
  const own = d.flags?.[MODULE_ID]?.outline;
  let rings = Array.isArray(own)
    ? own.filter((r) => r?.points?.length >= 6).map((r) => {
        const pts = [];
        for (let i = 0; i + 1 < r.points.length; i += 2) pts.push(at(r.points[i], r.points[i + 1]));
        return { pts, hole: !!r.hole };
      })
    : [];
  if (!rings.length) rings = [{ pts: [at(0, 0), at(1, 0), at(1, 1), at(0, 1)], hole: false }];
  const all = rings.flatMap((r) => r.pts);
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const pad = canvas.grid.size;
  const box = new PIXI.Rectangle(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad);
  // Точки под крышей — сеткой по рамке: по ним видно, открыта ли над ней поверхность.
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const inner = [];
  for (let j = 0; j < 5; j++) {
    for (let i = 0; i < 5; i++) {
      const q = { x: x0 + ((i + 0.5) / 5) * (x1 - x0), y: y0 + ((j + 0.5) / 5) * (y1 - y0) };
      if (inRings(rings, q)) inner.push(q);
    }
  }
  const shape = { sig, rings, rim: rimOf(rings), box, inner };
  shapes.set(tile, shape);
  return shape;
}

/** Сколько точек крыши лежит под поверхностью Foundry 14 (область с поведением
 * «поверхность»). Поверхность прячет тайлы с режимом SURFACE на своей высоте и выше. */
function under(tile, s) {
  const sh = shapeOf(tile);
  if (s.elevation > tile.document.elevation || !s.region.bounds.intersects(sh.box)) return 0;
  const tree = s.region.polygonTree;
  let hit = 0;
  for (const q of sh.inner) if (tree.testPoint(q)) hit++;
  return hit;
}

/** Крыша открыта: растаяла над фишкой (`occluded`) или спрятана открытой
 * поверхностью — фишка под ней, а у Мастера ещё мышь над ней или зажат Alt.
 * Открытую крышу в поле зрения не дорисовываем: на её месте комната, а не черепица. */
function opened(tile) {
  if (tile.occluded) return true;
  const surface = CONST.OCCLUSION_MODES?.SURFACE ?? 2;
  if (!(tile.mesh.occlusionMode & surface)) return false;
  const open = canvas.masks?.occlusion?.occludedSurfaces;
  if (!open?.size) return false;
  const need = shapeOf(tile).inner.length;
  if (!need) return false;
  let hit = 0;
  for (const s of open) {
    hit += under(tile, s);
    // Больше половины крыши под открытыми поверхностями: соседская задела бы лишь край.
    if (hit * 2 > need) return true;
  }
  return false;
}

/** С полем зрения фишки крыша открывается только над фишкой. По Alt и под мышью
 * (так открывает поверхности ядро) игрок увидел бы комнату: крышу, видную с
 * улицы, модуль дорисовывает в поле зрения, и туман войны помнит место под ней
 * как разведанное. Мастер без поля зрения открывает крыши как в ядре. */
function keepTokenOpened(open) {
  if (!open.size || !canvas.effects.visionSources.some((s) => s.active)) return;
  const tiles = roofs();
  if (!tiles.length) return;
  const tokens = canvas.tokens._getOccludableTokens?.() ?? [];
  for (const s of [...open]) {
    if (!tiles.some((t) => under(t, s) * 2 > shapeOf(t).inner.length)) continue;
    const tree = s.region.polygonTree;
    const below = tokens.some((t) => t.document.elevation < s.elevation && t.bounds.intersects(s.region.bounds) && t.document.getOcclusionTestPoints().some((p) => tree.testPoint(p)));
    if (!below) open.delete(s);
  }
}

/** Точка сцены под крышей (по контуру, дворы — снаружи). */
function inside(tile, p) {
  const sh = shapeOf(tile);
  return sh.box.contains(p.x, p.y) && inRings(sh.rings, p);
}

/** Крыша в маску видимости: каждое внешнее кольцо со своими дворами-дырами. */
function drawRoof(sight, rings) {
  const flat = (r) => r.pts.flatMap((p) => [p.x, p.y]);
  const holes = rings.filter((r) => r.hole);
  for (const outer of rings.filter((r) => !r.hole)) {
    sight.drawPolygon(flat(outer));
    const own = holes.filter((h) => inRings([outer], h.pts[0]));
    if (!own.length) continue;
    sight.beginHole();
    for (const h of own) sight.drawPolygon(flat(h));
    sight.endHole();
  }
}

function drawSeenRoofs(group) {
  const sight = group.vision?.sight;
  if (!sight) return;
  const sources = [...canvas.effects.visionSources].filter((s) => s.active && !s.isPreview && !s.isBlinded);
  if (!sources.length) return;
  const reach = sources.map((s) => s.los?.bounds ?? s.los?.getBounds?.()).filter(Boolean);
  for (const tile of roofs()) {
    if (opened(tile)) continue;
    const sh = shapeOf(tile);
    // Крыша далеко за линией взгляда всех токенов — край не проверяем.
    if (reach.length && !reach.some((b) => b.intersects(sh.box))) continue;
    if (sh.rim.length && canvas.visibility.testVisibility(sh.rim, { tolerance: 0 })) drawRoof(sight, sh.rings);
  }
}

/** Обе стороны двери (на полклетки от неё) под непрозрачной крышей. */
function underRoof(wall) {
  const list = roofs().filter((t) => !opened(t));
  if (!list.length) return false;
  const [x, y] = wall.midpoint;
  const ray = wall.toRay();
  const len = Math.hypot(ray.dx, ray.dy) || 1;
  const off = canvas.grid.size / 2;
  const [nx, ny] = [(-ray.dy / len) * off, (ray.dx / len) * off];
  const covered = (p) => list.some((t) => inside(t, p));
  return covered({ x: x + nx, y: y + ny }) && covered({ x: x - nx, y: y - ny });
}

// Растворилась крыша или вернулась — маску и значки надо пересчитать.
let lastState = "";
function roofState() {
  return roofs().map((t) => (opened(t) ? "1" : "0")).join("");
}
function watchOcclusion() {
  const state = roofState();
  if (state === lastState) return;
  lastState = state;
  canvas.perception.update({ refreshVision: true });
}

/** Поверхности открылись или закрылись (Alt, мышь, фишка) — поле зрения
 * пересчитать в том же проходе: до следующей проверки по таймеру открытая крыша
 * оставалась бы дорисованной в нём, и игрок на миг видел бы дом насквозь. */
function watchSurfaces() {
  const mask = foundry.canvas.layers?.CanvasOcclusionMask?.prototype;
  const base = mask?._updateOccludedSurfaces;
  if (!base) return;
  mask._updateOccludedSurfaces = function (flags, ...rest) {
    const out = base.call(this, flags, ...rest);
    try {
      keepTokenOpened(this.occludedSurfaces);
      const state = roofState();
      if (state !== lastState) {
        lastState = state;
        if (flags) flags.refreshVision = true;
      }
    } catch {
      // Проверка по таймеру остаётся.
    }
    return out;
  };
}

/** Створка двери — на землю (высота 0, поверх пола, под токенами). */
function sinkDoor(mesh) {
  for (const pos of [mesh._closedPosition, mesh._animatedPosition]) {
    if (!pos) continue;
    pos.elevation = 0;
    pos.sort = Infinity;
  }
  mesh.elevation = 0;
  mesh.sort = Infinity;
}

export function registerRoofs() {
  // Положение створки считает `initialize` — и при создании, и при правке стены.
  const DoorMesh = foundry.canvas.containers.DoorMesh;
  const init = DoorMesh?.prototype.initialize;
  if (init) {
    DoorMesh.prototype.initialize = function (...args) {
      const out = init.apply(this, args);
      sinkDoor(this);
      return out;
    };
  }

  Hooks.on("visibilityRefresh", drawSeenRoofs);
  Hooks.on("canvasReady", () => { lastState = ""; });
  watchSurfaces();

  const DoorControl = foundry.canvas.containers.DoorControl;
  const base = Object.getOwnPropertyDescriptor(DoorControl.prototype, "isVisible");
  if (base?.get) {
    Object.defineProperty(DoorControl.prototype, "isVisible", {
      configurable: true,
      get() {
        if (!base.get.call(this)) return false;
        if (canvas.walls?.active) return true;
        try {
          return !underRoof(this.wall);
        } catch {
          return true;
        }
      }
    });
  }

  // Тикер у приложения один на все сцены — вешаем раз.
  let acc = 0;
  Hooks.once("canvasReady", () => {
    canvas.app.ticker.add(() => {
      acc += canvas.app.ticker.deltaMS;
      if (acc < 200) return;
      acc = 0;
      if (canvas.ready) watchOcclusion();
    });
  });
}

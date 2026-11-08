// Крыши и значки дверей под ними.
//
// Туман Foundry накрывает всё, что не на линии взгляда, крыши тоже: стены дома
// закрывают взгляд с улицы, и крыша соседнего дома остаётся тёмной. Здесь крыша,
// край которой виден токену, дорисовывается в маску видимости целиком — с земли
// видно крышу, а не то, что под ней (токены и двери внутри по-прежнему проверяются
// по настоящей линии взгляда). Крыша, что сейчас растворилась (под ней свой токен),
// не дорисовывается: внутри видно как обычно.
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

const MODULE_ID = "burn-living-map";

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

/** Углы тайла на сцене (x, y документа — середина тайла). */
function corners(tile) {
  const s = tile.document.shape ?? tile.document;
  const { width: w, height: h } = tile.document;
  const r = (((s.rotation ?? tile.document.rotation) || 0) * Math.PI) / 180;
  const [c, sn] = [Math.cos(r), Math.sin(r)];
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ({ x: s.x + x * c - y * sn, y: s.y + x * sn + y * c }));
}

/** Точка сцены внутри прямоугольника тайла (с учётом поворота). Картинки крыш
 * заполняют тайл целиком, прозрачность не проверяем. */
function inside(tile, p) {
  const s = tile.document.shape ?? tile.document;
  const { width: w, height: h } = tile.document;
  const r = -(((s.rotation ?? tile.document.rotation) || 0) * Math.PI) / 180;
  const dx = p.x - s.x, dy = p.y - s.y;
  const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
}

/** Точки чуть снаружи края крыши: видна хоть одна — видна крыша. */
function rim(tile) {
  const cs = corners(tile);
  const mid = cs.reduce((m, p) => ({ x: m.x + p.x / 4, y: m.y + p.y / 4 }), { x: 0, y: 0 });
  const out = canvas.grid.size * 0.4;
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const a = cs[i], b = cs[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(2, Math.ceil(len / (canvas.grid.size / 2)));
    for (let k = 0; k <= steps; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
      const dx = p.x - mid.x, dy = p.y - mid.y;
      const d = Math.hypot(dx, dy) || 1;
      pts.push({ x: p.x + (dx / d) * out, y: p.y + (dy / d) * out });
    }
  }
  return pts;
}

function drawSeenRoofs(group) {
  const sight = group.vision?.sight;
  if (!sight) return;
  const sources = [...canvas.effects.visionSources].filter((s) => s.active && !s.isPreview && !s.isBlinded && s.radius > 0);
  if (!sources.length) return;
  for (const tile of roofs()) {
    if (tile.occluded) continue;
    const seen = rim(tile).some((p) => sources.some((s) => s.shape?.contains(p.x, p.y)));
    if (seen) sight.drawPolygon(corners(tile).flatMap((p) => [p.x, p.y]));
  }
}

/** Обе стороны двери (на полклетки от неё) под непрозрачной крышей. */
function underRoof(wall) {
  const list = roofs().filter((t) => !t.occluded);
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
function watchOcclusion() {
  const state = roofs().map((t) => (t.occluded ? "1" : "0")).join("");
  if (state === lastState) return;
  lastState = state;
  canvas.perception.update({ refreshVision: true });
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

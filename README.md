# 🔥 Wild Canvas

[Русский](README.ru.md)

A Foundry VTT 14 module that brings scene regions to life. A shader draws over
the map image on every player's screen:

- **water** — ripples, glints on the bottom, foam along the shore, and now and then a fish swims by: river fish (trout, perch, carp, pike), sea fish (mackerel, sea bream, cod, herring shoals), ornamental koi or no fish at all. Pick them with "Fish kind" in the region window or in the settings. Where they swim depends on the scene seed (the `seed` flag written by Cartographer; without it, the scene id), so every map has its own fish and all players see the same ones;
- **lava** — breathing glowing veins, sparks, heat along the shore;
- **swamp** — creeping murk and bubbles;
- **fog** — slowly drifting wisps;
- **fire and smoke** — fire seen from above: tongues spread from the hearth in every direction, wide and yellow at the base, narrowing, reddening and fading into soot at the tips, bending and leaning with the wind; a hot core, glow on the ground, sparks, smoke drifting with the wind. The "Wildfire" slider: 0 is a campfire in the middle of the region, 1 sets the whole region on fire, unevenly, with charred bald patches;
- **waterfall** — streams run along the region's "Direction" (90° is down), foam churns at the bottom edge, mist creeps past it and spray flickers; louder than a stream and heard four squares away;
- **fountain** — for a round fountain in three bowls (Cartographer's built-in one): a low jet with drops in the middle, water spills over each rim with foam below, rings spread from the middle to the edge; babbles three squares away;
- **wind in the crowns** — tree crowns (tiles) sway, gusts roll through the forest;
- **ship underway** — water has "Current" and "Current direction": the ship stands still, tokens walk the deck, and the water runs past the hull. The pattern and whitecaps drift, foam piles up at the bow, a churned wake and diverging arms trail behind the stern. The hole in the water region is the hull (Cartographer cuts water out under the deck and walls). Bottom glints and fish fade out underway — there is no bottom to see at sea;
- **hammocks** — sway with the ship's roll: the hooks on the posts stay put, the canvas swings from side to side, all hammocks nearly in step. The tile flag `swing` holds the hook ends as fractions of the image from its middle; Cartographer sets it on hammocks itself;
- **hover** — an airship or a balloon (tile) slowly drifts in a figure eight, turns a little and rises and sinks, while a soft shadow crawls over the ground and roofs below. In the tile window, "Appearance" tab, "Hover" — strength from 0 to 3. The gnome airship from Cartographer's steampunk set also spins its propellers and its runes pulse with light;
- **afloat** — a sheet of paper, a float, a chip of wood (tile) lies on the water and barely bobs: it drifts a few hundredths of a cell and turns a couple of degrees, each tile in its own rhythm. In the tile window, "Appearance" tab, "Afloat" — strength from 0 to 3. Cartographer flags sheets of paper lying on water;
- **burning tiles** — the tile itself burns (a house, a tree, a cart): in the tile window, "Appearance" tab, "Fire" — smouldering, burning or ablaze. The fire is the same as the region one: tongues spread from the hearths in every direction and lean with the fire wind; a small crown burns as one hearth in the middle. Flames appear only where the image is opaque (a baked semi-transparent shadow does not burn) and sway with the crown; smoke drifts above tokens with the fire wind, with Foundry light and the crackle of a large bonfire around it.
- **chimney smoke** — puffs rise from the chimneys on roofs, grow, lighten and drift with the scene wind ("Wind in the crowns" settings) over the neighbouring roofs too; when a token walks into the house and the roof fades, its smoke fades too. Cartographer marks the chimneys on the roof tile itself (flag `chimneys`: middle and size in scene pixels);
- **windsock** — the striped cone bends away from its pole in the wind, and ripples run along the cloth (tile flag `sock`, the pole on the left of the image; Cartographer sets it itself);
- **signal beacon** — on the steampunk beacon from Cartographer's set, branching discharges like on a Tesla coil jump from the lens to the brass ring, a new pattern several times a second, and the lens flickers with them.
- **river and canal** — a water region with a current runs, and a rock standing in it (a hole in the region) gets foam at its upstream side and a churned trail with diverging arms behind it, so the water flows round the rock. The outer banks of the region stay clean: foam and wake come only from holes inside the region. Cartographer gives a canal its own region with its own current (`flows`), while the harbour beside it stands still;
- **slewing crane** — the steam crane slowly turns on its platform by the given angle and back, with stops, and its shadow turns with it (tile flag `slew`: the axis as fractions of the image and the angle in degrees, plus is clockwise). Cartographer picks the side where the boom does not swing over houses;
- **mine carts** — carts ride along a rail path (tile flag `rail`: `path` in scene pixels, the first point is the depot in the dark of the mine, `lag` — how far the cart trails the head of the train, `cargo` — ore that is unloaded at the far end). The train rolls out of the dark, stops at the end, the ore disappears, and the empty carts go back into the mine and wait. Nearby you hear a low rumble and the double knock of the wheels on rail joints, a heavy knock at the stop — synthesised, on the "Ambient" volume slider, heard by the same listeners as scene sounds and through walls the same way, seven squares away.

The water or lava itself must already be painted on the map: the module adds
motion, not a fill.

## Marking regions

- **Cartographer** turns everything painted with a living material (water, lava,
  swamp — by texture name or by hand in the "Floor" panel) into regions on export.
- **By hand** — the usual Foundry region tool: draw a region, then in the region
  window, "Appearance" tab, choose "Animate as", the fish and the speed.

Players don't see the region as a region — only as the effect.

The wind sways tiles flagged `flags.burn-living-map.wind`: Cartographer sets it
on tree crowns on export. Flag your own tile from the console:
`tile.document.setFlag("burn-living-map", "wind", 1)`.

Tiles flagged `flags.burn-living-map.hover` (a number, the strength) float:
Cartographer sets it on airships and balloons on export.

Machines on a tile: fans spin, lamps smoulder and flare, leds blink. The module knows the assets of
Cartographer's cyberpunk set by itself (flag `flags.burn-living-map.machine`, tile window, "Appearance"
tab, "Machines"). Any other tile comes alive with its own layout, the flag `flags.burn-living-map.layout`:
`{"fans": [[cx, cy, radius, speed]], "lamps": [[x, y, radius, "#rrggbb"]], "leds": [x, y, colour, …],
"ledSize": 0.006}` — fractions of the picture (`leds`: x and y in thousandths, colour 0 cyan, 1 magenta).
Cartographer 0.2.41 takes the layout from `live.json` in the asset folder.

Tiles flagged `flags.burn-living-map.afloat` (a number, the strength) bob on the water:
Cartographer sets it on paper and floats lying on water.

Crowns flagged `flags.burn-living-map.particles` emit particles: `leaves` —
falling leaves (their colour is taken from the crown image; in water a leaf makes
ripples, floats with the wind and sinks, in swamp it gets stuck, in lava and fire
it burns up), `fireflies` — fireflies. Cartographer sets it by the forest's
season; it exports a winter forest with Foundry's own snow. Density is the
"Falling leaves and fireflies" setting. By hand:
`tile.document.setFlag("burn-living-map", "particles", "leaves")`.

Tokens in effect regions: splashes on entering water and ripples behind them,
murky rings and bubbles in swamp; lava is thick — red-hot shows through under the
token, a dark crust spreads and the tracks cool down; in lava and fire the token
burns: flames along its edges, smoke, sparks (the "Tokens in water, swamp and
lava" setting).

Fireflies are bugs with a lantern on the belly: they flash every 1.5–4 s, glow
faintly in between and light the ground under them. Their light is drawn over
Foundry lighting, so it shows at night too, and fog of war hides it.

## Weather on the ground

Snow and rain fall on their own (Foundry scene weather); the module adds what they leave on the floor:

- **snow, blizzard** — snow drifts up here and there: a small drift, a round mound, a long streak along the wind, a crescent, a handful of clumps or a dusting; it grows, holds for a few seconds and melts. Streaks and crescents follow the scene's single wind; a blizzard brings more and bigger streaks;
- **rain, downpour** — the floor gets wet: puddles faintly reflect the sky, raindrops make rings, small splashes on the wet ground.

Nothing appears under roofs (tiles that block weather), in water, lava or swamp. Turn it off for yourself with the client setting "Weather on the ground".

## Roofs

A roof is a tile with fade occlusion and a light or weather restriction (the way the
Cartographer exports them). A roof whose edge a token can see is shown whole from the
street: house walls no longer hide it in fog. You cannot look under it: tokens and doors
inside are still seen only along a real line of sight. Door leaves lie on the ground,
under roofs, and a door icon under an opaque roof is hidden from everyone, the GM too.
Doors in outer walls stay visible. On the Walls layer all icons show.

## Burrows

When a token burrows (the "Burrow" movement action), a hole and a pile of dug-up earth stay where it went underground, and another where it came out. The colour is taken from the floor image, so grass, sand and snow each get their own hole. Burrows are stored in the scene (the `burrows` flag, written by the GM), visible to everyone and survive a reload. Fill them in from the scene window, "Ambience" tab, or with `game.modules.get("burn-living-map").api.clearBurrows()`. No burrow is left in water, lava or swamp.

## Rifts

Anomalies in the floor: tears in reality. A rift is the "Rift" region effect. Nothing needs to be painted on the map, because the shader draws the whole thing.

- **Look.** A torn gap runs along the long side of the region with a black void inside, full of stars and wisps of nebula. The rim is white-hot and has colour fringes. Around it the floor is scorched, cracks spread from the rim, and waves of light run along them. Rings of time spread out from the gap, and motes get pulled in. Every few seconds time glitches: for a third of a second everything rewinds and then jumps forward, and the rim splits into colours. Colour: violet, cyan, gold or crimson.
- **Opening and closing.** The gap grows from the middle to the ends in about 2 s and closes the same way. Everyone with the scene on screen sees it.
- **By hand.** Draw a region of any shape and pick "Animate as: Rift" in the region window. The gap follows the region's main axis. A circle gets a random direction, the same for every player.
- **With the macro** ("Rift" in the Paradigma world):
  - **Open rifts with the mouse.** Drag across the floor and a rift lies along the drag. A click opens a rift in a random direction. You can place several in a row; Esc or right-click stops.
  - **Anomaly storm.** Rifts open and fade by themselves in the visible part of the scene, around tokens or inside a selected region. You set how many at once, how often a new one appears and how long each lasts.
  - **Stop the storm** or **close every rift on the scene.**
- **Light.** A rift from the macro has a Foundry light. It shows in the dark, lights up nearby tokens and goes away with the rift.
- **Lifetime.** A rift with a lifetime closes by itself. After a reload the active GM picks the timers up again. A storm stops when the GM reloads, and rifts already open live out their time.

From the console or your own macro: `game.modules.get("burn-living-map").api.rift`.

| Function | What it does |
|---|---|
| `open({x, y, length, width, angle, color, life, light})` | Open a rift. Position in scene pixels, sizes in grid squares, angle in degrees, `color` from 0 to 3, `life` in seconds (0 means it stays until closed) |
| `place(opts)` | Place a rift with the mouse |
| `close(region)` | Close one rift |
| `closeAll({storm})` | Close every rift on the scene |
| `storm({count, every, life, length: [min, max], area: "view" \| "tokens" \| "region", radius})` | Start an anomaly storm |
| `calm()` | Stop the storm |

## Footsteps

When a token walks, everyone hears footsteps on what it steps on. The surface is decided in order:

1. **A region with the "Footsteps: surface" behaviour** — hand marking, wins over everything: metal, stone, gravel, earth, grass, sand, snow, wood, creaky wood, water, mud, burning ground.
2. **Wild Canvas regions**: water and waterfall — water (the first step splashes), swamp — mud, fire — crackling embers; lava gives no footsteps, it rumbles on its own; a cut-out (a bridge) — wood.
3. **The floor of a Cartographer map**: on export it writes the `surfaces` flag to the scene — a letter per square, from the top floor layer (a road over a room floor, a room floor over terrain). Nothing to mark.
4. Otherwise silence: other maps without marking are not guessed.

A flying token (above 1 foot or "Fly") and a burrowing one make no steps. Walking (square by square) and running (dragging over several squares) have different paces. There are no own recordings of grass, sand and snow yet: grass and sand sound like earth, snow like gravel. Turn it off for yourself with the "Footsteps" setting; volume is the "Environment" slider.

Moved here from the "Location Misc" module (formerly footstep-sounds). The behaviour is now `burn-living-map.surface`, declared in `module.json`: Foundry 14 did not accept the old `footstep-sounds.surfaceType`, and no world had regions with it.

### Footstep sound credits

- Stone, gravel, metal: [Footsteps on different surfaces](https://opengameart.org/content/footsteps-on-different-surfaces), congusbongus (CC BY 3.0; stone — swuing, gravel — Ali_6868 CC0, metal — Eelke)
- Earth, wood: [Different steps on wood, stone, leaves, gravel and mud](https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud) (CC0)
- Creaky wood: [100 CC0 metal and wood SFX](https://opengameart.org/content/100-cc0-metal-and-wood-sfx) (CC0); wood variants — [100 CC0 SFX #2](https://opengameart.org/content/100-cc0-sfx-2) (CC0)
- Water and mud — cut and mixed from Freesound recordings: "SPLASH.wav" — petenice, CC0, <https://freesound.org/s/9508/>; "footstepswetgrass.WAV" — stomachache, CC0, <https://freesound.org/s/48248/>; "walk-mud01.wav" — JanKoehl, CC BY 4.0, <https://freesound.org/s/85604/>; "Water slosh spashing-9.wav" — AGFX, CC BY 4.0, <https://freesound.org/s/20439/>
- Burning ground — synthesised on the fly (`scripts/steps-synth.js`), no files.

## Settings

All module settings live in their own window, not in the game settings. With BurnHub, the "Wild Canvas" tile opens it; without BurnHub, a "Wild Canvas settings" button in the game settings does.

- **On this computer** — on or off (for a weak computer), effect strength, place sounds, weather on the ground, footsteps.
- **For everyone at the table** — the look of every effect, wind in the crowns, falling leaves, splashes. Only a user who may change world settings sees this part.

Sliders take effect at once; closing the window without saving brings everything back.

## Object shadows

Tiles flagged `flags.burn-living-map.shadow` (Cartographer 0.2.43+ exports every object this way, its picture without a shadow) get a shadow from the scene's sun: `flags.burn-living-map.shadows` — `angle` (where the shadow falls, degrees clockwise from "right"), `dist` and `blur` (grid cells), `opacity`, `fade` (0 — even, 1 — fades towards its end). The shadow is the tile's silhouette, black and blurred, baked once per picture (a hundred identical barrels share one texture); it lies right under its tile and follows it when the tile is moved, turned or hidden. On this computer only: "Object shadows" in the settings window.

## Cloud shadows

Scene window, "Ambience" tab: strength (0 is off) and density. Soft cloud shadows drift over the scene with the Wild Canvas wind; every 1–3 minutes a cloud covers the sun for a few seconds and the whole scene dims. Foundry lighting is unchanged: it is a layer of its own above the map, roofs and tokens. Shadows fade at night and soften in snow. Cartographer sets them for forests and town quarters.

## Place sounds

**Scene sound** — scene window, "Miscellaneous" tab, next to the playlist: "Place sound". Seasonal forest, cave, dungeon, town, station, tavern, house. It loops over the whole scene. Cartographer sets it on export.

**Sound inside** — any region can have a "Sound inside" (tavern, house…): while a token is in it, that sound plays and the scene sound fades; at the threshold they cross over within half a square. Cartographer outlines the rooms of houses and taverns this way and sets the seasonal forest as the scene sound.

**Area sound** — lava, water and swamp are heard over the region and within two squares of its edge, a campfire within five; closer is louder. Tokens listen, as with Foundry ambient sounds (for the GM, the selected ones). The recording is chosen in the region window, along with "Silent". "Volume" next to it (0–2, 1 is as recorded) sets how loud this region is — the sound inside it too; it is heard at once while the slider moves, before saving.

**Bells** — a button in the GM's sound panel: they ring for everyone.

The overall volume is the "Environment" slider (a region's own volume is multiplied by it); turn it off for yourself with the "Place sounds" setting. Loops are stitched with a 3 s crossfade. Recordings are Freesound HQ previews (mp3), long ones trimmed to 2.5–3 minutes; loudness is levelled with multipliers in `scripts/ambience.js`.

### Recording credits

- `lava-loop.mp3` — "Lava loop.wav", Audionautics, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), <https://freesound.org/s/133901/>
- `forest-summer.mp3` — "BirdSongEaster2002NL.wav", HerbertBoland, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), <https://freesound.org/s/28312/>
- `forest-spring.mp3` — "birds-in-spring.aif", sverga, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), <https://freesound.org/s/16726/>
- `forest-autumn.mp3` — "Autumn wind grabbs the trees.wav", straget, [CC0](https://creativecommons.org/publicdomain/zero/1.0/), <https://freesound.org/s/403764/>
- `forest-winter.mp3` — "Forest snow falling and birds", xkeril, [CC0](https://creativecommons.org/publicdomain/zero/1.0/), <https://freesound.org/s/673266/>
- `forest-magic.mp3` — "eerie_forest.mp3", gregswinford, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), <https://freesound.org/s/70100/>
- `cave.mp3` — "Ambience_Cave_00.wav", LittleRobotSoundFactory, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), <https://freesound.org/s/270387/>
- `cave-creepy.mp3` — "Creepy Dungeon Ambience", DrMinky, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), <https://freesound.org/s/166187/>
- `cave-drips.mp3` — "Water Dripping in Cave.wav", Sclolex, [CC0](https://creativecommons.org/publicdomain/zero/1.0/), <https://freesound.org/s/177958/>
- `dungeon-air.mp3` — "Dungeon Air", Flamiffer, [CC0](https://creativecommons.org/publicdomain/zero/1.0/), <https://freesound.org/s/530161/>
- `dungeon-dark.mp3` — "Dark Dungeon Ambience", Kinoton, [CC0](https://creativecommons.org/publicdomain/zero/1.0/), <https://freesound.org/s/516566/>
- `town-street.mp3` — "230520_2437_FR_TouristsStreet.wav", kevp888, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), <https://freesound.org/s/690168/>
- `town-village.mp3` — "medieval_village_atmosphere.wav", ramonmineiro, [CC0](https://creativecommons.org/publicdomain/zero/1.0/), <https://freesound.org/s/578072/>
- `town-bells.mp3` — "Rostrenen bells market day", bruno.auzet, [CC0](https://creativecommons.org/publicdomain/zero/1.0/), <https://freesound.org/s/826902/>
- `tavern.mp3` — "Tavern_Ambience_Inside_Laughter.WAV", ivolipa, [CC0](https://creativecommons.org/publicdomain/zero/1.0/), <https://freesound.org/s/326313/>
- `house-fireplace.mp3` — "Aachen_Burning Fireplace Crackling Fire Sounds.wav", visionear, [CC0](https://creativecommons.org/publicdomain/zero/1.0/), <https://freesound.org/s/501417/>
- `station-vent.wav`, `station-core.wav` — a station's ventilation hum and reactor hum: synthesized, no recordings; built by `tools/station_synth.py` in the repository
- `water-stream.mp3` — "Stream River Water Up Close", jackthemurray, [CC0](https://creativecommons.org/publicdomain/zero/1.0/), <https://freesound.org/s/433589/>
- `water-brook.mp3` — "Woodland Stream March 2016.wav", plantmonkey, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), <https://freesound.org/s/376709/>
- `swamp-night.mp3` — "Lake At Night.aif", timgormly, [CC0](https://creativecommons.org/publicdomain/zero/1.0/), <https://freesound.org/s/148318/>
- `swamp-lilypads.mp3` — "Lilipads and frogs at night.wav", Danjocross, [CC0](https://creativecommons.org/publicdomain/zero/1.0/), <https://freesound.org/s/503206/>
- `swamp-frogs.mp3` — "swamp frogs.wav", Tomlija, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), <https://freesound.org/s/99193/>
- `swamp-april.mp3` — "swamp April SHORT NL 01 130416_00.wav", klankbeeld, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), <https://freesound.org/s/193032/>
- `fire-campfire.mp3` — "campfire_01.wav", matucha, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), <https://freesound.org/s/170247/>
- `fire-bonfire.mp3` — "Nighttime Bonfire 2", samararaine, [CC0](https://creativecommons.org/publicdomain/zero/1.0/), <https://freesound.org/s/187079/>

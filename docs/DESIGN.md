# ALPENGLOW — Design

*Alpenglow: the red-violet light that stays on the peaks after the sun has already gone.*

A ~5-minute, single-level, momentum-driven 3D platformer about climbing a snow mountain at sunset,
and about depression. Browser, Three.js, everything procedural.

## 1. Story

### Premise
You wake up lying in the snow at the foot of a mountain. No name, no backstory. There is a summit,
the sun is going down, and something in your own head would prefer you stayed where you are.

### Two voices (text only, no cutscenes)
- **The Weight** — lowercase, cool grey, slightly blurred, drifts in near screen centre and dissolves.
  It is never a monster or a character; it is *your own voice*, sounding reasonable. It gets physically
  smaller and fainter over the level, but it never disappears.
- **You** — sentence case, warm off-white, lower third, steady. Rarer early, more frequent later.
- **Others** — short notes found in cairns (whiteout section). Hand-lettered style, amber. Proof that
  other people have been here.

### How the mountain maps onto depression
| Mountain | Experience |
|---|---|
| Getting up from the snow | Starting at all is the hardest move |
| Deep powder: huge effort, little progress | Everything costs more than it should |
| Packed trails hidden in the powder | Coping strategies you have to re-find every time |
| Ice chutes: speed you earn going *down* | Good days; momentum that carries even as it fades |
| Wind on the ridge | Intrusive thoughts: loud, pushy, sounding like you |
| Snow bridge collapse into the ice cave | Relapse. Falling back is not starting over |
| Whiteout, cairns left by others | Isolation, then evidence you are not the only one |
| Summit: more ranges beyond | There is no final victory — and you are still here |

### Emotional arc
Numb → effortful → a flicker of joy → pressure → relapse → isolation → connection → resolve → quiet.
Colour tracks this: flat and desaturated at the start, warming as you climb, drained in the whiteout,
fully saturated alpenglow after the storm, then blue hour and first stars at the end.

### Ending (bittersweet / ambiguous)
You reach the summit. There is nothing there: no flag, no reward. The camera lifts and reveals
range after range beyond. The sun slips under the horizon; the Earth's shadow rises in the east with
the pink Belt of Venus above it; the last alpenglow clings to the far peaks. You sit down. The Weight
speaks once more, very faintly. You answer. The line "I'm still here." holds, then fade to the title.
Not a cure, not a defeat — a person who is still here, noticing light.

### Inner-voice lines (first draft; W = Weight, Y = You, O = Other)
| # | Section / trigger | Voice | Line |
|---|---|---|---|
| 1 | 0 Opening — before any input | W | stay down. it's easier. |
| 2 | 0 — first input | Y | Get up. |
| 3 | 0 — first steps | W | why bother. it's the same mountain every day. |
| 4 | 1 Foot — first jump | Y | One thing. Then the next thing. |
| 5 | 1 — first downhill slide | W | downhill is always easy. |
| 6 | 2 Powder — enter deep powder | W | everything takes more than it should. |
| 7 | 2 — first time on a packed trail | Y | There's a way through. I just have to find it again. Every time. |
| 8 | 2 — mid-field, if slow | W | everyone else makes this look easy. |
| 9 | 3 Chutes — first time > sprint speed | Y | Oh — I forgot what that felt like. |
| 10 | 3 — first failed launch | W | don't get used to it. |
| 11 | 3 — exit | Y | Speed doesn't last. But it carries. |
| 12 | 4 Ridge — enter | W | look how far there is to fall. |
| 13 | 4 — first strong gust | W | you're too much. you've always been too much. |
| 14 | 4 — right after 13 | Y | That's the wind. It always sounds like me. |
| 15 | 4 — ridge end, first deep sunset colour | Y | The light's changing. |
| 16 | 5 Collapse — bridge breaks | W | there it is. you were doing so well. |
| 17 | 5 — landing in the cave | W | back at the bottom. like always. |
| 18 | 5 — sees light above | Y | I know this place. I've climbed out of it before. |
| 19 | 5 — exit cave | Y | Falling isn't starting over. My legs remember the way. |
| 20 | 6 Whiteout — storm hits | W | no one can see you in here. |
| 21 | 6 — cairn A | O | I stopped here too. It passed. |
| 22 | 6 — after cairn A | Y | I'm not the first one lost up here. |
| 23 | 6 — cairn B | O | Keep the stones on your left. Rest if you need to. |
| 24 | 6 — cairn C | O | You don't have to do this alone. I didn't. |
| 25 | 6 — leaving cairn C (you add a stone) | Y | I'll leave one too. For whoever's next. |
| 26 | 7 Summit push — storm clears | W | it'll be dark soon. |
| 27 | 7 — right after 26 | Y | I know. |
| 28 | 7 — halfway up the final face | W | you're so tired. |
| 29 | 7 — right after 28 | Y | I'm tired. I'm still going. |
| 30 | 8 Summit — arrive | Y | I thought there'd be something up here. |
| 31 | 8 — camera reveals ranges | W | there's always another one. |
| 32 | 8 — right after 31 | Y | Yeah. There is. |
| 33 | 8 — sun sets, sitting | Y | The light stays on the peaks after the sun is gone. I never noticed that. |
| 34 | 8 — final | Y | I'm still here. |

Lines never block input. Each fades in over ~0.6 s, holds ~2.5 s + 60 ms/char, fades out. One line on
screen at a time; queued lines wait. Optional lines (8, 10) only fire if their condition is met.

### Credits
Short, plain: title, "made with Three.js and Web Audio, everything generated in code", then:
*"If you're carrying something heavy, you don't have to carry it alone. findahelpline.com lists free,
confidential support in many countries."* Small, unobtrusive, not a pop-up.

### Care rules
No death imagery, no self-harm, no "the Weight wins" ending. Falling off the mountain is a soft
fade-and-return at the last cairn, never a death animation. The Weight's worst line (13) is always
immediately answered (14).

## 2. Movement

Movement feel is the heart of the game. The character is a **kinematic body** with our own physics.

### Moveset
- **Run** — analog acceleration toward input direction relative to camera. Turn rate drops as speed
  rises (you carve, you don't pivot). Top run speed on flat packed snow ~7 m/s.
- **Jump** — variable height (release early = short hop). Coyote time 100 ms, jump buffer 120 ms.
  Horizontal velocity is fully preserved. Jumping off a slope adds a small push along the surface normal.
- **Slide** (hold Shift / B) — drop into a boot-ski crouch. Very low friction; input only *steers*
  (carving) and cannot add speed. Gravity along the slope does all the work. The main speed tool.
- **Slide-jump** — jumping out of a slide keeps all speed and gets a lower, longer arc: the "launch".
- **Landing** — velocity is projected onto the landing surface. Landing on a downslope that matches
  your arc keeps (even gains) speed; landing flat bleeds the normal component; a very hard flat landing
  causes a 0.3 s stumble.
- **Wall-kick** (ice cave onward) — jump while touching a steep ice/rock wall in the air: reflect off
  it. Taught in the cave, used once or twice in the final push.
- **Steep slopes** — snow above ~38° can't be walked up; you slide back down. Rock grips up to ~55°
  so rock outcrops are the "stairs" of the mountain.
- **Air control** — weak (~15% of ground), enough to correct, not to steer a jump.
- **Rest** — standing still for 3 s near a cairn sits you down. It does nothing mechanically. Resting
  is allowed and never punished.

### Surfaces (per-triangle / per-texel surface id)
| Surface | Friction | Drag | Control | Notes |
|---|---|---|---|---|
| Powder | medium | **high**, rises with depth | good | sink ~0.3 m, deep trail, slow |
| Packed snow | medium | low | good | baseline; visible as wind-crust sheen |
| Ice | **near zero** | very low | poor | fast, slippery, glassy blue |
| Rock | high | low | great | stops slides, climbable steep |

### Momentum model (per fixed step, 120 Hz)
1. Gravity projected onto the ground plane accelerates you downhill (scaled per state: running resists
   it, sliding embraces it).
2. Input acceleration (running only), clamped by surface control.
3. Friction (Coulomb, proportional to normal force) + drag (quadratic, surface-dependent).
4. Steering rotates the velocity vector, not the facing; max turn rate ∝ 1/speed.
5. Moving over a crest faster than gravity can hold you → you become airborne (ramps emerge naturally).
There is no hard max speed on slides — terrain is the limiter.

### Tuning goals (plain language)
- The first 10 seconds should feel slightly heavy and reluctant; the first good slide should feel like
  a release.
- You should always feel *why* you lost speed (powder, upslope, bad landing).
- A good player chains slides and launches through sections without stopping; a struggling player can
  still walk everything except the chutes' big gaps, which have a slower rock detour.
- Skill ceiling: chute lines and the final face reward reading the terrain. Nothing requires frame-perfect input.

### Camera
Third-person orbit (mouse / right stick), soft auto-follow behind velocity when moving fast, terrain
collision via heightfield sampling, FOV 60°→75° with speed, slight roll into carves, framing lifts
to show the next objective at section entrances.

### Tuning (Phase 2 final; values in `src/tuning.js`, measured by `npm run check`)
All numbers below are measured headlessly by `tools/check-movement.mjs` at the fixed 120 Hz step
(identical at 30/60/144/240 fps and jittered frame times). Gravity is 15 m/s² (DECISIONS #31).

| Feel target | Mechanism | Measured |
|---|---|---|
| Slightly heavy start | run accel 10·(1 − v/7): 0.7 s time constant | 90 % of top speed in 1.6 s |
| ~7 m/s run on packed | same curve, quadratic drag | 6.9 m/s; powder 5.4, ice 6.8 (but 5 s to get there), rock 6.9 |
| Stops are readable per surface | run brake 9 m/s² × grip | stop from top speed: rock 2.2 m, packed 2.6 m, powder 1.3 m, **ice 24 m** |
| Slides are the speed tool | Coulomb μ (packed .06, powder .10, ice .012, rock .45) + drag | 20° slope after 150 m: ice 33, packed 27, powder 8.7 m/s, rock doesn't move |
| Glide vs. brake is a choice | slide keeps momentum, standing up brakes | from 15 m/s on flat: rock 16 m, powder 21 m, packed 87 m, ice 313 m |
| Snow walls at ~38°, rock stairs to ~55° | maxWalk per surface → forced slide above it; run gravity × 0.5 | packed climbs 37° (3.4 m/s), not 40°; rock climbs 50°, not 58°; ice struggles at 20°, fails at 30° |
| Jumps: readable, variable | 6.5 m/s up; ×2.6 gravity if released while rising; ×1.2 falling | full 1.38 m / 0.82 s, tap 0.55 m, running jump 5.8 m |
| Slide-jump is the "launch" | 5 m/s up, all speed kept | at 15 m/s: 0.81 m high, 9.4 m long, lands at 14.7 m/s |
| Forgiving inputs | coyote 100 ms, buffer 120 ms | 60 ms late off a ledge works, 160 ms doesn't; early press jumps on touchdown |
| Landings reward matching the slope | keep tangential velocity, bleed normal | 10 m/s hop onto 30° downslope → 16 m/s; ≥ 11 m/s into the ground (≈ 3.4 m flat drop) stumbles 0.3 s |
| Ramps emerge from terrain | leave ground when v²/R > g·cosθ·stick (slide 1, run 3) | R = 20 m crest: slide stays down at 12 m/s, launches at 22; running stays down |
| Wall-kick is learnable | 7 up, ≥ 6 out, 0.12 s wall grace, no repeat off one wall | 3.5 m chimney climbed to 8 m in 5 relaxed kicks |

Notes:
- Speeds on long ice/packed pitches reach 30–40 m/s; there is still no cap (DECISIONS #18), so Phase 3
  must give ice chutes a run-out or a rock band (rock μ .45 stops a 15 m/s slide in 16 m).
- Heightfield collision uses a Catmull-Rom surface and its exact normal (DECISIONS #30), so launches
  depend only on real curvature and the controller never sticks to cliff faces.
- Camera: the look-at height follows a critically damped spring (ω 7/s) whose target leads by the
  low-passed vertical velocity, so steady descents have no lag while bumps are filtered (over the
  rollers the camera's vertical jerk is 0.18× the player's). Terrain behind the player lifts the boom
  (pitch) smoothly rather than snapping it in; colliders still pull in instantly. FOV 60°→75° from 8
  to 30 m/s; roll up to 0.1 rad from lateral acceleration.

## 3. Level — "the route"

One continuous route, ~1.6 km of path, ~550 m of climb. Sun elevation is tied to **route progress**
(not time): +12° at the start → −5° at the summit, so pacing always lands. Checkpoints are cairns.

| # | Section | ~Time | Mechanic | Emotional beat |
|---|---|---|---|---|
| 0 | **Opening** — lying in snow at the trailhead | 0:15 | Get up; walk | Inertia, numbness |
| 1 | **The Foot** — rolling snow hills | 0:40 | Run, jump, first gentle slide, speed carries into a rise | "One thing, then the next" |
| 2 | **Powder Fields** — wide basin | 0:40 | Powder drag vs. packed trails; finding the line | Effort vs. result |
| 3 | **Ice Chutes** — two linked half-pipes | 0:45 | Slide down to earn speed, slide-jump launches, landing on downslopes | First joy |
| 4 | **Cornice Ridge** — narrow crest | 0:40 | Wind gusts push laterally; rock for grip; precision | Intrusive thoughts |
| 5 | **The Collapse / Ice Cave** — bridge falls, blue-violet cave | 0:50 | Wall-kicks, half-pipe walls, climbing back out toward light | Relapse |
| 6 | **Whiteout** — blizzard plateau | 0:40 | Low visibility; navigate cairn to cairn; stronger drag | Isolation → connection |
| 7 | **Summit Push** — steep final face, storm clears | 0:40 | Everything: slide-launch off a dip, rock steps, one wall-kick | Resolve |
| 8 | **Summit** | 0:30 | Walk, sit; no challenge | Quiet, ambiguous ending |

### Teaching (no tutorial popups)
- Controls are shown once as tiny glyphs in the snow at the trailhead (drawn into the snow shader).
- Section 1 gates: a small rise you can only crest with momentum from the preceding dip teaches that
  speed carries. A gentle slope with a lone boulder at the bottom invites the first slide.
- Section 2 shows packed trails as brighter, faintly glittering lines; the direct powder line is
  possible but slow.
- Section 3's first chute is safe (fall = slide back to start of chute); the second needs a launch,
  with a slow rock detour for players who can't.
- The cave has a sealed, low-risk half-pipe to learn wall-kick before it matters.
- Failure costs little: falls off the mountain fade to the last cairn in < 1.5 s.

## 4. Visuals

- **Sky** — physically based single-scattering atmosphere (Rayleigh + Mie + ozone) computed into a
  small sky-view LUT each frame, with a transmittance LUT for sun colour. Artistic push toward
  purple/red/orange. At the end: Earth's shadow + Belt of Venus + first stars (hashed star field).
- **Snow** — custom shader: pure white albedo, wrap diffuse + fake subsurface for soft terminators,
  **blue/violet shadows** from sky ambient, view-dependent glitter (hashed micro-facets), triplanar
  detail normals, surface-type blending (powder / packed sheen / ice clearcoat / rock).
- **Deformable snow** — a trail render target (ring buffer following the player) stores snow depth;
  the terrain vertex shader displaces powder down along your path; persistent across the section.
- **Lighting** — one sun (colour from transmittance LUT) with cascaded shadow maps; hemisphere-like
  ambient sampled from the sky LUT. Low sun = long shadows across snow — the main visual motif.
- **Fog** — height fog + aerial perspective tinted by sky in-scattering; whiteout raises density and
  shifts it to near-white.
- **Particles** — GPU-animated instanced snow with a wind field; spindrift blowing off ridge crests;
  snow spray from slides/landings; breath puffs; embers of light at cairns.
- **Character** — abstract procedural figure (capsules), procedural gait and lean, and a **verlet
  scarf** in warm red — the one saturated warm colour until the sunset overtakes it.
- **Post** — HDR half-float target → physically based mip-chain bloom → per-section colour grade
  (saturation/temperature curve) → AgX/ACES tonemap → vignette, film grain, subtle speed-streak/
  chromatic aberration at high speed → FXAA.
- **Arc** — desaturated and flat at the start; progressively warmer; whiteout drains to monochrome;
  post-storm is the colour climax; summit falls into blue hour.

## 5. Audio (all procedural Web Audio)

- **Wind** — pink/brown noise through modulated bandpass filters; gust envelopes (synced with ridge
  gameplay gusts); resonant "whistle" band rises with player speed.
- **Footsteps** — noise-burst grain synthesis per surface: powder = soft low muffled crunch; packed =
  bright granular crunch (many micro-clicks); ice = tick + short scrape; rock = dull thud. Timed from
  the gait cycle.
- **Slide** — continuous filtered noise, cutoff and gain from speed and surface.
- **Breath** — filtered noise swells on jumps, hard landings, and in powder.
- **Music** — generative ambient: slow pad chords (detuned oscillators through lowpass), a sparse
  Karplus-Strong/FM "glass piano" motif that grows by section. Harmony moves from suspended/minor to
  an unresolved major add9 at the summit. Music thins in the whiteout, nearly silent at the collapse.
- **Space** — convolution reverb with procedurally generated impulse responses (open air vs. cave).
- **Voice cue** — a soft, pitch-varied bell under each inner-voice line (Weight: low, dull; You: warm).

## 6. Tech architecture

### Stack
Three.js (WebGL2) + Vite, plain modern JavaScript (ES modules). `three-mesh-bvh` for non-terrain
collision. No physics engine. Dev-only `lil-gui` for tuning.

### Module layout
```
src/
  main.js            bootstrap, loading screen, game state machine
  core/              loop (fixed 120 Hz physics, interpolated render), input (kb/mouse/gamepad),
                     quality tiers, events, math utils
  world/             noise, heightfield + erosion (in a Web Worker), route spline & sections,
                     surfaces map, props (cairns, rocks, bridge), ice cave mesh, collision
  player/            controller (state machine: ground/slide/air/stumble/sit), camera, avatar, scarf
  render/            renderer setup, sky (LUTs), snow material, terrain chunks/LOD, shadows,
                     trails RT, particles, post/ (bloom, grade, tonemap, fxaa)
  audio/             engine, wind, footsteps, slide, music, reverb IR generator
  story/             lines table, narrator (text UI + queue), triggers, ending sequence
  ui/                title, pause/settings, credits
  debug/             stats overlay, free camera, tuning panel (dev only)
```

### Key technical choices
- **Controller**: custom kinematic controller (sphere/capsule) — full control over momentum feel.
- **Terrain**: 2 km × 2 km heightfield, 1024² samples, generated deterministically at load in a Web
  Worker (domain-warped ridged fBm + erosion + route carving by spline SDF). Terrain collision is
  analytic heightfield sampling (O(1)); surface type from a splat map. The cave, bridge, rocks and
  cairns are meshes queried with `three-mesh-bvh`. The controller merges both contact sets.
- **Terrain rendering**: chunked grid (e.g. 16×16 chunks) with 3 geometric LODs + skirts, height in
  a float texture sampled in the vertex shader so LODs share data and trails can displace.
- **Render pipeline**: HDR render target → sky → opaque (terrain, props, avatar) → particles → post.
- **Game flow**: Title → Playing (sections 0–8) → Ending → Credits → Title.

### Quality tiers (auto-selected by a 2 s warm-up benchmark; overridable in settings)
| | Low | Medium (target: integrated GPU) | High |
|---|---|---|---|
| Render scale | 0.6 + dyn. res | 0.8 + dyn. res | 1.0 |
| Shadows | 1 cascade, 1024 | 2 cascades, 1024 | 3 cascades, 2048 |
| Terrain LOD distance | short | medium | long |
| Snow particles | 4k | 12k | 30k |
| Bloom mips | 4 | 5 | 6 |
| Trail RT | 256² | 512² | 1024² |
| Glitter / AA | off / FXAA | on / FXAA | on / FXAA |

### Performance budget (Medium, Intel Iris Xe class, 1080p window)
≤ 14 ms GPU frame: terrain ~5 ms, shadows ~2.5 ms, sky LUT ~0.5 ms, particles ~1 ms, post ~3 ms,
spare ~2 ms. ≤ 150 draw calls, ≤ 400k visible triangles. CPU: physics + game logic ≤ 3 ms.
Load (terrain generation) ≤ 4 s behind the title screen.

## 7. Technical showcase (with fallbacks)

| # | Technique | Fallback if it fails (two-strike rule) |
|---|---|---|
| 1 | Physically based atmospheric scattering with LUTs, aerial perspective, Earth's shadow & Belt of Venus | Keyframed analytic gradient sky + sun disc, colours tied to progress |
| 2 | Procedural mountain: domain-warped ridged multifractal + hydraulic/thermal erosion in a worker, route carved by spline SDF | Noise + route carving only, no erosion |
| 3 | Deformable snow trails (ring-buffer RT displacement) + custom snow shader (glitter, SSS wrap, violet shadows) | Normal-map-only trails; MeshStandardMaterial-based snow with tinted shadows |
| 4 | Momentum controller with surface physics + procedural avatar animation + verlet scarf | Simplified capsule avatar, rigid scarf ribbon |
| 5 | GPU weather: instanced snow/spindrift driven by a wind field, whiteout via fog + particle layers | Fewer CPU-updated particles, fog-only whiteout |
| 6 | Fully generative audio: synthesized wind, surface-aware footsteps, generative score, procedural reverb IRs | Wind + footsteps + static pad drone |

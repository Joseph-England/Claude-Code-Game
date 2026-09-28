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
| The Descent: the only way on is down first | Setbacks and humility. Going down is not starting over |
| Whiteout, cairns left by others | Isolation, then evidence you are not the only one |
| Summit: more ranges beyond | There is no final victory — and you are still here |

### Emotional arc
Numb → effortful → a flicker of joy → pressure → setback (going down) → isolation → connection → resolve → quiet.
Colour tracks this: flat and desaturated at the start, warming as you climb, drained in the whiteout,
fully saturated alpenglow after the storm, then blue hour and first stars at the end.

### Ending (bittersweet / ambiguous)
You reach the summit. There is nothing there: no flag, no reward. The camera lifts and reveals
range after range beyond. The sun slips under the horizon; the Earth's shadow rises in the east with
the pink Belt of Venus above it; the last alpenglow clings to the far peaks. You stand and look
(standing, not sitting: Session 6 playtest, DECISIONS #75), then turn to the lit peaks. The Weight
speaks once more, very faintly. You answer. The line "I'm still here." holds, then fade to the title.
Not a cure, not a defeat — a person who is still here, noticing light.

### Inner-voice lines (final, locked in Phase 5; W = Weight, Y = You, O = Other)
Revised once from the 34-line first draft to 30 (DECISIONS #68): cut lines that explained what the
player could already see ("look how far there is to fall", "I'm not the first one lost up here",
"downhill is always easy"), tightened the rest, and rewrote the relapse beat for the Descent. Cut again to 18 (DECISIONS #93), then 16
(11 on the climb, the ending's 5 kept; #94: the ridge pair didn't make sense) so the few words there are carry more, and none play while you sled. Data:
`src/world/level.js` (`beats`); logic: `src/story/story.js`; display: `src/story/narrator.js`.

| # | Section / trigger | Voice | Line |
|---|---|---|---|
| 1 | 0 Opening — lying in the snow, before any input | W | stay down. it's easier. |
| 2 | 0 — first input (you get up) | Y | Get up. |
| 4 | 1 Foot — first jump (or by the bank) | Y | One thing. Then the next. |
| 5 | 2 Powder — into the deep powder | W | everything takes more than it should. |
| 8 | 3 Chutes — stepping off the sled at the bottom (no words while you ride) | Y | Oh. I forgot what that felt like. |
| 18 | 6 — note in cairn A | O | I stopped here too. It passed. |
| 19 | 6 — note in cairn B | O | Keep the stones on your left. Rest if you need to. |
| 20 | 6 — note in cairn C | O | You don't have to do this alone. I didn't. |
| 21 | 6 — you leave a stone on cairn C (E) | Y | I'll leave one too. For whoever's next. |
| 24 | 7 — halfway up the summit ridge | W | you're so tired. |
| 25 | 7 — straight after 24 | Y | I'm tired. I'm still going. |
| 26 | 8 Summit — walking onto the top | Y | I thought there'd be something up here. |
| 27 | 8 — the camera lifts to the ranges | W | there's always another one. |
| 28 | 8 — straight after 27 | Y | Yeah. There is. |
| 29 | 8 — sitting, the sun gone, light still on the far peaks | Y | The light stays on the peaks after the sun goes. I never noticed that. |
| 30 | 8 — final | Y | I'm still here. |

(#3, 6, 7, 9–17, 22, 23 are retired with the cut lines; ids are stable, not contiguous.) Lines never block input. One
on screen at a time from a queue: fade in (W 1.4 s, Y 0.8 s, O 0.9 s), hold 2.2 s + 55 ms/char
(min 2.6 s), fade out, then 1.2 s of quiet (0.3 s before a direct answer). A note stays up while you
stand at its cairn. Each line has a soft bell under it (W low and dull, Y warm, O a small chime).
The Weight shrinks and fades a little over the climb but never disappears.

### Credits
Short, plain: title, "made with Three.js and Web Audio, everything generated in code", then:
*"If you're carrying something heavy, you don't have to carry it alone. findahelpline.com lists free,
confidential support in many countries."* Small, unobtrusive, not a pop-up.

### Care rules
No death imagery, no self-harm, no "the Weight wins" ending. Falling off the mountain is a soft
fade-and-return at the last cairn, never a death animation. The Weight's worst line (11) is always
immediately answered (12). No line points at heights or falling as an escape (the draft's "look how
far there is to fall" was cut for that reason). The Weight never gets the last word: every W line in
the last two sections is answered.

## 2. Movement

Movement feel is the heart of the game. The character is a **kinematic body** with our own physics.

### Moveset
- **Run** — analog acceleration toward input direction relative to camera. Turn rate drops as speed
  rises (you carve, you don't pivot). Top run speed on flat packed snow ~7 m/s.
- **Jump** — variable height (release early = short hop). Coyote time 100 ms, jump buffer 120 ms.
  Horizontal velocity is fully preserved. Jumping off a slope adds a small push along the surface normal.
- ~~Slide~~ / ~~slide-jump~~ — removed as moves in Session 7 (DECISIONS #83): crouch-skating on
  your boots looked odd. Sliding is the **sled's** job (below); `slide` survives only as the
  involuntary slip on ground too steep to stand on.
- **Sled** (Session 7, DECISIONS #83) — a wooden sled waits by the Ice Chutes cairn. `E` / X sits on
  it; gravity does the work; A/D steer (the velocity turns about the ground normal),
  W paddles off from rest (no brake since Session 7b, DECISIONS #92). The kicker's lip throws a rider on a fixed arc over the crevasse; the
  run-out climbs into deep powder where the sled stops and you step off.
- **Landing** — velocity is projected onto the landing surface. Landing on a downslope that matches
  your arc keeps (even gains) speed; landing flat bleeds the normal component; a very hard flat landing
  causes a 0.3 s stumble.
- ~~Wall-kick~~ — removed in Phase 5 (DECISIONS #60): it no longer fit the theme.
- **Steep slopes** — snow above ~38° can't be walked up; you slide back down. Rock grips up to ~55°
  so rock outcrops are the "stairs" of the mountain.
- **Air control** — weak (~15% of ground), enough to correct, not to steer a jump.
- **Rest** — standing still is resting; it is allowed and never punished. (The automatic sit at
  cairns was removed in Session 6, DECISIONS #75.)

### Surfaces (per-triangle / per-texel surface id)
| Surface | Friction | Drag | Control | Notes |
|---|---|---|---|---|
| Snow | medium | low | good | baseline (the old packed physics); looks and sounds like snow — there is no packed snow any more (Session 7, DECISIONS #80) |
| Powder | medium | **high**, rises with depth | good | sink ~0.3 m, deep trail, slow; only in the Powder Fields and the whiteout col |
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
| 5 | **The Descent** — the ridge runs out; down into a hollow, then up | 0:40 | Slide down, carry the speed up the far side, climb out | Setback; going down to get back up |
| 6 | **Whiteout** — a storm in the gap between two horns | 0:40 | Low visibility; navigate cairn to cairn; headwind | Isolation → connection |
| 7 | **Summit Push** — the summit ridge, storm behind you | 0:40 | Just walking: a steady climb that narrows to a ridge with the ranges either side | Resolve |
| 8 | **Summit** | 0:30 | Walk, stand, look; no challenge | Quiet, ambiguous ending |

### Teaching (as built, Session 7: contextual hints, DECISIONS #84)
One-shot hints with key caps show when they matter — the sled and how to steer it, what to do when
the wind rises on the ridge, the lanterns at the note cairns, leaving a stone — above the prompts for
actions (`E` sit on the sled, `E` leave a stone). The original plan below is kept for reference.

### Teaching (original plan: no tutorial popups)
- Controls are shown once as tiny glyphs in the snow at the trailhead (drawn into the snow shader).
- Section 1 gates: a small rise you can only crest with momentum from the preceding dip teaches that
  speed carries. A gentle slope with a lone boulder at the bottom invites the first slide.
- Section 2 shows packed trails as brighter, faintly glittering lines; the direct powder line is
  possible but slow.
- Section 3's first chute is safe (fall = slide back to start of chute); the second needs a launch,
  with a slow rock detour for players who can't.
- Failure costs little: falls off the mountain fade to the last cairn in < 1.5 s.

### As built (Phase 3; data in `src/world/level.js`, measured by `npm run playthrough`)
Route 1106 m of centreline, trailhead 0 m → summit 102 m (DECISIONS #37, #41). The mountain is
generated around the route (DECISIONS #36, #38); 14 cairns; the whole level is carved by
cross-section profiles (trail, basin, pipe, ridge, cave, plateau, summit).

| # | Section | Length | Heights (m) | Bot time | What is there |
|---|---|---|---|---|---|
| 0 | Opening | 40 m | 0 | 4.6 s | Packed trailhead, first cairn |
| 1 | The Foot | 160 m | 0 → 12 | 23.4 s | Rolling hills; 12° slope with a lone boulder (first slide); a 1.6 m bank you crest with the slide's speed, with a rock strip at its right edge for walkers |
| 2 | Powder Fields | 120 m | 12 → 34 | 23.1 s | Powder basin (52 m wide); a meandering packed trail is the fast line |
| 3 | Ice Chutes | 260 m | 34 → 15 → 21 → 5 → 8 | 23.9 s | Ice half-pipe 1, packed rise + cairn, half-pipe 2, packed kicker, 7 m crevasse (70° walls), downslope landing, carry-up exit |
| 4 | Cornice Ridge | 140 m | 8 → 46 | 27.4 s | 6 m crest with 52° falls; gusts every 5.5 s (telegraphed 0.8 s, halved on rock patches) |
| 5 | The Descent (Phase 5, replaces the Collapse) | 130 m | 46 → 22 → 49 | 12.6 s | The ridge runs out; a long packed slope down into a sheltered hollow (checkpoint cairn at the bottom), then the path climbs out; slide down and the speed carries you part of the way up |
| 6 | Whiteout | 165 m | 49 → 66 | 22.5 s | A col between two rock horns (~45 m above the path, 50–100 m out); the wind is funnelled through the gap, so the storm lives there (world/storm.js): you see it from the climb out of the hollow, the wind and snow build as you near it, visibility falls to ~16 m inside, and it is still blowing behind you when you come out (Session 6, DECISIONS #77). Note cairns A/B/C at 36 / 86 / 138 m on the left of a packed path |
| 7 | Summit Push | 150 m | 62 → 117 | — | Out of the storm onto a broad shoulder that narrows into the summit ridge: a steady 20–25° walk with the ranges on both sides and the low sun ahead (Session 6, DECISIONS #78; the dip, bank, couloir and rock line are gone) |
| 8 | Summit | 26 m | 117 → 118 | — | Round top with 60 m falls; the ending takes over 12 m in (no flag) |

**Session 7 changes** (DECISIONS #80–#91): the Foot's bank is a plain climb; the Powder Fields are
deep powder with no packed trail; the Ice Chutes are ridden on the sled (it waits at 11 m; the lip
launches at 198.8 m; the run-out from 238 m is powder); the ridge has no ice; the whiteout's note
cairns have lanterns and prayer flags and the col is walled by six rock peaks; the Summit Push ridge
and the summit sit on a planar pyramid with couloirs and strata, the top pointed at 121.5 m (view
spot 13 m in, the ending triggers at 10 m). Bot 2:26, first-time estimate ≈ 4:36 climb, ≈ 5:36 title
to credits.

Phase 5 numbers (tighter controls, no chimneys): bot 2:16, first-time estimate ≈ 4:54 for the
climb, ≈ 5:54 title to credits with the opening (~8 s) and the 52 s ending. The estimate is 1.35 ×
bot + ~6 s hesitation per new mechanic + a retry share in the chutes, ridge and push + ~5 s reading
each note. `npm run playthrough` also replays the narrator's timing at that pace: no line waits more
than ~4 s behind another except direct answers, which follow their line by design.

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
  snow spray from slides/landings; no breath puffs or breathing sound; embers of light at cairns.
- **Character** — As built (Session 7, DECISIONS #82): a climber built from lathed and rounded
  shapes as one rigidly skinned mesh — quilted down jacket, rolled hood, a **red knitted neck gaiter**
  (it replaced the cloth scarf, which never behaved), beanie and goggles, pack with straps, foam mat
  and ice axe, mittens, gaiters, boots on real ankles — walking heel to toe with pelvis sway, drop and
  turn and trekking poles planted with the opposite foot (arms by IK). Originally: an abstract
  capsule figure with a verlet scarf. As built
  (Session 6): feet are planted with two-bone IK on the snow under each foot (no foot slide; toe-off;
  hips ride steadily on slopes; lean into climbs; stepping turns; feet lift higher in powder), and
  the scarf collides with capsules for jacket, pack, bedroll, head and arms (DECISIONS #74, #76;
  the scarf is gone since Session 7).
- **Post** — HDR half-float target → physically based mip-chain bloom → per-section colour grade
  (saturation/temperature curve) → AgX/ACES tonemap → vignette, film grain, subtle speed-streak/
  chromatic aberration at high speed → FXAA.
- **Arc** — desaturated and flat at the start; progressively warmer; whiteout drains to monochrome;
  post-storm is the colour climax; summit falls into blue hour.

### As built (Phase 4; `src/render/`)
Pipeline: sky-view LUT + terrain sun-visibility map + trail ring buffer (off-screen) → scene into a
half-float target with depth (sky triangle, terrain, props, avatar, particles) → atmosphere pass
(aerial perspective, height fog, whiteout) → bloom → grade/AgX/vignette/grain/speed → FXAA.
Modules: `atmosphere.js` (LUTs, sky, sun colour), `sunshadow.js` (ray-marched terrain shadows),
`lights.js` (CSM for props/avatar), `materials.js` (shared world lighting: sky-LUT ambient,
alpenglow), `snow.js`, `trails.js`, `fog.js`, `particles.js`, `post.js`, `arc.js` (sun path, snow
density and grade per section), `quality.js`. Decisions #51–59. Medium: 83–85 draw calls and
275–329k triangles (both including shadow passes).

**Session 7** (DECISIONS #86–#91): the sun is a larger coloured, limb-darkened disc in a warm aureole;
snowfall moves in terrain-following coordinates and the storm's snow comes across the path out of
the sky; the distant ranges are grown by stream-power erosion (`world/ranges.js`) with a snowline,
rock faces with snow couloirs, and forest in the valleys; the summit is a pyramid with a snow plume
(fog pass) and the col's horns are rock peaks; the note cairns' lanterns scatter halos through the
storm (fog pass) and light their surroundings; rock is banded, gently bumped and snow-dusted;
fractured snow-capped rocks and snow-laden firs (`world/rocks` in props.js, `world/trees.js`).
Medium now: 43–84 draw calls, 300–430k triangles.

## 5. Audio (all procedural Web Audio)

- **Wind** — pink noise through a rumble, a soft whistle band and a hiss, with slow swells; gusts
  are a deep roar plus a broad rush with turbulence, heard building from the warning, panned from
  upwind, dying away over ~2 s; the gap's storm adds a wandering two-band howl and its roar is heard
  from the approach (Session 6, DECISIONS #73).
- **Footsteps** — synthesized in `audio/steps.js`. As built (Session 7, DECISIONS #80): snow is one
  soft muffled compression (one-pole lowpassed noise under a single swell — the Phase 5 powder
  recipe the user liked), powder the same deeper and slower; ice = tick + scrape + glassy grit;
  rock = boot heel knock, crushed grit, toe scuff. 8 variations per surface, never the same one twice
  in a row, a small change of rate and level on every play, panned toward the foot, fired at each
  heel strike of the IK gait; ~6 dB quieter than Session 6.
- **Slide** — continuous filtered noise, cutoff and gain from speed and surface.
- **Breath** — filtered noise swells on jumps, hard landings, in powder, sprinting and on steep climbs.
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

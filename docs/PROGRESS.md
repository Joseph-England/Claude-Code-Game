# Progress

Current phase: **Phase 6 — Polish, performance & release** (Phases 1–5 complete)

## Phase 1: Foundation & design
- [x] Create CLAUDE.md operating rules
- [x] Write docs/DESIGN.md (story, lines, movement, level, visuals, audio, tech, showcase)
- [x] Write docs/DECISIONS.md
- [x] Write docs/PROGRESS.md with all six phases; create empty docs/IDEAS.md
- [x] Vite + Three.js skeleton with a basic rendering scene
- [x] GitHub Actions workflow deploying to GitHub Pages (base path `/Claude-Code-Game/`)
- [x] README with local run instructions
- [x] `npm run build` passes; commit; handoff note

**Done when:** all docs exist and are committed; `npm run build` passes; the deploy workflow is in
`.github/workflows/`; README explains local dev; handoff note written.

## Phase 2: Movement & camera (gray-box; feel is the priority)
- [x] Core loop: fixed 120 Hz physics step, interpolated rendering, `core/loop.js`
- [x] Input module: keyboard, mouse (pointer lock), gamepad; action mapping (DECISIONS #26)
- [x] Gray-box test course: procedural heightfield with flats, slopes (10°–50°), dips/rises, a half-pipe, a ramp, walls; surface zones for powder/packed/ice/rock
- [x] Heightfield collision + surface lookup; `three-mesh-bvh` collision for box/wall meshes
- [x] Controller states: ground run, slide, air, stumble, sit; momentum model (DESIGN §2)
- [x] Jump: variable height, coyote time, jump buffer; slide-jump; landing velocity projection
- [x] Wall-kick
- [x] Surface physics table (friction/drag/control) wired to the controller
- [x] Third-person camera: orbit, auto-follow, terrain collision, speed FOV, carve roll
- [x] Placeholder avatar (capsule + facing) with lean
- [x] Dev tuning panel (lil-gui) + speed/state readout; tune until it feels good; record final constants in DECISIONS

**Done when:** on the gray-box course you can run, jump, slide, slide-jump, wall-kick and feel clear
differences between surfaces; speed is earned on downslopes and lost uphill/in powder; camera never
clips into terrain; 60 fps; build passes.

## Phase 3: Mountain & level (full level playable with simple visuals)
- [x] Noise library (value/simplex, fBm, ridged, domain warp), seeded and deterministic
- [x] Terrain generation in a Web Worker with progress reporting
- [x] Erosion pass (fallback: skip — DESIGN §7 #2)
- [x] Route spline + section definitions (0–8) and spline-SDF carving of the route into the terrain
- [x] Splat map: surface types painted by section, slope and route
- [x] Chunked terrain renderer with 3 LODs + skirts (height texture in vertex shader)
- [x] Section set pieces: ice chutes, cornice ridge (wind gust zones), snow bridge collapse, ice cave mesh, whiteout plateau, final face, summit
- [x] Props: cairns (checkpoints), rocks; collision meshes into BVH
- [x] Checkpoints + respawn (fade back to last cairn < 1.5 s); out-of-bounds detection
- [x] Progress tracking along the route (drives sun elevation later) + section trigger volumes
- [x] Full playthrough test: first-time route ≈ 5 min; fix blockers and soft-locks

**Done when:** the whole level is playable start to finish with flat-shaded visuals; every section's
mechanic works; respawns work everywhere; no soft-locks; 60 fps on Medium-equivalent settings.

## Phase 4: Atmosphere & rendering
- [x] HDR render target + post chain skeleton (tonemap, FXAA)
- [x] Atmospheric scattering sky (transmittance + sky-view LUTs), sun driven by route progress; stars, Earth's shadow, Belt of Venus
- [x] Sun light + cascaded shadow maps; sky ambient (+ ray-marched terrain shadows)
- [x] Snow shader: wrap/SSS diffuse, violet shadows, glitter, triplanar detail, surface blending
- [x] Deformable snow trails (ring-buffer RT)
- [x] Height fog + aerial perspective; whiteout fog
- [x] GPU particles: snowfall, spindrift, slide spray, breath, cairn embers
- [x] Procedural avatar with gait/lean + verlet scarf
- [x] Bloom, per-section colour grade, vignette, grain, speed effects (+ alpenglow)
- [x] Quality tiers + auto benchmark + dynamic resolution; verify budgets (DESIGN §6)

**Done when:** the level looks like the design (sunset arc, snow, fog, particles, post) and holds
60 fps on Medium on integrated graphics; every showcase item is shipped or its fallback is logged.

**Measured (Phase 4, headless Chromium + SwiftShader, 1280×720; `tools/smoke.mjs`):**

| Tier | Section | Draw calls | Triangles (incl. shadow passes) |
|---|---|---|---|
| Medium | 1 The Foot | 83 | 326k |
| Medium | 4 Cornice Ridge | 85 | 275k |
| Medium | 7 Summit Push | 83 | 329k |
| Low | 1 / 4 / 7 | 63 / 63 / 61 | 247k / 193k / 254k |
| High | 3 Ice Chutes | 113 | 442k |

Budget (DESIGN §6, Medium): ≤ 150 calls, ≤ 400k triangles: met. Frame time is not measurable here
(software GL: ~0.4–0.7 s/frame, so the auto benchmark correctly picks Low and dynamic resolution
drops to 0.5). On real hardware, F3 shows GPU ms (timer query) per frame. Physics is unchanged
(≈ 3.5 µs/step).

## Phase 5: Story, audio & flow
Playtest notes from Session 4's build (done first):
- [x] Remove wall-kick + chimneys; replace the bridge collapse with a descent; spread the whiteout cairns; no summit flag; tighter controls (DECISIONS #60–63)
- [x] Avatar: better figure, no idle animation, balanced stance; scarf that behaves like cloth (DECISIONS #64)
- [x] Mountains that read as mountains (structure of the ranges and the relief); sunset glow from the sky, not the valley fog (DECISIONS #65–66)
- [x] Clear summit flow (ending takes over; no "press R" nag at the top) (DECISIONS #67, #71)

- [x] Game state machine: title → playing → ending → credits → title
- [x] Title screen (with brief content note) and loading progress
- [x] Narrator: text UI for three voices, queue, fade timing, bell cue
- [x] Place all line triggers (DESIGN §1 table) including conditional lines
- [x] Cairn notes interaction + "add a stone" beat
- [x] Audio engine + procedural wind with gusts
- [x] Surface-aware footsteps, slide noise, breath, landings
- [x] Generative music by section + procedural reverb IRs (open air / sheltered; the cave is gone, DECISIONS #69)
- [x] Ending sequence: camera reveal, sit, sunset, final lines, fade
- [x] Credits with support-resources line
- [x] Pacing pass: full playthroughs, adjust trigger timing and section lengths (DECISIONS #72)

**Done when:** a first-time player can go from title to credits in ~5 minutes with every line,
sound and the ending working, and the tone reads as intended.

## Phase 6: Polish, performance & release
Playtest notes from Session 5's build (done first, Session 6):
- [x] Footsteps: crunchier, lower packed; varied powder; a real boot-on-rock sound; per-step variation; quieter (DECISIONS #73)
- [x] Gust and storm wind sound; mix balance (DECISIONS #73)
- [x] Walking made the core: foot-planted IK gait, slope posture, stepping turns, powder kicks, climbing breath (DECISIONS #74)
- [x] No sitting: stand and admire the view at the top; no auto-sit at cairns (DECISIONS #75)
- [x] Scarf no longer clips through the figure (DECISIONS #76)
- [x] Whiteout motivated: a wind gap between two horns; the storm is a place you see, enter and leave (DECISIONS #77)
- [x] Final ascent is a walk up the summit ridge, no platforming (DECISIONS #78)

Playtest notes from Session 6's build (done first, Session 7):
- [x] Title screen centred (the heading overflowed its 560 px column to the right) (DECISIONS #79)
- [x] No camera roll: the horizon stays level when turning (DECISIONS #79)
- [x] Packed snow removed (look, sound, trail); new soft snow steps; quieter footsteps (DECISIONS #80)
- [x] Ridge ice removed; gusts are waited out standing still or on rock (DECISIONS #81)
- [x] Scarf replaced by a knitted neck gaiter (no cloth simulation) (DECISIONS #82)
- [x] Better climber model and walk (feet that roll heel to toe, hip sway, pelvis turn, trekking poles, hood, gaiters) (DECISIONS #82)
- [x] Sled at the chutes cairn replaces the boot-slide; the kicker launches cleanly over the crevasse (DECISIONS #83)
- [x] Contextual hints (what to do, when it matters) (DECISIONS #84)
- [x] Note cairns draw you in (lanterns and prayer flags); notes never collide with earlier lines; the stone beat can't be missed (DECISIONS #85)
- [x] Blizzard snow travels along the slope and falls; more blowing snow at the top (DECISIONS #86)
- [x] New sun (DECISIONS #87)
- [x] Backdrop ranges that read as real mountains (DECISIONS #88)
- [x] A summit that looks majestic from everywhere (pyramid, arêtes, rock faces, snow plume) (DECISIONS #89)
- [x] Environment craft: rocks that belong, outcrops, rock shading, banded slopes, trees low down (DECISIONS #90, #91)

- [ ] Bug bash: full playthroughs on each quality tier; fix all blockers
- [ ] Performance pass: profile, hit budgets, reduce draw calls/overdraw
- [ ] Settings menu: quality, mouse sensitivity, invert Y, volume sliders, reduce motion
- [ ] Pause menu + restart from checkpoint
- [ ] Gamepad pass
- [ ] Browser checks (Chrome, Firefox, Safari) and WebGL2-unavailable message
- [ ] Final tuning of movement and camera
- [ ] README: description, controls, tech highlights, credits; screenshots generated from the game
- [ ] Verify the GitHub Pages deploy from a clean clone

**Done when:** the deployed link plays start to finish without blockers at 60 fps on Medium, settings
work, README is complete.

## Session Log

### Session 1 — Phase 1: Foundation & design (2026-09-27)
- **Completed:** CLAUDE.md; DESIGN.md (story + 34 draft lines, moveset, 9-section route, visuals,
  audio, architecture, quality tiers, 6 showcase techniques with fallbacks); DECISIONS.md (#1–27);
  this checklist for all six phases; empty IDEAS.md. Vite 8 + Three.js r186 skeleton (`src/main.js`:
  ridged-noise slope, gradient sunset sky, low sun with shadows, slow orbiting camera; verified
  rendering in headless Chromium). Pages workflow `.github/workflows/deploy.yml`; README.
- **Broken / deferred:** nothing broken. The deploy only runs on pushes to `main`. Work so far is on
  branch `claude/stoic-hypatia-40nygj`, so it must be merged to `main`, and **Settings → Pages →
  Source = GitHub Actions** must be set once, before the link goes live.
- **Next step:** Phase 2, first item: create `src/core/loop.js` (fixed 120 Hz step + interpolation),
  then `src/core/input.js`. Replace the Phase 1 demo in `src/main.js` with the gray-box test course.
- **Addendum:** PR #1 merged by the user; first Pages deploy succeeded. Per user request Claude now
  handles PRs/merges/deploys itself (DECISIONS #28); the workflow now builds PRs (#29).

### Session 2 — Phase 2: Movement & camera (2026-09-27)
- **Completed:** every Phase 2 item. `core/loop.js` (120 Hz fixed step, interpolated render),
  `core/input.js` (kb, pointer-lock mouse, standard gamepad), `world/heightfield.js` (Catmull-Rom
  height + exact normal, DECISIONS #30), `world/colliders.js` (three-mesh-bvh capsule push-out +
  camera rays), `world/course.js` (gray-box course: the Run with ice/rollers/kicker/powder lanes,
  slope lanes 10–58°, surface pads, half-pipe trench, chimney/steps/wall/tunnel, cairn, 7 stations),
  `player/controller.js` (run/slide/air/stumble/sit, surface table, jump with coyote/buffer,
  slide-jump, landing projection, stumble, crest launches, wall-kick), `player/camera.js`,
  `player/avatar.js`, `debug/overlay.js` (F3), `debug/panel.js` (F4), `render/graybox.js`, and all
  constants in `src/tuning.js`. `npm run check` (also in CI) measures and asserts the feel numbers
  and camera clipping; results + rationale in DESIGN §2 "Tuning"; decisions #30–35.
- **User playtest notes:** camera bumps/choppiness fixed (lead-compensated vertical spring, smooth
  terrain lift, interpolation; DECISIONS #35). Blocky striped shadows explained and fixed for the
  gray box (r186 dropped PCFSoft; now soft PCF radius + follow frustum, DECISIONS #33); the mountain
  itself returns in Phase 3 and gets cascades in Phase 4.
- **Broken / deferred:** 60 fps is not verifiable headless here. Physics is 3.5 µs/step and the
  course is one ~295k-triangle mesh, so it should hold on integrated GPUs; please confirm with F3.
  The capsule is resolved against the heightfield only at the feet, so on 60°+ trench walls the
  body can visually dip into the slope. Phase 3's terrain renderer replaces the single mesh.
- **Next step:** Phase 3, first item: noise library (`src/world/noise.js`: seeded value/simplex,
  fBm, ridged, domain warp). The Phase 2 course stays reachable for testing (keep `buildCourse`,
  e.g. behind `?course=graybox`).

### Session 3 — Phase 3: Mountain & level (2026-09-27)
- **Completed:** every Phase 3 item. `world/noise.js` (seeded value/simplex, fBm, ridged, warp);
  `world/level.js` (all 9 sections as data: lengths, turns, height knots, profiles, surfaces, cairns,
  story beats with the draft lines as placeholder text, OOB rules, wind, bridge, chimneys, roof, bot
  hints); `world/route.js` (constant-curvature centreline, smoothed heights with hard knots,
  crevasses); `world/erosion.js`; `world/terrain-gen.js` + `terrain.worker.js` + `mountain.js`
  (macro shape from the route + cone + warped ridged noise, erosion, 1 m upsample, route distance
  field, profile carving with adaptive shoulders, splat map, backdrop ranges; ~2 s in the worker
  with progress); `render/terrain.js` (16×16 chunks, 3 instanced LODs + skirts, height texture in
  the vertex shader, splat tints: terrain = 3 draw calls); `world/props.js` (cairns, boulder,
  rocks merged into one mesh, marker poles, snow bridge, chimneys, ice-cave roof, summit pole);
  `world/levelstate.js` (progress, sections, trigger volumes, checkpoints, OOB, collapse, gusts,
  headwind, whiteout, wall-kick gating, summit); `game.js` (loading progress, HUD placeholders,
  1.0 s respawn fade, stuck hint). `tools/playthrough.mjs` (`npm run playthrough`, also in CI) and
  `tools/map.mjs`. Decisions #36–46; DESIGN §3 "As built".
- **Measured:** bot reaches the summit in 3:05 with 0 respawns; first-time estimate ≈ 5:30; all 32
  story trigger volumes entered; 14/14 cairn respawns stable; both momentum banks clear from rest
  (slide or rock edge); soft-lock sweep 270/272. In the browser (Powder Fields view): 221k
  triangles, 27 draw calls incl. shadows, mountain generated in 1.5 s.
- **Broken / deferred:** 60 fps is not verifiable headless (software GL); budgets above look fine,
  please confirm with F3 on real hardware. The two sweep misses are bot limits, reviewed: (1) Summit
  Push +50, d = −18: the bot backs into a scattered rock; (2) Summit Push +90, d = −17: dropped on
  the gully rim, the bot falls into the chimney from the side and its script doesn't recover (a
  player can walk along the rim, which also bypasses that chimney; acceptable). Profile changes
  far from the centreline still leave a few straight terrain seams (visible on the map). Beats that
  depend on events (first jump, first slide, failed launch, "if slow") are placed as location
  volumes; Phase 5 adds their conditions. Wall-kick contacts only come from colliders, so
  heightfield cliffs are never kickable (by design). The avatar, sun, sky and fog are placeholders.
- **Next step:** Phase 4, first item: HDR render target + post chain skeleton (tonemap, FXAA),
  replacing `render/lights.js` and the flat fog/background in `game.js`. The terrain material is
  `MeshStandardMaterial` patched in `render/terrain.js`; the Phase 4 snow shader should keep its
  height-texture vertex code (and the depth material) and replace the fragment part.

### Session 4 — Phase 4: Atmosphere & rendering (2026-09-27)
- **Playtest notes (done first):** Shift sprints (9 m/s), walk is 5 m/s, slide moved to C / right
  mouse, unlimited stamina (#47). Harder route: 5 checkpoints instead of 14, a 46° summit couloir
  climbed on a zig-zag rock line (step off it and you slide back), ice patches between rock
  shelters on a narrower, gustier ridge, an 8.5 m crevasse; every surface now has a job (#48).
  HUD text on dark backings; the Weight looks like a stain with a vignette, not a second person;
  cairn notes look like notes (#49). Procedural avatar replaces the capsule: lean capped at 0.08 rad
  on foot, and the "blob" (the old squashed rest pose) is now a real sit (#50).
- **Completed:** every Phase 4 item. `render/post.js` (HDR target, bloom, grade, AgX, vignette,
  grain, speed streaks/CA, FXAA), `atmosphere.js` (transmittance + sky-view LUTs, Earth's shadow,
  sun disc, stars, JS sun colour), `arc.js` (sun path #52, snow density and grade per section),
  `sunshadow.js` + `lights.js` + `materials.js` (ray-marched terrain shadows, CSM for props/avatar,
  sky-LUT ambient, alpenglow; #53), `snow.js` (#54), `trails.js` (#55), `fog.js` (#56),
  `particles.js` (#57), `quality.js` (#59), `player/avatar.js` (#50). Tools: `tools/smoke.mjs`.
  Screenshots used: 5 (trailhead figure, cave, ridge, summit push ×2).
- **Broken / deferred:** 60 fps on integrated graphics is unverified (software GL only here); please
  check F3 on real hardware (GPU ms, scale, calls). The post-sunset look (Earth's shadow, Belt of
  Venus, stars, alpenglow) is implemented but was not screenshotted: it only appears after reaching
  the summit, and Phase 5's ending camera will frame it. Shadow cascade count changes apply after a
  reload (#59). Trails fade 64 m behind you (#55). The one soft-lock sweep miss (Opening +30,
  d = 19: a hollow off the trail) is a bot limit; R and the 12 s hint cover it.
- **Next step:** Phase 5, first item: game state machine (title → playing → ending → credits →
  title) in `src/main.js`/`game.js`. The ending should drive `sunElevation(p, sinceSummit)` (already
  sets the sun under the horizon over 40 s after arrival) and turn the camera east toward Earth's
  shadow and the alpenglow on the far ranges. Keep the voice styles from #49 in the narrator.


### Session 5 — Phase 5: Story, audio & flow (2026-09-27)
- **Playtest notes (done first):** wall-kick, chimneys, snow bridge, ice-cave roof and summit flag
  removed; "The Descent" replaces the collapse (down into a sheltered hollow, then the path up);
  whiteout notes spread to 36 / 86 / 138 m and each stays up while you stand at its cairn; tighter
  ground control (#60–63). New climber avatar with no idle motion and a stable cloth scarf (the old
  one's follow-the-leader constraints pumped energy into it) (#64). Structured backdrop ranges; the
  sunset glow no longer rises out of the valley fog (#65–66). The top is now clear: the ending takes
  over, and the "R" reminder is rare and never on the summit (#67, #71).
- **Completed:** every Phase 5 item. `src/story/story.js` (line triggers + conditions, Node-safe),
  `narrator.js` (queue, per-voice fades, the Weight fading over the climb), `ending.js` (walk, sit,
  camera reveal, timed lines, fade); `src/audio/audio.js` + `music.js` (reverbs, wind, footsteps,
  slide, breath, bells, generative score); title/credits in `index.html`; flow in `game.js`. Final
  lines locked in DESIGN §1 (30 lines, #68). Tools: `tools/flow.mjs` (scripted headless run with
  screenshots); `npm run playthrough` now checks every line fires and replays the narrator's timing.
- **Measured:** bot 2:16, first-time estimate ≈ 4:54 climb / ≈ 5:54 title to credits; all 22
  non-scripted lines fire (plus 2 struggle-only); no line waits > 4.2 s behind another (answers
  excepted); Medium at the summit push: 109 draw calls, 344k triangles (budget 150 / 400k); audio
  ≈ −30 dBFS RMS pre-compressor while walking. `npm run check` and `npm run playthrough` pass.
- **Broken / deferred:** nothing known broken. Not verifiable here: how the audio actually sounds
  (levels were measured, but please listen, especially wind vs. music balance and the footstep
  timbres), real-hardware frame rate, and first-time timing with a real player (the ~5:54 is a
  model). Soft-lock sweep has 3 bot misses (limit 3), one new in a hollow off the Descent's left
  shoulder; R and the reminder cover it. The ending timeline is fixed (52 s); skipping it is not
  possible yet (Phase 6 pause menu could add it).
- **Next step:** Phase 6, first item: bug bash — full playthroughs on each quality tier (start with
  the title → credits loop twice in a row, to confirm the reset: stone, notes, sun, music level).

### Session 6 — Phase 6 playtest notes (2026-09-27)
- **Completed (all user playtest notes, done first):** synthesized footsteps (`src/audio/steps.js`)
  with per-play variation and a lower mix; gust roar/rush with turbulence and a warning swell; storm
  howl and approach roar (#73). Foot-planted IK gait with toe-off, steady hips on slopes, climb lean,
  stepping turns, powder kicks; effort breathing on steep climbs (#74). No sitting: the ending stands
  at the viewpoint and turns to the alpenglow; the cairn auto-sit is gone (#75). Scarf capsule
  colliders, inelastic contact, settled resets, ribbon width across the strip (#76). The whiteout is
  a wind gap: horns either side of a col, and the storm is an analytic volume in the fog pass that
  you see from the approach and behind you, with wind/snow/audio from the same field (#77). Summit
  Push rebuilt as a walk up the summit ridge (#78). New dev tools: `tools/check-gait.mjs` (foot slip,
  hip bob, scarf penetration), `window.__game.tp(s, back)` (teleport along the route), `evalfile:`
  steps in `tools/flow.mjs`.
- **Measured:** footstep spectral centroid packed 16.4 kHz → ~1.1 kHz, powder ~0.3 kHz, rock
  ~1.1 kHz, ice ~3.5 kHz; in-game packed step peak ≈ −18 dB K-weighted at the master (Phase 5:
  −11.6 dB), ~10 dB over the wind bed. Gait: 0.000 m/s planted-foot slip (flat, ±20°, 2/5/9 m/s),
  2–5 cm hip bob. Scarf ≤ 5 mm inside the body in all tested winds. Bot 2:16, first-time estimate
  ≈ 4:53 climb / ≈ 5:53 title to credits; all lines fire; soft-lock sweep 3 bot misses (limit 3; all
  in shoulder gullies off the path, R and the reminder cover them). `npm run check`, `npm run
  playthrough`, `npm run build` pass.
- **Broken / deferred:** audio was tuned by measurement, not by ear (please listen: the new packed
  crunch, rock steps, gusts on the ridge, the storm's approach roar and howl). The browser analyser
  can't measure the mix here (headless frames are ~1 s, so steps and taps are sparse). The storm's
  look from outside was checked in screenshots at low quality only. The Phase 6 checklist itself is
  untouched.
- **Next step:** Phase 6, first item: bug bash — full playthroughs on each quality tier (start with
  the title → credits loop twice in a row, to confirm the reset: stone, notes, sun, music level, the
  standing ending's `admire`).

### Session 7 — Phase 6 playtest notes, round 2 (2026-09-28)
- **Completed (all 21 user playtest notes, done first):** title centred; no camera roll (#79). No
  packed snow: one snow surface (old packed footing, snow look and sound), deep powder only where it
  means something, soft Phase 5-style snow steps ~6 dB quieter (#80). No ridge ice (#81). No scarf:
  a red knitted neck gaiter on a rebuilt climber (quilted jacket, hood, pack with straps and axe,
  goggles, gaiters, boots on ankles) with a heel-to-toe walk, pelvis sway/drop/turn and trekking
  poles planted with the opposite foot (#82). A sled at the chutes cairn replaces the boot-slide;
  the kicker's lip launches a rider on a fixed arc over the crevasse; the run-out stops it (#83).
  One-shot contextual hints with key caps (#84). Note cairns have storm lanterns whose light
  scatters through the blizzard, prayer flags, notes that cut in over earlier lines, and a stone
  prompt you can't miss (#85). Snowfall follows the terrain; the storm's snow comes across the path
  from the sky; spindrift off the summit ridge (#86). A new sun (#87). Distant ranges grown by
  stream-power erosion (#88). A summit that looks like one: pointed top, planar pyramid with
  couloirs and strata, horns rebuilt as rock peaks, rock shards, a sunlit snow plume (#89).
  Fractured snow-capped rocks (#90); rock shading with strata and snow on ledges, rock bands on
  steep ground, firs from the tree line down, and a much cheaper frame (#91).
- **New tools:** `tools/ranges.mjs` (backdrop map + skyline panorama from the summit);
  `window.__game.look(x, z, pitch)` (dev: point the camera); `tools/check-gait.mjs` measures heel/ball
  contact slip; `npm run playthrough` rides the sled and checks the run.
- **Measured:** gait slip ≤ 0.034 m/s, sole 0.000 m (flat, ±20°, 2/5/9 m/s). Bot 2:26, first-time
  estimate ≈ 4:36 climb / ≈ 5:36 title to credits; all 22 lines fire; soft-lock sweep 1 bot miss
  (limit 3). Sled run from the cairn: one launch, clears the crevasse, stops at +245 m (steered) /
  +252 m (hands off), top ~23–25 m/s. Medium in headless Chromium: 43–84 draw calls (was ~110) and
  300–430k triangles (was 318–382k; budget 400k). Terrain generation ~3.1 s (ranges 0.7 s of it).
  `npm run check`, `npm run playthrough`, `npm run build` pass.
- **Broken / deferred:** nothing known broken. Not verifiable here: how the new snow steps sound
  (measured, not heard), the sled's feel at real frame rates, the walk and poles in motion (frames
  were ~1 s apart; the gait check covers the foot contact numbers). Triangles run up to ~7 % over the
  Medium budget on some views (chutes, the Foot): the Phase 6 performance pass should trim them
  (far trees, avatar segments, LOD distances). The first-time estimate fell to ≈ 4:36 because the
  chutes rarely cost a retry now; the pacing still lands at ~5.5 min title to credits.
- **Next step:** Phase 6, first item: bug bash — full playthroughs on each quality tier (start with
  the title → credits loop twice in a row, to confirm the reset: sled back at the cairn, stone,
  notes, hints, sun, music level, the standing ending's `admire`).

### Session 7b — follow-up playtest notes (2026-09-28)
- **Completed:** gusts removed from the ridge (the only difficulty change); sled brake removed; zebra
  stripes gone from the ranges, the slopes beside the route and the summit; the summit is a snowy
  peak that matches the ranges (DECISIONS #92). Bot 2:25, first-time ≈ 4:25 climb / ≈ 5:25 title to
  credits; all 22 lines fire; checks and build pass.
- **Broken / deferred:** nothing known. The triangle budget note from Session 7 still stands.
- **Next step:** Phase 6, first item: bug bash (title → credits twice in a row on each tier).

### Session 8 — playtest notes round 3 (2026-09-28)
- **Completed:** breathing sound removed; the ending's light changes smoothly (sun-shadow cross-fade);
  dialogue cut to 18 lines (13 on the climb + the ending's 5), none during the sled (line 8 plays
  on stepping off); less blowing snow at the top, placed like real spindrift — plumes off lee
  edges and grains along exposed snow, in gusts (DECISIONS #93). Bot 2:25, first-time ≈ 4:25 climb
  / ≈ 5:25 title to credits; 13/13 climb lines fire; checks and build pass.
- **Broken / deferred:** the user finds the mountains "much better" but still not great — no change
  this round (no specific ask); candidates are in IDEAS if it comes up again. Triangle budget note
  from Session 7 still stands.
- **Next step:** Phase 6, first item: bug bash (title → credits twice in a row on each tier).

### Session 9 — playtest notes round 4 (2026-09-28)
- **Completed:** the sun no longer turns black as it sets (the disc is added and fades with the
  light; a wider, softer sunset of the light); no green in the sunset (hue pull in the composite);
  lines 11/12 cut (16 lines); breath puffs removed; the ending is one continuous camera move with
  a long hand-over and an eased turn (DECISIONS #94). Bot 2:25, first-time ≈ 5:25 title to credits;
  11/11 climb lines; checks and build pass.
- **Broken / deferred:** nothing known.
- **Next step:** Phase 6, first item: bug bash (title → credits twice in a row on each tier).

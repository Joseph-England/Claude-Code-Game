# Progress

Current phase: **Phase 4 — Atmosphere & rendering** (Phases 1–3 complete)

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
- [ ] GPU particles: snowfall, spindrift, slide spray, breath, cairn embers
- [x] Procedural avatar with gait/lean + verlet scarf
- [ ] Bloom, per-section colour grade, vignette, grain, speed effects
- [ ] Quality tiers + auto benchmark + dynamic resolution; verify budgets (DESIGN §6)

**Done when:** the level looks like the design (sunset arc, snow, fog, particles, post) and holds
60 fps on Medium on integrated graphics; every showcase item is shipped or its fallback is logged.

## Phase 5: Story, audio & flow
- [ ] Game state machine: title → playing → ending → credits → title
- [ ] Title screen (with brief content note) and loading progress
- [ ] Narrator: text UI for three voices, queue, fade timing, bell cue
- [ ] Place all line triggers (DESIGN §1 table) including conditional lines
- [ ] Cairn notes interaction + "add a stone" beat
- [ ] Audio engine + procedural wind with gusts
- [ ] Surface-aware footsteps, slide noise, breath, landings
- [ ] Generative music by section + procedural reverb IRs (open air / cave)
- [ ] Ending sequence: camera reveal, sit, sunset, final lines, fade
- [ ] Credits with support-resources line
- [ ] Pacing pass: full playthroughs, adjust trigger timing and section lengths

**Done when:** a first-time player can go from title to credits in ~5 minutes with every line,
sound and the ending working, and the tone reads as intended.

## Phase 6: Polish, performance & release
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

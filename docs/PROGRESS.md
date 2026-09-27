# Progress

Current phase: **Phase 2 — Movement & camera** (Phase 1 complete)

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
- [ ] Core loop: fixed 120 Hz physics step, interpolated rendering, `core/loop.js`
- [ ] Input module: keyboard, mouse (pointer lock), gamepad; action mapping (DECISIONS #26)
- [ ] Gray-box test course: procedural heightfield with flats, slopes (10°–50°), dips/rises, a half-pipe, a ramp, walls; surface zones for powder/packed/ice/rock
- [ ] Heightfield collision + surface lookup; `three-mesh-bvh` collision for box/wall meshes
- [ ] Controller states: ground run, slide, air, stumble, sit; momentum model (DESIGN §2)
- [ ] Jump: variable height, coyote time, jump buffer; slide-jump; landing velocity projection
- [ ] Wall-kick
- [ ] Surface physics table (friction/drag/control) wired to the controller
- [ ] Third-person camera: orbit, auto-follow, terrain collision, speed FOV, carve roll
- [ ] Placeholder avatar (capsule + facing) with lean
- [ ] Dev tuning panel (lil-gui) + speed/state readout; tune until it feels good; record final constants in DECISIONS

**Done when:** on the gray-box course you can run, jump, slide, slide-jump, wall-kick and feel clear
differences between surfaces; speed is earned on downslopes and lost uphill/in powder; camera never
clips into terrain; 60 fps; build passes.

## Phase 3: Mountain & level (full level playable with simple visuals)
- [ ] Noise library (value/simplex, fBm, ridged, domain warp), seeded and deterministic
- [ ] Terrain generation in a Web Worker with progress reporting
- [ ] Erosion pass (fallback: skip — DESIGN §7 #2)
- [ ] Route spline + section definitions (0–8) and spline-SDF carving of the route into the terrain
- [ ] Splat map: surface types painted by section, slope and route
- [ ] Chunked terrain renderer with 3 LODs + skirts (height texture in vertex shader)
- [ ] Section set pieces: ice chutes, cornice ridge (wind gust zones), snow bridge collapse, ice cave mesh, whiteout plateau, final face, summit
- [ ] Props: cairns (checkpoints), rocks; collision meshes into BVH
- [ ] Checkpoints + respawn (fade back to last cairn < 1.5 s); out-of-bounds detection
- [ ] Progress tracking along the route (drives sun elevation later) + section trigger volumes
- [ ] Full playthrough test: first-time route ≈ 5 min; fix blockers and soft-locks

**Done when:** the whole level is playable start to finish with flat-shaded visuals; every section's
mechanic works; respawns work everywhere; no soft-locks; 60 fps on Medium-equivalent settings.

## Phase 4: Atmosphere & rendering
- [ ] HDR render target + post chain skeleton (tonemap, FXAA)
- [ ] Atmospheric scattering sky (transmittance + sky-view LUTs), sun driven by route progress; stars, Earth's shadow, Belt of Venus
- [ ] Sun light + cascaded shadow maps; sky ambient
- [ ] Snow shader: wrap/SSS diffuse, violet shadows, glitter, triplanar detail, surface blending
- [ ] Deformable snow trails (ring-buffer RT)
- [ ] Height fog + aerial perspective; whiteout fog
- [ ] GPU particles: snowfall, spindrift, slide spray, breath, cairn embers
- [ ] Procedural avatar with gait/lean + verlet scarf
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

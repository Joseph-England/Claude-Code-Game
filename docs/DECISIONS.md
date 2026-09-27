# Decisions log

Numbered and append-only. A decision stands unless a later entry reverses it with a reason.

1. **Title: ALPENGLOW.** The light that stays on the peaks after the sun has gone is the game's central image and its ending.
2. **Stack: Three.js (WebGL2) + Vite, plain JavaScript ES modules.** No TypeScript, to keep iteration fast and build config minimal.
3. **Vite base path is `/Claude-Code-Game/`** (GitHub Pages project site for repo `Joseph-England/Claude-Code-Game`).
4. **Deploy via GitHub Actions** (`actions/deploy-pages`) on every push to `main`; Pages source must be set to "GitHub Actions".
5. **Custom kinematic character controller, no physics engine.** Momentum feel needs hand-tuned friction/drag/steering, not rigid-body behaviour.
6. **Fixed 120 Hz physics step with interpolated rendering.** Deterministic feel independent of frame rate.
7. **Terrain collision = analytic heightfield sampling; all other collision (cave, bridge, rocks, cairns) = `three-mesh-bvh`.** Controller merges both.
8. **Terrain: 2 km × 2 km, 1024² heightfield, generated deterministically at load in a Web Worker** (domain-warped ridged fBm → erosion → route carving via spline SDF).
9. **Surface types: powder, packed, ice, rock**, stored in a splat map aligned with the heightfield; the controller reads friction/drag/control from it.
10. **Terrain rendering: chunked grid with 3 LODs + skirts, height read from a float texture in the vertex shader.** Lets LODs and snow trails share one data source.
11. **One level, 9 sections (0 Opening … 8 Summit), ~1.6 km route, ~5 min.** No additional levels, ever.
12. **Sun elevation is driven by route progress, not wall-clock time** (+12° → −5°), so the sunset always lands at the summit.
13. **Checkpoints are cairns; falling off fades back to the last cairn in < 1.5 s.** No death animations, no lives, no timer pressure.
14. **Story told only through timed text lines in three voices** (The Weight, You, Others). Lines never block input; one on screen at a time.
15. **The ending is ambiguous:** empty summit, more ranges beyond, sun sets, "I'm still here." No victory screen.
16. **Credits include one small support line pointing to findahelpline.com.** No pop-ups or content-warning walls; a brief content note on the title screen.
17. **Moveset: run, variable jump (coyote + buffer), slide, slide-jump, landing projection, wall-kick (from cave onward), rest.** No double jump, no dash.
18. **No hard speed cap on slides; terrain is the limiter.**
19. **Camera: third-person orbit with velocity auto-follow, heightfield collision, speed-based FOV.**
20. **Rendering: HDR half-float target → sky → opaque → particles → custom post chain** (mip-chain bloom, grade, tonemap, vignette/grain, FXAA) built on three's EffectComposer.
21. **Sky: physically based single scattering with transmittance + sky-view LUTs**, artistically pushed toward purple/red/orange.
22. **Snow: custom shader** (wrap/SSS diffuse, violet sky-lit shadows, glitter, triplanar detail, surface blending) plus ring-buffer trail render target displacing powder.
23. **All audio is procedural Web Audio**, including reverb impulse responses. No sample files.
24. **Avatar is an abstract procedural figure with a verlet-simulated red scarf.**
25. **Quality tiers Low/Medium/High, auto-picked by a 2 s benchmark, plus dynamic resolution on Low/Medium.** Medium targets integrated GPUs at 60 fps.
26. **Controls:** WASD/arrows move, mouse look (pointer lock), Space jump, Shift slide, Esc pause. Gamepad: left stick, right stick, A jump, B/RT slide, Start pause.
27. **Dev-only `lil-gui` tuning panel and stats overlay**, stripped from production builds via `import.meta.env.DEV`.

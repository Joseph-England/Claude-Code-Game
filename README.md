# Alpenglow

A short, momentum-driven 3D platformer for the browser: climbing a snow mountain at sunset, and a
quiet story about depression told through a few lines of inner voice. One level, about five minutes.
Built with Three.js and Vite; every model, texture, and sound is generated in code.

**Status:** in development (see [`docs/PROGRESS.md`](docs/PROGRESS.md)).
Once deployed it is playable at <https://joseph-england.github.io/Claude-Code-Game/>.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev       # dev server with hot reload; open the printed URL (…/Claude-Code-Game/)
npm run build     # production build into dist/
npm run preview   # serve the production build locally
npm run check     # headless movement/camera checks (speeds, stops, jumps, slopes, camera clipping)
```

## Controls (current gray-box build)

Click the game to capture the mouse. **WASD / arrows** move · **mouse** look · **Space** jump (hold
for height; also wall-kick off ice/rock walls in the air) · **Shift** slide · **1–7** teleport to test
stations · **R** reset · **F3** debug overlay · **F4** live tuning panel. Gamepad: left stick move,
right stick look, A jump, B/RT slide. `?spawn=N` in the URL starts at station N (0–6).

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`, which builds the game and publishes `dist/`
to GitHub Pages. One-time setup: in the repository's **Settings → Pages**, set **Source** to
**GitHub Actions**. The Vite base path (`vite.config.js`) is `/Claude-Code-Game/` to match the repo name.

## Project docs

- [`CLAUDE.md`](CLAUDE.md): operating rules for the AI-driven development sessions
- [`docs/DESIGN.md`](docs/DESIGN.md): story, movement, level, visuals, audio, and architecture
- [`docs/DECISIONS.md`](docs/DECISIONS.md): numbered decision log
- [`docs/PROGRESS.md`](docs/PROGRESS.md): phase checklists and session log
- [`docs/IDEAS.md`](docs/IDEAS.md): parking lot for out-of-scope ideas

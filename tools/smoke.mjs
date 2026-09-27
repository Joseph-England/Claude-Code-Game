// Dev helper: load the game in headless Chromium (no screenshot), let it run, report console
// errors, draw calls, triangles and frame times. Usage: node tools/smoke.mjs [query] [waitMs]
import { chromium } from 'playwright';
import { createServer } from 'vite';

const [query = '', wait = '6000'] = process.argv.slice(2);
const server = await createServer({ logLevel: 'error', server: { port: 5198 } });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[error] ${e.message}`));
await page.goto(`http://localhost:5198/Claude-Code-Game/${query}`);
await page.waitForTimeout(Number(wait));
const stats = await page.evaluate(async () => {
  const g = window.__game;
  if (!g) return null;
  const times = [];
  let last = performance.now();
  for (let i = 0; i < 20; i++) { await new Promise((r) => requestAnimationFrame(r)); const t = performance.now(); times.push(t - last); last = t; }
  times.sort((a, b) => a - b);
  return { calls: g.calls, tris: g.tris, medianFrameMs: times[10].toFixed(1), extra: g.extra?.() };
});
console.log(logs.slice(0, 20).join('\n'));
console.log(JSON.stringify(stats));
await browser.close();
await server.close();

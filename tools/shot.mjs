// Dev helper: screenshot the built game in headless Chromium.
// Usage: node tools/shot.mjs out.png [waitMs] [query] [keysToHold,comma,separated] [preWaitMs]
// Needs Playwright + Chromium available to Node (not a project dependency; e.g. link a global install).
import { chromium } from 'playwright';
import { createServer } from 'vite';

const [out = 'shot.png', wait = '2500', query = '', keys = '', pre = '1500'] = process.argv.slice(2);
const server = await createServer({ logLevel: 'error', server: { port: 5199 } });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[error] ${e.message}`));
await page.goto(`http://localhost:5199/Claude-Code-Game/${query}`);
if (keys) {
  await page.waitForTimeout(Number(pre));
  for (const k of keys.split(',')) await page.keyboard.down(k);
}
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
await server.close();

// Dev helper: drive the real game in headless Chromium through a scripted sequence and take
// screenshots. Usage: node tools/flow.mjs outPrefix "step;step;…" [query]
//   steps: wait:ms | click | down:Key | up:Key | press:Key | shot:name | eval:js
import { chromium } from 'playwright';
import { createServer } from 'vite';

const [prefix = 'flow', script = 'wait:8000;shot:title', query = '?quality=low'] = process.argv.slice(2);
const server = await createServer({ logLevel: 'error', server: { port: 5197 } });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[error] ${e.message}`));
await page.goto(`http://localhost:5197/Claude-Code-Game/${query}`);
for (const step of script.split(';')) {
  const [cmd, ...rest] = step.split(':');
  const arg = rest.join(':');
  if (cmd === 'wait') await page.waitForTimeout(Number(arg));
  else if (cmd === 'click') await page.mouse.click(640, 400);
  else if (cmd === 'down') await page.keyboard.down(arg);
  else if (cmd === 'up') await page.keyboard.up(arg);
  else if (cmd === 'press') await page.keyboard.press(arg);
  else if (cmd === 'shot') await page.screenshot({ path: `${prefix}-${arg}.png` });
  else if (cmd === 'eval') console.log(arg, '→', JSON.stringify(await page.evaluate(arg)));
}
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
await server.close();

// Drive the avatar lab headless: node tools/lab/shoot.mjs out.png "<js returning a sheet dataURL>"
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const [out, js] = process.argv.slice(2);
const server = await createServer({ logLevel: 'error', server: { port: 5201 } });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
page.on('pageerror', (e) => console.log('[error]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto('http://localhost:5201/Claude-Code-Game/tools/lab/avatar.html');
await page.waitForFunction(() => window.labReady, null, { timeout: 60000 });
const res = await page.evaluate(js);
if (typeof res === 'string' && res.startsWith('data:image')) writeFileSync(out, Buffer.from(res.split(',')[1], 'base64'));
else console.log(JSON.stringify(res));
await browser.close();
await server.close();

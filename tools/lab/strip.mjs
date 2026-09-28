// Frame strip of the avatar driven by the real Controller (headless Chromium, the avatar lab page):
// node tools/lab/strip.mjs out.png fromT toT everyNframes [az] ['[[t0,t1,moveY,sprint],…]'] [getup]
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const [out, fromT, toT, every, az = '90', inputs = '[[0.3,3,1,0]]', mode = ''] = process.argv.slice(2);
const server = await createServer({ logLevel: 'error', server: { port: 5202 } });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
page.on('pageerror', (e) => console.log('[error]', e.message));
await page.goto('http://localhost:5202/Claude-Code-Game/tools/lab/avatar.html');
await page.waitForFunction(() => window.labReady, null, { timeout: 60000 });
const url = await page.evaluate(async ([fromT, toT, every, az, inputs, mode]) => {
  const { Controller } = await import('/Claude-Code-Game/src/player/controller.js');
  const { Heightfield } = await import('/Claude-Code-Game/src/world/heightfield.js');
  const { tuning } = await import('/Claude-Code-Game/src/tuning.js');
  const w = { heightfield: new Heightfield(220, 1).fill(() => 0, () => 0) };
  const c = new Controller(w, tuning); c.teleport([0, 0, 60], 0); c.grounded = true;
  const av = lab.av; av.wake = mode === 'getup' ? 0 : 1; av.reset(); lab.bind(c);
  const DT = 1 / 120, frames = [];
  for (let i = 0; i < toT / DT; i++) {
    const t = i * DT;
    const inp = inputs.find(([a, b]) => t >= a && t < b);
    c.step(DT, { moveX: 0, moveY: inp ? inp[2] : 0, sprintHeld: !!(inp && inp[3]), jumpPressed: false, jumpHeld: false, slideHeld: false }, 0);
    if (mode === 'getup') av.wake = Math.min(1, Math.max(0, (t - 0.3) / 2.6)); // (as the game drives it)
    av.update(c, c.pos, 1, DT);
    if (t >= fromT && i % every === 0) frames.push({ t, x: c.pos.x, z: c.pos.z, snap: lab.sheet({ views: [[az, 4, 4.2, 0.9, `t ${t.toFixed(3)} v ${Math.hypot(c.vel.x, c.vel.z).toFixed(1)}`]], cols: 1, size: 170 }) });
  }
  // (lab.sheet frames the avatar where lab.ctl() says; point it at the controller)
  const cols = Math.min(12, frames.length), rows = Math.ceil(frames.length / cols), cv = document.createElement('canvas');
  cv.width = cols * 170; cv.height = rows * 212; const g = cv.getContext('2d');
  for (const [k, f] of frames.entries()) { const img = new Image(); await new Promise((r) => { img.onload = r; img.src = f.snap; }); g.drawImage(img, (k % cols) * 170, Math.floor(k / cols) * 212); }
  return cv.toDataURL('image/png');
}, [Number(fromT), Number(toT), Number(every), Number(az), JSON.parse(inputs), mode]);
writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
await browser.close(); await server.close();

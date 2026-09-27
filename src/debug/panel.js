// Live tuning panel (F4) bound to src/tuning.js. "Copy JSON" puts the current values on the
// clipboard so good settings can be pasted back into tuning.js.
import GUI from 'lil-gui';

function addFolder(gui, name, obj, ranges = {}, open = false) {
  const f = gui.addFolder(name);
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number') {
      const [lo, hi, step] = ranges[k] ?? [0, Math.max(1, Math.abs(v) * 3), Math.abs(v) < 0.1 ? 0.0005 : 0.01];
      f.add(obj, k, lo, hi, step);
    } else if (typeof v === 'boolean') f.add(obj, k);
  }
  if (!open) f.close();
  return f;
}

export function createPanel(tuning) {
  const gui = new GUI({ title: 'Tuning (F4)', width: 300 });
  gui.add(tuning, 'gravity', 5, 30, 0.1);
  addFolder(gui, 'run', tuning.run, {}, true);
  addFolder(gui, 'slide', tuning.slide);
  addFolder(gui, 'air', tuning.air);
  addFolder(gui, 'jump', tuning.jump);
  addFolder(gui, 'landing', tuning.landing);
  const sf = gui.addFolder('surfaces');
  for (const s of tuning.surfaces) addFolder(sf, s.name, s, { friction: [0, 1, 0.001], drag: [0, 0.05, 0.0005], linDrag: [0, 2, 0.01], control: [0, 2, 0.01], grip: [0, 2, 0.01], maxWalk: [0, 89, 1] });
  sf.close();
  addFolder(gui, 'camera', tuning.camera);
  addFolder(gui, 'input', tuning.input);
  gui.add({ copy: () => navigator.clipboard?.writeText(JSON.stringify(tuning, null, 2)) }, 'copy').name('Copy JSON');
  gui.hide();
  return { toggle: () => (gui._hidden ? gui.show() : gui.hide()) };
}

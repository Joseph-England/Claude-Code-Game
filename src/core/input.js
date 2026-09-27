// Input: keyboard, mouse (pointer lock) and gamepad mapped to game actions (DECISIONS #26).
// `sample(frameDt)` is called once per frame and returns a command snapshot that the
// physics steps read. Edge-triggered actions (jumpPressed) are true for one frame only.

const DEADZONE = 0.15;

function deadzone2(x, y) {
  const m = Math.hypot(x, y);
  if (m < DEADZONE) return [0, 0];
  const s = Math.min(1, (m - DEADZONE) / (1 - DEADZONE)) / m;
  return [x * s, y * s];
}

export class Input {
  constructor(element, settings) {
    this.el = element;
    this.settings = settings; // { mouseSensitivity, stickLookSpeed, invertY }
    this.down = new Set();
    this.pressed = new Set(); // keys pressed since last sample
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.padJumpWas = false;
    this.lastDevice = 'keyboard';
    this.mouseRight = false;

    addEventListener('mousedown', (e) => { if (e.button === 2) this.mouseRight = true; });
    addEventListener('mouseup', (e) => { if (e.button === 2) this.mouseRight = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'F3' || e.code === 'F4' || e.code === 'F2' || e.code === 'Space') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      this.lastDevice = 'keyboard';
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.mouseRight = false; });
    element.addEventListener('click', () => {
      if (!this.locked) element.requestPointerLock?.();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === element;
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
      this.lastDevice = 'keyboard';
    });
  }

  /** True once per physical key press (consumed by sample()). */
  wasPressed(code) {
    return this.pressed.has(code);
  }

  sample(frameDt) {
    const k = this.down;
    let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let my = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const km = Math.hypot(mx, my);
    if (km > 1) { mx /= km; my /= km; }

    const s = this.settings;
    let lookX = this.mouseDX * s.mouseSensitivity;
    let lookY = this.mouseDY * s.mouseSensitivity;
    this.mouseDX = this.mouseDY = 0;

    let jumpPressed = this.pressed.has('Space');
    let jumpHeld = k.has('Space');
    // Shift sprints; C or the right mouse button slides (DECISIONS #47).
    let sprintHeld = k.has('ShiftLeft') || k.has('ShiftRight');
    let slideHeld = k.has('KeyC') || this.mouseRight;

    const pad = navigator.getGamepads?.().find((p) => p && p.connected && p.mapping === 'standard');
    if (pad) {
      const [lx, ly] = deadzone2(pad.axes[0], pad.axes[1]);
      const [rx, ry] = deadzone2(pad.axes[2], pad.axes[3]);
      const b = pad.buttons;
      const jump = b[0]?.pressed;
      const padActive = lx || ly || rx || ry || jump || b[1]?.pressed || b[7]?.value > 0.3;
      if (padActive) this.lastDevice = 'gamepad';
      if (lx || ly) { mx = lx; my = -ly; }
      lookX += rx * s.stickLookSpeed * frameDt;
      lookY += ry * s.stickLookSpeed * frameDt;
      if (jump && !this.padJumpWas) jumpPressed = true;
      this.padJumpWas = jump;
      jumpHeld ||= jump;
      slideHeld ||= b[1]?.pressed || b[7]?.value > 0.3;
      sprintHeld ||= b[10]?.pressed || b[4]?.pressed || b[6]?.value > 0.3; // L3, LB or LT
    }

    if (s.invertY) lookY = -lookY;
    const cmd = { moveX: mx, moveY: my, lookX, lookY, jumpPressed, jumpHeld, slideHeld, sprintHeld };
    this.pressed.clear();
    return cmd;
  }
}

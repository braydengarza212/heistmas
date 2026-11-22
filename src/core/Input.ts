/**
 * Keyboard + mouse input with pointer lock, and a click-drag fallback when
 * pointer lock is not available (for example inside sandboxed iframes).
 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  mouseDown = [false, false, false];
  private mousePressed = [false, false, false];
  pointerLocked = false;
  pointerLockFailed = false;
  /** When false (menus), keys are not swallowed and the cursor stays free. */
  gameplayActive = false;
  private dragging = false;
  private gestureRequest = false;
  onPointerLockChange: ((locked: boolean) => void) | null = null;
  private lastRequestAt = -1e9;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => this.onKeyDown(e), { capture: true });
    window.addEventListener('keyup', (e) => this.onKeyUp(e), { capture: true });
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });

    canvas.addEventListener('mousedown', (e) => {
      this.mouseDown[e.button] = true;
      this.mousePressed[e.button] = true;
      if (this.gameplayActive) {
        if (!this.pointerLocked) {
          this.requestPointerLock(true);
          this.dragging = true;
        }
        e.preventDefault();
      }
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseDown[e.button] = false;
      this.dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.gameplayActive) return;
      if (this.pointerLocked || (this.pointerLockFailed && this.dragging)) {
        // Some browsers report absurd deltas on the first locked event.
        if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.gameplayActive) {
          this.wheel += Math.sign(e.deltaY);
          e.preventDefault();
        }
      },
      { passive: false },
    );
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      this.onPointerLockChange?.(this.pointerLocked);
    });
    document.addEventListener('pointerlockerror', () => {
      if (this.gestureRequest) this.pointerLockFailed = true;
    });
  }

  private onKeyDown(e: KeyboardEvent) {
    // Never block browser/devtools shortcuts outside of gameplay.
    if (this.gameplayActive) {
      const allow = e.code === 'F5' || e.code === 'F11' || e.code === 'F12';
      // Swallow Ctrl+key combos (Ctrl+D bookmark, Ctrl+S save...) while playing,
      // since Ctrl is the dive/slide key.
      if (!allow) e.preventDefault();
    }
    if (!e.repeat) {
      this.down.add(e.code);
      this.pressed.add(e.code);
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    this.down.delete(e.code);
    this.released.add(e.code);
    if (this.gameplayActive) e.preventDefault();
  }

  reset() {
    this.down.clear();
    this.mouseDown = [false, false, false];
    this.dragging = false;
  }

  /** fromGesture: called from a click. Only those failures mean "unsupported here". */
  requestPointerLock(fromGesture = false) {
    if (this.pointerLocked) return;
    // A second request while one is pending can make the browser grant and
    // then drop the lock, which reads as the player pressing Esc.
    const now = performance.now();
    if (!fromGesture && now - this.lastRequestAt < 1500) return;
    this.lastRequestAt = now;
    this.gestureRequest = fromGesture;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function')
        p.catch(() => {
          if (fromGesture) this.pointerLockFailed = true;
        });
    } catch {
      if (fromGesture) this.pointerLockFailed = true;
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(...codes: string[]) {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  wasPressed(...codes: string[]) {
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  wasReleased(...codes: string[]) {
    for (const c of codes) if (this.released.has(c)) return true;
    return false;
  }

  wasMousePressed(button: number) {
    return this.mousePressed[button];
  }

  consumeMouse() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed = [false, false, false];
    this.wheel = 0;
  }

  // ---- Game-level bindings ----
  get moveX() {
    return (this.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (this.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
  }
  get moveY() {
    return (this.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (this.isDown('KeyS', 'ArrowDown') ? 1 : 0);
  }
  get sprint() {
    return this.isDown('ShiftLeft', 'ShiftRight');
  }
  get jumpPressed() {
    return this.wasPressed('Space');
  }
  get jumpHeld() {
    return this.isDown('Space');
  }
  /** Ctrl is the documented key; C and right mouse are safe alternatives. */
  get divePressed() {
    return this.wasPressed('ControlLeft', 'ControlRight', 'KeyC') || this.mousePressed[2];
  }
  /** Fire the snowball blaster: F, or left click while the camera is captured. */
  get firePressed() {
    return this.wasPressed('KeyF') || (this.mousePressed[0] && !!document.pointerLockElement);
  }
  /** Held trigger for automatic weapons. */
  get fireHeld() {
    return this.isDown('KeyF') || (this.mouseDown[0] && !!document.pointerLockElement);
  }
  get lockPressed() {
    return this.wasPressed('KeyQ');
  }
  get interactPressed() {
    return this.wasPressed('KeyE');
  }
}

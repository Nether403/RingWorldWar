/**
 * Camera input.
 *
 * Standard RTS conventions, because anything else costs the player time they
 * would rather spend on the game: WASD or edge-of-screen to pan, wheel to zoom,
 * middle-drag or Q/E to rotate.
 */

import type { CameraRig } from './cameraRig';

/** How close to the edge, in pixels, before edge-panning kicks in. */
const EDGE_MARGIN = 18;

export class InputController {
  private keys = new Set<string>();
  private pointerX = -1;
  private pointerY = -1;
  private pointerInside = false;
  private rotating = false;
  private lastRotateX = 0;
  /** Edge panning is off until the pointer has entered the canvas once, so the
   *  camera does not drift on load while the cursor sits at 0,0. */
  private edgePanArmed = false;
  private direct = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly rig: CameraRig,
  ) {
    el.tabIndex = 0;
    el.style.touchAction = 'none';

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());

    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointerleave', () => {
      this.pointerInside = false;
    });
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.el.getBoundingClientRect();
    this.pointerX = e.clientX - rect.left;
    this.pointerY = e.clientY - rect.top;
    this.pointerInside = true;
    this.edgePanArmed = true;

    if (this.rotating) {
      this.rig.rotate((e.clientX - this.lastRotateX) * 0.005);
      this.lastRotateX = e.clientX;
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.el.focus();
    if (this.direct) return;
    if (e.button === 1 || (e.button === 2 && e.shiftKey)) {
      this.rotating = true;
      this.lastRotateX = e.clientX;
      e.preventDefault();
    }
  };

  private onPointerUp = (): void => {
    this.rotating = false;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.direct) return;
    this.rig.zoom(Math.sign(e.deltaY) * (e.shiftKey ? 3 : 1));
  };

  update(dt: number): void {
    const speed = 320 * dt;
    let right = 0;
    let forward = 0;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forward += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forward -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) right += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) right -= 1;

    if (this.direct) return;

    if (this.keys.has('KeyQ')) this.rig.rotate(-1.6 * dt);
    if (this.keys.has('KeyE')) this.rig.rotate(1.6 * dt);
    if (this.keys.has('KeyR')) this.rig.zoom(-4 * dt);
    if (this.keys.has('KeyF')) this.rig.zoom(4 * dt);

    // Edge panning, only once the pointer has actually been over the canvas.
    if (this.pointerInside && this.edgePanArmed && !this.rotating) {
      const w = this.el.clientWidth;
      const h = this.el.clientHeight;
      if (this.pointerX < EDGE_MARGIN) right -= 1;
      else if (this.pointerX > w - EDGE_MARGIN) right += 1;
      if (this.pointerY < EDGE_MARGIN) forward += 1;
      else if (this.pointerY > h - EDGE_MARGIN) forward -= 1;
    }

    if (right !== 0 || forward !== 0) {
      const len = Math.hypot(right, forward);
      this.rig.pan((right / len) * speed, (forward / len) * speed);
    }
  }

  setDirectMode(enabled: boolean): void {
    this.direct = enabled;
  }

  consume(code: string): void {
    this.keys.delete(code);
  }

  get moveForward(): number {
    return (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
  }

  get moveRight(): number {
    return (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('pointerup', this.onPointerUp);
  }
}

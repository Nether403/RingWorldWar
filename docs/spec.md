# Spec: Ring World War

## Objective
A browser-based 3D real-time strategy game set on the inner surface of a ring-shaped megastructure. Two factions wage war across the curve of the ring: players build bases, extract resources, fire rockets whose trajectories bend with the ring's spin physics, and deploy battle mechs they can optionally pilot directly. Single-player vs AI first, architected for future multiplayer.

**Who it's for:** Strategy players who want a tactile, visually stunning RTS with a physics twist no flat-map RTS can offer.

**What success looks like:** A player can load the game in a desktop browser, complete a 20–40 minute skirmish against a competent AI on one map, and the experience feels responsive (60 fps on mid-range hardware), readable, and visually striking — the ring arcing overhead into the sky is always part of the experience.

**Signature differentiators:**
1. The enemy is visible *in the sky* — the ring curves up, so distant territory hangs overhead.
2. Rocket trajectories obey ring physics: Coriolis drift makes spinward and antispinward shots behave differently.
3. The map wraps — there is no map edge in the ring direction; flanking goes all the way around.

## Tech Stack
- **Language:** TypeScript (strict mode)
- **Rendering:** Three.js (latest stable), WebGL2 baseline, WebGPU renderer as progressive enhancement later
- **Build:** Vite
- **Post-processing:** `postprocessing` (pmndrs)
- **ECS:** `bitecs` (data-oriented, deterministic-friendly)
- **UI:** HTML/CSS overlay (no framework initially; revisit if HUD complexity demands it)
- **Testing:** Vitest (simulation unit tests), Playwright (smoke/e2e)
- **Assets: NONE.** Hard constraint — zero external art, audio, or model files. Every mesh, texture, material, animation, and sound is generated in code at build or load time. See `docs/procedural-assets.md`.
- **Audio:** WebAudio synthesis (no sample files)
- **No physics engine for gameplay** — custom ring-space kinematics (see docs/architecture.md). Optional Rapier later for cosmetic debris only.

## Commands
```
Install:   npm install
Dev:       npm run dev
Build:     npm run build
Preview:   npm run preview
Test:      npm run test            # vitest run
Test (UI): npm run test:e2e        # playwright test
Lint:      npm run lint            # eslint . --fix
Typecheck: npm run typecheck       # tsc --noEmit
```

## Project Structure
```
docs/              → Design docs (this spec, GDD, art direction, architecture)
tasks/             → plan.md and todo.md (development plan + task list)
public/            → Static assets served as-is (compressed textures, models, audio)
src/
  core/            → Engine-agnostic utilities: math (ring-space), events, RNG
  sim/             → Deterministic game simulation (ECS world, systems, no Three.js imports)
  render/          → Three.js scene, materials, VFX, post-processing, LOD
  input/           → Camera controls, selection, command input, direct mech control
  ai/              → Opponent AI (strategic + tactical layers)
  ui/              → HUD, menus, build bars (DOM overlay)
  assets/          → Asset manifest, loaders, procedural generators
  main.ts          → Bootstrap: wires sim loop + render loop
tests/             → Vitest unit tests (mirrors src/sim structure)
e2e/               → Playwright smoke tests
```

**Hard rule:** `src/sim/` must never import from `src/render/` or Three.js. The simulation is a pure, fixed-timestep, deterministic state machine — this is what makes future lockstep multiplayer possible.

## Code Style
```ts
// src/sim/systems/projectileSystem.ts
import { defineQuery } from 'bitecs';
import { Projectile, RingPosition, Velocity } from '../components';
import { RING, coriolisAccel, surfaceGravity } from '../../core/ringMath';
import type { SimWorld } from '../world';

const projectiles = defineQuery([Projectile, RingPosition, Velocity]);

/** Integrates rocket flight in the rotating ring frame (fixed timestep). */
export function projectileSystem(world: SimWorld): void {
  const dt = world.fixedDt;
  for (const eid of projectiles(world)) {
    const ax = coriolisAccel(Velocity.y[eid], RING.omega);
    Velocity.x[eid] += ax * dt;
    Velocity.y[eid] -= surfaceGravity(RingPosition.r[eid]) * dt;
    RingPosition.theta[eid] = wrapTheta(RingPosition.theta[eid] + (Velocity.x[eid] / RingPosition.r[eid]) * dt);
    RingPosition.r[eid] += Velocity.y[eid] * dt;
  }
}
```
Conventions:
- `camelCase` functions/variables, `PascalCase` types/components, `SCREAMING_SNAKE` constants.
- Systems are plain functions `(world) => void`; no classes in `src/sim/`.
- All sim math uses the fixed timestep `world.fixedDt` — never wall-clock time.
- No `any`. No floating-point nondeterminism shortcuts in sim (no `Math.random` — use seeded RNG from `core/rng.ts`).
- Files under ~300 lines; split systems rather than grow them.

## Testing Strategy
- **Vitest unit tests** for everything in `src/sim/` and `src/core/`: ring math, projectile ballistics (golden-value trajectories), economy ticks, combat resolution, pathfinding on the wrapped grid.
- **Determinism test:** run the same seeded skirmish twice for N ticks, assert identical state hashes. This test is sacred — it guards multiplayer readiness.
- **Playwright smoke test:** game boots, renders first frame without WebGL errors, a unit can be selected and ordered to move.
- Render layer is verified visually + via smoke tests, not unit-tested.
- Coverage expectation: sim layer ≥ 80%; no coverage requirement on render layer.

## Boundaries
- **Always:** run `npm run typecheck && npm run lint && npm run test` before commits; keep sim/render separation; use seeded RNG in sim; keep the determinism test passing; profile before optimizing.
- **Ask first:** adding runtime dependencies; introducing a physics engine; changing the ring's canonical dimensions (they cascade through balance and art); any networking code.
- **Never:** commit secrets or API keys; **add any binary art/audio/model asset to the repo**; import Three.js inside `src/sim/`; delete or skip the determinism test to make CI green.

## Success Criteria (vertical slice)
- [ ] One map (a ring segment ~40 km of arc, wrapping logically into the full ring), 2 factions, playable skirmish vs AI, 20–40 min match length.
- [ ] Full core loop works: harvest 2 resources → build structures → produce units → fire rockets → deploy mechs → destroy enemy Bastion → win/lose screen.
- [ ] Rockets visibly arc with ring curvature; spinward vs antispinward shots land differently; a tutorial tooltip explains it.
- [ ] Player can take direct control of any mech (WASD + mouse aim) and return to tactical camera seamlessly.
- [ ] 60 fps at 1080p on a GTX 1660-class GPU with default settings; no GC hitches > 16 ms during combat.
- [ ] The ring arc, atmosphere, and shadow-square day/night cycle are visible and composed into the default camera framing.
- [ ] Determinism test passes: identical seeds → identical outcomes.

## Open Questions
- Faction identity: symmetric factions with cosmetic differences (cheaper to balance) vs asymmetric mechanics (more interesting)? Vertical slice assumes **symmetric with distinct visual identity**.
- Audio direction: licensed music vs generative/ambient? Deferred to Phase 4.
- WebGPU renderer adoption timing — revisit when Three.js WebGPU path is stable for our post stack.
- Multiplayer model when it comes: deterministic lockstep (cheap bandwidth, needs perfect determinism) vs state sync. Architecture bets on lockstep.

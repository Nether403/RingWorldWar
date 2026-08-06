# Spec: Ring World War

> **Current status and sequencing:** See `docs/roadmap.md`. This specification defines the product contract; it is not the authoritative progress tracker.

## Objective
A single-player 3D real-time strategy game for PC, with a browser demo, set on the inner surface of a ring-shaped megastructure. Two factions wage war across the curve of the ring: players build bases, extract resources, fire rockets whose trajectories bend with the ring's spin physics, and deploy battle mechs they can optionally pilot directly. See `docs/publishable-game-roadmap.md` for the campaign and release target.

**Who it's for:** Strategy players who want a tactile, visually stunning RTS with a physics twist no flat-map RTS can offer.

**What success looks like:** A player can choose either faction, complete its six-mission campaign, play skirmish and gravity-focused Arcade modes, and understand why direction, rotation, and the inhabited ring change every battle. The browser demo and packaged PC build share deterministic gameplay and remain readable on the qualified Low profile.

**Signature differentiators:**
1. The enemy is visible *in the sky* — the ring curves up, so distant territory hangs overhead.
2. Rocket trajectories obey ring physics: Coriolis drift makes spinward and antispinward shots behave differently.
3. The map wraps — there is no map edge in the ring direction; flanking goes all the way around. Antispinward is the authoritative long-range artillery direction.

## Tech Stack
- **Language:** TypeScript (strict mode)
- **Rendering:** Three.js (latest stable), WebGL2 baseline, WebGPU renderer as progressive enhancement later
- **Build:** Vite
- **Presentation:** Three.js forward rendering with ACES; decorative post effects return after Gate 1 stability
- **Simulation:** stable-ordered object arrays with fixed-step state hashing
- **UI:** HTML/CSS overlay (no framework initially; revisit if HUD complexity demands it)
- **Testing:** Vitest (simulation unit tests), Playwright (smoke/e2e)
- **Gameplay assets:** terrain, units, structures, and world effects remain procedural unless a later reviewed asset-pipeline decision explicitly changes that contract. See `docs/procedural-assets.md`.
- **Presentation assets:** reviewed video, posters, captions, voices, and DOM-only images are allowed with provenance, integrity receipts, and complete fallbacks.
- **Audio:** procedural gameplay effects plus reviewed sampled tactical voices.
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
  public/            → Reviewed delivery media with provenance and fallback coverage
src/
  core/            → Engine-agnostic utilities: math (ring-space), events, RNG
  sim/             → Deterministic game simulation (world, navigation, ballistics; no Three.js imports)
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
const world = new World(terrain, seed);
world.setup();

while (accumulator >= SIM_DT) {
  world.step();
  accumulator -= SIM_DT;
}

entityRenderer.update(world, anchor, renderTime, player, accumulator / SIM_DT);
```
Conventions:
- `camelCase` functions/variables, `PascalCase` types/components, `SCREAMING_SNAKE` constants.
- World state is processed in stable entity-array order.
- All sim math uses `SIM_DT` — never wall-clock or frame time.
- No `any`. No floating-point nondeterminism shortcuts in sim (no `Math.random` — use seeded RNG from `core/rng.ts`).
- New subsystems should be focused modules; `World` remains the authoritative orchestration boundary.

## Testing Strategy
- **Vitest unit tests** for everything in `src/sim/` and `src/core/`: ring math, projectile ballistics (golden-value trajectories), economy ticks, combat resolution, pathfinding on the wrapped grid.
- **Determinism test:** run the same seeded skirmish twice for N ticks, assert identical state hashes. This test is sacred — it guards multiplayer readiness.
- **Playwright smoke tests:** stable rendering/resource use plus boot, move, control groups, mech takeover, and commanded artillery.
- Render layer is verified visually + via smoke tests, not unit-tested.
- Coverage expectation: sim layer ≥ 80%; no coverage requirement on render layer.

## Boundaries
- **Always:** run `npm run typecheck && npm run lint && npm run test` before commits; keep sim/render separation; use seeded RNG in sim; keep the determinism test passing; profile before optimizing.
- **Ask first:** adding runtime dependencies; introducing a physics engine; changing the ring's canonical dimensions (they cascade through balance and art); any networking code.
- **Never:** commit secrets or API keys; add unreviewed or unlicensed media; import Three.js inside `src/sim/`; delete or skip the determinism test to make CI green.

## Success Criteria (vertical slice)
- [x] One complete 22.6 km ring map, 2 mechanically asymmetric factions, and a playable skirmish vs AI with a 45-minute hard cap.
- [x] Full core loop works: extract salvage and generate power → build structures → produce units → fire rockets → deploy mechs → destroy enemy Bastion → win/lose screen.
- [x] Rockets visibly arc with ring curvature; spinward vs antispinward shots land differently; targeting guidance explains the long-range direction.
- [x] Player can take direct control of any mech (WASD + mouse aim) and return to tactical camera seamlessly.
- [ ] 60 fps at 1080p on a GTX 1660-class GPU with default settings; no GC hitches > 16 ms during combat.
- [x] The ring arc, atmosphere, and shadow-square day/night cycle are visible and composed into the default camera framing.
- [x] Determinism test passes: identical seeds → identical outcomes.

## Open Questions
- Desktop packaging choice after an offline/save/fullscreen/update spike.
- Commercial title and trademark clearance before store publication.
- Final code/content license and third-party notice policy.
- WebGPU renderer adoption timing after the WebGL2 release baseline is stable.
- Multiplayer remains post-launch research; the launch roadmap does not include netcode.

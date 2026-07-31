# Ring World War — Technical Architecture

## 1. The Three Hard Problems
Everything in this document exists to solve three problems that a flat-map RTS never faces:

1. **Coordinates.** A 600 km ring has a 3,770 km circumference. Float32 has ~0.25 m precision at that magnitude — z-fighting, jittering units, broken shadows. Solved by *ring-space simulation + floating-origin rendering*.
2. **Nothing is ever occluded.** On the inner surface of a ring there is no horizon. The far side of the world is always in view, 1,200 km overhead. Naive rendering tries to draw the entire planet every frame. Solved by a *three-tier world representation*.
3. **Physics is non-inertial.** Gravity is centrifugal (a fiction of the rotating frame), and Coriolis acceleration is real and gameplay-relevant. Solved by *custom rotating-frame kinematics* — no off-the-shelf physics engine models this correctly.

## 2. Coordinate Systems

### 2.1 Ring space (canonical — the simulation's truth)
Every entity is stored as `(θ, h, z)`:
- `θ` — angle around the ring, radians, wrapped to `[0, 2π)`. **Stored as float64.**
- `h` — height above the inner floor surface, metres (small: 0–20,000 m).
- `z` — axial position across the ring's width, metres, range `[-20000, +20000]`.

Radial distance from the ring axis is `r = R − h` (the floor is at `r = R`; "up" is toward the axis, so height *decreases* r).

Constants:
```
R      = 600_000 m           // ring radius
W      = 40_000 m            // habitable width
ω      = sqrt(g / R)         // ≈ 4.044e-3 rad/s  → 1 g at the floor
period = 2π/ω                // ≈ 1554 s (~26 min) per rotation
v_surf = ωR                  // ≈ 2426 m/s tangential surface speed
```

### 2.2 Surface space (the gameplay plane)
For everything that walks, drives, builds, or pathfinds, we project to an unwrapped 2D plane:
```
s = R · θ    (arc length, wraps at 2πR)
z            (axial, clamped by rim walls)
```
Over the tens-of-kilometres scale of a battle, the surface is locally flat to well within a pixel. **So all ground gameplay — pathfinding, collision, spatial hashing, building placement, area-of-effect — is plain 2D math on a cylinder-wrapped plane.** This is the single most important simplification in the project: the ring is exotic only where it needs to be.

The wrap is handled by one helper used everywhere:
```ts
/** Shortest signed arc-length delta from a to b on the wrapped surface. */
export function deltaS(a: number, b: number): number {
  const c = CIRCUMFERENCE;
  let d = (b - a) % c;
  if (d > c / 2) d -= c;
  else if (d < -c / 2) d += c;
  return d;
}
```
Every distance/direction/targeting call goes through `deltaS`. Bugs where a unit walks the long way around the ring are the signature failure of getting this wrong — hence dedicated unit tests.

### 2.3 Render space (float32-safe)
The renderer maintains a **floating origin**: a `RenderAnchor` at the camera's current `(θ₀, z₀)`. Entities are converted to a local tangent frame around that anchor:
```
x_local = R · deltaS_angle(θ₀, θ)     // ≈ arc length, exact enough within 50 km
y_local = h  (+ curvature drop)
z_local = z − z₀
```
The anchor re-bases whenever the camera moves > 2 km. All Three.js objects live in this local frame, so world coordinates never exceed ~1e5 — comfortably float32-safe.

**Curvature drop** is what makes the world visibly curve: a point at arc distance `d` from the anchor sits lower by `R(1 − cos(d/R))` and tilts by `d/R` radians. Applied to the local transform, distant terrain naturally sweeps *upward* into the sky on both sides — the ring effect is geometric, not a shader trick.

### 2.4 Orientation
Every surface entity's basis is derived, never stored as a free quaternion:
- `up` = local radial direction (toward the axis)
- `forward` = spinward tangent, rotated by the unit's yaw
This guarantees units are always properly planted on the curve, and yaw stays a single scalar in the sim.

## 3. Simulation Layer (`src/sim/`)

### 3.1 Determinism contract
- **Fixed timestep:** 30 Hz sim ticks (`fixedDt = 1/30`), decoupled from render. Accumulator loop; render interpolates between the last two sim states.
- **Seeded RNG only:** xorshift128+ in `core/rng.ts`. `Math.random` is banned in `src/sim/` (enforced by an ESLint rule).
- **Transcendentals:** `Math.sin/cos/pow` are *not* bit-identical across JS engines. The sim uses `core/detMath.ts` — polynomial/LUT implementations with defined precision. `+ - * / sqrt` are IEEE-754 exact and safe to use directly.
- **Ordered iteration:** entities processed in stable entity-ID order; no `Set`/`Map` iteration order dependencies in sim logic.
- **State hashing:** every N ticks the world hashes to a checksum. The determinism test replays a seeded match twice and compares hash streams.

This costs maybe 5% of implementation effort now and is the difference between "we could add multiplayer" and "we would have to rewrite the game."

### 3.2 ECS
`bitecs` — components are typed arrays, systems are functions. Layout:
```
components/   RingPosition, Velocity, Health, Faction, UnitType, Projectile,
              Turret, Producer, Storage, Vision, Pathing, DamageState, ...
systems/      (executed in fixed order every tick)
  1. commandSystem        consume queued player/AI orders
  2. productionSystem     build queues, resource spend
  3. economySystem        extraction, energy generation/upkeep
  4. pathingSystem        flow-field steering on the wrapped grid
  5. movementSystem       integrate ground units in surface space
  6. projectileSystem     rotating-frame ballistics
  7. targetingSystem      acquisition, LOS, fog checks
  8. combatSystem         damage resolution, armor, damage states
  9. interceptSystem      point defense + laser grid vs projectiles
 10. visionSystem         fog of war raster update
 11. captureSystem        Spinal Node control, Dominance score
 12. lifecycleSystem      deaths, spawns, wreck creation
 13. victorySystem        win/loss/time-cap evaluation
```
Systems emit **events** (a flat ring buffer) — `Impact`, `UnitDied`, `WeaponFired`, `StructureComplete`. The render and audio layers consume events; they never poll or mutate sim state. This is the only channel from sim → presentation, and it keeps the boundary honest.

### 3.3 Ballistics — the rotating frame
In the ring's rotating reference frame, a free-flying projectile experiences two fictitious accelerations:
```
a_centrifugal = ω² · r        (outward — this is "gravity", and it weakens with altitude)
a_coriolis    = −2 · ω × v    (the interesting one)
```
Working in the local `(x = spinward, y = up)` plane, with `ω` about the axial direction:
```
a_x = +2ω·v_y                 // vertical motion pushes you spinward/antispinward
a_y = −ω²(R − h) + 2ω·v_x     // effective gravity, modified by tangential speed
```
Consequences that fall straight out of the math and become gameplay:
- A rocket fired **spinward** gains apparent lift (`+2ω·v_x` opposes gravity) → flatter, longer flight.
- A rocket fired **antispinward** is pressed down → shorter range, steeper arc.
- Anything thrown straight up drifts antispinward and lands *behind* the launcher.
- Effective gravity drops with altitude, so high-apex shots hang longer than intuition says.

Integration uses **velocity Verlet** at the sim timestep with sub-stepping for fast projectiles, plus a swept-segment collision test against the terrain heightfield and unit hitspheres to prevent tunneling. Drag is applied inside an atmosphere shell (`h < 12 km`); chord shots that exceed it fly clean and re-enter on the far side.

Aim solving (for AI and for the player's predicted-trajectory ribbon) is done by iterative refinement — an analytic flat-earth solution as the seed, then 3–5 Newton iterations against the true integrator. Cheap, accurate, and it means the preview ribbon is generated by *the same code that flies the rocket*. Never two implementations.

### 3.4 Pathfinding
- Static navgrid in surface space (~8 m cells), wrapped in `s`.
- **Flow fields** per destination for group movement (cheap for RTS crowds), with local RVO-lite avoidance for mechs so they don't stack.
- Wrapping handled in the grid's neighbor lookup — a single place, unit-tested.

## 4. Render Layer (`src/render/`)

### 4.1 Three-tier world (solving "no horizon")
| Tier | Range | Representation |
|---|---|---|
| **Near** | 0–8 km | Full clipmap terrain, real units, decals, full shadows, all VFX |
| **Mid** | 8–60 km | Lower-LOD terrain rings, imposter units, no decals, cheap shadows |
| **Far ring** | 60 km – full circumference | A single pre-baked "ring shell" mesh: low-poly cylinder segment with a baked albedo/emissive texture generated offline from the map's heightmap and settlements. A few thousand triangles for 3,700 km of world. |

The far ring shell is what lets the entire world be visible at all times for a near-zero cost. It's updated only when large-scale things change (a base is destroyed → repaint that region of the baked texture). Atmospheric fog does the rest of the work hiding the seam between tiers.

### 4.2 Draw call discipline
Target: **< 400 draw calls** in a heavy combat frame.
- All units of a type drawn as one `InstancedMesh` per LOD, per faction, with per-instance attributes for color, damage, and team.
- Terrain: clipmap rings share one material; texture arrays instead of per-material textures.
- Scatter props: instanced, merged per chunk.
- Particles: GPU-simulated in one system, one draw call per blend mode.
- **Zero material recompiles at runtime.** All shader permutations are compiled during the loading screen; a stutter mid-battle from a shader compile is unacceptable and is a common cause of "web games feel bad."

### 4.3 Frame budget @ 60 fps (16.6 ms)
```
Sim (amortized)          1.5 ms
Culling + instance pack  1.5 ms
Shadow passes            2.5 ms
Main opaque              4.0 ms
Transparent + particles  2.0 ms
Post-processing          3.5 ms
UI / DOM                 1.0 ms
                        ------
                        16.0 ms
```
These are contracts, not aspirations. A stats overlay (`F3`) shows per-phase timings live, and a CI perf scene fails the build on regression beyond a tolerance.

### 4.4 Memory & GC
- **Zero allocation in the hot loop.** Pooled vectors/quaternions, pooled particles, pooled event objects, preallocated typed arrays. GC pauses read as stutter, and stutter is the #1 tell of a browser game.
- Object pools for projectiles, decals, lights, audio voices, UI world-space markers.
- `SharedArrayBuffer` (where cross-origin isolation is available) to move sim state to a worker thread without copying.

### 4.5 Threading
- **Main thread:** render, input, UI.
- **Sim worker:** the ECS tick loop. Communicates via SAB double-buffer (or structured-clone fallback).
- **Path worker:** flow-field generation.
- **Asset workers:** KTX2 transcode + meshopt decode (Three.js provides these).
This keeps a 5 ms sim spike from ever becoming a dropped frame.

## 5. Data-Driven Content
Units, weapons, structures, and factions are defined in typed JSON/TS data tables (`src/sim/data/`), not in code:
```ts
export const VANGUARD: UnitDef = {
  id: 'mech_vanguard', class: 'mech', cost: { S: 800, C: 2 },
  hp: 4200, armor: 'heavy', speed: 9.5, turnRate: 0.7,
  weapons: ['autocannon_twin'], abilities: ['shield_wall'],
  model: 'mech_vanguard', hitRadius: 6.5,
};
```
Balance changes never require touching systems. This is also what makes future modding and faction asymmetry cheap.

## 6. Build & Delivery
- Vite + TS, code-split by phase (menu bundle vs game bundle).
- Assets served from a CDN, streamed by zone with a priority queue; the first playable frame must arrive in **< 15 s on a 20 Mbps connection**.
- Progressive loading: menu → low-res terrain + player base → stream the rest during the opening minutes.
- WebGL2 required; a capability check gates quality presets and shows a clear message on unsupported hardware.

## 7. Risk Register
| Risk | Mitigation |
|---|---|
| Precision artifacts at ring scale | Floating origin + float64 sim, prototyped and validated in Phase 0 before anything else is built |
| "Everything visible" kills perf | Three-tier world; prove the far-ring shell in Phase 1, not Phase 4 |
| Coriolis is confusing, not fun | Predicted-trajectory ribbon makes it legible; playtest early; the *option* exists to scale ω down for feel without changing architecture |
| Post stack too expensive for 60 fps | Quality presets built in Phase 2, not bolted on; half-res effects + TAA amortization |
| Determinism drift | Determinism test from day one; ESLint bans `Math.random` in sim |
| Art scope explosion | Modular kits, trim sheets, shared skeletons; hard CI budget on asset size |
| Shader compile hitches | Warm all permutations during loading; never compile mid-match |

# Ring World War — Technical Architecture

## 1. The Three Hard Problems
Everything in this document exists to solve three problems that a flat-map RTS never faces:

1. **Coordinates.** The 3.6 km-radius ring is 22.6 km around. A floating local frame still prevents seam jitter and keeps shadows stable while preserving exact curvature.
2. **Nothing is ever occluded.** The far side is only 7.2 km overhead. Gate 1 renders the complete static ring as one procedural mesh and culls detailed entities by arc distance.
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
R      = 3_600 m             // ring radius
W      = 4_000 m             // habitable width
g      = 6.0 m/s²            // apparent floor gravity
ω      = sqrt(g / R)         // ≈ 4.082e-2 rad/s
period = 2π/ω                // ≈ 154 s per rotation
v_surf = ωR                  // ≈ 147 m/s tangential surface speed
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
The anchor re-bases whenever the camera moves more than 600 m. All Three.js objects live in this local frame.

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
- **Transcendentals:** Gate 1 is deterministic within the supported JavaScript runtime and is guarded by seeded state-hash tests. Cross-engine lockstep remains contingent on replacing raw transcendental functions with defined approximations.
- **Ordered iteration:** entities processed in stable entity-ID order; no `Set`/`Map` iteration order dependencies in sim logic.
- **State hashing:** every N ticks the world hashes to a checksum. The determinism test replays a seeded match twice and compares hash streams.

This costs maybe 5% of implementation effort now and is the difference between "we could add multiplayer" and "we would have to rewrite the game."

### 3.2 Simulation world
Gate 1 uses stable-ordered object arrays. At the current few-hundred-entity target this keeps the gameplay model inspectable while preserving deterministic iteration. The fixed pipeline is:
```
  1. economy and production
  2. wrapped flow-field movement, vision-gated targeting, and weapons
  3. structures and point defence
  4. rotating-frame projectiles
  5. node capture and Dominance
  6. lifecycle cleanup and victory
```
Systems emit presentation events for transient effects. Renderers read authoritative world state plus previous unit transforms for interpolation; player and AI actions enter through world/game command methods.

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
- In the implemented coordinate convention, an **antispinward** launch subtracts from floor velocity and travels farther.
- A **spinward** launch adds to floor velocity and returns sooner.
- Anything thrown straight up drifts antispinward and lands *behind* the launcher.
- Effective gravity drops with altitude, so high-apex shots hang longer than intuition says.

Integration uses **velocity Verlet** at the sim timestep with sub-stepping for fast projectiles, plus a swept-segment collision test against the terrain heightfield and unit hitspheres to prevent tunneling. Drag is applied inside an atmosphere shell (`h < 12 km`); chord shots that exceed it fly clean and re-enter on the far side.

Aim solving (for AI and for the player's predicted-trajectory ribbon) is done by iterative refinement — an analytic flat-earth solution as the seed, then 3–5 Newton iterations against the true integrator. Cheap, accurate, and it means the preview ribbon is generated by *the same code that flies the rocket*. Never two implementations.

### 3.4 Pathfinding
- Static navgrid in surface space (~8 m cells), wrapped in `s`.
- **Flow fields** per destination for group movement (cheap for RTS crowds), with local RVO-lite avoidance for mechs so they don't stack.
- Wrapping handled in the grid's neighbor lookup — a single place, unit-tested.

## 4. Render Layer (`src/render/`)

### 4.1 Complete ring representation
The scaled habitat permits the entire procedural floor to live in one static ring mesh. Detailed units, effects, markers, and health bars are culled by wrapped arc distance; atmospheric haze preserves the overhead-world composition.

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
- **No unbounded hot-loop growth.** Render vectors/quaternions, particles, effects, lights, and world-space marker buffers are pooled or preallocated. Simulation entities and events allocate at authoritative creation points, then deterministic cleanup and bounded presentation queues release them.
- ID-keyed simulation indexes use maps rather than sparse arrays, ballistic/navigation caches have explicit limits, and renderer/session owners expose complete disposal paths.
- `SharedArrayBuffer` (where cross-origin isolation is available) to move sim state to a worker thread without copying.

### 4.5 Threading
Gate 1 keeps simulation and cached flow-field generation on the main thread because profiling at the target entity count does not justify worker synchronization yet. The deterministic world/state-hash boundary allows a worker migration when profiling demonstrates the need.

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
- Vite + TypeScript currently build one application entry. The title screen defers construction of simulation, renderer, terrain, and audio authority until a session starts; menu/game bundle splitting is a future measured optimization.
- Gameplay terrain, meshes, materials, and effects remain procedural. Reviewed presentation video, posters, captions, tactical voices, and DOM-only images are delivered through typed manifests with provenance, integrity receipts, and complete missing-media fallbacks.
- WebGL2 required; a capability check gates quality presets and shows a clear message on unsupported hardware.

## 7. Risk Register
| Risk | Mitigation |
|---|---|
| Precision artifacts at ring scale | Floating origin + float64 sim, prototyped and validated in Phase 0 before anything else is built |
| "Everything visible" kills perf | One static complete-ring mesh; detailed entities are arc-distance culled |
| Coriolis is confusing, not fun | Predicted-trajectory ribbon makes it legible; playtest early; the *option* exists to scale ω down for feel without changing architecture |
| Post stack fails or exhausts GPU resources | Stable direct ACES path is the Gate 1 baseline; post effects require fallback and browser regression tests |
| Determinism drift | Determinism test from day one; ESLint bans `Math.random` in sim |
| Art scope explosion | Modular kits, trim sheets, shared skeletons; hard CI budget on asset size |
| Shader compile hitches | Warm all permutations during loading; never compile mid-match |

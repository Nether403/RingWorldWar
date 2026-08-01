# Design Document: Phase 2 — Systems Depth

## Overview

Phase 2 deepens Ring World War from a playable vertical slice into a strategically rich RTS. It adds AI intelligence (Strategist + Tactician), new weapon systems (cruise missiles, chord shots, laser grids), mech abilities, faction asymmetry, quality presets, save/load, and a headless balance-testing pipeline. All additions honour the hard boundary: `src/sim/` remains a pure deterministic state machine with zero render or DOM imports.

## Architecture

### Module Boundaries

```
src/
  sim/              ← Pure deterministic state machine (30 Hz)
    world.ts        ← Authoritative state + step()
    data.ts         ← All balance tables (units, structures, weapons, factions)
    ballistics.ts   ← Rotating-frame trajectory solver
    nav.ts          ← Surface-space pathfinding
    abilities.ts    ← [NEW] Ability state machine (activate, tick, deactivate)
    serialize.ts    ← [NEW] Snapshot save/load + schema validation
  ai/
    opponent.ts     ← [EXPAND] Strategist + Tactician with behavior trees
    behaviorTree.ts ← [NEW] BT node types, composites, decorators
  core/
    constants.ts    ← Ring physics constants
    ringMath.ts     ← Coordinate math
    rng.ts          ← Seeded deterministic RNG
  render/           ← Reads sim state, never mutates it
    settings.ts     ← [NEW] Quality presets, localStorage persistence
  ui/
    settingsMenu.ts ← [NEW] Pause overlay with preset/volume/keybinds
    perfOverlay.ts  ← [EXPAND] F3 overlay with full metrics
  headless/
    runner.ts       ← [NEW] AI-vs-AI batch runner, no render imports
```

### Data Flow

```
[AI Strategist] → goals → [AI Tactician] → orders → [World.step()]
                                                         ↓
                                               [Ability system ticks]
                                                         ↓
                                               [Ballistics integration]
                                                         ↓
                                               [Events queue] → [Renderer]
```

The sim emits `SimEvent`s for all presentation-only effects (damage states, ability visuals, muzzle flashes). The renderer drains this queue each frame. The AI reads world state but mutates it only through the same public API the player uses (`tryQueueUnit`, `fireBallisticAt`, `issueOrder`).

---

## Component Design

### 1. AI Strategist (Expansion of `src/ai/opponent.ts`)

The existing `AiOpponent` has a `runStrategy` method with utility-scored building decisions. Phase 2 extracts a formal goal-scoring layer.

#### Interface

```typescript
// src/ai/opponent.ts (expanded)

type StrategicGoal = 'expand' | 'tech' | 'harass' | 'defend' | 'allIn';

interface GoalScore {
  goal: StrategicGoal;
  score: number;
}

interface StrategistConfig {
  evaluationInterval: number;       // seconds between evaluations
  candidateGoals: StrategicGoal[];  // subset available at this difficulty
  weights: Record<string, number>;  // tunable coefficients
}

const STRATEGIST_CONFIG: Record<Difficulty, StrategistConfig> = {
  recruit:   { evaluationInterval: 3.0, candidateGoals: ['expand', 'tech', 'defend'], weights: { /* base */ } },
  veteran:   { evaluationInterval: 1.5, candidateGoals: ['expand', 'tech', 'harass', 'defend', 'allIn'], weights: { /* base */ } },
  commander: { evaluationInterval: 0.6, candidateGoals: ['expand', 'tech', 'harass', 'defend', 'allIn'], weights: { /* optimized */ } },
};
```

#### Scoring Functions

Each goal's score is a weighted sum of normalized signals:

- **expand**: deposit availability × (extractors < desired) × safety of nearest unclaimed deposit
- **tech**: can_afford_next_tech × (time_since_last_tech > threshold)
- **harass**: enemy_expansion_visible × own_scout_count × aggression_weight
- **defend**: incoming_threat_score × (own_army < enemy_visible_army)
- **allIn**: (army_strength / enemy_estimated_strength) × economy_exhaustion_risk

No goal reads information the human player wouldn't have; only reaction speed and coefficient tuning differ between difficulties.

### 2. AI Tactician with Behavior Trees

#### Behavior Tree Nodes (`src/ai/behaviorTree.ts`)

```typescript
type BTStatus = 'running' | 'success' | 'failure';

interface BTNode {
  tick(ctx: TacticianContext): BTStatus;
  reset(): void;
}

// Composites
class Selector implements BTNode { children: BTNode[]; /* first success wins */ }
class Sequence implements BTNode { children: BTNode[]; /* all must succeed */ }

// Decorators
class Cooldown implements BTNode { child: BTNode; delay: number; /* rate-limits child */ }
class DifficultyGate implements BTNode { child: BTNode; minTier: Difficulty; }

// Leaves (actions)
class FocusFire implements BTNode { /* assign squad target to highest-priority enemy */ }
class Retreat implements BTNode { /* move toward nearest rally point */ }
class Reposition implements BTNode { /* shuffle position post-fire */ }
class DodgeIncoming implements BTNode { /* move out of predicted splash */ }
class ActivateAbility implements BTNode { /* trigger unit ability */ }
class FormUp implements BTNode { /* position Aegis for umbrella coverage */ }
```

#### Squad Formation

```typescript
interface Squad {
  id: number;
  unitIds: number[];
  tree: BTNode;
  rallyPoint: { s: number; z: number };
  targetId: number;
}

interface TacticianContext {
  world: World;
  faction: Faction;
  squad: Squad;
  difficulty: Difficulty;
  reactionTimer: number;  // 0 for Commander, 0.8s for Veteran, skipped for Recruit
}
```

Squads are reformed every strategist evaluation cycle. Units are grouped by proximity and role (front-line, artillery, escort). Each squad receives a behavior tree composed from the node library, with `DifficultyGate` decorators preventing advanced behaviors at lower tiers.

### 3. Cruise Missile System

Cruise missiles integrate into the existing `Projectile` type with a new flight mode.

#### Data Table Addition (`src/sim/data.ts`)

```typescript
export const WEAPONS: Record<string, WeaponDef> = {
  // ... existing weapons ...
  cruiseMissile: {
    id: 'cruiseMissile',
    kind: 'ballistic',     // reuses projectile infrastructure
    damage: 380,
    damageType: 'explosive',
    cooldown: 18,
    range: 3800,
    launchSpeed: 55,       // slow but terrain-hugging
    splash: 30,
    energyPerShot: 10,
    muzzleFlashScale: 2.5,
    // New fields for cruise behavior:
    cruise: true,
    cruiseAltitude: 50,    // max height above terrain
  },
};
```

#### Flight Integration

The cruise missile uses a terrain-following integrator rather than the free-flight ballistic solver:

```typescript
// In world.ts stepProjectiles:
if (projectile.weapon === 'cruiseMissile') {
  // Advance along surface at cruise speed, maintaining altitude <= 50m above terrain
  const terrainH = this.terrain.heightAt(projectile.p.s, projectile.p.z);
  const targetAlt = Math.min(50, WEAPONS.cruiseMissile.cruiseAltitude);
  // Steer toward target coordinates along surface path
  // Laser grids check apex altitude > 50m → cruise missiles are immune
  // Point defense checks range regardless of altitude → cruise missiles are vulnerable
}
```

The `Projectile` type gains an optional `cruise: boolean` field. The interception logic in `runInterceptor` already checks distance; the new `stepLaserGrid` method checks altitude, creating the immunity naturally.

### 4. Chord Shot System

Chord shots exit the atmosphere and traverse the ring interior.

#### Data Table

```typescript
chordShot: {
  id: 'chordShot',
  kind: 'ballistic',
  damage: 1200,
  damageType: 'explosive',
  cooldown: 45,
  range: RING_CIRCUMFERENCE * 0.5,  // can hit the far side
  launchSpeed: 280,                   // must exceed escape velocity
  splash: 50,
  energyPerShot: 30,
  muzzleFlashScale: 4,
  chord: true,                        // new flag
},
```

#### Flight Physics

The existing `stepWithDrag` already applies zero drag above `ATMOSPHERE_HEIGHT` (returns early when `airDensityAt(h) <= 0`). Chord shots use a high launch angle that sends them above the atmosphere shell, coasting drag-free across the interior, then re-entering on the far side where drag resumes. No new physics code is needed — the existing integrator handles it correctly.

#### Visibility Override

While `projectile.p.h > ATMOSPHERE_HEIGHT`, the projectile is added to both factions' visibility regardless of fog state. This is a single check in the visibility computation.

#### Accuracy Penalty

Without spotter vision of the target area, the chord shot's impact point is jittered:

```typescript
const hasVision = this.isVisible(faction, targetS, targetZ);
const spread = hasVision ? 0 : 80; // metres of Gaussian jitter
const actualTargetS = wrapS(targetS + this.rng.gaussian() * spread);
const actualTargetZ = clampAxial(targetZ + this.rng.gaussian() * spread);
```

### 5. Laser Grid Structure

A new structure kind in `data.ts`:

```typescript
laserGrid: {
  kind: 'laserGrid',
  name: 'Laser Grid',
  role: 'Burns ballistic rockets at apex. Cruise missiles fly under it.',
  cost: { salvage: 350 },
  buildTime: 18,
  hp: 900,
  armor: 'structure',
  radius: 10,
  height: 24,
  vision: 200,
  weapons: ['gridLaser'],
  energy: -8,
  requires: 'fabricator',
  // New field:
  coverageArc: 800,  // metres of arc coverage in each direction
}
```

#### Interception Logic

```typescript
// New method in World:
private stepLaserGrids(dt: number): void {
  for (const grid of this.structures) {
    if (!grid.alive || grid.kind !== 'laserGrid' || grid.progress < 1) continue;
    // Check each ballistic projectile (not cruise, not chord above atmosphere)
    for (const proj of this.projectiles) {
      if (!proj.alive || proj.doomed || proj.faction === grid.faction) continue;
      if (WEAPONS[proj.weapon]?.cruise) continue;           // immune: too low
      if (WEAPONS[proj.weapon]?.chord && proj.p.h > ATMOSPHERE_HEIGHT) continue; // immune: above atmosphere
      if (proj.p.h < 200) continue;                          // not at apex altitude yet
      const arcDist = Math.abs(deltaS(grid.s, proj.p.s));
      if (arcDist > STRUCTURES.laserGrid.coverageArc) continue;  // outside arc
      // Attempt interception (energy-gated, fire-rate-limited)
      if (grid.cd[0]! > 0) continue;
      if (!this.canAffordEnergy(grid.faction, WEAPONS.gridLaser.energyPerShot)) continue;
      proj.doomed = true;
      grid.cd[0] = WEAPONS.gridLaser.cooldown;
      this.drawEnergy(grid.faction, WEAPONS.gridLaser.energyPerShot);
      this.emit('intercepted', proj.p.s, proj.p.z, proj.p.h, grid.faction, 1, grid.id);
    }
  }
}
```

### 6. Counter-Battery Flash

Already partially implemented (`revealed` field, `FIRING_REVEAL_TIME`). Phase 2 formalises it:

- Any entity that fires a ballistic or chord weapon sets `revealed = FIRING_REVEAL_TIME`
- The visibility system (`isEntityVisible`) checks `revealed > 0` and returns true regardless of fog
- When `revealed` ticks to 0, normal fog rules resume
- The data table stores `FIRING_REVEAL_TIME = 6` (seconds)

No new module needed; this is a tweak to the existing visibility check.

### 7. Ability System (`src/sim/abilities.ts`)

A shared state machine for all mech abilities.

```typescript
export type AbilityId = 'shieldWall' | 'siegeMode' | 'cloak' | 'umbrella';

export interface AbilityState {
  id: AbilityId;
  active: boolean;
  cooldown: number;       // remaining cooldown after deactivation
  transitionTimer: number; // deploy/undeploy animation time remaining
}

export interface AbilityDef {
  id: AbilityId;
  unitKind: UnitKind;
  energyPerSecond: number;
  cooldownAfterDeactivation: number;
  activationCondition?: (unit: Unit, world: World) => boolean;
  onActivate: (unit: Unit, world: World) => void;
  onTick: (unit: Unit, world: World, dt: number) => void;
  onDeactivate: (unit: Unit, world: World) => void;
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  shieldWall: {
    id: 'shieldWall',
    unitKind: 'vanguard',
    energyPerSecond: 3,
    cooldownAfterDeactivation: 5,
    onActivate(unit) { /* set speed multiplier to 0.6 */ },
    onTick(unit, world, dt) {
      /* consume energy; if exhausted, deactivate */
    },
    onDeactivate(unit) { /* restore speed multiplier */ },
  },
  siegeMode: {
    id: 'siegeMode',
    unitKind: 'longbow',
    energyPerSecond: 0,
    cooldownAfterDeactivation: 0,
    onActivate(unit) {
      /* immobilize, swap weapon to siegeMortar with boosted stats */
      /* transitionTimer = 3.0 */
    },
    onTick(unit, world, dt) { /* nothing; state is maintained by flags */ },
    onDeactivate(unit) { /* transitionTimer = 3.0; restore mobility after timer */ },
  },
  cloak: {
    id: 'cloak',
    unitKind: 'wisp',
    energyPerSecond: 0,
    cooldownAfterDeactivation: 0,
    // Passive: auto-activates after 1.5s stationary
    onActivate(unit) { /* set invisible flag */ },
    onTick(unit, world, dt) {
      /* if moved or fired: deactivate immediately */
      /* if enemy within 30m: reveal */
    },
    onDeactivate(unit) { /* clear invisible flag */ },
  },
  umbrella: {
    id: 'umbrella',
    unitKind: 'aegis',
    energyPerSecond: 6,
    cooldownAfterDeactivation: 8,
    onActivate(unit) { /* expand interception radius to 120m */ },
    onTick(unit, world, dt) { /* consume energy; if exhausted, deactivate */ },
    onDeactivate(unit) { /* reset interception radius to base */ },
  },
};
```

#### Unit Type Extension

The `Unit` interface gains:

```typescript
export interface Unit {
  // ... existing fields ...
  ability: AbilityState | null;    // null for units without abilities (engineer)
  cloaked: boolean;                // visibility flag
  stationaryTime: number;          // seconds since last movement (for cloak trigger)
  damageState: 0 | 1 | 2;         // visual/mechanical degradation tier
  speedMultiplier: number;         // 1.0 default, modified by abilities and damage
}
```

### 8. Mech Damage States

Computed each tick based on HP ratio:

```typescript
function computeDamageState(unit: Unit): 0 | 1 | 2 {
  const def = UNITS[unit.kind];
  const ratio = unit.hp / def.hp;
  if (ratio < 0.33) return 2;
  if (ratio < 0.66) return 1;
  return 0;
}
```

- **State 0**: Full health. No mechanical effect.
- **State 1** (< 66% HP): Cosmetic only. Renderer shows sparks via event.
- **State 2** (< 33% HP): `speedMultiplier *= 0.8`. Renderer shows exposed internals.

On death, a `Wreck` entity spawns:

```typescript
export interface Wreck {
  id: number;
  s: number;
  z: number;
  yaw: number;
  kind: UnitKind;  // for visual selection
  hp: number;      // targetable; decays over 60s
  lifetime: number;
}
```

Wrecks are stored in a separate `wreckages: Wreck[]` array on World, ticked for decay, and provide cover (block line-of-sight for targeting at short range).

### 9. Faction Asymmetry (`src/sim/data.ts`)

A per-faction modifier table applied at entity creation:

```typescript
export interface FactionModifiers {
  buildTimeMultiplier: number;
  visionMultiplier: number;
  mechHpMultiplier: number;
  ballisticCostMultiplier: number;
}

export const FACTION_MODS: Record<Faction, FactionModifiers> = {
  [Faction.Compact]: {
    buildTimeMultiplier: 1.0,
    visionMultiplier: 1.0,
    mechHpMultiplier: 1.15,           // +15% mech HP
    ballisticCostMultiplier: 0.85,    // -15% rocket/battery cost
  },
  [Faction.Choir]: {
    buildTimeMultiplier: 0.85,        // -15% build time (faster)
    visionMultiplier: 1.2,            // +20% vision range
    mechHpMultiplier: 0.85,           // -15% mech HP
    ballisticCostMultiplier: 1.0,
  },
};
```

#### Application at Spawn Time

```typescript
// In World.spawnUnit (modified):
spawnUnit(faction: Faction, kind: UnitKind, s: number, z: number): Unit {
  const def = UNITS[kind];
  const mods = FACTION_MODS[faction];
  const hp = def.isMech ? Math.round(def.hp * mods.mechHpMultiplier) : def.hp;
  const vision = Math.round(def.vision * mods.visionMultiplier);
  // ... create unit with modified hp, vision ...
}
```

Costs are checked with the modifier at queue time (`tryQueueUnit`), ensuring the economic asymmetry is deterministic and front-loaded.

### 10. Quality Preset Framework (`src/render/settings.ts`)

```typescript
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityConfig {
  shadowMapSize: number;
  drawDistance: number;
  particleCap: number;
  postProcessing: boolean;
  shadowsEnabled: boolean;
  bloomEnabled: boolean;
}

export const PRESETS: Record<QualityPreset, QualityConfig> = {
  low:    { shadowMapSize: 0,    drawDistance: 2000, particleCap: 64,  postProcessing: false, shadowsEnabled: false, bloomEnabled: false },
  medium: { shadowMapSize: 1024, drawDistance: 3500, particleCap: 128, postProcessing: true,  shadowsEnabled: true,  bloomEnabled: false },
  high:   { shadowMapSize: 2048, drawDistance: 5000, particleCap: 256, postProcessing: true,  shadowsEnabled: true,  bloomEnabled: true },
  ultra:  { shadowMapSize: 4096, drawDistance: 7200, particleCap: 512, postProcessing: true,  shadowsEnabled: true,  bloomEnabled: true },
};

export class Settings {
  preset: QualityPreset;
  volume: number;  // 0..1, wired for future audio

  constructor() {
    const saved = localStorage.getItem('rww-settings');
    if (saved) { /* parse and validate */ }
    else { this.preset = 'high'; this.volume = 0.8; }
  }

  save(): void {
    localStorage.setItem('rww-settings', JSON.stringify({ preset: this.preset, volume: this.volume }));
  }

  apply(renderer: Renderer): void {
    const cfg = PRESETS[this.preset];
    // Apply all config values to renderer within a single frame
  }
}
```

### 11. Save/Load Serialization (`src/sim/serialize.ts`)

#### Snapshot Format

```typescript
export interface SimSnapshot {
  version: number;          // schema version, currently 1
  tick: number;
  time: number;
  rngState: number;         // Rng.snapshot()
  seed: number;             // original world seed
  terrainSeed: number;
  players: Record<Faction, SerializedPlayer>;
  units: SerializedUnit[];
  structures: SerializedStructure[];
  projectiles: SerializedProjectile[];
  deposits: SerializedDeposit[];
  wreckages: SerializedWreck[];
  nextId: number;
  winner: Faction | null;
}
```

Each entity is serialized as a plain object matching its runtime shape, minus methods and circular references. The `Rng` class exposes `snapshot()` (already exists) and gains a static `fromState(state: number): Rng` factory.

#### Validation

```typescript
export function validateSnapshot(data: unknown): data is SimSnapshot {
  if (!data || typeof data !== 'object') return false;
  const s = data as Record<string, unknown>;
  if (s.version !== 1) return false;
  if (typeof s.tick !== 'number') return false;
  // ... field-by-field type checks ...
  return true;
}
```

On failed validation, `World.load()` returns an error result without mutating the current world state.

#### Determinism Round-Trip

After loading a snapshot, the world must produce the same state hash sequence as a continuous run. This is verified by:

1. Running world A to tick N, taking snapshot S
2. Creating world B from S
3. Running both A and B for M more ticks
4. Asserting `A.stateHash() === B.stateHash()` at each tick

### 12. Headless Sim Runner (`src/headless/runner.ts`)

```typescript
export interface HeadlessConfig {
  seed: number;
  factions: [Faction, Faction];
  difficulties: [Difficulty, Difficulty];
  tickLimit: number;          // default: 45 * 60 * 30 (45 min at 30 Hz)
}

export interface MatchResult {
  winner: Faction | null;
  durationTicks: number;
  durationMinutes: number;
  economy: Record<Faction, { peakSalvage: number; totalProduced: number }>;
  unitsProduced: Record<Faction, number>;
  unitsLost: Record<Faction, number>;
  structuresDestroyed: Record<Faction, number>;
  endReason: string;
}

export function runHeadlessMatch(config: HeadlessConfig): MatchResult {
  // Creates World + two AiOpponents
  // Loops world.step() + ai.update() until winner or tickLimit
  // Returns aggregated stats
  // NEVER imports from render/, ui/, or uses DOM APIs
}
```

### 13. Silo Structure (Chord Shot Launcher)

```typescript
// Addition to StructureKind type and STRUCTURES table:
silo: {
  kind: 'silo',
  name: 'Silo',
  role: 'Endgame cross-ring weapon. Expensive, visible, devastating.',
  cost: { salvage: 1200 },
  buildTime: 45,
  hp: 2000,
  armor: 'structure',
  radius: 16,
  height: 30,
  vision: 180,
  weapons: ['chordShot'],
  energy: -12,
  requires: 'mechFoundry',
}
```

The Silo fires chord shots through the same `fireBallisticAt` API. The chord shot's high launch speed (280 m/s) combined with a steep elevation sends it above `ATMOSPHERE_HEIGHT`, triggering the zero-drag chord flight path naturally.

### 14. Settings Menu & Performance Overlay

#### Settings Menu (`src/ui/settingsMenu.ts`)

A DOM overlay toggled by Escape. Does not pause the sim (single-player continues in background). Contains:

- Quality preset dropdown (Low/Medium/High/Ultra)
- Volume slider (0-100%, persisted, wired to future audio)
- Keybindings display (read-only list of current bindings)
- Resume button (closes overlay, restores input)

#### Performance Overlay (`src/ui/perfOverlay.ts`)

Extended from existing `debugOverlay.ts`. Toggled by F3. Displays:

- Frame time (ms) and FPS
- Draw call count (from `renderer.info.render.calls`)
- Active entity count (`world.units.filter(alive).length + world.structures.filter(alive).length`)
- Sim step duration (measured via `performance.now()` around `world.step()`)
- Memory estimate (`performance.memory?.usedJSHeapSize` where available)

Renders as a fixed-position DOM element with `pointer-events: none` so gameplay input passes through.

---

## Data Models

### Extended Unit Type

```typescript
export interface Unit {
  // ... all existing fields from Gate 1 ...
  ability: AbilityState | null;
  cloaked: boolean;
  stationaryTime: number;
  damageState: 0 | 1 | 2;
  speedMultiplier: number;
}
```

### New Entity: Wreck

```typescript
export interface Wreck {
  id: number;
  s: number;
  z: number;
  yaw: number;
  kind: UnitKind;
  hp: number;
  lifetime: number;   // counts down from 60
  faction: Faction;   // original owner, for rendering colour
}
```

### Extended WeaponDef

```typescript
export interface WeaponDef {
  // ... all existing fields ...
  cruise?: boolean;        // terrain-following low-altitude flight
  cruiseAltitude?: number; // max height above terrain (metres)
  chord?: boolean;         // exits atmosphere, crosses ring interior
}
```

### Extended StructureDef

```typescript
export interface StructureDef {
  // ... all existing fields ...
  coverageArc?: number;    // laser grid: arc coverage in metres
}
```

### Faction Modifier Table

```typescript
export interface FactionModifiers {
  buildTimeMultiplier: number;
  visionMultiplier: number;
  mechHpMultiplier: number;
  ballisticCostMultiplier: number;
}
```

---

## Error Handling

| Scenario | Response |
|----------|----------|
| Snapshot fails validation on load | Return error result, current world state unchanged |
| Ability activated without sufficient energy | Activation rejected, no state change |
| Chord shot launched without Silo | `fireBallisticAt` returns false |
| Cruise missile pathing fails (terrain too steep) | Missile detonates in place |
| AI strategist receives invalid world state | Skip evaluation cycle, retain previous goal |
| Quality preset string unrecognized from localStorage | Fall back to 'high' |
| Headless runner exceeds tick limit | Resolve via dominance score, return result |

---

## Testing Strategy

### Unit Tests (Vitest)
- Strategist scoring produces valid numbers for all goal types
- Tactician assigns all combat units to squads
- Cruise missile altitude invariant
- Chord shot visibility to both factions
- Laser grid immunity for cruise missiles
- Shield wall damage reduction from correct arc only
- Siege mode immobilization
- Cloak activation/deactivation triggers
- Umbrella radius expansion
- Damage state thresholds
- Faction modifier application
- Snapshot round-trip determinism
- Headless runner produces complete results

### Property-Based Tests (Vitest with generators)
- For all game states: strategist scores all candidate goals
- For all cruise missile flights: altitude stays within bound
- For all ballistic fires: counter-battery flash reveals entity
- For all faction/unit combinations: modifiers applied deterministically
- For all snapshots: save/load round-trip produces identical state

### Integration Tests (Playwright)
- Quality preset applies without reload
- Settings persist across sessions
- F3 overlay toggles
- Escape opens settings without stopping sim


---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Strategist scores all candidate goals

*For any* valid game state (economy, army, map control) and *for any* difficulty tier, the Strategist SHALL produce a finite numeric score for every goal in that tier's candidate set, and the candidate set SHALL match the tier's configuration (Recruit: 3 goals; Veteran/Commander: 5 goals).

**Validates: Requirements 1.1, 1.3, 1.4, 1.5**

### Property 2: AI never receives resource cheats

*For any* difficulty tier and *for any* sequence of sim ticks, the AI player's salvage and energy SHALL only change through the same economy mechanisms available to the human player (extraction, production, solar/fusion generation). The AI's resource balance after N ticks SHALL be identical whether it is controlled by a Recruit, Veteran, or Commander strategist, given the same decisions.

**Validates: Requirements 1.6**

### Property 3: Tactician assigns all combat units to exactly one squad

*For any* set of alive mech-class units belonging to the AI faction, the Tactician SHALL partition them into squads such that every mech appears in exactly one squad, and each squad has an assigned behavior tree.

**Validates: Requirements 2.1**

### Property 4: Focus-fire convergence

*For any* squad engaging multiple enemies within weapon range, all squad members SHALL share the same target (the highest-priority threat), unless a unit is in retreat state.

**Validates: Requirements 2.2**

### Property 5: Retreat threshold triggers withdrawal

*For any* mech-class unit whose HP is below the retreat threshold percentage, the Tactician SHALL issue a withdraw order toward a rally point. The unit's order SHALL change to 'move' with a destination closer to a friendly structure than its current position.

**Validates: Requirements 2.3**

### Property 6: Difficulty gates behaviors

*For any* combat scenario at Recruit difficulty, the behavior tree SHALL never execute kiting, ability coordination, or dodge nodes. *For any* combat scenario at Veteran or Commander difficulty, all behavior types SHALL be available (modulated only by reaction delay).

**Validates: Requirements 2.5, 2.6, 2.7**

### Property 7: Cruise missile altitude invariant

*For any* cruise missile in flight over *any* terrain profile, the missile's height above local terrain SHALL never exceed 50 metres at any simulation tick.

**Validates: Requirements 3.1, 3.5**

### Property 8: Cruise missile laser grid immunity

*For any* cruise missile passing through *any* laser grid's coverage arc, the laser grid SHALL NOT intercept the missile (because its altitude is below the grid's engagement floor). Conversely, *for any* standard ballistic rocket at apex altitude within the same arc, the laser grid SHALL attempt interception if it has energy.

**Validates: Requirements 3.2, 5.1, 5.4**

### Property 9: Point defense engages cruise missiles

*For any* cruise missile within the engagement range of a point defense structure or Aegis umbrella, the interceptor SHALL attempt engagement (energy permitting), regardless of the missile's low altitude.

**Validates: Requirements 3.3, 10.2**

### Property 10: Splash damage application

*For any* projectile (cruise missile, chord shot, or standard rocket) that impacts at position (s, z), *all* entities within the weapon's splash radius SHALL receive damage scaled by the damage table, and *no* entity outside the splash radius SHALL receive damage from that impact.

**Validates: Requirements 3.4, 4.3**

### Property 11: Chord shot exits atmosphere

*For any* chord shot trajectory, at least one trajectory sample SHALL have height greater than ATMOSPHERE_HEIGHT, confirming the projectile traversed the ring interior.

**Validates: Requirements 4.1**

### Property 12: Zero drag above atmosphere

*For any* projectile (chord shot or otherwise) at height above ATMOSPHERE_HEIGHT, the air density function SHALL return 0, and consequently no drag force SHALL be applied during that integration step. The projectile's speed SHALL remain constant while above the atmosphere shell.

**Validates: Requirements 4.2**

### Property 13: Chord shot global visibility

*For any* chord shot whose current position is above ATMOSPHERE_HEIGHT, *both* factions SHALL have visibility of that projectile regardless of fog-of-war state.

**Validates: Requirements 4.4**

### Property 14: Accuracy penalty without spotter vision

*For any* chord shot fired at a target area without spotter vision, the impact dispersion SHALL be strictly larger than the dispersion of a chord shot fired at a target with vision. Specifically, the standard deviation of impact offset SHALL exceed zero when vision is absent.

**Validates: Requirements 4.6**

### Property 15: Laser grid saturation

*For any* laser grid with fire rate cooldown C, when N > 1/C ballistic rockets pass through its coverage arc simultaneously, at most floor(elapsed_time / C) rockets SHALL be intercepted. The remainder SHALL pass through unengaged.

**Validates: Requirements 5.5**

### Property 16: Laser grid energy gate

*For any* laser grid with zero available energy, *no* interceptions SHALL occur regardless of how many valid targets pass through its coverage arc.

**Validates: Requirements 5.3**

### Property 17: Counter-battery flash visibility

*For any* entity that fires a ballistic weapon, the entity SHALL have `revealed > 0` for exactly FIRING_REVEAL_TIME seconds afterward. *While* revealed > 0, the enemy faction SHALL have vision of that entity. *After* revealed reaches 0, normal fog-of-war rules SHALL resume.

**Validates: Requirements 6.1, 6.2, 6.3, 8.5, 18.4**

### Property 18: Shield wall directional damage reduction

*For any* Vanguard with Shield_Wall active, damage from sources within the forward 120-degree arc SHALL be reduced by the data-table multiplier. Damage from sources outside that arc SHALL be applied at full value. Movement speed SHALL equal base speed × 0.6 while active.

**Validates: Requirements 7.1, 7.2**

### Property 19: Ability energy exhaustion deactivation

*For any* ability (Shield_Wall or Umbrella) that consumes energy per second, if the owning faction's energy supply is exhausted, the ability SHALL be deactivated within one sim tick and a cooldown SHALL be applied preventing immediate reactivation.

**Validates: Requirements 7.4, 10.4**

### Property 20: Siege mode immobilization and stat change

*For any* Longbow in Siege_Mode, movement speed SHALL be 0, turn rate SHALL be 0, weapon range SHALL equal base range × siege multiplier, and fire rate SHALL equal base cooldown / siege multiplier. On deactivation, mobility SHALL not restore for 3.0 seconds (transition timer).

**Validates: Requirements 8.1, 8.3, 8.4**

### Property 21: Cloak activation and breaking

*For any* Wisp that has been stationary for ≥ 1.5 seconds, `cloaked` SHALL be true. *For any* cloaked Wisp that moves (speed > 0) or fires a weapon, `cloaked` SHALL become false within the same tick. *While* cloaked, no enemy unit SHALL acquire the Wisp as a target.

**Validates: Requirements 9.1, 9.2, 9.3**

### Property 22: Cloak proximity detection

*For any* enemy unit within 30 metres of a cloaked Wisp, the Wisp SHALL be revealed to that unit's faction. *For any* enemy unit farther than 30 metres, the cloak SHALL remain intact (absent other reveal conditions).

**Validates: Requirements 9.4**

### Property 23: Umbrella radius expansion and contraction

*For any* Aegis with Umbrella active, the interception engagement radius SHALL be 120 metres (covering all allies within that radius). On deactivation, the radius SHALL immediately return to the Aegis's base interceptor range. Energy draw SHALL increase by the data-table rate while active.

**Validates: Requirements 10.1, 10.3, 10.5**

### Property 24: Damage state determination

*For any* mech-class unit, its damage state SHALL be determined solely by the ratio of current HP to maximum HP: state 0 if ≥ 66%, state 1 if 33%–66%, state 2 if < 33%. In state 2, the unit's effective speed SHALL be base speed × 0.8.

**Validates: Requirements 11.1, 11.2**

### Property 25: Wreck spawning on death

*For any* mech-class unit that is destroyed (HP reaches 0), a Wreck entity SHALL be spawned at the unit's death position. The wreck SHALL persist for 60 seconds (decrementing lifetime each tick) and SHALL be targetable (can receive damage to deny cover).

**Validates: Requirements 11.3, 11.4**

### Property 26: Faction modifier determinism

*For any* entity spawned for a given faction, the entity's HP, vision, build time, and cost SHALL equal the base value from the data table multiplied by the corresponding faction modifier. Two entities of the same kind and faction SHALL always receive identical stats regardless of when in the match they are created.

**Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6**

### Property 27: Settings round-trip persistence

*For any* quality preset selection, saving to localStorage and then constructing a new Settings instance SHALL restore the same preset value. The round-trip SHALL preserve all fields without data loss.

**Validates: Requirements 13.3**

### Property 28: Simulation snapshot round-trip

*For any* world state at tick N, serializing to a SimSnapshot and deserializing into a new World SHALL produce a state where `stateHash()` is identical to the original. Running both worlds forward for M additional ticks SHALL produce identical hash sequences at every tick, confirming determinism is preserved across the serialization boundary.

**Validates: Requirements 16.1, 16.2, 16.3**

### Property 29: Invalid snapshot rejection

*For any* malformed or version-mismatched JSON input, the `World.load()` method SHALL return an error without modifying the current world state. The world's stateHash before and after the failed load attempt SHALL be identical.

**Validates: Requirements 16.4, 16.5**

### Property 30: Headless match completeness

*For any* headless match configuration (seed, faction pair, difficulty pair, tick limit), the `runHeadlessMatch` function SHALL return a MatchResult containing: a winner (or null for draws), duration in ticks, economy stats for both factions, units produced/lost counts, and structures destroyed counts. No field SHALL be undefined or NaN.

**Validates: Requirements 17.3**

### Property 31: Time-cap dominance resolution

*For any* match that reaches the 45-minute time cap without a bastion being destroyed, the World SHALL declare the faction with the higher dominance score as the winner. If dominance is tied, the match SHALL be declared a draw (winner = null).

**Validates: Requirements 19.4**

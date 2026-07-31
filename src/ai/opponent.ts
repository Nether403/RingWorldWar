/**
 * The AI opponent.
 *
 * Two layers, deliberately separated:
 *
 *   STRATEGIST decides what the faction is trying to achieve right now by
 *   scoring a handful of goals against the current economy and map control.
 *   Utility scoring rather than a fixed build order, so it adapts instead of
 *   executing the same opening whichever way the match goes.
 *
 *   TACTICIAN moves what already exists: forms a strike group once it has
 *   enough mass, sends scouts to contest nodes, and pulls artillery back when
 *   something closes on it.
 *
 * It does not cheat on resources at any difficulty. What difficulty changes is
 * how often it thinks and how well it reads the map, which produces an
 * opponent that feels slow rather than one that feels unfair.
 */

import { RING_CIRCUMFERENCE, RING_HALF_WIDTH } from '@core/constants';
import { deltaS, surfaceDist, wrapS } from '@core/ringMath';
import { Rng } from '@core/rng';
import {
  Faction,
  other,
  STRUCTURES,
  UNITS,
  type StructureKind,
  type UnitKind,
} from '@sim/data';
import type { Structure, Unit, World } from '@sim/world';

export type Difficulty = 'recruit' | 'veteran' | 'commander';

const DIFFICULTY = {
  recruit: { think: 2.4, army: 5, aggression: 0.6, expand: 0.7 },
  veteran: { think: 1.2, army: 4, aggression: 1.0, expand: 1.0 },
  commander: { think: 0.6, army: 3, aggression: 1.35, expand: 1.3 },
} as const;

export class AiOpponent {
  private timer = 0;
  private rng: Rng;
  private cfg: (typeof DIFFICULTY)[Difficulty];
  /** Where the current push is headed, or null when regrouping. */
  private pushTarget: { s: number; z: number } | null = null;
  private regroupUntil = 0;

  constructor(
    private readonly faction: Faction,
    difficulty: Difficulty,
    seed: number,
  ) {
    this.cfg = DIFFICULTY[difficulty];
    this.rng = new Rng(seed ^ 0xa11);
  }

  update(world: World, dt: number): void {
    if (world.winner !== null) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.cfg.think;

    this.runStrategy(world);
    this.runTactics(world);
  }

  // -------------------------------------------------------------------------
  // Strategy
  // -------------------------------------------------------------------------

  private runStrategy(world: World): void {
    const me = world.players[this.faction];
    const mine = this.myStructures(world);
    const engineers = this.myUnits(world).filter((u) => UNITS[u.kind].canBuild);

    const count = (k: StructureKind): number => mine.filter((s) => s.kind === k).length;
    const extractors = count('extractor');
    const power = me.energyProduced - me.energyDrawn;
    const hasFab = count('fabricator') > 0;
    const hasFoundry = count('mechFoundry') > 0;

    // --- Keep production queues fed -----------------------------------------
    // Engineers first: without them nothing else can be built.
    const engineerCount = engineers.length;
    for (const st of mine) {
      if (st.progress < 1 || st.queue.length > 1) continue;
      const produces = STRUCTURES[st.kind].produces;
      if (!produces) continue;

      if (produces.includes('engineer') && engineerCount < 4 && me.salvage > 200) {
        world.tryQueueUnit(st.id, 'engineer');
        continue;
      }
      if (st.kind === 'mechFoundry') {
        world.tryQueueUnit(st.id, this.chooseMech(world, me.salvage));
      }
    }

    // --- Decide what to build next -------------------------------------------
    // Scored rather than sequenced: whichever need is most acute wins.
    const wants: Array<{ kind: StructureKind; score: number }> = [];
    wants.push({ kind: 'extractor', score: (4 - extractors) * 30 * this.cfg.expand });
    wants.push({ kind: 'solarArray', score: power < 8 ? 40 : 0 });
    wants.push({ kind: 'fabricator', score: hasFab ? 0 : 90 });
    wants.push({ kind: 'mechFoundry', score: hasFab && !hasFoundry ? 100 : 0 });
    wants.push({
      kind: 'fusionCore',
      score: power < 14 && hasFoundry ? 45 : 0,
    });
    wants.push({
      kind: 'rocketBattery',
      score: hasFoundry && count('rocketBattery') < 2 ? 35 : 0,
    });
    wants.push({
      kind: 'pointDefense',
      score: count('pointDefense') < 2 && hasFoundry ? 30 : 0,
    });
    wants.push({ kind: 'radarMast', score: count('radarMast') < 1 && hasFoundry ? 28 : 0 });

    wants.sort((a, b) => b.score - a.score);
    const pick = wants[0];
    if (!pick || pick.score <= 0) return;

    const def = STRUCTURES[pick.kind];
    // Leave a reserve so the AI does not starve unit production to build.
    if (me.salvage < (def.cost.salvage ?? 0) + 120) return;

    const idle = engineers.find((e) => e.order.kind === 'idle');
    if (!idle) return;

    const spot = this.findBuildSpot(world, pick.kind);
    if (!spot) return;

    const site = world.tryPlaceStructure(this.faction, pick.kind, spot.s, spot.z);
    if (site) {
      idle.order = { kind: 'build', s: spot.s, z: spot.z, targetId: site.id };
      idle.buildTargetId = site.id;
    }
  }

  /** Composition logic: a core of brawlers, then artillery, screened by scouts. */
  private chooseMech(world: World, salvage: number): UnitKind {
    const army = this.myUnits(world).filter((u) => UNITS[u.kind].isMech);
    const n = (k: UnitKind): number => army.filter((u) => u.kind === k).length;

    // A scout early is worth more than anything else: artillery cannot fire at
    // what nobody can see.
    if (n('wisp') < 1) return 'wisp';
    if (n('vanguard') < 2) return 'vanguard';
    if (n('longbow') < 1 && salvage > 700) return 'longbow';
    if (n('aegis') < 1 && n('vanguard') >= 2) return 'aegis';
    if (n('vanguard') < n('longbow') * 2) return 'vanguard';
    if (salvage > 1200) return 'longbow';
    return 'vanguard';
  }

  /**
   * Where to put a building. Extractors go on the nearest free deposit; other
   * buildings cluster near the Bastion, with a slight bias away from the enemy
   * so that the economy sits behind the fighting.
   */
  private findBuildSpot(world: World, kind: StructureKind): { s: number; z: number } | null {
    const home = this.myStructures(world).find((s) => s.kind === 'bastion');
    if (!home) return null;

    if (STRUCTURES[kind].needsDeposit) {
      let best: { s: number; z: number } | null = null;
      let bestD = Infinity;
      for (const d of world.deposits) {
        if (d.amount <= 0) continue;
        if (d.claimedBy !== 0 && world.structureById(d.claimedBy)) continue;
        const dist = surfaceDist(home.s, home.z, d.s, d.z);
        if (dist > 420) continue; // must be within the build anchor radius
        if (dist < bestD && world.canPlace(this.faction, kind, d.s, d.z)) {
          bestD = dist;
          best = { s: d.s, z: d.z };
        }
      }
      return best;
    }

    // Rejection-sample a ring around the Bastion.
    for (let i = 0; i < 40; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(60, 300);
      const s = wrapS(home.s + Math.cos(a) * r);
      const z = clamp(home.z + Math.sin(a) * r, -RING_HALF_WIDTH + 120, RING_HALF_WIDTH - 120);
      if (world.canPlace(this.faction, kind, s, z)) return { s, z };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Tactics
  // -------------------------------------------------------------------------

  private runTactics(world: World): void {
    const army = this.myUnits(world).filter((u) => UNITS[u.kind].isMech);
    const scouts = army.filter((u) => u.kind === 'wisp');
    const artillery = army.filter((u) => u.kind === 'longbow');
    const line = army.filter((u) => u.kind === 'vanguard' || u.kind === 'aegis');

    // --- Scouts take and hold nodes ------------------------------------------
    const nodes = world.structures.filter((s) => s.alive && s.kind === 'spinalNode');
    const wanted = nodes.filter((n) => n.faction !== this.faction);
    for (let i = 0; i < scouts.length; i++) {
      const sc = scouts[i]!;
      if (sc.order.kind !== 'idle' && this.rng.next() > 0.25) continue;
      const node = wanted[i % Math.max(1, wanted.length)];
      if (node) sc.order = { kind: 'attackMove', s: node.s, z: node.z, targetId: 0 };
    }

    // --- Artillery repositions after firing ----------------------------------
    // Anything that has just fired is on the enemy's map, so it shuffles. This
    // is also what stops the AI parking artillery in one spot all match.
    for (const a of artillery) {
      const threat = this.nearestEnemy(world, a.s, a.z, 260);
      if (threat) {
        // Something is close: back off toward home.
        const home = this.myStructures(world).find((s) => s.kind === 'bastion');
        if (home) {
          const away = Math.atan2(a.z - threat.z, deltaS(threat.s, a.s));
          a.order = {
            kind: 'move',
            s: wrapS(a.s + Math.cos(away) * 220),
            z: clamp(a.z + Math.sin(away) * 220, -RING_HALF_WIDTH + 80, RING_HALF_WIDTH - 80),
            targetId: 0,
          };
          void home;
        }
      } else if (a.revealed > 0 && a.order.kind === 'idle' && this.rng.chance(0.6)) {
        a.order = {
          kind: 'move',
          s: wrapS(a.s + this.rng.range(-130, 130)),
          z: clamp(a.z + this.rng.range(-90, 90), -RING_HALF_WIDTH + 80, RING_HALF_WIDTH - 80),
          targetId: 0,
        };
      } else if (this.pushTarget && a.order.kind === 'idle') {
        // Follow the push at a standoff distance rather than joining it.
        a.order = {
          kind: 'attackMove',
          s: wrapS(this.pushTarget.s - this.approachSign(world) * 500),
          z: this.pushTarget.z,
          targetId: 0,
        };
      }
    }

    // --- The main body -------------------------------------------------------
    const strength = line.length;
    if (world.time < this.regroupUntil) {
      const home = this.myStructures(world).find((s) => s.kind === 'bastion');
      if (home) {
        for (const u of line) {
          if (u.order.kind === 'idle') {
            u.order = { kind: 'move', s: wrapS(home.s + 90), z: home.z, targetId: 0 };
          }
        }
      }
      return;
    }

    if (strength >= this.cfg.army) {
      if (!this.pushTarget) this.pushTarget = this.chooseAttackTarget(world);
      const t = this.pushTarget;
      if (t) {
        for (const u of line) {
          if (u.order.kind === 'idle' || u.order.kind === 'move') {
            u.order = { kind: 'attackMove', s: t.s, z: t.z, targetId: 0 };
          }
        }
      }
    } else {
      // Too weak to attack: pull back and rebuild.
      this.pushTarget = null;
      const home = this.myStructures(world).find((s) => s.kind === 'bastion');
      if (home) {
        for (const u of line) {
          if (u.order.kind === 'idle') {
            const a = this.rng.range(0, Math.PI * 2);
            u.order = {
              kind: 'attackMove',
              s: wrapS(home.s + Math.cos(a) * 140),
              z: clamp(home.z + Math.sin(a) * 140, -RING_HALF_WIDTH + 80, RING_HALF_WIDTH - 80),
              targetId: 0,
            };
          }
        }
      }
    }

    // If the push has been wiped out, stop feeding units into it.
    if (this.pushTarget && strength < 2) {
      this.pushTarget = null;
      this.regroupUntil = world.time + 45;
    }
  }

  /**
   * Pick something to attack.
   *
   * The ring's asymmetric artillery ranges make direction matter: approaching
   * from antispinward means our own artillery reaches much further into their
   * base than theirs does into ours. So an undefended node or expansion on that
   * side is worth more than a closer one on the wrong side.
   */
  private chooseAttackTarget(world: World): { s: number; z: number } | null {
    const enemy = other(this.faction);
    const home = this.myStructures(world).find((s) => s.kind === 'bastion');
    if (!home) return null;

    let best: { s: number; z: number } | null = null;
    let bestScore = -Infinity;

    const candidates: Structure[] = world.structures.filter(
      (s) => s.alive && (s.faction === enemy || (s.kind === 'spinalNode' && s.faction !== this.faction)),
    );

    for (const c of candidates) {
      const d = Math.abs(deltaS(home.s, c.s));
      // Closer is better, but not linearly -- crossing the map is fine if the
      // prize is right.
      let score = 100 - (d / RING_CIRCUMFERENCE) * 160;

      if (c.kind === 'spinalNode') score += 40;
      if (c.kind === 'extractor') score += 25;
      if (c.kind === 'mechFoundry') score += 35;
      if (c.kind === 'bastion') score += 10 * this.cfg.aggression;

      // Prefer approaching from antispinward of the target.
      const spinwardOfUs = deltaS(home.s, c.s) > 0;
      if (spinwardOfUs) score += 22;

      // Avoid walking into point defence and turrets.
      let defended = 0;
      for (const o of world.structures) {
        if (!o.alive || o.faction !== enemy) continue;
        if (STRUCTURES[o.kind].weapons.length === 0) continue;
        if (surfaceDist(o.s, o.z, c.s, c.z) < 220) defended++;
      }
      score -= defended * 18;

      score += this.rng.range(-8, 8);
      if (score > bestScore) {
        bestScore = score;
        best = { s: c.s, z: c.z };
      }
    }
    return best;
  }

  private approachSign(world: World): number {
    const home = this.myStructures(world).find((s) => s.kind === 'bastion');
    if (!home || !this.pushTarget) return 1;
    return Math.sign(deltaS(home.s, this.pushTarget.s)) || 1;
  }

  private nearestEnemy(world: World, s: number, z: number, range: number): Unit | null {
    let best: Unit | null = null;
    let bestD = range;
    for (const u of world.units) {
      if (!u.alive || u.faction === this.faction) continue;
      const d = surfaceDist(u.s, u.z, s, z);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private myUnits(world: World): Unit[] {
    return world.units.filter((u) => u.alive && u.faction === this.faction);
  }

  private myStructures(world: World): Structure[] {
    return world.structures.filter((s) => s.alive && s.faction === this.faction);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

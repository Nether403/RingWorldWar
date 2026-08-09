import { describe, expect, it } from 'vitest';

// @ts-expect-error The lint helper is intentionally plain Node ESM.
import { auditSource } from '../../tools/lint.mjs';

describe('source boundary lint', () => {
  it('allows reviewed World authority owners', () => {
    expect(auditSource('src/game.ts', 'this.world.drainEvents();')).toEqual([]);
    expect(auditSource('src/headless/runner.ts', 'world.step();')).toEqual([]);
    expect(auditSource('src/scenario/worldFactory.ts', 'world.spawnUnit();')).toEqual([]);
    expect(auditSource('src/ui/hud.ts', 'world.tryQueueUnit();')).toEqual([]);
  });

  it('rejects unauthorized World authority callers', () => {
    expect(auditSource('src\\render\\effects.ts', 'world?.drainEvents();')).toMatchObject([
      { message: expect.stringContaining('World.drainEvents()') },
    ]);
    expect(auditSource('src/ui/settingsMenu.ts', 'world.restorePersistenceState(snapshot);')).toMatchObject([
      { message: expect.stringContaining('World.restorePersistenceState()') },
    ]);
    expect(auditSource('src/render/markers.ts', 'world.activateAbility(1, true);')).toMatchObject([
      { message: expect.stringContaining('World.activateAbility()') },
    ]);
  });

  it('keeps lower-level AI modules independent of opponent', () => {
    expect(auditSource(
      'src/ai/tactician.ts',
      "import type { Difficulty } from './opponent';",
    )).toMatchObject([
      { message: expect.stringContaining('shared contracts') },
    ]);
    expect(auditSource(
      'src/ai/tactician.ts',
      "import type { Difficulty } from './contracts';",
    )).toEqual([]);
  });
});

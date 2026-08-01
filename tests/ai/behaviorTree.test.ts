import { describe, expect, it } from 'vitest';
import {
  Cooldown,
  DifficultyGate,
  Selector,
  Sequence,
  type BTContext,
  type BTNode,
  type BTStatus,
} from '@ai/behaviorTree';

interface TestContext extends BTContext {
  log: string[];
}

class ScriptedNode implements BTNode<TestContext> {
  ticks = 0;
  resets = 0;

  constructor(
    private readonly name: string,
    private readonly statuses: BTStatus[],
  ) {}

  tick(ctx: TestContext): BTStatus {
    ctx.log.push(this.name);
    const status = this.statuses[Math.min(this.ticks, this.statuses.length - 1)]!;
    this.ticks++;
    return status;
  }

  reset(): void {
    this.ticks = 0;
    this.resets++;
  }
}

function context(now = 0, difficulty: TestContext['difficulty'] = 'veteran'): TestContext {
  return { now, difficulty, log: [] };
}

describe('behavior-tree composites', () => {
  it('resumes a running sequence at the running child and restarts after success', () => {
    const first = new ScriptedNode('first', ['success']);
    const second = new ScriptedNode('second', ['running', 'success']);
    const tree = new Sequence([first, second]);
    const ctx = context();

    expect(tree.tick(ctx)).toBe('running');
    expect(ctx.log).toEqual(['first', 'second']);

    ctx.log.length = 0;
    expect(tree.tick(ctx)).toBe('success');
    expect(ctx.log).toEqual(['second']);

    ctx.log.length = 0;
    expect(tree.tick(ctx)).toBe('success');
    expect(ctx.log).toEqual(['first', 'second']);
  });

  it('selects the first non-failing child and preserves running progress', () => {
    const failure = new ScriptedNode('failure', ['failure']);
    const running = new ScriptedNode('running', ['running', 'success']);
    const unused = new ScriptedNode('unused', ['success']);
    const tree = new Selector([failure, running, unused]);
    const ctx = context();

    expect(tree.tick(ctx)).toBe('running');
    expect(ctx.log).toEqual(['failure', 'running']);

    ctx.log.length = 0;
    expect(tree.tick(ctx)).toBe('success');
    expect(ctx.log).toEqual(['running']);
    expect(unused.ticks).toBe(0);
  });

  it('recursively resets composite progress', () => {
    const child = new ScriptedNode('child', ['running']);
    const tree = new Sequence([child]);

    expect(tree.tick(context())).toBe('running');
    tree.reset();

    expect(child.resets).toBe(1);
    expect(child.ticks).toBe(0);
  });
});

describe('behavior-tree decorators', () => {
  it('rate-limits a child until its deterministic cooldown expires', () => {
    const child = new ScriptedNode('child', ['success']);
    const cooldown = new Cooldown(child, 1);

    expect(cooldown.tick(context(0))).toBe('success');
    expect(cooldown.tick(context(0.5))).toBe('failure');
    expect(cooldown.tick(context(1))).toBe('success');
    expect(child.ticks).toBe(2);

    cooldown.reset();
    expect(cooldown.tick(context(0))).toBe('success');
  });

  it('blocks a child below the configured difficulty', () => {
    const child = new ScriptedNode('advanced', ['success']);
    const gate = new DifficultyGate(child, 'veteran');

    expect(gate.tick(context(0, 'recruit'))).toBe('failure');
    expect(child.ticks).toBe(0);
    expect(gate.tick(context(0, 'veteran'))).toBe('success');
    expect(gate.tick(context(0, 'commander'))).toBe('success');
  });
});

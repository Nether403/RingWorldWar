import type { Difficulty } from './opponent';

export type BTStatus = 'running' | 'success' | 'failure';

export interface BTContext {
  now: number;
  difficulty: Difficulty;
}

export interface BTNode<TContext extends BTContext = BTContext> {
  tick(ctx: TContext): BTStatus;
  reset(): void;
}

export class Selector<TContext extends BTContext = BTContext> implements BTNode<TContext> {
  private current = 0;

  constructor(readonly children: readonly BTNode<TContext>[]) {}

  tick(ctx: TContext): BTStatus {
    while (this.current < this.children.length) {
      const status = this.children[this.current]!.tick(ctx);
      if (status === 'running') return 'running';
      if (status === 'success') {
        this.current = 0;
        return 'success';
      }
      this.current++;
    }
    this.current = 0;
    return 'failure';
  }

  reset(): void {
    this.current = 0;
    for (const child of this.children) child.reset();
  }
}

export class Sequence<TContext extends BTContext = BTContext> implements BTNode<TContext> {
  private current = 0;

  constructor(readonly children: readonly BTNode<TContext>[]) {}

  tick(ctx: TContext): BTStatus {
    while (this.current < this.children.length) {
      const status = this.children[this.current]!.tick(ctx);
      if (status === 'running') return 'running';
      if (status === 'failure') {
        this.current = 0;
        return 'failure';
      }
      this.current++;
    }
    this.current = 0;
    return 'success';
  }

  reset(): void {
    this.current = 0;
    for (const child of this.children) child.reset();
  }
}

export class Cooldown<TContext extends BTContext = BTContext> implements BTNode<TContext> {
  private readyAt = -Infinity;

  constructor(
    readonly child: BTNode<TContext>,
    readonly delay: number,
  ) {}

  tick(ctx: TContext): BTStatus {
    if (ctx.now < this.readyAt) return 'failure';
    const status = this.child.tick(ctx);
    if (status !== 'running') this.readyAt = ctx.now + Math.max(0, finite(this.delay));
    return status;
  }

  reset(): void {
    this.readyAt = -Infinity;
    this.child.reset();
  }
}

export class DifficultyGate<TContext extends BTContext = BTContext> implements BTNode<TContext> {
  constructor(
    readonly child: BTNode<TContext>,
    readonly minTier: Difficulty,
  ) {}

  tick(ctx: TContext): BTStatus {
    if (DIFFICULTY_RANK[ctx.difficulty] < DIFFICULTY_RANK[this.minTier]) {
      this.child.reset();
      return 'failure';
    }
    return this.child.tick(ctx);
  }

  reset(): void {
    this.child.reset();
  }
}

const DIFFICULTY_RANK: Record<Difficulty, number> = {
  recruit: 0,
  veteran: 1,
  commander: 2,
};

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

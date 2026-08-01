import type { Unit } from '@sim/world';

export interface AiPoint {
  s: number;
  z: number;
}

export function issueMove(unit: Unit, destination: AiPoint): void {
  unit.order = { kind: 'move', s: destination.s, z: destination.z, targetId: 0 };
  unit.targetId = 0;
}

export function issueAttackMove(unit: Unit, destination: AiPoint): void {
  unit.order = { kind: 'attackMove', s: destination.s, z: destination.z, targetId: 0 };
}

export function issueAttack(unit: Unit, targetId: number, target: AiPoint): void {
  unit.order = { kind: 'attack', s: target.s, z: target.z, targetId };
  unit.targetId = targetId;
}

export function issueBuild(unit: Unit, targetId: number, target: AiPoint): void {
  unit.order = { kind: 'build', s: target.s, z: target.z, targetId };
  unit.buildTargetId = targetId;
}

import { Faction, type UnitKind } from '@sim/data';
import type { SimEvent, World } from '@sim/world';

export type VoiceTrigger =
  | 'selected'
  | 'move'
  | 'attack'
  | 'ready'
  | 'critical'
  | 'group-selected'
  | 'group-move'
  | 'group-attack'
  | 'group-lost';

export interface VoiceClip {
  id: string;
  src: string;
  faction: Faction;
  unit?: UnitKind;
  trigger: VoiceTrigger;
  priority: number;
}

export interface VoiceUnitRef {
  id: number;
  kind: UnitKind;
}

export interface VoicePlayback {
  clip: VoiceClip;
}

export type VoicePlaybackSink = (request: VoicePlayback) => void;

const SELECTION_REPEAT_MS = 1_500;
const SELECTION_COOLDOWN_MS = 400;
const COMMAND_COOLDOWN_MS = 650;
const EMERGENCY_COOLDOWN_MS = 2_500;

export class VoiceDirector {
  private lastSelectionSignature = '';
  private lastSelectionAt = -Infinity;
  private lastCommandAt = -Infinity;
  private lastCriticalAt = -Infinity;
  private lastLossAt = -Infinity;

  constructor(
    private readonly play: VoicePlaybackSink,
    private readonly clips: readonly VoiceClip[],
    private readonly now: () => number = () => performance.now(),
  ) {}

  observeSelection(faction: Faction, units: readonly VoiceUnitRef[]): void {
    if (units.length === 0) return;
    const now = this.now();
    const signature = units.map((unit) => unit.id).sort((a, b) => a - b).join(',');
    const repeated = signature === this.lastSelectionSignature && now - this.lastSelectionAt < SELECTION_REPEAT_MS;
    if (repeated || now - this.lastSelectionAt < SELECTION_COOLDOWN_MS) return;

    this.lastSelectionSignature = signature;
    this.lastSelectionAt = now;
    const clip = units.length === 1
      ? this.findClip(faction, 'selected', units[0]!.kind)
      : this.findClip(faction, 'group-selected');
    if (clip) this.play({ clip });
  }

  observeOrder(
    faction: Faction,
    units: readonly VoiceUnitRef[],
    order: 'move' | 'attack',
  ): void {
    if (units.length === 0) return;
    const now = this.now();
    if (now - this.lastCommandAt < COMMAND_COOLDOWN_MS) return;
    this.lastCommandAt = now;
    const trigger = units.length === 1 ? order : order === 'move' ? 'group-move' : 'group-attack';
    const clip = units.length === 1
      ? this.findClip(faction, trigger, units[0]!.kind)
      : this.findClip(faction, trigger);
    if (clip) this.play({ clip });
  }

  consumePresentation(events: readonly SimEvent[], world: World, viewer: Faction): void {
    const deaths = new Set(events.filter((event) => event.kind === 'unitDied').map((event) => event.id));
    const candidates: VoiceClip[] = [];

    if (deaths.size > 0 && events.some((event) => event.kind === 'unitDied' && event.faction === viewer)) {
      const loss = this.findClip(viewer, 'group-lost');
      if (loss) candidates.push(loss);
    }

    for (const event of events) {
      if (event.faction !== viewer) continue;
      if (event.kind === 'damageStateChanged' && event.scale === 2 && !deaths.has(event.id)) {
        const unit = world.unitById(event.id);
        const warning = unit ? this.findClip(viewer, 'critical', unit.kind) : undefined;
        if (warning) candidates.push(warning);
      } else if (event.kind === 'unitComplete' && isUnitKind(event.entityKind)) {
        const ready = this.findClip(viewer, 'ready', event.entityKind);
        if (ready) candidates.push(ready);
      }
    }

    candidates.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    const clip = candidates[0];
    if (!clip) return;
    const now = this.now();
    if (clip.trigger === 'critical' && now - this.lastCriticalAt < EMERGENCY_COOLDOWN_MS) return;
    if (clip.trigger === 'group-lost' && now - this.lastLossAt < EMERGENCY_COOLDOWN_MS) return;
    if (now - this.lastCommandAt < COMMAND_COOLDOWN_MS && clip.priority < 5) return;
    this.lastCommandAt = now;
    if (clip.trigger === 'critical') this.lastCriticalAt = now;
    if (clip.trigger === 'group-lost') this.lastLossAt = now;
    this.play({ clip });
  }

  reset(): void {
    this.lastSelectionSignature = '';
    this.lastSelectionAt = -Infinity;
    this.lastCommandAt = -Infinity;
    this.lastCriticalAt = -Infinity;
    this.lastLossAt = -Infinity;
  }

  private findClip(faction: Faction, trigger: VoiceTrigger, unit?: UnitKind): VoiceClip | undefined {
    return this.clips.find((clip) =>
      clip.faction === faction && clip.trigger === trigger && clip.unit === unit);
  }
}

function isUnitKind(value: SimEvent['entityKind']): value is UnitKind {
  return value === 'engineer' || value === 'vanguard' || value === 'longbow' ||
    value === 'wisp' || value === 'aegis' || value === 'bulwark' || value === 'needle';
}

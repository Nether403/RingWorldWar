import { Faction, type UnitKind } from '@sim/data';
import type { VoiceClip, VoiceTrigger } from '../audio/voiceDirector';

const UNITS: Readonly<Record<Faction, readonly UnitKind[]>> = {
  [Faction.Compact]: ['engineer', 'vanguard', 'longbow', 'wisp', 'aegis', 'bulwark'],
  [Faction.Choir]: ['engineer', 'vanguard', 'longbow', 'wisp', 'aegis', 'needle'],
};
const UNIT_TRIGGERS: readonly VoiceTrigger[] = ['selected', 'move', 'attack', 'ready', 'critical'];
const GROUP_TRIGGERS: readonly VoiceTrigger[] = ['group-selected', 'group-move', 'group-attack', 'group-lost'];

/** Human-reviewed delivery files generated from tools/media/voice-lines.json. */
export const REVIEWED_VOICE_CLIPS: readonly VoiceClip[] = [
  ...factionClips(Faction.Compact, 'compact'),
  ...factionClips(Faction.Choir, 'choir'),
];

function factionClips(faction: Faction, name: string): VoiceClip[] {
  const unitClips = UNITS[faction].flatMap((unit) => UNIT_TRIGGERS.map((trigger) => ({
    id: `${name}.${unit}.${trigger}`,
    src: `/media/voices/${name}.${unit}.${trigger}.mp3`,
    faction,
    unit,
    trigger,
    priority: priority(trigger),
  })));
  const groupClips = GROUP_TRIGGERS.map((trigger) => ({
    id: `${name}.${trigger}`,
    src: `/media/voices/${name}.${trigger}.mp3`,
    faction,
    trigger,
    priority: priority(trigger),
  }));
  return [...unitClips, ...groupClips];
}

function priority(trigger: VoiceTrigger): number {
  if (trigger === 'group-lost') return 6;
  if (trigger === 'critical') return 5;
  if (trigger === 'attack' || trigger === 'group-attack') return 3;
  if (trigger === 'move' || trigger === 'group-move') return 2;
  return 1;
}

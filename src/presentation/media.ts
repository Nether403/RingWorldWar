import { Faction, type UnitKind } from '@sim/data';
import type { CampaignMissionId } from '../campaign/missionRegistry';

export type UnitDossierMedia = Partial<Record<Faction, Partial<Record<UnitKind, string>>>>;

export interface PresentationMedia {
  menuLoop?: string;
  menuPoster?: string;
  introVideo?: string;
  introPoster?: string;
  introCaptions?: string;
  unitDossiers?: UnitDossierMedia;
  narrativePortraits?: Readonly<Record<string, string>>;
  campaignMissionArt?: Partial<Record<CampaignMissionId, string>>;
}

/** Reviewed delivery files are enabled here after they are copied into public/. */
export const PRESENTATION_MEDIA: PresentationMedia = {
  menuPoster: '/media/presentation/last-rotation-title.webp',
  introVideo: '/media/presentation/last-rotation-intro.mp4',
  introPoster: '/media/presentation/last-rotation-poster.jpg',
  introCaptions: '/media/presentation/last-rotation-intro.vtt',
  unitDossiers: {
    [Faction.Compact]: {
      engineer: '/media/presentation/units/dossier.compact.engineer.webp',
      vanguard: '/media/presentation/units/dossier.compact.vanguard.webp',
      longbow: '/media/presentation/units/dossier.compact.longbow.webp',
      wisp: '/media/presentation/units/dossier.compact.wisp.webp',
      aegis: '/media/presentation/units/dossier.compact.aegis.webp',
      bulwark: '/media/presentation/units/dossier.compact.bulwark.webp',
    },
    [Faction.Choir]: {
      engineer: '/media/presentation/units/dossier.choir.engineer.webp',
      vanguard: '/media/presentation/units/dossier.choir.vanguard.webp',
      longbow: '/media/presentation/units/dossier.choir.longbow.webp',
      wisp: '/media/presentation/units/dossier.choir.wisp.webp',
      aegis: '/media/presentation/units/dossier.choir.aegis.webp',
      needle: '/media/presentation/units/dossier.choir.needle.webp',
    },
  },
  narrativePortraits: {
    'signal-briefing': '/media/presentation/narrative/signal-briefing.webp',
    'signal-hunters': '/media/presentation/narrative/signal-hunters.webp',
    'signal-migration': '/media/presentation/narrative/signal-migration.webp',
    'signal-last-correction': '/media/presentation/narrative/signal-last-correction.webp',
  },
  campaignMissionArt: {
    'compact-01': '/media/presentation/units/dossier.compact.engineer.webp',
    'compact-02': '/media/presentation/units/dossier.compact.vanguard.webp',
    'compact-03': '/media/presentation/units/dossier.compact.aegis.webp',
    'compact-04': '/media/presentation/units/dossier.compact.bulwark.webp',
    'compact-05': '/media/presentation/units/dossier.compact.wisp.webp',
    'compact-06': '/media/presentation/units/dossier.compact.longbow.webp',
    'choir-01': '/media/presentation/units/dossier.choir.wisp.webp',
    'choir-02': '/media/presentation/units/dossier.choir.vanguard.webp',
    'choir-03': '/media/presentation/units/dossier.choir.engineer.webp',
    'choir-04': '/media/presentation/units/dossier.choir.aegis.webp',
    'choir-05': '/media/presentation/units/dossier.choir.needle.webp',
    'choir-06': '/media/presentation/units/dossier.choir.longbow.webp',
  },
};

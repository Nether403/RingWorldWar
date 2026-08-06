import { Faction, type UnitKind } from '@sim/data';

export type UnitDossierMedia = Partial<Record<Faction, Partial<Record<UnitKind, string>>>>;

export interface PresentationMedia {
  menuLoop?: string;
  menuPoster?: string;
  introVideo?: string;
  introPoster?: string;
  introCaptions?: string;
  unitDossiers?: UnitDossierMedia;
  narrativePortraits?: Readonly<Record<string, string>>;
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
};

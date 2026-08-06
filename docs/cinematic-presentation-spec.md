# Cinematic Presentation Layer

**Status:** Title screen and reviewed Last Rotation intro implemented on 2026-08-06.

## Objective

Give Ring World War a finished narrative front door without changing gameplay
authority. The first experience is a faction-neutral command deck overlooking
the ring during the Last Rotation. `New Campaign` leads into a skippable
60-90 second environmental intro; returning players reach the menu immediately
and can continue a saved match.

The presentation is about systems, populations, infrastructure, and impossible
choices rather than individual heroes.

## Creative Direction

- Monumental, ominous, restrained environmental scale.
- The inhabited surface curves upward and closes overhead in every exterior.
- The Solar Filament, failing Shadow-Square Network, arc-cities, Bastions,
  mobile industry, Spinal Nodes, evacuation machinery, and distant war carry
  the visual narrative.
- People appear as small silhouettes or degraded transmission portraits, not
  as heroic talking heads.
- A calm androgynous archive voice provides the historical spine. Brief
  Meridian Compact and Axiom Choir transmissions interrupt and complicate it.
- Neither faction is correct by default. The ring's origin, destination,
  carrying capacity, and final moral answer remain unresolved.

## Menu Contract

- The title screen appears before `Game`, terrain, renderer, or audio authority
  is constructed on normal development and production routes.
- `New Campaign` plays the intro when a valid asset exists, then starts a new
  standard match. The intro is skippable and keyboard accessible.
- `Continue` is enabled only when the existing save slot is present. It skips
  the intro and restores through the current atomic save/load boundary.
- `Settings` edits the existing persisted graphics quality and master-volume
  values before the renderer exists.
- The background may use a muted looping video, but a complete CSS panorama is
  always available for missing media, reduced motion, failed decoding, or Low
  capability.
- Automated WebDriver routes bypass the menu in development unless `menu=1` is
  explicit. Scenario-driver and calibration routes remain deterministic.

## Media Contract

- Optional files live under `public/media/presentation/` and are referenced
  through one typed manifest.
- Menu motion and intro video never gate game startup. A missing or failed file
  falls back without an uncaught error.
- Captions are enabled by default when a track exists.
- Intro playback exposes Skip, captions, mute, and elapsed-time controls without
  replacing native keyboard behavior.
- Generated source files and provider receipts remain outside the application
  bundle; only reviewed delivery assets are copied into `public/`.
- Reviewed static title, dossier, and transmission images may use the same typed
  optional-media boundary. They remain decorative and preserve complete text/CSS
  behavior when absent or failed.

## Audio Contract

- Menu ambience starts muted until a user gesture.
- Intro voice and sound use the video mix initially. Future separated stems may
  route through the existing master-volume setting.
- Gameplay sound effects remain procedural. Reviewed unit speech may use sampled
  files after individual review for priority, latency, intelligibility, chatter
  rate, and fallback.

## Project Structure

- `src/ui/titleScreen.ts`: title menu, pre-game settings, intro playback.
- `src/presentation/media.ts`: typed optional-media manifest and capability rules.
- `e2e/title-screen.spec.ts`: menu, keyboard, continue, fallback, and responsive checks.
- `public/media/presentation/`: reviewed delivery assets only.
- `docs/cinematic-presentation-spec.md`: creative and technical contract.

## Commands

- Development: `npm run dev`
- Unit tests: `npm test`
- Browser tests: `npm run test:e2e`
- Build: `npm run build`
- Lint and boundaries: `npm run lint`

## Boundaries

Always:

- preserve simulation, AI, balance, save, and scenario semantics;
- provide missing-media and reduced-motion fallbacks;
- keep menu controls keyboard and screen-reader accessible;
- retain source and provider provenance for reviewed generated assets.

Ask first:

- introduce named recurring characters;
- replace procedural gameplay audio with authored assets;
- make a generated cinematic canonical beyond this approved outline;
- spend external credits on alternate renders after the first reviewed session.

Never:

- read or commit local API keys;
- autoplay audible media before a gesture;
- block game startup on an external URL or provider response;
- present Playwright WebKit as physical Safari or close Gate 4 without hardware.

## Success Criteria

- Normal users see the title screen before any gameplay canvas or HUD.
- New Campaign, Continue, Settings, Skip, mute, and captions are keyboard usable.
- Existing automated gameplay tests retain tick-zero and startup behavior.
- Missing media, failed video, and reduced motion still provide a complete menu.
- The menu is contained at 320x568, 768x1024, 1100x640, and 1440x900.
- No console or page errors occur in the title-screen browser tests.
- Generated intro and audio are not integrated until reviewed.

## Accepted Delivery

The 65.216-second Last Rotation opening was human reviewed and accepted as
cryptic, mysterious, intriguing, with an appropriate archive voice. The game
ships the original 1080p video, a separate WebVTT caption track, and the poster
frame. See `docs/generated-media-provenance.md` for source IDs and hashes.

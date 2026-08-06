# Phase 5: Voice and Visual Identity

**Status:** Implemented and human reviewed on 2026-08-06. The approved delivery
contains 68 tactical voice lines, 12 unit cards, four narrative portraits, and
one title poster.

## Objective

Give field units concise faction-specific acknowledgements and add reviewed
presentation art to tactical UI surfaces without changing simulation authority,
the procedural 3D battlefield, or the existing performance qualification.

## Scope

- Meridian Compact and Axiom Choir each use one reviewed Deepgram voice identity.
- Valid faction/unit combinations receive class-specific selection, move, attack,
  ready, and critical-damage lines.
- Mixed groups use faction-level selection, move, attack, and aggregated-loss lines.
- GPT-image-2 may provide a title panorama, unit dossier cards, and narrative
  transmission portraits.
- Generated images remain DOM presentation. They do not enter Three.js materials,
  terrain, effects, markers, simulation data, or save data.

## Authoring Boundary

Deepgram and Azure OpenAI are offline authoring services. The browser never
receives provider credentials and never calls either provider.
The direct media CLI entrypoints load the ignored project `.env` when available;
imported test helpers do not.

Source manifests:

- `tools/media/voice-lines.json`
- `tools/media/image-prompts.json`

Commands:

```powershell
npm run media:check
npm run media:voices -- --id compact.vanguard.selected
npm run media:images -- --id title.last-rotation
```

Those commands are dry runs by default. Adding `--generate` performs paid work
and requires explicit approval plus the corresponding inherited environment
variables. Candidate files remain under ignored `tools/media-candidates/` until
human review. Only approved delivery files may be copied into `public/` and
enabled in the typed runtime manifests.

Paid generation requires a single `--id`. An approved bulk run additionally
requires all three flags: `--generate --all --confirm-bulk`. This prevents an
omitted ID from silently spending against the complete catalog.

## Runtime Contract

- `src/audio/voiceDirector.ts` owns presentation-only cooldowns, priorities, and
  coalescing.
- `src/audio/webAudioBackend.ts` decodes reviewed files on the existing WebAudio
  context, uses a dedicated voice bus, and ducks other buses during speech.
- Voice requests originate only from accepted player actions and friendly,
  already-visible presentation events.
- Missing or late audio is skipped. It is never replayed after the tactical
  moment has passed.
- Existing HUD command text and procedural audio remain the complete fallback.
- Voice volume is persisted separately under the existing master volume.

## Graphics Contract

- `src/presentation/media.ts` is the only runtime image manifest.
- Title, dossier, production, and narrative images are optional, decorative,
  lazy-decoded, and removed on load error.
- Unit names, faction, role, costs, health, orders, warnings, narrative copy, and
  controls remain text and CSS.
- Low quality, reduced motion, missing files, and failed decoding retain complete
  CSS/text presentation.

## Review Gates

1. Approve credit spend for ten voice auditions and three image style anchors.
2. Select one voice identity per faction and one visual treatment.
3. Approve bulk generation separately.
4. Reject assets with generated text, misleading equipment, wrong faction color,
   inaccessible crops, poor intelligibility, or excessive file size.
5. Record provider metadata, request IDs where available, bytes, SHA-256, rights
   basis, and human review in `docs/generated-media-provenance.md`.

## Acceptance

- No simulation timeline or result hash changes.
- No provider requests from production/browser code.
- Accepted actions speak at most once; rejected and continuous actions stay silent.
- Critical and loss lines preempt lower-priority chatter without spam.
- Missing media never blocks startup, input, narrative progression, or production.
- Unit cards and transmission portraits remain contained at supported mobile and
  desktop layouts.
- Existing unit, build, browser, and T480s qualification gates pass.

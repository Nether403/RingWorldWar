# First Contact Tutorial Alpha

## Status

First Contact is a playable tutorial alpha with one tester-reported completed
internal run. The tester reported zero gameplay confusion or faulty mechanics and rated
the experience A+ overall. Its objective timing and copy remain provisional until
the broader player cohort is complete.

Run it with:

```text
npm run rww -- play first-contact
```

The deterministic scenario starts at tick zero, disables the general opponent
AI, and preserves normal simulation, command, construction, production, sensor,
capture, and artillery authority.

## Objective Sequence

1. Select an Engineer.
2. Complete two Solar Arrays.
3. Complete an Extractor.
4. Complete a Fabricator.
5. Complete a Mech Foundry.
6. Produce a Wisp.
7. Capture the forward antispinward Spinal Node.
8. Produce a Longbow.
9. Finish deploying the Longbow in Siege Mode.
10. Fire the Siege Mortar antispinward at the Choir power core beyond the node.

Objectives observe real player commands and simulation events. Tutorial state is
not advanced by DOM clicks, wall-clock timers, or special-case construction.
Milestones completed slightly out of order are retained so an exploratory player
cannot permanently strand the sequence.

## Persistence

The browser save slot now wraps the existing deterministic match-session state
with AI mode and validated mission progress. Legacy match-session saves remain
loadable with no active mission. Active missions validate only the live bindings
still needed by their current objective; completed missions remain loadable after
their battlefield entities are destroyed.

## Validation Boundary

Automated checks establish deterministic progression, strict scenario parsing,
save/load round trips, HUD presentation, responsive containment, and the CLI
launch path. They do not establish whether the sequence is paced well or whether
the current hints are sufficient for an uncoached first-time player.

The completed internal observation and retained Low-quality presentation fixes
are recorded in `docs/playtests/2026-08-02-first-contact-completion.md`.

Tracked receipts are recorded in:

- `validation/evidence/first-contact-visual.json`
- `validation/evidence/first-contact-t480s-5s.json`
- `validation/evidence/full-suite-2026-08-02.json`

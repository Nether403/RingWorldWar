# A Signal in the Spine

## Objective

Expand the accepted three-mission baseline with one faction-exclusive unit per
side and one story-driven mission that introduces the Last Rotation conflict
through play rather than exposition.

## New Units

### Meridian Compact Bulwark

- Compact-exclusive heavy escort walker.
- Slow, high-integrity line unit.
- Reuses the established Shield Wall ability.
- Intended to hold corridors and protect Engineers during node restoration.

### Axiom Choir Needle

- Choir-exclusive fast hunter.
- Fragile, high-vision direct-fire mech.
- Reuses the established passive Cloak behavior.
- AI prioritizes Engineers, Wisp spotters, and Longbow artillery when visible.

No new resource, damage type, projectile model, or status system is introduced.

## Story Mission

1. Receive a blocking briefing from Compact command.
2. Bring an Engineer and Bulwark escort to an isolated Spinal Node.
3. Defeat Choir Needles hunting the restoration team.
4. Restore power and exact sensor contact at the node.
5. Hold the node while it decodes correction data.
6. Receive an intercepted Choir transmission revealing the Migration Protocol.
7. Destroy the Choir field command without destroying the Spinal Node.
8. Debrief with the revelation that one habitat-scale correction remains.

## Narrative Layer

- Static mission-defined briefing and transmission beats.
- Blocking briefings pause fixed simulation until acknowledged.
- Nonblocking transmissions remain visible without stopping play.
- Delivered and acknowledged beat IDs persist in the mission snapshot.
- Narrative text is rendered through `textContent`; no dialogue choices or HTML
  content are supported.

## Compatibility

- Existing world saves migrate with no new required unit fields.
- Existing mission snapshots migrate to an empty narrative state.
- First Contact, Break the Line, and Counterfire behavior remains unchanged.
- Existing units retain their weapon cardinality and balance values.

## Success Criteria

- Wrong-faction exclusive production and scenario spawning are rejected.
- Bulwark and Needle render as distinct procedural silhouettes.
- Compact AI may build Bulwarks but never Needles; Choir does the inverse.
- Needle cloak and target priorities are deterministic.
- The story mission starts paused at its briefing, progresses through normal
  movement/combat/construction/capture authority, and restores through save/load.
- The mission debrief includes story-specific results.
- T480s 1280x720 Low remains within the accepted candidate budget.

## Commands

```text
npm run rww -- play a-signal-in-the-spine
npm test
npm run test:e2e
npm run lint
npm run build
```

## Boundaries

- Keep ring size, baseline unit speeds, projectile speeds, and accepted balance
  frozen unless this mission produces contradictory evidence.
- Do not add branching dialogue, cinematic cameras, a campaign map, or binary
  art assets in this slice.

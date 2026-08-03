# Counterfire Mission

## Purpose

Counterfire exposes the defensive and ammunition-counter systems already in the
simulation without changing movement, projectile speed, damage, or ring scale.

Run it with:

```text
npm run rww -- play counterfire
```

## Objective Sequence

1. Detect the first Choir mortar launch.
2. Complete the emergency Fusion Core and restore defensive reserve.
3. Activate the Aegis Umbrella around the protected Fabricator.
4. Intercept one hostile mortar with the Aegis.
5. Establish exact Wisp sensor contact with the enemy Longbow.
6. Fire a Standard Rocket and observe Laser Grid interception.
7. Switch to Cruise Missile, which travels below the grid envelope.
8. Destroy the Longbow before the protected Fabricator falls.

The enemy barrage comes from a deployed Longbow using its normal attack order,
power, visibility, cooldown, and ballistic authority. Standard and Cruise rounds
use the normal player targeting path and independent cooldowns.

## Debrief

Mission completion and failure now use a reusable debrief model rather than
changing the world-level victory state. Counterfire records and displays:

- mission duration;
- completed objectives;
- hostile launches;
- friendly interceptions;
- hostile penetrations;
- counterfire rounds;
- protected-asset integrity;
- lowest power ratio.

The counters live in the persisted mission snapshot because simulation events
are drained once per fixed tick. Save/load therefore reconstructs the same
debrief after mission completion.

## Evidence Boundary

Automated tests prove event attribution, harmless intercepted impacts, Standard
versus Cruise adaptation, mission completion, debrief rendering, and completed
save/load. Human validation should focus on whether the ammunition switch is
discoverable and whether the debrief explains the outcome without coaching.

The first human run exposed and closed an objective-6 attribution bug. See
`docs/playtests/2026-08-03-counterfire-grid-progression.md`.

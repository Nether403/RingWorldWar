# Break the Line Mission

## Purpose

Break the Line is the first post-tutorial core-loop mission. It exists to judge
whether the current pace comes from intentional strategic distance or from too
much travel without decisions before changing unit speed.

Run it with:

```text
npm run rww -- play break-the-line
```

The scenario uses existing mechanics only. It adds no units, weapons, economy
rules, movement modifiers, or ballistic exceptions.

## Battlefield

The Meridian Compact begins with an established powered base, an active salvage
line, a Wisp, four Vanguards, an Aegis, and a Longbow. A scripted Choir raid is
already moving against the protected Extractor. Farther spinward, a Rocket
Battery and supporting strongpoint block access to a forward Spinal Node.

General strategic AI is disabled so the opening raid and mission timings remain
repeatable. Normal targeting, movement, capture, fog, construction, combat,
artillery, power, and projectile authority remain active.

## Objective Sequence

1. Defeat the bound raiders before the protected Extractor falls.
2. Reveal the Choir forward artillery position with a Wisp.
3. Capture the forward Spinal Node.
4. Deploy a Longbow near the node with the battery antispinward of it.
5. Destroy the Rocket Battery.
6. Destroy the remaining bound strongpoint structures.
7. Hold the forward node for thirty consecutive seconds.

Losing the protected Extractor before defeating the raid fails the mission. The
final hold timer resets if the node changes hands.

## Pacing Evidence

Every objective transition and underlying milestone occurrence records its
authoritative simulation tick in the mission snapshot. Play receipts include
that snapshot in both applied and final scenario state, allowing later analysis of:

- time to first contact;
- scouting and travel duration;
- raid resolution time;
- time spent establishing the favorable artillery side;
- strongpoint reduction time;
- total mission duration.

The local playtest-notes template separately asks where travel stopped producing
meaningful decisions and whether movement speed should stay fixed or enter a
small A/B test.

## Decision Boundary

Do not change the ring dimensions or ballistic launch speeds from this mission.
After several complete runs, compare the current baseline against at most one
experimental variant with approximately ten percent faster ground units. Only
change the baseline if the evidence consistently shows long decision-free travel.

## Automated Completion

The command-driven browser path completed through normal orders, proximity
capture, combat, explicit Siege Mortar fire, and territorial hold in 28,354
simulation ticks: 945.13 seconds, or 15:45. Objective transition and milestone
occurrence ticks were identical in that run:

`2998, 5396, 8760, 22100, 23884, 27454, 28354`

This proves the mission is mechanically completable inside the intended 15–25
minute window. It does not replace human pacing observations.

Tracked evidence is recorded in:

- `validation/evidence/break-the-line-completion.json`
- `validation/evidence/break-the-line-visual.json`
- `validation/evidence/break-the-line-t480s-5s.json`

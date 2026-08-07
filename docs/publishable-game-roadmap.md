# Publishable Game Roadmap

**Status:** Approved direction, implementation in progress  
**Target:** Solo/AI-assisted PC release with a browser demo

## Product Thesis

Ring World War is not an ordinary RTS on a curved map. Its identity is:

> Surround the enemy around a living circular world, fight for the direction where physics favors you, and decide which parts of that world can survive.

The release must make four ideas visible in play:

- Direction is territory: antispinward positions create long-shot artillery advantage.
- The world is overhead: strategic structures, shadow bands, launches, and damage remain spatially readable around the ring when applicable intelligence rules reveal them.
- Gravity is a system: direction, altitude, velocity, drag, and chord flight create tactical consequences.
- The habitat is inhabited: cities, agriculture, vegetation, industry, and evacuation infrastructure make battles costly.

## Launch Scope

- Six Meridian Compact campaign missions.
- Six Axiom Choir campaign missions.
- Skirmish versus AI with faction and difficulty selection.
- Gravity Range and fixed-cannon Arena modes.
- A dedicated whole-ring strategic side view.
- Four reusable environmental district palettes.
- One air attack role, static air-defense role, land transport, and air transport, each with faction variants.
- Remappable input, scalable UI, complete captions, versioned saves, release packaging, and accessibility qualification.

Launch excludes online multiplayer, a third faction, a nonlinear conquest map, fully destructible terrain, manual flight simulation, and full surviving-army persistence.

## Dependency Order

```text
Session and player perspective
    -> faction selection and correct save/audio/HUD authority

Runtime scenarios and world factory
    -> production missions and authored district layers

Mission registry and campaign profile
    -> twelve missions, unlocks, retry, replay, and continuation

Camera controller interface
    -> tactical, direct, whole-ring, briefing, and Arcade views

Layered district/scatter system
    -> vegetation, ruins, cities, transit, and ambient life

Movement/target domains
    -> aircraft, anti-air, air AI, collision, and persistence

Generic cargo model
    -> land transport, air transport, and later chord insertion

Ballistic Arena
    -> gravity-focused modes without coupling to RTS economy rules
```

## Milestones

| Milestone | Scope | Exit |
| --- | --- | --- |
| 0. Product truth | Canon, release contract, CI, licensing/title gates | One authoritative product direction and reproducible release baseline |
| 1. Campaign platform | Session perspective, runtime scenarios, mission registry, campaign profile | Title to faction-correct skirmish and mission-to-mission progression |
| 2. Ring USP slice | Authenticated Spinal Node pairs and local Alignment, direction overlay, shadow rules, overhead intelligence, whole-ring view, Gravity Range | Uncoached players understand and exploit the directional advantage |
| 3. Inhabited ring | District scatter, vegetation, cities, ambient life, integrated tutorial arc | Public browser alpha with a dense, readable battlefield |
| 4. Air and transport | Air domain, target masks, cargo, four requested roles, AI and saves | Deterministic combined-arms test arena |
| 5. Compact campaign | Revise four existing missions and add two finales | Complete six-mission Anchor arc |
| 6. Choir campaign | Six mobility, sensing, evacuation, and Migration missions | Complete six-mission Migration arc |
| 7. Modes and launch | Cannon Arena, skirmish polish, accessibility, packaging, beta | Qualified PC release and representative web demo |

Planning range: 15-24 months with a commercial go/no-go checkpoint after Milestone 3.

## Campaign Shape

### Meridian Compact

| Mission | Status | Purpose |
| --- | --- | --- |
| First Contact | Existing, revise | Controls, economy, wrap, first Node, favorable artillery direction |
| Break the Line | Existing, revise | Established base, scouting, two-front movement, artillery positioning |
| Counterfire | Existing, revise | Power, interception, ammunition counters, threat telegraphing |
| A Signal in the Spine | Existing, revise | Bulwark escort, Needle threat, land transport, final-correction evidence |
| The Shadow Front | New | Inhabited-arc defense, strikecraft, anti-air, shadow timing, an authenticated Spinal Node pair |
| Anchor the Living | New | Multi-front Spinal Alignment objective supporting Anchor, air transport, capture versus loss of control |

### Axiom Choir

| Mission | Purpose |
| --- | --- |
| The Listening Arc | Sensing, rapid construction, fragile-force preservation, Needle reconnaissance |
| Against the Spin | Relocation after fire and favorable-direction attacks |
| The Weight We Shed | Land transports, archives, evacuees, and dismantling choices |
| Beneath the Shadow | Sensor resilience, strikecraft, anti-air route planning |
| What We Carry | Air transport and evacuation through contested paired-node territory |
| Migration Window | Distributed launch defense and a multi-front Spinal Alignment objective supporting Migration |

## Environment Direction

Four palettes make the ring inhabited without requiring twelve unrelated maps:

- Arc-City Habitat: occupied towers, shelter lights, transit viaducts, civic infrastructure.
- Agricultural Canopy: engineered vegetation, terraces, water channels, farm machinery.
- Spinal/Industrial Corridor: power trunks, maintenance stations, gantries, salvage yards.
- Breach and Evacuation Zone: seal walls, exposed scrith, ruined blocks, abandoned convoys.

Density is implemented in three scales: overhead landmarks, tactical silhouettes, and bounded micro-detail. The first pass remains presentation-only. Collision, cover, LOS, and salvage are added only to explicit authored landmarks after readability and performance pass.

## Physics Guardrails

- Preserve the canonical 3.6 km radius, 6 m/s² floor gravity, and exact inertial-frame ballistic solver.
- Do not use constant-Coriolis trajectory approximations.
- Ammunition differs through velocity, drag, thrust, staging, fuse, and payload; mass does not change Coriolis acceleration.
- Spinward travel increases floorward loading and antispinward travel reduces it.
- Units auto-compensate for routine rotating-frame motion; players make strategic route and firing decisions.
- The whole-ring view uses a simplified strategic annulus rather than rendering every tactical entity.

## Validation Gates

- Four of five uncoached novices identify and exploit the favorable artillery direction after onboarding.
- Four of five novices complete the tutorial arc without external coaching.
- Blind testers describe the factions' strategic difference after one mission per side.
- Every standard mission has visible phase changes and at least two tested approaches where intended.
- Every battlefield view contains a legible district function, landmark, vegetation, or habitation.
- Air/cargo tests cover altitude, domains, interception, embarkation, destruction, landing, AI, and save/load.
- The accepted T480s 720p Low performance contract remains intact.
- Release artifacts reproduce from a tagged commit and pass save migration, offline startup, recovery, and rollback checks.

## Research Basis

- NASA, artificial gravity fundamentals: https://ntrs.nasa.gov/api/citations/20070001008/downloads/20070001008.pdf
- Age of Empires IV campaign/onboarding interview: https://news.xbox.com/en-us/2021/04/10/age-of-empires-4-interview/
- Tutorial failure modes: https://www.gamedeveloper.com/design/the-designer-s-notebook-eight-ways-to-make-a-bad-tutorial
- Dynamic RTS map elements: https://www.gamedeveloper.com/design/dynamic-map-elements-in-rts-games
- Planetary Annihilation curved-geometry implementation: https://allenchou.net/2013/07/bending-solid-geometry-in-planetary-annihilation/
- Steam Next Fest guidance: https://partner.steamgames.com/doc/marketing/upcoming_events/nextfest/tips

Secondary comparisons are used as design analysis rather than universal proof: Homeworld persistence, Grey Goo faction systems, Company of Heroes map readability, StarCraft II mission variety, Supreme Commander strategic zoom, and Command & Conquer dual campaigns.

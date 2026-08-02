# Ring World War — Visual & Art Direction

## 0. The Governing Principle
**Browser games don't lose to AAA on polygon count — they lose on lighting, coherence, and post.** Every decision below optimizes for *perceived* fidelity per byte and per millisecond. A consistent, well-lit, well-graded scene with 200k triangles beats an incoherent one with 5 million.

> **Hard constraint: everything is procedural.** No downloaded models, textures, or audio. This is a feature, not a handicap — procedural generation forces exactly the coherence that makes scenes look expensive, and it means the whole game ships in a few hundred kilobytes. Where this document says "texture" or "model," read "generated in code." Implementation details live in `docs/procedural-assets.md`.

Three rules:
1. **Coherence over detail.** One lighting model, one material system, one color script. No asset ships that wasn't authored against the shared PBR calibration scene.
2. **Silhouette first.** At RTS zoom the player sees shapes, not normal maps. Budget art effort into readable silhouettes and faction color, then surface detail.
3. **The ring is the hero.** Every frame should be able to answer "where am I?" by looking up.

## 1. Signature Visual Identity
The one screenshot that sells the game: a mech lance silhouetted on a ruined plain, rocket contrails arcing overhead, and behind them the ring surface **sweeping up into the sky on both sides**, hazing into atmospheric blue, with the far side visible as a bright band overhead crossed by the dark bars of shadow squares.

**Mood board anchors:** *Halo* (ring vista, hopeful scale), *Homeworld: Deserts of Kharak* (readable RTS terrain, warm dust, clean UI), *Elysium* / *Oblivion* (clean megastructure industrialism), *Titanfall* (mech weight and scale), Simon Stålenhag (mundane machines in vast landscapes).

## 2. Color Script
- **Environment base:** desaturated warm greys, bone, oxidized copper, dust ochre. Terrain is deliberately low-chroma so units read.
- **Faction accents:** Meridian Compact = amber `#F0821E`; Axiom Choir = cyan `#3FD0E8`. **Only** factions get saturated color. This is a hard rule — it makes threat assessment instant.
- **Energy/danger:** white-hot cores, magenta warning telegraphs (impact zones), never used for anything else.
- **Sky:** the ring's inner surface reads as a pale luminous band; open space beyond the rim is near-black with stars — a strong value contrast that frames the play space.
- **Day/night:** shadow-square bands sweep the map, shifting the key light from warm sun to cool starlight + emissive base lighting. Night is *legible*, never murky — raise ambient and lean on emissives.

## 3. Lighting Model
- **PBR metal/rough** throughout. Single calibration scene (`/dev/calibration`) with a chrome ball, grey ball, macbeth chart, and reference mech — all art validated against it.
- **Key light:** directional "sun" with CSM (cascaded shadow maps, 3–4 cascades tuned for RTS zoom range). Cascade splits recomputed on zoom, not per frame.
- **Sky/bounce:** custom procedural sky + IBL. The environment map must include the ring arc itself — bounce light from the far side of the ring is a real, and gorgeous, phenomenon. Bake to a small cubemap, update it only when the day/night phase advances.
- **Emissives:** every faction structure and mech has emissive strips that carry faction color into bloom. This is the cheapest AAA-look lever available and should be used aggressively.
- **Local lights:** strictly budgeted — clustered forward shading; muzzle flashes and explosions get short-lived pooled point lights (cap ~32 active).
- **Shadows:** CSM for sun; no shadows from local lights (use baked contact shadows / blob-plus-SSAO instead).

## 4. Atmosphere — the make-or-break system
Distance haze is what sells the 22.6 km ring as a world rather than a curved arena. Non-negotiable:
- **Aerial perspective / height fog** with a physically-motivated falloff, tinted by sun angle. Distant ring surface fades into the sky color and becomes indistinguishable from the horizon — this is what makes the curve feel enormous instead of like a curved plane.
- **Volumetric light shafts** (cheap raymarched, half-res, temporally jittered) at shadow-square boundaries — the terminator line sweeping across the map with god rays is a signature moment.
- **Dust & particulate:** always-present drifting motes near camera, dust plumes from mech footsteps, smoke that persists in battle zones. Motion in the air = alive.

## 5. Post-Processing Roadmap
Gate 1 deliberately uses stable forward rendering with ACES after the composer prototype intermittently produced black frames. The following stack is a post-Gate-1 roadmap and must return behind a direct-render fallback with browser regression coverage:
1. TAA (temporal AA — also amortizes our volumetrics and SSAO)
2. SSAO (GTAO-style, half-res, bilateral upsample)
3. SSR — **only** on wet/metal ground surfaces, quality-gated off on low presets
4. Bloom (physically-weighted, multi-mip; feeds off emissives and explosions)
5. Motion blur — camera only, subtle, off by default in tactical view
6. Depth of field — only in direct-mech and cinematic cameras, never in tactical
7. Chromatic aberration + lens distortion — trace amounts, near screen edges only
8. Film grain (very light) + vignette
9. **Color grading via 3D LUT** — the single highest-impact item on this list. Author LUTs in a real grading tool; ship a day LUT and a night LUT and cross-fade with the shadow-square phase.

Quality presets (Low/Medium/High/Ultra) gate: SSR, volumetrics resolution, shadow cascade count/resolution, TAA vs FXAA, particle density, LOD bias. **The game must look intentional on Low, not just degraded** — Low keeps grading, bloom, and fog; it drops SSR, volumetrics, and shadow resolution.

## 6. Terrain
- Clipmap/quadtree LOD terrain wrapped onto the ring cylinder; heights from a compressed heightfield + runtime detail noise.
- **Triplanar splat blending** across 4–6 materials (dust, cracked scrith, rubble, metal decking, vegetation patch) with height-based blending (not linear lerp — height blending is what makes splat maps stop looking like splat maps).
- Detail normal + roughness layers fading in at close range so the ground survives direct-mech camera height.
- **Scatter system:** GPU-instanced rocks/debris/ruin props with density maps and distance-based LOD/fade. Thousands of instances, a handful of draw calls.
- Decals: crater decals, scorch, tread/footprint marks, all deferred-style projected decals with a pooled budget.

## 7. Characters — Mechs & Structures
- **Poly budget:** hero mech 40–60k tris with 3 LODs (LOD2 ≈ 3k for zoomed-out crowds) + an imposter/billboard tier for extreme distance.
- **Texture strategy:** trim sheets + a shared faction material atlas rather than unique 4K sets per unit. Unique-ish look comes from decals and color masks, not unique textures. Everything KTX2/Basis compressed.
- **Modularity:** shared skeleton per mech weight class; weapons and armor as attachable sockets. This is how you get roster breadth without art blowout.
- **Damage:** vertex-color / mask-driven damage layers (scorch → exposed frame → glowing internals) blended by a per-instance damage float. No separate damage meshes.
- **Animation:** authored locomotion set + runtime **foot IK** on the terrain, torso/turret aim blending (upper body aims while legs walk), procedural recoil, and hydraulic settle on stop. Weight comes from IK and secondary motion, not from more keyframes.
- **Instancing:** all units drawn via instanced meshes with per-instance color/damage attributes; skinning via GPU skinning with a shared bone texture where possible.

## 8. VFX
- **Rockets:** GPU-particle exhaust plumes, ribbon contrails that *persist and slowly disperse* (contrails crossing the sky are a core visual motif and a gameplay tell), stage-separation flashes, terminal-phase glow.
- **Explosions:** flipbook-sprite fireballs + real light flash + shockwave distortion ring + physics debris + a lingering smoke column. The light flash is what makes explosions feel real — never skip it.
- **Impacts:** decal + dust puff + spark shower, scaled by ordnance size.
- **Chord shots:** a full-screen event — a bright lance crossing the sky, sky brightening, audio drop-out, then a distant flash on the far ring surface *before* the shockwave audio arrives. Sell the scale with light-lag.
- **Shields:** fresnel-rim hex-pattern hits, not full-cover bubbles (they hide the mech silhouette).

## 9. UI / HUD
Diegetic-adjacent, not fantasy-ornate. Thin strokes, high contrast, faction-tinted, generous negative space. Think *Deserts of Kharak* meets modern flight-sim HUD.
- Tactical HUD: minimal bottom command bar, right-side minimap that is a **ring-strip** (unwrapped cylinder) — the minimap itself teaches the topology.
- World-space UI: selection rings that hug terrain curvature, health arcs, trajectory ribbons, impact ellipses.
- Direct-control HUD: reticle with lead indicator, heat/ammo, torso-vs-legs orientation indicator (critical for mech feel), damage direction arcs.
- Typography: one condensed technical sans; numbers tabular; never more than 3 sizes on screen.
- **Readability gate:** at max zoom-out the player must identify faction, unit class, and health of every visible unit within one second. Test this explicitly.

## 10. Camera & Composition
- Tactical camera has a **tilt-with-zoom** curve: zoomed in it's near-top-down and functional; zoomed out it tilts up so the ring arc enters frame. The game's beauty shot is a normal part of play, not a cutscene.
- Subtle camera shake on nearby impacts, hard shake on chord strikes, footstep thump when a heavy mech passes near.
- Cinematic camera mode for screenshots/trailers: DoF, longer lens, letterbox.

## 11. Asset Pipeline

The current product has no external asset pipeline: meshes, materials, textures, animation, and audio remain generated in code under the procedural-only rule.

A Blender → glTF 2.0 → `gltf-transform` → KTX2/Basis workflow is a **proposed future option**, not an active roadmap commitment. Adopting it would require an explicit product decision to relax `docs/spec.md`'s zero-binary-asset constraint, followed by naming, download-budget, calibration-scene, and CI rules. Until that decision is recorded, `.blend`, `.glb`, and authored texture files must not be added.

## 12. Audio Direction (brief)
Mix is 40% of perceived polish. Layered mech foley (servo + hydraulic + footfall + armor rattle), distance-attenuated and delayed rocket booms (sound arrives late from far impacts — free realism), and an adaptive score that swells on engagement. Positional audio via WebAudio panner nodes; a hard voice/SFX/music bus structure with ducking.

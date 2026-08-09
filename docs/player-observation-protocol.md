# Player Observation Protocol

## Purpose

Use this protocol to gather directional-artillery comprehension evidence from the
human developer and an initial uncoached human tester. It is an observation
guide, not telemetry. The launcher writes only local files under ignored
`output/runs/`; it does not collect or transmit tester data.

## Start The Session

1. Assign an anonymous local tester ID. Do not put names, contact details, recordings, or other personal data in the notes. Record the developer review separately without identifying the developer.
2. Run `npm run rww -- play directional-artillery`.
3. Give the tester control when Chromium opens. Do not explain spinward, antispinward, the minimap footprint, or the Siege Mortar workflow.
4. Observe first actions and spoken reasoning. Avoid leading questions or pointing at controls.
5. End by closing the browser/page or pressing Ctrl+C. Open the printed `playtest-notes.md` path and record observations locally.

Use `--seconds N` only when the session has a predetermined observation window. Use `--headless --seconds 2` only for automated smoke verification, never as human evidence.

## Five Questions

Ask these after the tester has had an uncoached attempt. Record their words rather than translating them into game terminology.

1. Which direction lets this launcher shoot farther?
2. Which side of the target is the favorable firing position, and why?
3. Is the minimap footprint exact or approximate, and what determines whether the shot can actually fire?
4. What do the footprint halves wrapping across the joined minimap edges represent?
5. Without coaching, can the tester deploy the Longbow, find Siege Mortar, preview a shot, and fire?

## Initial Cohort And Required Notes

G-01 requires one developer review and one uncoached human tester. Both must
demonstrate the five criteria in `docs/directional-artillery-prototype.md`.
After reviewing those results, the developer may require one to three more
uncoached testers when clarification, pacing, or comprehension remains in doubt.

Record the anonymous tester ID, whether the task was completed, confusion points, chosen route/direction, and the tester's unprompted explanation of the artillery advantage. Note whether any moderator prompt was necessary. Do not infer comprehension from task completion alone.

Assess results against the five human success criteria in `docs/directional-artillery-prototype.md`. The developer decides whether an observed issue requires the optional additional cohort before accepting the gate. Failure on direction identification or seam interpretation should prompt communication changes before balance or physics changes.

## Reproduction And Privacy

Keep the generated receipt and notes together. The receipt contains scenario and artifact hashes, browser/hardware identity, duration, local game state summaries, and browser errors so the setup can be reproduced. Review the notes for accidental personal data before sharing them manually. Nothing is uploaded automatically.

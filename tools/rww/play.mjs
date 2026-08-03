export function waitForPlaySession({ page, browser, seconds, signals = process }) {
  return new Promise((resolve) => {
    let timer;
    const finish = (reason) => {
      if (timer !== undefined) clearTimeout(timer);
      page.removeListener('close', pageClosed);
      browser.removeListener('disconnected', browserClosed);
      signals.removeListener('SIGINT', interrupted);
      signals.removeListener('SIGTERM', interrupted);
      resolve(reason);
    };
    const pageClosed = () => finish('page-closed');
    const browserClosed = () => finish('browser-closed');
    const interrupted = () => finish('interrupted');
    page.once('close', pageClosed);
    browser.once('disconnected', browserClosed);
    signals.once('SIGINT', interrupted);
    signals.once('SIGTERM', interrupted);
    if (seconds !== null) timer = setTimeout(() => finish('timeout'), seconds * 1000);
  });
}

export function buildPlaytestNotes({ scenarioId, reproductionCommand }) {
  let questions;
  if (scenarioId === 'first-contact') {
    questions = `## First Contact Questions

1. Was the objective sequence clear without coaching?
   - Observation/answer:
2. Could the tester establish power, salvage income, and mech production?
   - Observation/answer:
3. Did moving the Wisp to the Spinal Node make capture and sensor reveal understandable?
   - Observation/answer:
4. Could the tester deploy the Longbow and resolve any blocked preview from the status text?
   - Observation/answer:
5. Why was the antispinward firing position favorable?
   - Observation/answer:`;
  } else if (scenarioId === 'break-the-line') {
    questions = `## Break the Line Questions

1. Time to first contact:
   - Observation/answer:
2. Which stretches felt like travel without a meaningful decision?
   - Observation/answer:
3. Did scouting, defence, artillery positioning, assault, and consolidation form a coherent loop?
   - Observation/answer:
4. Which objective created the most idle time or unclear pressure?
   - Observation/answer:
5. Should movement speed remain unchanged, increase slightly, or be reconsidered after another run?
   - Observation/answer:`;
  } else if (scenarioId === 'counterfire') {
    questions = `## Counterfire Questions

1. Was the relationship between power reserve and interception clear?
   - Observation/answer:
2. Did activating Umbrella feel like an intentional defensive decision?
   - Observation/answer:
3. Was it clear why the Standard Rocket failed against the Laser Grid?
   - Observation/answer:
4. Was switching to Cruise Missile discoverable without coaching?
   - Observation/answer:
5. Which debrief statistic best explained the outcome?
   - Observation/answer:`;
  } else if (scenarioId === 'a-signal-in-the-spine') {
    questions = `## A Signal in the Spine Questions

1. Did the briefing establish the objective without overexplaining the setting?
   - Observation/answer:
2. Did the Bulwark feel meaningfully different from the Vanguard during the escort?
   - Observation/answer:
3. Were cloaked Needles readable and threatening without feeling arbitrary?
   - Observation/answer:
4. Was the Migration Protocol transmission understandable during play?
   - Observation/answer:
5. Did the final one-operation revelation create a clear reason to continue?
   - Observation/answer:`;
  } else {
    questions = `## Directional-Artillery Questions

1. Which direction lets this launcher shoot farther?
   - Observation/answer:
2. Which side of the target is the favorable firing position, and why?
   - Observation/answer:
3. Is the minimap footprint exact or approximate, and what determines whether the shot can actually fire?
   - Observation/answer:
4. What do the footprint halves wrapping across the joined minimap edges represent?
   - Observation/answer:
5. Without coaching, can the tester deploy the Longbow, find Siege Mortar, preview a shot, and fire?
   - Observation/answer:`;
  }
  return `# Ring World War Playtest Notes

- Scenario: ${scenarioId}
- Tester ID: [anonymous/local identifier]
- Completed: [yes/no]
- Reproduction: \`${reproductionCommand}\`

${questions}

## Session Observations

- Confusion points:
- Chosen route/direction:
- Unprompted explanation of the artillery advantage:
- Completion notes:

This file stays local beside the run receipt. The launcher does not collect or transmit playtest data.
`;
}

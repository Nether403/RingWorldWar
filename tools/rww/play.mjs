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
  return `# Ring World War Playtest Notes

- Scenario: ${scenarioId}
- Tester ID: [anonymous/local identifier]
- Completed: [yes/no]
- Reproduction: \`${reproductionCommand}\`

## Directional-Artillery Questions

1. Which direction lets this launcher shoot farther?
   - Observation/answer:
2. Which side of the target is the favorable firing position, and why?
   - Observation/answer:
3. Is the minimap footprint exact or approximate, and what determines whether the shot can actually fire?
   - Observation/answer:
4. What do the footprint halves wrapping across the joined minimap edges represent?
   - Observation/answer:
5. Without coaching, can the tester deploy the Longbow, find Siege Mortar, preview a shot, and fire?
   - Observation/answer:

## Session Observations

- Confusion points:
- Chosen route/direction:
- Unprompted explanation of the artillery advantage:
- Completion notes:

This file stays local beside the run receipt. The launcher does not collect or transmit playtest data.
`;
}

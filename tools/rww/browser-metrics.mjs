export function percentile(values, quantile) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction;
}

export function summarizeFrameMetrics(intervals, sampleSeconds, render = [], simulation = [], fullFrame = []) {
  const over100 = intervals.filter((value) => value > 100).length;
  return {
    samples: intervals.length,
    sampleSeconds,
    medianFrameMilliseconds: round(percentile(intervals, 0.5)),
    p95FrameMilliseconds: round(percentile(intervals, 0.95)),
    p99FrameMilliseconds: round(percentile(intervals, 0.99)),
    over100MillisecondsCount: over100,
    over100MillisecondsPerMinute: round(over100 * 60 / sampleSeconds),
    renderMilliseconds: distribution(render),
    simulationMilliseconds: distribution(simulation),
    fullFrameMilliseconds: distribution(fullFrame),
  };
}

export function evaluateBrowserBudget(metrics, budget) {
  const failures = [];
  const targetFrame = 1000 / budget.targetFps;
  if (metrics.medianFrameMilliseconds > targetFrame) failures.push(`median ${metrics.medianFrameMilliseconds}ms exceeds ${round(targetFrame)}ms`);
  if (budget.maximumP95FrameMilliseconds !== undefined && metrics.p95FrameMilliseconds > budget.maximumP95FrameMilliseconds) failures.push(`p95 ${metrics.p95FrameMilliseconds}ms exceeds ${budget.maximumP95FrameMilliseconds}ms`);
  if (budget.maximumP99FrameMilliseconds !== undefined && metrics.p99FrameMilliseconds > budget.maximumP99FrameMilliseconds) failures.push(`p99 ${metrics.p99FrameMilliseconds}ms exceeds ${budget.maximumP99FrameMilliseconds}ms`);
  const hard = budget.classification === 'candidate-hard';
  return { id: budget.id, classification: budget.classification, status: failures.length === 0 ? 'pass' : hard ? 'fail' : 'warn', failures };
}

function distribution(values) {
  return { median: round(percentile(values, 0.5)), p95: round(percentile(values, 0.95)), p99: round(percentile(values, 0.99)) };
}
function round(value) { return value === null ? null : Number(value.toFixed(3)); }

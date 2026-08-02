export function computeVisualSignature(pixels, width, height, regions, options = {}) {
  if (!(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) throw new Error('RGBA pixel buffer size does not match dimensions');
  const gridColumns = options.gridColumns ?? 8;
  const gridRows = options.gridRows ?? 6;
  const luminance = new Float64Array(width * height);
  const chroma = new Float64Array(width * height);
  const histogram = Array(16).fill(0);
  let sum = 0;
  let sumSquares = 0;
  let chromaSum = 0;
  for (let index = 0; index < width * height; index++) {
    const offset = index * 4;
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    luminance[index] = luma;
    chroma[index] = saturation;
    sum += luma;
    sumSquares += luma * luma;
    chromaSum += saturation;
    histogram[Math.min(15, Math.floor(luma / 16))]++;
  }
  const count = width * height;
  const mean = sum / count;
  return {
    schema: 'rww.visual-signature',
    version: 1,
    width,
    height,
    meanLuminance: round(mean),
    luminanceVariance: round(sumSquares / count - mean * mean),
    meanChroma: round(chromaSum / count),
    luminanceChromaGrid: buildGrid(luminance, chroma, width, height, gridColumns, gridRows),
    histogram: histogram.map((value) => round(value / count, 8)),
    edgeDensity: round(edgeDensity(luminance, width, height)),
    perceptualHash: averageHash(luminance, width, height),
    differenceHash: differenceHash(luminance, width, height),
    regions: Object.fromEntries(regions.map((region) => [region.id, regionStats(region, luminance, chroma, width, height)])),
  };
}

export function compareVisualSignatures(actual, expected, tolerances) {
  const checks = [
    check('meanLuminance', Math.abs(actual.meanLuminance - expected.meanLuminance), tolerances.maximumMeanLuminanceDelta),
    check('meanChroma', Math.abs(actual.meanChroma - expected.meanChroma), tolerances.maximumMeanChromaDelta),
    check('histogramL1', actual.histogram.reduce((sum, value, index) => sum + Math.abs(value - expected.histogram[index]), 0), tolerances.maximumHistogramL1),
    check('edgeDensity', Math.abs(actual.edgeDensity - expected.edgeDensity), tolerances.maximumEdgeDensityDelta),
    check('perceptualHash', hamming(actual.perceptualHash, expected.perceptualHash), tolerances.maximumPerceptualHashHamming),
    check('differenceHash', hamming(actual.differenceHash, expected.differenceHash), tolerances.maximumDifferenceHashHamming),
  ];
  for (const [id, region] of Object.entries(actual.regions)) {
    if (expected.regions?.[id]) checks.push(check(
      `region:${id}:meanLuminance`, Math.abs(region.meanLuminance - expected.regions[id].meanLuminance),
      tolerances.maximumRegionMeanLuminanceDelta,
    ));
  }
  return { status: checks.every((item) => item.status === 'pass') ? 'pass' : 'fail', checks };
}

function buildGrid(luminance, chroma, width, height, columns, rows) {
  const result = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const x0 = Math.floor(column * width / columns);
    const x1 = Math.max(x0 + 1, Math.floor((column + 1) * width / columns));
    const y0 = Math.floor(row * height / rows);
    const y1 = Math.max(y0 + 1, Math.floor((row + 1) * height / rows));
    let l = 0; let c = 0; let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * width + x; l += luminance[i]; c += chroma[i]; n++; }
    result.push({ luminance: round(l / n), chroma: round(c / n) });
  }
  return { columns, rows, cells: result };
}

function regionStats(region, luminance, chroma, width, height) {
  const x0 = Math.floor(region.x * width); const x1 = Math.max(x0 + 1, Math.ceil((region.x + region.width) * width));
  const y0 = Math.floor(region.y * height); const y1 = Math.max(y0 + 1, Math.ceil((region.y + region.height) * height));
  let sum = 0; let squares = 0; let c = 0; let n = 0;
  for (let y = y0; y < Math.min(height, y1); y++) for (let x = x0; x < Math.min(width, x1); x++) {
    const i = y * width + x; sum += luminance[i]; squares += luminance[i] ** 2; c += chroma[i]; n++;
  }
  const mean = sum / n;
  return { kind: region.kind, meanLuminance: round(mean), luminanceVariance: round(squares / n - mean ** 2), meanChroma: round(c / n) };
}

function edgeDensity(luminance, width, height) {
  if (width < 2 || height < 2) return 0;
  let edges = 0; let count = 0;
  for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
    const i = y * width + x;
    if (Math.hypot(luminance[i + 1] - luminance[i], luminance[i + width] - luminance[i]) >= 24) edges++;
    count++;
  }
  return edges / count;
}

function averageHash(values, width, height) {
  const sample = resample(values, width, height, 8, 8);
  const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length;
  return bitsToHex(sample.map((value) => value >= mean));
}
function differenceHash(values, width, height) {
  const sample = resample(values, width, height, 9, 8);
  const bits = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(sample[y * 9 + x] > sample[y * 9 + x + 1]);
  return bitsToHex(bits);
}
function resample(values, width, height, outWidth, outHeight) {
  const result = [];
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    const sourceX = Math.min(width - 1, Math.floor((x + 0.5) * width / outWidth));
    const sourceY = Math.min(height - 1, Math.floor((y + 0.5) * height / outHeight));
    result.push(values[sourceY * width + sourceX]);
  }
  return result;
}
function bitsToHex(bits) { let value = ''; for (let i = 0; i < bits.length; i += 4) { let nibble = 0; for (let j = 0; j < 4; j++) if (bits[i + j]) nibble |= 1 << (3 - j); value += nibble.toString(16); } return value; }
function hamming(left, right) { let count = 0; for (let i = 0; i < left.length; i++) { let value = Number.parseInt(left[i], 16) ^ Number.parseInt(right[i], 16); while (value) { count += value & 1; value >>>= 1; } } return count; }
function check(id, actual, maximum) { return { id, actual: round(actual), maximum, status: maximum === undefined || actual <= maximum ? 'pass' : 'fail' }; }
function round(value, digits = 6) { return Number(value.toFixed(digits)); }

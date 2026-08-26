/**
 * Generated colour-grading lookup tables.
 *
 * `docs/art-direction.md` section 5 calls grading the single highest-impact item
 * on the post list, and `docs/procedural-assets.md` forbids shipping a LUT as a
 * committed binary. Both are satisfied by building the tables from analytic
 * curves at load: no asset, no download, and the grade is reviewable as code
 * rather than as an opaque cube file.
 *
 * WHY A 2D STRIP RATHER THAN A 3D TEXTURE
 *
 * A `Data3DTexture` would be the obvious container, but sampling one needs
 * `sampler3D`, which does not exist in GLSL ES 1.00. Using it would force the
 * composite material to GLSL3 and split the shader set across two language
 * versions for one lookup. Instead each table is laid out as 32 slices side by
 * side in a 1024x32 2D texture and interpolated along blue in the shader. This is
 * the long-standing portable form of the same thing.
 *
 * The tables operate on display-referred values, so they are applied after ACES
 * and after the sRGB encode, which is the same place a grade sits in a film
 * pipeline.
 */

import * as THREE from 'three';

/** Slices per axis. 32 is the usual quality floor for a grade of this strength. */
export const LUT_SIZE = 32;

export type GradeKind = 'day' | 'night';

/**
 * Lift, gamma, gain per channel, plus saturation.
 *
 * Expressed as plain numbers rather than as a curve editor because the whole
 * point is that a reviewer can read the intent off the page: `lift` moves the
 * blacks, `gain` moves the whites, `gamma` bends the middle.
 */
interface GradeCurve {
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  saturation: number;
  /** Pulls the very darkest values up, so shade stays readable. */
  shadowFloor: number;
}

/**
 * Day: warm highlights, faintly cool shadows, mild contrast.
 *
 * Restrained on saturation because `docs/art-direction.md` section 2 reserves
 * saturated colour for factions, and a global saturation push would put chroma
 * back into the terrain the section explicitly wants low-chroma.
 */
const DAY: GradeCurve = {
  lift: [-0.006, -0.004, 0.004],
  gamma: [0.98, 1.0, 1.03],
  gain: [1.06, 1.015, 0.95],
  saturation: 1.04,
  shadowFloor: 0.004,
};

/**
 * Night: cool, and deliberately lifted rather than crushed.
 *
 * Section 2 requires that night be legible and never murky. The instinct for a
 * night grade is to crush the blacks, which would hide exactly the terrain and
 * unit silhouettes the player still needs to read, so this raises the floor and
 * lets the emissive strips carry the contrast instead. Saturation comes down so
 * faction colour remains the brightest chroma in frame.
 */
const NIGHT: GradeCurve = {
  lift: [0.012, 0.020, 0.044],
  gamma: [1.06, 1.03, 0.94],
  gain: [0.84, 0.90, 1.04],
  saturation: 0.86,
  shadowFloor: 0.030,
};

const CURVES: Record<GradeKind, GradeCurve> = { day: DAY, night: NIGHT };

const LUMA = [0.2126, 0.7152, 0.0722] as const;

function applyCurve(curve: GradeCurve, rgb: [number, number, number]): [number, number, number] {
  const graded: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel++) {
    let value = rgb[channel]!;
    // Lift the floor before anything else, so the raise survives the gamma bend.
    value = curve.shadowFloor + value * (1 - curve.shadowFloor);
    value += curve.lift[channel]!;
    value = Math.max(value, 0);
    value = value ** curve.gamma[channel]!;
    value *= curve.gain[channel]!;
    graded[channel] = value;
  }

  const luminance = graded[0] * LUMA[0] + graded[1] * LUMA[1] + graded[2] * LUMA[2];
  for (let channel = 0; channel < 3; channel++) {
    graded[channel] = luminance + (graded[channel]! - luminance) * curve.saturation;
    graded[channel] = Math.min(1, Math.max(0, graded[channel]!));
  }
  return graded;
}

/**
 * Build one grade as a horizontal strip of `LUT_SIZE` slices.
 *
 * Red runs along x within a slice, green along y, and blue selects the slice.
 * Deterministic by construction: the same kind always produces identical bytes,
 * which `tests/render/grading.test.ts` asserts.
 */
export function createGradeLut(kind: GradeKind): THREE.DataTexture {
  const curve = CURVES[kind];
  const width = LUT_SIZE * LUT_SIZE;
  const data = new Uint8Array(width * LUT_SIZE * 4);
  const maximum = LUT_SIZE - 1;

  for (let blue = 0; blue < LUT_SIZE; blue++) {
    for (let green = 0; green < LUT_SIZE; green++) {
      for (let red = 0; red < LUT_SIZE; red++) {
        const graded = applyCurve(curve, [red / maximum, green / maximum, blue / maximum]);
        const x = blue * LUT_SIZE + red;
        const offset = (green * width + x) * 4;
        data[offset] = Math.round(graded[0] * 255);
        data[offset + 1] = Math.round(graded[1] * 255);
        data[offset + 2] = Math.round(graded[2] * 255);
        data[offset + 3] = 255;
      }
    }
  }

  const texture = new THREE.DataTexture(data, width, LUT_SIZE, THREE.RGBAFormat);
  texture.name = `rww-grade-${kind}`;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  // Unmanaged: these are already display-referred values and must not be decoded
  // on sample. The composite owns every transform.
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Strip-LUT sampling, with manual interpolation along blue.
 *
 * The half-texel insets are load-bearing. Sampling a strip at the raw normalised
 * coordinate bleeds the neighbouring slice in at the edges of every cell, which
 * shows up as banded colour fringing on smooth gradients like the sky.
 */
export const GRADE_GLSL = /* glsl */ `
  #define RWW_LUT_SIZE ${LUT_SIZE}.0

  vec3 rww_sampleGrade(sampler2D lut, vec3 color) {
    color = clamp(color, 0.0, 1.0);
    float sliceWidth = 1.0 / RWW_LUT_SIZE;
    float texelWidth = sliceWidth / RWW_LUT_SIZE;

    float blueScaled = color.b * (RWW_LUT_SIZE - 1.0);
    float slice = floor(blueScaled);
    float sliceBlend = blueScaled - slice;

    // Inset by half a texel at both ends so red never samples across a slice edge.
    float redOffset = texelWidth * 0.5 + color.r * (texelWidth * (RWW_LUT_SIZE - 1.0));
    float greenOffset = (0.5 + color.g * (RWW_LUT_SIZE - 1.0)) / RWW_LUT_SIZE;

    vec2 lowUv = vec2(slice * sliceWidth + redOffset, greenOffset);
    vec2 highUv = vec2(min(slice + 1.0, RWW_LUT_SIZE - 1.0) * sliceWidth + redOffset, greenOffset);
    return mix(texture2D(lut, lowUv).rgb, texture2D(lut, highUv).rgb, sliceBlend);
  }
`;

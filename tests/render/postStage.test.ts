import { describe, expect, it } from 'vitest';
import { PostStage } from '../../src/render/postStage';

/**
 * Target lifecycle is the whole reason this stage exists as its own unit.
 *
 * The composer removed at Gate 1 leaked eleven bloom targets every time it was
 * rebuilt, and nothing failed until memory climbed. These tests make an
 * allocation a counted, asserted event. They run without a WebGL context because
 * `WebGLRenderTarget` is only a descriptor until something renders to it, which
 * is exactly the property being checked.
 */
/** HDR scene target, five bloom mips, and two half-resolution occlusion buffers. */
const TARGETS = 8;

describe('PostStage target lifecycle', () => {
  it('allocates one target and resizes it in place', () => {
    const stage = new PostStage();
    stage.setSize(1100, 640);
    expect(stage.diagnostics()).toMatchObject({ allocations: TARGETS, live: TARGETS, width: 1100, height: 640 });

    // A resize storm must not allocate. This is the leak canary.
    for (let index = 0; index < 40; index++) stage.setSize(1100 + index, 640 + (index % 7));
    const after = stage.diagnostics();
    expect(after.allocations).toBe(TARGETS);
    expect(after.live).toBe(TARGETS);
    expect(after.width).toBe(1139);

    stage.dispose();
    expect(stage.diagnostics()).toMatchObject({ allocations: TARGETS, disposals: TARGETS, live: 0 });
  });

  it('ignores a repeated size without touching the target', () => {
    const stage = new PostStage();
    stage.setSize(800, 600);
    stage.setSize(800, 600);
    stage.setSize(800, 600);
    expect(stage.diagnostics().allocations).toBe(TARGETS);
    stage.dispose();
  });

  it('clamps degenerate sizes rather than allocating a zero-area target', () => {
    const stage = new PostStage();
    stage.setSize(0, 0);
    expect(stage.diagnostics()).toMatchObject({ width: 2, height: 2, allocations: TARGETS });
    stage.dispose();
  });

  it('drops handles on context loss and reallocates exactly once afterwards', () => {
    const stage = new PostStage();
    stage.setSize(1100, 640);
    expect(stage.diagnostics().allocations).toBe(TARGETS);

    // Deletes must not be issued against a lost context, so the target is
    // released by dropping the reference rather than by disposing it.
    stage.handleContextLoss();
    expect(stage.diagnostics()).toMatchObject({ live: 0, contextLost: true, disposals: 0 });

    stage.setSize(1100, 640);
    const restored = stage.diagnostics();
    expect(restored.allocations).toBe(TARGETS * 2);
    expect(restored.live).toBe(TARGETS);
    expect(restored.contextLost).toBe(false);

    stage.dispose();
    expect(stage.diagnostics()).toMatchObject({ allocations: TARGETS * 2, disposals: TARGETS, live: 0 });
  });

  it('reports a multisampled target with a depth texture attached', () => {
    const stage = new PostStage();
    stage.setSize(640, 480);
    const diagnostics = stage.diagnostics();
    // Multisampling replaces the antialiasing the default framebuffer gave for
    // free once rendering moves off it.
    expect(diagnostics.samples).toBe(4);
    // Attached in Task 2 so the resolve path is proven before Task 4's ambient
    // occlusion depends on it.
    expect(diagnostics.hasDepthTexture).toBe(true);
    expect(stage.depthTexture).not.toBeNull();
    stage.dispose();
    expect(stage.depthTexture).toBeNull();
  });

  it('survives disposal without a prior size', () => {
    const stage = new PostStage();
    expect(() => stage.dispose()).not.toThrow();
    expect(stage.diagnostics()).toMatchObject({ allocations: 0, disposals: 0, live: 0 });
  });
});

describe('PostStage bloom chain', () => {
  it('builds a halving mip chain that never collapses below one texel', () => {
    const stage = new PostStage();
    stage.setSize(1100, 640);
    const diagnostics = stage.diagnostics();
    expect(diagnostics.bloomLevels).toBe(5);
    // 1100 -> 550, 275, 137, 68, 34 and 640 -> 320, 160, 80, 40, 20.
    expect(diagnostics.smallestBloom).toEqual({ width: 34, height: 20 });
    stage.dispose();
  });

  it('keeps the smallest mip valid at a degenerate drawing-buffer size', () => {
    const stage = new PostStage();
    // A 2x2 buffer would drive a five-level chain to zero without the floor,
    // which produces an invalid framebuffer rather than a small one.
    stage.setSize(2, 2);
    const diagnostics = stage.diagnostics();
    expect(diagnostics.bloomLevels).toBe(5);
    expect(diagnostics.smallestBloom.width).toBeGreaterThanOrEqual(1);
    expect(diagnostics.smallestBloom.height).toBeGreaterThanOrEqual(1);
    stage.dispose();
  });

  it('resizes the whole chain in place without reallocating', () => {
    const stage = new PostStage();
    stage.setSize(1100, 640);
    stage.setSize(1920, 1080);
    const diagnostics = stage.diagnostics();
    expect(diagnostics.allocations).toBe(TARGETS);
    expect(diagnostics.smallestBloom).toEqual({ width: 60, height: 33 });
    stage.dispose();
  });

  it('clamps a negative bloom strength rather than inverting the composite', () => {
    const stage = new PostStage();
    stage.setSize(64, 64);
    expect(() => stage.setBloomStrength(-4)).not.toThrow();
    stage.dispose();
  });
});

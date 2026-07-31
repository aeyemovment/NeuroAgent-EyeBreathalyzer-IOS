import { describe, it, expect } from 'vitest';
import {
  computeVideoRenderRect,
  isCropActive,
  computeCenterOffset,
  computeMinEyeEdgeMargin,
} from '../framingGeometry';

describe('computeVideoRenderRect', () => {
  it('fills completely when aspect ratios match (16:9 in 16:9)', () => {
    const rect = computeVideoRenderRect(1280, 720, 1280, 720);
    expect(rect).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });

  it('letterboxes left/right for 4:3 video in 16:9 container', () => {
    const rect = computeVideoRenderRect(1280, 720, 640, 480);
    // 4:3 video (1.333) in 16:9 container (1.778) → video taller → pillarbox
    expect(rect.y).toBe(0);
    expect(rect.h).toBe(720);
    expect(rect.w).toBeLessThan(1280);
    expect(rect.x).toBeGreaterThan(0);
    // Video render width = 720 * (640/480) = 960
    expect(rect.w).toBeCloseTo(960, 0);
    expect(rect.x).toBeCloseTo(160, 0);
  });

  it('letterboxes top/bottom for 16:9 video in 4:3 container', () => {
    const rect = computeVideoRenderRect(960, 720, 1280, 720);
    // 16:9 video (1.778) in 4:3 container (1.333) → video wider → letterbox
    expect(rect.x).toBe(0);
    expect(rect.w).toBe(960);
    expect(rect.h).toBeLessThan(720);
    expect(rect.y).toBeGreaterThan(0);
    // Video render height = 960 / (1280/720) = 540
    expect(rect.h).toBeCloseTo(540, 0);
    expect(rect.y).toBeCloseTo(90, 0);
  });

  it('returns full container rect for zero video dimensions', () => {
    const rect = computeVideoRenderRect(1280, 720, 0, 0);
    expect(rect).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });

  it('render rect never exceeds container bounds', () => {
    const rect = computeVideoRenderRect(1280, 720, 640, 480);
    expect(rect.x + rect.w).toBeLessThanOrEqual(1280);
    expect(rect.y + rect.h).toBeLessThanOrEqual(720);
  });
});

describe('isCropActive', () => {
  it('returns false when aspect ratios match', () => {
    expect(isCropActive(1280, 720, 1920, 1080)).toBe(false);
  });

  it('returns true when aspect ratios differ', () => {
    expect(isCropActive(1280, 720, 640, 480)).toBe(true);
  });

  it('returns false for zero video dimensions', () => {
    expect(isCropActive(1280, 720, 0, 0)).toBe(false);
  });
});

describe('computeCenterOffset', () => {
  it('returns 0 for perfectly centered nose', () => {
    expect(computeCenterOffset(0.5, 0.5)).toBe(0);
  });

  it('returns positive value for off-center nose', () => {
    expect(computeCenterOffset(0.3, 0.5)).toBeGreaterThan(0);
  });

  it('is symmetric horizontally', () => {
    const left = computeCenterOffset(0.3, 0.5);
    const right = computeCenterOffset(0.7, 0.5);
    expect(left).toBeCloseTo(right);
  });

  it('returns ~0.707 for extreme corner', () => {
    expect(computeCenterOffset(0, 0)).toBeCloseTo(Math.SQRT2 / 2, 3);
  });
});

describe('computeMinEyeEdgeMargin', () => {
  it('returns reasonable margin for centered corners', () => {
    const corners = [
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.4 },
    ];
    expect(computeMinEyeEdgeMargin(corners)).toBeCloseTo(0.4);
  });

  it('returns small value when corner near edge', () => {
    const corners = [
      { x: 0.02, y: 0.5 },
      { x: 0.6, y: 0.5 },
    ];
    expect(computeMinEyeEdgeMargin(corners)).toBeCloseTo(0.02);
  });

  it('returns 0 for empty array', () => {
    expect(computeMinEyeEdgeMargin([])).toBe(0);
  });
});

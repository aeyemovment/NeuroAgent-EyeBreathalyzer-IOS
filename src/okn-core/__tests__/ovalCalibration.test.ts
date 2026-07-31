import { describe, it, expect } from 'vitest';
import {
  computeOvalTargets,
  checkEyeOvalFit,
  irisInRange,
  medianEyeSpan,
  computeHintLayout,
  crosshairOpacity,
  crosshairPositions,
  HINT_MAX_WIDTH_FRAC,
  CROSSHAIR_FADE_MS,
  CROSSHAIR_SIZE_FRAC,
  CROSSHAIR_GAP_FRAC,
  TARGET_IRIS_SIZE,
  IRIS_SIZE_TOLERANCE,
  OVAL_WIDTH_FRAC,
  OVAL_SEPARATION_FRAC,
  OVAL_CENTER_Y_FRAC,
  OVAL_ASPECT,
  OVAL_REQUIRED_STABLE,
} from '../ovalCalibration';

// ---------------------------------------------------------------------------
// computeOvalTargets — canvas-relative sizing (kept for reference/future use)
// ---------------------------------------------------------------------------

describe('computeOvalTargets', () => {
  it('returns two ovals', () => {
    const { left, right } = computeOvalTargets(800, 600);
    expect(left).toBeDefined();
    expect(right).toBeDefined();
  });

  it('ovals are horizontally symmetric around canvas center', () => {
    const { left, right } = computeOvalTargets(800, 600);
    expect(left.cx + right.cx).toBeCloseTo(800, 3);
  });

  it('oval width scales with canvas width', () => {
    const small = computeOvalTargets(400, 300);
    const large = computeOvalTargets(1200, 900);
    expect(large.left.rx / small.left.rx).toBeCloseTo(3, 1);
  });

  it('ovals do not overlap', () => {
    const { left, right } = computeOvalTargets(800, 600);
    const gap = right.cx - right.rx - (left.cx + left.rx);
    expect(gap).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// irisInRange — same distance gate as old calibration
// ---------------------------------------------------------------------------

describe('irisInRange', () => {
  it('passes at exact target size', () => {
    expect(irisInRange(TARGET_IRIS_SIZE)).toBe(true);
  });

  it('passes at lower bound', () => {
    expect(irisInRange(TARGET_IRIS_SIZE - IRIS_SIZE_TOLERANCE)).toBe(true);
  });

  it('passes at upper bound', () => {
    expect(irisInRange(TARGET_IRIS_SIZE + IRIS_SIZE_TOLERANCE)).toBe(true);
  });

  it('fails when too small (too far)', () => {
    expect(irisInRange(TARGET_IRIS_SIZE - IRIS_SIZE_TOLERANCE - 0.005)).toBe(false);
  });

  it('fails when too large (too close)', () => {
    expect(irisInRange(TARGET_IRIS_SIZE + IRIS_SIZE_TOLERANCE + 0.005)).toBe(false);
  });

  it('matches old calibration range [0.05, 0.07]', () => {
    expect(irisInRange(0.05)).toBe(true);
    expect(irisInRange(0.07)).toBe(true);
    expect(irisInRange(0.04)).toBe(false);
    expect(irisInRange(0.08)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// medianEyeSpan
// ---------------------------------------------------------------------------

describe('medianEyeSpan', () => {
  it('returns median of an odd-length array', () => {
    expect(medianEyeSpan([0.08, 0.06, 0.10, 0.07, 0.09])).toBeCloseTo(0.08, 5);
  });

  it('returns average of two middle values for even-length', () => {
    expect(medianEyeSpan([0.06, 0.08, 0.10, 0.12])).toBeCloseTo(0.09, 5);
  });

  it('returns 0 for empty array', () => {
    expect(medianEyeSpan([])).toBe(0);
  });

  it('is robust to outliers', () => {
    const spans = [0.08, 0.08, 0.08, 0.50, 0.08, 0.08, 0.08, 0.08, 0.08];
    expect(medianEyeSpan(spans)).toBeCloseTo(0.08, 2);
  });
});

// ---------------------------------------------------------------------------
// computeHintLayout — pill never exceeds max fraction of box
// ---------------------------------------------------------------------------

describe('computeHintLayout', () => {
  // Typical ratio: "Move closer" at 14px is ~7 chars * ~0.55 = 3.85 per font px
  const typicalRatio = 5.5; // textWidth / fontSize for "Move closer"

  it('pill width never exceeds HINT_MAX_WIDTH_FRAC of box width', () => {
    for (const boxW of [200, 400, 800, 1600]) {
      const layout = computeHintLayout(0, 0, boxW, boxW * 0.6, typicalRatio);
      expect(layout.pillW).toBeLessThanOrEqual(boxW * HINT_MAX_WIDTH_FRAC + 1);
    }
  });

  it('font size scales down on small boxes to stay within limit', () => {
    const small = computeHintLayout(0, 0, 200, 120, typicalRatio);
    const large = computeHintLayout(0, 0, 1600, 960, typicalRatio);
    expect(small.fontSize).toBeLessThan(large.fontSize);
  });

  it('text is centered horizontally in the box', () => {
    const layout = computeHintLayout(50, 20, 800, 600, typicalRatio);
    expect(layout.textX).toBeCloseTo(50 + 800 / 2, 1);
  });

  it('text is near the top of the box', () => {
    const layout = computeHintLayout(0, 100, 800, 600, typicalRatio);
    // textY should be within top 15% of box
    expect(layout.textY).toBeLessThan(100 + 600 * 0.15);
  });

  it('font size has a reasonable minimum', () => {
    const layout = computeHintLayout(0, 0, 50, 30, typicalRatio);
    expect(layout.fontSize).toBeGreaterThanOrEqual(10);
  });

  it('works with long text (higher ratio)', () => {
    const longRatio = 12; // e.g. "Center your face in the box"
    const layout = computeHintLayout(0, 0, 400, 300, longRatio);
    expect(layout.pillW).toBeLessThanOrEqual(400 * HINT_MAX_WIDTH_FRAC + 1);
  });
});

// ---------------------------------------------------------------------------
// crosshairOpacity — fade timing
// ---------------------------------------------------------------------------

describe('crosshairOpacity', () => {
  it('returns 1 at t=0', () => {
    expect(crosshairOpacity(0)).toBe(1);
  });

  it('returns 1 during the hold period (first 60%)', () => {
    expect(crosshairOpacity(CROSSHAIR_FADE_MS * 0.5)).toBe(1);
  });

  it('returns 0 at t=CROSSHAIR_FADE_MS', () => {
    expect(crosshairOpacity(CROSSHAIR_FADE_MS)).toBe(0);
  });

  it('returns 0 after CROSSHAIR_FADE_MS', () => {
    expect(crosshairOpacity(CROSSHAIR_FADE_MS + 1000)).toBe(0);
  });

  it('fades linearly between hold and end', () => {
    const midFade = CROSSHAIR_FADE_MS * 0.8; // midpoint of the 60%-100% fade region
    const opacity = crosshairOpacity(midFade);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
    expect(opacity).toBeCloseTo(0.5, 1);
  });

  it('returns 1 for negative elapsed', () => {
    expect(crosshairOpacity(-100)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// crosshairPositions — placed at horizontal thirds
// ---------------------------------------------------------------------------

describe('crosshairPositions', () => {
  it('places left at 1/3 and right at 2/3 horizontally', () => {
    const { left, right } = crosshairPositions(900, 600);
    expect(left.x).toBeCloseTo(300, 1);
    expect(right.x).toBeCloseTo(600, 1);
  });

  it('places both at vertical center', () => {
    const { left, right } = crosshairPositions(900, 600);
    expect(left.y).toBeCloseTo(300, 1);
    expect(right.y).toBeCloseTo(300, 1);
  });

  it('scales with canvas size', () => {
    const small = crosshairPositions(300, 200);
    const large = crosshairPositions(1200, 800);
    expect(large.left.x).toBeCloseTo(small.left.x * 4, 1);
  });
});

// ---------------------------------------------------------------------------
// Crosshair constants
// ---------------------------------------------------------------------------

describe('crosshair constants', () => {
  it('CROSSHAIR_FADE_MS is 3-5 seconds', () => {
    expect(CROSSHAIR_FADE_MS).toBeGreaterThanOrEqual(3000);
    expect(CROSSHAIR_FADE_MS).toBeLessThanOrEqual(5000);
  });

  it('CROSSHAIR_SIZE_FRAC is a small fraction of canvas', () => {
    expect(CROSSHAIR_SIZE_FRAC).toBeGreaterThan(0.02);
    expect(CROSSHAIR_SIZE_FRAC).toBeLessThan(0.15);
  });
});

// ---------------------------------------------------------------------------
// Constants sanity checks
// ---------------------------------------------------------------------------

describe('calibration constants', () => {
  it('iris range matches old calibration (0.05-0.07)', () => {
    expect(TARGET_IRIS_SIZE - IRIS_SIZE_TOLERANCE).toBeCloseTo(0.05, 5);
    expect(TARGET_IRIS_SIZE + IRIS_SIZE_TOLERANCE).toBeCloseTo(0.07, 5);
  });

  it('OVAL_SEPARATION_FRAC keeps ovals apart', () => {
    expect(OVAL_SEPARATION_FRAC).toBeGreaterThan(OVAL_WIDTH_FRAC);
  });

  it('OVAL_REQUIRED_STABLE is reasonable', () => {
    expect(OVAL_REQUIRED_STABLE).toBeGreaterThanOrEqual(5);
    expect(OVAL_REQUIRED_STABLE).toBeLessThanOrEqual(10);
  });
});

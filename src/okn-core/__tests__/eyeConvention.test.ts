import { describe, it, expect } from 'vitest';
import { selectEye, normalizeEyeX } from '../eyeConvention';

/**
 * Tests use REALISTIC MediaPipe Face Mesh coordinates:
 * - Subject's LEFT eye (L_IRIS 468-471) is at camera-RIGHT → higher x (~0.55-0.65)
 * - Subject's RIGHT eye (R_IRIS 473-476) is at camera-LEFT → lower x (~0.35-0.45)
 *
 * MediaPipe landmarks are labeled from the SUBJECT's perspective.
 *
 * CRITICAL: "Leftward tracking" = user follows leftward stimulus = user's eyes look LEFT.
 * Camera faces the user, so user's LEFT = camera-RIGHT = HIGHER camera x for iris.
 */

describe('selectEye', () => {
  it('selects "right" when right iris is closer to x=0.5', () => {
    // Right iris at 0.45 (dist=0.05), left iris at 0.58 (dist=0.08) → 'right'
    expect(selectEye(0.58, 0.45)).toBe('right');
  });

  it('selects "left" when left iris is closer to x=0.5', () => {
    // Left iris at 0.52 (dist=0.02), right iris at 0.35 (dist=0.15) → 'left'
    expect(selectEye(0.52, 0.35)).toBe('left');
  });

  it('selects "left" on exact tie (equal distance)', () => {
    // Left at 0.58 (dist=0.08), right at 0.42 (dist=0.08) → tie → 'left'
    expect(selectEye(0.58, 0.42)).toBe('left');
  });

  it('label refers to anatomical eye — "right" eye is at camera-LEFT (lower x)', () => {
    // Subject's RIGHT eye: R_IRIS at camera-LEFT x≈0.42
    // When right is selected, the returned label = 'right' = anatomical, NOT camera side
    const result = selectEye(0.60, 0.45);
    expect(result).toBe('right');
  });
});

describe('normalizeEyeX', () => {
  it('returns 0 when iris is centered between corners', () => {
    // Left eye: iris at midpoint between corners
    const result = normalizeEyeX(0.58, 0.54, 0.62);
    expect(result).toBeCloseTo(0, 5);
  });

  it('returns negative when iris tracks leftward stimulus (higher camera-x)', () => {
    // Leftward tracking: user looks LEFT = camera sees iris at HIGHER x
    // Left eye: iris shifted toward outer corner (higher x = 0.61)
    const result = normalizeEyeX(0.61, 0.54, 0.62);
    expect(result).toBeLessThan(0);
  });

  it('returns positive when iris tracks rightward (lower camera-x)', () => {
    // Rightward tracking: user looks RIGHT = camera sees iris at LOWER x
    // Left eye: iris shifted toward inner corner (lower x = 0.55)
    const result = normalizeEyeX(0.55, 0.54, 0.62);
    expect(result).toBeGreaterThan(0);
  });

  it('returns 0 when span is zero', () => {
    expect(normalizeEyeX(0.5, 0.5, 0.5)).toBe(0);
  });
});

describe('eye polarity consistency', () => {
  // Realistic MediaPipe coords:
  // Subject's LEFT eye at camera-RIGHT: cornerIn=0.54, cornerOut=0.62, center=0.58
  // Subject's RIGHT eye at camera-LEFT: cornerIn=0.46, cornerOut=0.38, center=0.42

  it('both eyes produce same sign for same gaze direction', () => {
    // Leftward tracking: iris moves to HIGHER camera-x (user looks left)
    // Left eye: iris toward outer corner (higher x) = 0.61
    const leftVal = normalizeEyeX(0.61, 0.54, 0.62);
    // Right eye: iris toward inner corner (higher x for right eye) = 0.45
    const rightVal = normalizeEyeX(0.45, 0.46, 0.38);
    expect(Math.sign(leftVal)).toBe(Math.sign(rightVal));
  });

  it('both eyes produce NEGATIVE values for leftward tracking', () => {
    // Leftward stimulus: user's eyes follow LEFT = iris at higher camera-x
    // Left eye: iris at 0.61 (near outer corner at 0.62)
    const leftVal = normalizeEyeX(0.61, 0.54, 0.62);
    // Right eye: iris at 0.45 (near inner corner at 0.46)
    const rightVal = normalizeEyeX(0.45, 0.46, 0.38);
    expect(leftVal).toBeLessThan(0);
    expect(rightVal).toBeLessThan(0);
  });
});

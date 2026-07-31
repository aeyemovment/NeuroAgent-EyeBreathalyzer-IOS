import { describe, it, expect } from 'vitest';
import {
  bothEyesVisible,
  faceInSafeZone,
  faceCentering,
  headPoseCheck,
  motionStability,
  calibrationCoach,
  MIN_EYE_SPAN_NORM,
  SAFE_ZONE_X_MIN,
  SAFE_ZONE_X_MAX,
  SAFE_ZONE_Y_MIN,
  SAFE_ZONE_Y_MAX,
  CENTER_ZONE_X_MIN,
  CENTER_ZONE_X_MAX,
  CENTER_ZONE_Y_MIN,
  CENTER_ZONE_Y_MAX,
  YAW_LIMIT_NORM,
  NOSE_MOTION_SIGMA_MAX,
  type CalibrationFrame,
  type Landmark,
} from '../calibrationChecks';

// Helper: build a centered, well-framed CalibrationFrame
function goodFrame(overrides: Partial<CalibrationFrame> = {}): CalibrationFrame {
  return {
    leftCornerIn: { x: 0.45, y: 0.4 },
    leftCornerOut: { x: 0.35, y: 0.4 },
    rightCornerIn: { x: 0.55, y: 0.4 },
    rightCornerOut: { x: 0.65, y: 0.4 },
    nose: { x: 0.5, y: 0.55 },
    forehead: { x: 0.5, y: 0.3 },
    chin: { x: 0.5, y: 0.75 },
    faceEdgeL: { x: 0.3, y: 0.5 },
    faceEdgeR: { x: 0.7, y: 0.5 },
    ...overrides,
  };
}

// Helper: stable nose positions (low variance)
function stableNosePositions(n = 10): Landmark[] {
  return Array.from({ length: n }, (_, i) => ({
    x: 0.5 + (i % 2 === 0 ? 0.001 : -0.001),
    y: 0.5 + (i % 2 === 0 ? 0.0005 : -0.0005),
  }));
}

// Helper: shaky nose positions (high variance)
function shakyNosePositions(n = 10): Landmark[] {
  return Array.from({ length: n }, (_, i) => ({
    x: 0.5 + (i % 2 === 0 ? 0.02 : -0.02),
    y: 0.5 + (i % 2 === 0 ? 0.015 : -0.015),
  }));
}

describe('bothEyesVisible', () => {
  it('passes when both eye spans > MIN_EYE_SPAN_NORM', () => {
    const result = bothEyesVisible(goodFrame());
    expect(result.pass).toBe(true);
  });

  it('fails when left eye span < MIN_EYE_SPAN_NORM', () => {
    const frame = goodFrame({
      leftCornerIn: { x: 0.41, y: 0.4 },
      leftCornerOut: { x: 0.40, y: 0.4 }, // span = 0.01 < 0.035
    });
    const result = bothEyesVisible(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Left eye');
  });

  it('fails when right eye span < MIN_EYE_SPAN_NORM', () => {
    const frame = goodFrame({
      rightCornerIn: { x: 0.55, y: 0.4 },
      rightCornerOut: { x: 0.56, y: 0.4 }, // span = 0.01 < 0.035
    });
    const result = bothEyesVisible(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Right eye');
  });

  it('fails when landmarks are null', () => {
    const frame = goodFrame({ leftCornerIn: null });
    const result = bothEyesVisible(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('not fully detected');
  });

  it('reports both eyes too small when both spans tiny', () => {
    const frame = goodFrame({
      leftCornerIn: { x: 0.41, y: 0.4 },
      leftCornerOut: { x: 0.40, y: 0.4 },
      rightCornerIn: { x: 0.55, y: 0.4 },
      rightCornerOut: { x: 0.56, y: 0.4 },
    });
    const result = bothEyesVisible(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Both eyes');
  });
});

describe('faceInSafeZone', () => {
  it('passes when nose is centered', () => {
    const result = faceInSafeZone(goodFrame());
    expect(result.pass).toBe(true);
  });

  it('hints "Move left" when nose at low camera-x (selfie mirror: display-right)', () => {
    const frame = goodFrame({ nose: { x: 0.05, y: 0.5 } });
    const result = faceInSafeZone(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Move left');
  });

  it('hints "Move right" when nose at high camera-x (selfie mirror: display-left)', () => {
    const frame = goodFrame({ nose: { x: 0.95, y: 0.5 } });
    const result = faceInSafeZone(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Move right');
  });

  it('hints "Move down" when nose too high', () => {
    const frame = goodFrame({ nose: { x: 0.5, y: 0.05 } });
    const result = faceInSafeZone(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Move down');
  });

  it('hints "Move up" when nose too low', () => {
    const frame = goodFrame({ nose: { x: 0.5, y: 0.95 } });
    const result = faceInSafeZone(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Move up');
  });

  it('fails when nose is null', () => {
    const frame = goodFrame({ nose: null });
    const result = faceInSafeZone(frame);
    expect(result.pass).toBe(false);
  });

  it('combines hints for corner position', () => {
    const frame = goodFrame({ nose: { x: 0.05, y: 0.95 } });
    const result = faceInSafeZone(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Move left');
    expect(result.hint).toContain('Move up');
  });
});

describe('faceCentering', () => {
  it('passes when nose is centered', () => {
    const result = faceCentering(goodFrame());
    expect(result.pass).toBe(true);
  });

  it('fails with "Move left" when nose at x=0.15 (inside safe zone, outside center zone)', () => {
    const frame = goodFrame({ nose: { x: 0.15, y: 0.5 } });
    const result = faceCentering(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Move left');
  });

  it('fails with "Move right" when nose at x=0.85', () => {
    const frame = goodFrame({ nose: { x: 0.85, y: 0.5 } });
    const result = faceCentering(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Move right');
  });

  it('fails with "Move down" when nose at y=0.15', () => {
    const frame = goodFrame({ nose: { x: 0.5, y: 0.15 } });
    const result = faceCentering(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Move down');
  });

  it('fails with "Move up" when nose at y=0.85', () => {
    const frame = goodFrame({ nose: { x: 0.5, y: 0.85 } });
    const result = faceCentering(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Move up');
  });

  it('passes at exact boundary x=0.25 (strict < comparison)', () => {
    const frame = goodFrame({ nose: { x: 0.25, y: 0.5 } });
    const result = faceCentering(frame);
    expect(result.pass).toBe(true);
  });

  it('passes at exact boundary x=0.75 (strict > comparison)', () => {
    const frame = goodFrame({ nose: { x: 0.75, y: 0.5 } });
    const result = faceCentering(frame);
    expect(result.pass).toBe(true);
  });

  it('fails when nose is null', () => {
    const frame = goodFrame({ nose: null });
    const result = faceCentering(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Face not detected');
  });

  it('prefixes hint with "Center your face:"', () => {
    const frame = goodFrame({ nose: { x: 0.15, y: 0.5 } });
    const result = faceCentering(frame);
    expect(result.hint).toMatch(/^Center your face:/);
  });
});

describe('headPoseCheck', () => {
  it('passes with centered face', () => {
    const result = headPoseCheck(goodFrame());
    expect(result.pass).toBe(true);
  });

  it('fails with excessive yaw — nose camera-right of center → Turn head right', () => {
    // Nose at camera-right → mirror-left → user facing their left → turn right to straighten
    const frame = goodFrame({
      nose: { x: 0.65, y: 0.55 },
      faceEdgeL: { x: 0.3, y: 0.5 },
      faceEdgeR: { x: 0.7, y: 0.5 },
    });
    const result = headPoseCheck(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Turn head right');
  });

  it('fails with excessive yaw — nose camera-left of center → Turn head left', () => {
    // Nose at camera-left → mirror-right → user facing their right → turn left to straighten
    const frame = goodFrame({
      nose: { x: 0.35, y: 0.55 },
      faceEdgeL: { x: 0.3, y: 0.5 },
      faceEdgeR: { x: 0.7, y: 0.5 },
    });
    const result = headPoseCheck(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Turn head left');
  });

  it('fails when required landmarks missing', () => {
    const frame = goodFrame({ faceEdgeL: null });
    const result = headPoseCheck(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Not enough landmarks');
  });

  it('detects pitch when head tilted down', () => {
    // Nose at 80% of face height (normally ~60%), deviation = 0.2 > 0.10
    const frame = goodFrame({
      nose: { x: 0.5, y: 0.66 },  // (0.66-0.3)/(0.75-0.3) = 0.8, deviation = 0.2
      forehead: { x: 0.5, y: 0.3 },
      chin: { x: 0.5, y: 0.75 },
    });
    const result = headPoseCheck(frame);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Tilt head up');
  });
});

describe('motionStability', () => {
  it('passes with stable positions', () => {
    const result = motionStability(stableNosePositions());
    expect(result.pass).toBe(true);
  });

  it('fails with shaky positions', () => {
    const result = motionStability(shakyNosePositions());
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Hold as steady as you can');
  });

  it('fails with too few samples', () => {
    const result = motionStability([{ x: 0.5, y: 0.5 }]);
    expect(result.pass).toBe(false);
    expect(result.hint).toContain('Stabilizing');
  });
});

describe('calibrationCoach', () => {
  it('returns empty array when all checks pass', () => {
    const messages = calibrationCoach(goodFrame(), stableNosePositions());
    expect(messages).toHaveLength(0);
  });

  it('returns messages in priority order', () => {
    // Missing eye + shaky + off-center
    const frame = goodFrame({
      leftCornerIn: null,
      nose: { x: 0.05, y: 0.5 },
    });
    const messages = calibrationCoach(frame, shakyNosePositions());
    expect(messages.length).toBeGreaterThan(0);
    // bothEyes (priority 1) should be first
    expect(messages[0].criterion).toBe('bothEyes');
    // Verify sorted by priority
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].priority).toBeGreaterThanOrEqual(messages[i - 1].priority);
    }
  });

  it('includes safeZone when nose off-center', () => {
    const frame = goodFrame({ nose: { x: 0.05, y: 0.5 } });
    const messages = calibrationCoach(frame, stableNosePositions());
    const zoneMsg = messages.find(m => m.criterion === 'safeZone');
    expect(zoneMsg).toBeDefined();
    expect(zoneMsg!.message).toContain('Move left');
  });

  it('includes motionStability when shaky', () => {
    const messages = calibrationCoach(goodFrame(), shakyNosePositions());
    const motionMsg = messages.find(m => m.criterion === 'motionStability');
    expect(motionMsg).toBeDefined();
    expect(motionMsg!.message).toContain('Hold as steady as you can');
  });

  it('includes faceCentering at priority 2.5 when nose outside center zone but inside safe zone', () => {
    // x=0.15 is inside safe zone [0.15, 0.85] but outside center zone [0.25, 0.75]
    const frame = goodFrame({ nose: { x: 0.15, y: 0.5 } });
    const messages = calibrationCoach(frame, stableNosePositions());
    const centerMsg = messages.find(m => m.criterion === 'faceCentering');
    expect(centerMsg).toBeDefined();
    expect(centerMsg!.priority).toBe(2.5);
    expect(centerMsg!.message).toContain('Center your face');
    // safeZone should NOT fire (x=0.15 is at boundary, passes with >=)
    const zoneMsg = messages.find(m => m.criterion === 'safeZone');
    expect(zoneMsg).toBeUndefined();
  });
});

describe('mirror convention', () => {
  it('hint directions account for CSS scaleX(-1) selfie mirror', () => {
    // Low camera-x → display-right (mirror) → user physically right → move left to center
    const lowX = faceInSafeZone(goodFrame({ nose: { x: 0.05, y: 0.5 } }));
    expect(lowX.hint).toContain('Move left');

    // High camera-x → display-left (mirror) → user physically left → move right to center
    const highX = faceInSafeZone(goodFrame({ nose: { x: 0.95, y: 0.5 } }));
    expect(highX.hint).toContain('Move right');

    // faceCentering uses same convention
    const lowXCenter = faceCentering(goodFrame({ nose: { x: 0.15, y: 0.5 } }));
    expect(lowXCenter.hint).toContain('Move left');
    const highXCenter = faceCentering(goodFrame({ nose: { x: 0.85, y: 0.5 } }));
    expect(highXCenter.hint).toContain('Move right');
  });
});

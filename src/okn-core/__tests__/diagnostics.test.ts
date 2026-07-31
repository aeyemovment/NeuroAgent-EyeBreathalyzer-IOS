import { describe, it, expect } from 'vitest';
import {
  deriveCalibrationFailureCodes,
  deriveQualityFailureCodes,
  buildCalibrationDiagnostic,
  buildTestQualityDiagnostic,
  buildFramingGeometry,
  buildTransformMetadata,
  buildSessionDiagnostic,
  summarizeDiagnostic,
  type CriterionResult,
  type FailureCode,
  type CalibrationDiagnostic,
  type TestQualityDiagnostic,
  type FramingGeometry,
  type TransformMetadata,
  type SessionDiagnostic,
} from '../diagnostics';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function passingCriterion(criterion: string): CriterionResult {
  return { criterion: criterion as CriterionResult['criterion'], pass: true };
}

function failingCriterion(
  criterion: string,
  hint: string,
): CriterionResult {
  return { criterion: criterion as CriterionResult['criterion'], pass: false, hint };
}

function goodQuality(): TestQualityDiagnostic {
  return buildTestQualityDiagnostic(true, 0.85, 12, 0.35, 59, 'right', 0.9, 0.88);
}

function goodCalibration(): CalibrationDiagnostic {
  return buildCalibrationDiagnostic(true, 30, 30, 5000, [
    passingCriterion('bothEyes'),
    passingCriterion('safeZone'),
    passingCriterion('faceCentering'),
    passingCriterion('headPose'),
    passingCriterion('motionStability'),
    passingCriterion('irisSize'),
  ]);
}

function goodFraming(): FramingGeometry {
  return buildFramingGeometry(0.5, 0.5, [
    { x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 },
  ], false, { x: 0, y: 0, w: 375, h: 667 });
}

function goodTransform(): TransformMetadata {
  return buildTransformMetadata(true, 'right', 'contain', 1280, 720, 375, 667);
}

// ---------------------------------------------------------------------------
// deriveCalibrationFailureCodes
// ---------------------------------------------------------------------------

describe('deriveCalibrationFailureCodes', () => {
  it('returns empty array for empty criteria', () => {
    expect(deriveCalibrationFailureCodes([])).toEqual([]);
  });

  it('returns empty array when all criteria pass', () => {
    const criteria = [
      passingCriterion('bothEyes'),
      passingCriterion('safeZone'),
      passingCriterion('faceCentering'),
      passingCriterion('headPose'),
      passingCriterion('motionStability'),
      passingCriterion('irisSize'),
    ];
    expect(deriveCalibrationFailureCodes(criteria)).toEqual([]);
  });

  it('maps bothEyes + "Left" hint to EYE_OCCLUDED_LEFT', () => {
    const criteria = [failingCriterion('bothEyes', 'Left eye partially hidden')];
    expect(deriveCalibrationFailureCodes(criteria)).toEqual(['EYE_OCCLUDED_LEFT']);
  });

  it('maps bothEyes + "Right" hint to EYE_OCCLUDED_RIGHT', () => {
    const criteria = [failingCriterion('bothEyes', 'Right eye partially hidden')];
    expect(deriveCalibrationFailureCodes(criteria)).toEqual(['EYE_OCCLUDED_RIGHT']);
  });

  it('maps bothEyes + "Both" hint to EYES_TOO_SMALL', () => {
    const criteria = [failingCriterion('bothEyes', 'Both eyes too small -- move closer')];
    expect(deriveCalibrationFailureCodes(criteria)).toEqual(['EYES_TOO_SMALL']);
  });

  it('maps faceCentering fail to FACE_OFF_CENTER', () => {
    const criteria = [failingCriterion('faceCentering', 'Center your face: Move left')];
    expect(deriveCalibrationFailureCodes(criteria)).toEqual(['FACE_OFF_CENTER']);
  });

  it('maps safeZone fail to FACE_OUT_OF_ZONE', () => {
    const criteria = [failingCriterion('safeZone', 'Move left, Move up')];
    expect(deriveCalibrationFailureCodes(criteria)).toEqual(['FACE_OUT_OF_ZONE']);
  });

  it('maps headPose + "Turn" hint to HEAD_YAW', () => {
    const criteria = [failingCriterion('headPose', 'Turn head right')];
    expect(deriveCalibrationFailureCodes(criteria)).toEqual(['HEAD_YAW']);
  });

  it('maps headPose + "Tilt" hint to HEAD_PITCH', () => {
    const criteria = [failingCriterion('headPose', 'Tilt head up')];
    expect(deriveCalibrationFailureCodes(criteria)).toEqual(['HEAD_PITCH']);
  });

  it('maps motionStability fail to MOTION_UNSTABLE', () => {
    const criteria = [failingCriterion('motionStability', 'Hold as steady as you can')];
    expect(deriveCalibrationFailureCodes(criteria)).toEqual(['MOTION_UNSTABLE']);
  });

  it('maps irisSize + "closer" hint to IRIS_TOO_SMALL', () => {
    const criteria = [failingCriterion('irisSize', 'Move closer')];
    expect(deriveCalibrationFailureCodes(criteria)).toEqual(['IRIS_TOO_SMALL']);
  });

  it('maps irisSize + "farther" hint to IRIS_TOO_LARGE', () => {
    const criteria = [failingCriterion('irisSize', 'Move farther')];
    expect(deriveCalibrationFailureCodes(criteria)).toEqual(['IRIS_TOO_LARGE']);
  });

  it('handles multiple failures — returns correct code for each', () => {
    const criteria = [
      failingCriterion('bothEyes', 'Left eye partially hidden'),
      failingCriterion('faceCentering', 'Center your face: Move left'),
      failingCriterion('headPose', 'Turn head right'),
    ];
    const codes = deriveCalibrationFailureCodes(criteria);
    expect(codes).toContain('EYE_OCCLUDED_LEFT');
    expect(codes).toContain('FACE_OFF_CENTER');
    expect(codes).toContain('HEAD_YAW');
    expect(codes).toHaveLength(3);
  });

  // Ambiguity guard: faceCentering hint contains "left" but should NOT map to EYE_OCCLUDED_LEFT
  it('does NOT produce EYE_OCCLUDED_LEFT for faceCentering hint containing "left"', () => {
    const criteria = [failingCriterion('faceCentering', 'Center your face: Move left')];
    const codes = deriveCalibrationFailureCodes(criteria);
    expect(codes).not.toContain('EYE_OCCLUDED_LEFT');
    expect(codes).toEqual(['FACE_OFF_CENTER']);
  });

  // Unknown criterion: gracefully ignored
  it('ignores unknown criterion names', () => {
    const criteria = [failingCriterion('unknownCheck' as any, 'Something happened')];
    expect(deriveCalibrationFailureCodes(criteria)).toEqual([]);
  });

  // bothEyes with generic hint (no Left/Right/Both keyword)
  it('maps bothEyes with generic hint to CALIBRATION_INCOMPLETE', () => {
    const criteria = [failingCriterion('bothEyes', 'Face not fully detected')];
    expect(deriveCalibrationFailureCodes(criteria)).toEqual(['CALIBRATION_INCOMPLETE']);
  });

  // Default fallback paths for unmatched hint text
  it('maps headPose with generic hint to HEAD_YAW (default)', () => {
    const criteria = [failingCriterion('headPose', 'Look straight ahead')];
    expect(deriveCalibrationFailureCodes(criteria)).toEqual(['HEAD_YAW']);
  });

  it('maps irisSize with generic hint to IRIS_TOO_SMALL (default)', () => {
    const criteria = [failingCriterion('irisSize', 'Adjust distance')];
    expect(deriveCalibrationFailureCodes(criteria)).toEqual(['IRIS_TOO_SMALL']);
  });
});

// ---------------------------------------------------------------------------
// deriveQualityFailureCodes
// ---------------------------------------------------------------------------

describe('deriveQualityFailureCodes', () => {
  it('returns empty array when all metrics are good', () => {
    expect(deriveQualityFailureCodes(goodQuality())).toEqual([]);
  });

  it('returns LOW_USABLE_FRAMES when usableFraction < 0.6', () => {
    const q = buildTestQualityDiagnostic(false, 0.4, 12, 0.35, 59, 'right', 0.5, 0.3);
    expect(deriveQualityFailureCodes(q)).toContain('LOW_USABLE_FRAMES');
  });

  it('returns INSUFFICIENT_SEGMENTS when segmentCount < 6', () => {
    const q = buildTestQualityDiagnostic(false, 0.85, 3, 0.35, 59, 'right', 0.5, 0.3);
    expect(deriveQualityFailureCodes(q)).toContain('INSUFFICIENT_SEGMENTS');
  });

  it('returns LOW_PHASE_COVERAGE when phaseCoverage < 0.10', () => {
    const q = buildTestQualityDiagnostic(false, 0.85, 12, 0.05, 59, 'right', 0.5, 0.3);
    expect(deriveQualityFailureCodes(q)).toContain('LOW_PHASE_COVERAGE');
  });

  it('returns multiple codes when multiple thresholds fail', () => {
    const q = buildTestQualityDiagnostic(false, 0.3, 2, 0.02, 59, 'right', null, null);
    const codes = deriveQualityFailureCodes(q);
    expect(codes).toContain('LOW_USABLE_FRAMES');
    expect(codes).toContain('INSUFFICIENT_SEGMENTS');
    expect(codes).toContain('LOW_PHASE_COVERAGE');
    expect(codes).toHaveLength(3);
  });

  // Boundary tests: exact threshold values should PASS (< is strict)
  it('usableFraction === 0.6 passes (threshold is strict <)', () => {
    const q = buildTestQualityDiagnostic(true, 0.6, 12, 0.35, 59, 'right', 0.9, 0.88);
    expect(deriveQualityFailureCodes(q)).not.toContain('LOW_USABLE_FRAMES');
  });

  it('segmentCount === 6 passes (threshold is strict <)', () => {
    const q = buildTestQualityDiagnostic(true, 0.85, 6, 0.35, 59, 'right', 0.9, 0.88);
    expect(deriveQualityFailureCodes(q)).not.toContain('INSUFFICIENT_SEGMENTS');
  });

  it('phaseCoverage === 0.10 passes (threshold is strict <)', () => {
    const q = buildTestQualityDiagnostic(true, 0.85, 12, 0.10, 59, 'right', 0.9, 0.88);
    expect(deriveQualityFailureCodes(q)).not.toContain('LOW_PHASE_COVERAGE');
  });
});

// ---------------------------------------------------------------------------
// buildCalibrationDiagnostic
// ---------------------------------------------------------------------------

describe('buildCalibrationDiagnostic', () => {
  it('success: passed=true, failureCodes=[]', () => {
    const diag = goodCalibration();
    expect(diag.passed).toBe(true);
    expect(diag.failureCodes).toEqual([]);
    expect(diag.stableFrames).toBe(30);
    expect(diag.requiredStableFrames).toBe(30);
    expect(diag.durationMs).toBe(5000);
    expect(diag.criteria).toHaveLength(6);
  });

  it('failure: passed=false, failureCodes derived from criteria', () => {
    const diag = buildCalibrationDiagnostic(false, 5, 30, 3000, [
      passingCriterion('bothEyes'),
      failingCriterion('faceCentering', 'Center your face: Move left'),
      failingCriterion('headPose', 'Turn head right'),
    ]);
    expect(diag.passed).toBe(false);
    expect(diag.failureCodes).toContain('FACE_OFF_CENTER');
    expect(diag.failureCodes).toContain('HEAD_YAW');
  });

  it('includes failureHistory when provided', () => {
    const diag = buildCalibrationDiagnostic(true, 30, 30, 5000, [
      passingCriterion('bothEyes'),
    ], ['faceCentering', 'headPose']);
    expect(diag.failureHistory).toEqual(['faceCentering', 'headPose']);
  });

  it('omits failureHistory when not provided', () => {
    const diag = buildCalibrationDiagnostic(true, 30, 30, 5000, [
      passingCriterion('bothEyes'),
    ]);
    expect(diag.failureHistory).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildTestQualityDiagnostic
// ---------------------------------------------------------------------------

describe('buildTestQualityDiagnostic', () => {
  it('pass: qualityPass=true, failureCodes=[]', () => {
    const diag = goodQuality();
    expect(diag.qualityPass).toBe(true);
    expect(diag.failureCodes).toEqual([]);
    expect(diag.usableFraction).toBe(0.85);
    expect(diag.segmentCount).toBe(12);
    expect(diag.phaseCoverage).toBe(0.35);
    expect(diag.detectedFps).toBe(59);
    expect(diag.selectedEye).toBe('right');
    expect(diag.gainCal).toBe(0.9);
    expect(diag.rSquared).toBe(0.88);
  });

  it('fail: failureCodes derived from metrics', () => {
    const diag = buildTestQualityDiagnostic(false, 0.3, 2, 0.02, 59, 'left', null, null);
    expect(diag.qualityPass).toBe(false);
    expect(diag.failureCodes).toContain('LOW_USABLE_FRAMES');
    expect(diag.failureCodes).toContain('INSUFFICIENT_SEGMENTS');
    expect(diag.failureCodes).toContain('LOW_PHASE_COVERAGE');
  });

  it('handles null gainCal and rSquared', () => {
    const diag = buildTestQualityDiagnostic(true, 0.85, 12, 0.35, 59, null, null, null);
    expect(diag.gainCal).toBeNull();
    expect(diag.rSquared).toBeNull();
    expect(diag.selectedEye).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildFramingGeometry
// ---------------------------------------------------------------------------

describe('buildFramingGeometry', () => {
  it('centered nose produces centerOffset near 0', () => {
    const fg = buildFramingGeometry(0.5, 0.5, [
      { x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 },
    ], false, { x: 0, y: 0, w: 375, h: 667 });
    expect(fg.centerOffset).toBeCloseTo(0, 5);
    expect(fg.nosePosition).toEqual({ x: 0.5, y: 0.5 });
    expect(fg.cropActive).toBe(false);
  });

  it('off-center nose produces positive centerOffset', () => {
    const fg = buildFramingGeometry(0.2, 0.8, [], false, { x: 0, y: 0, w: 375, h: 667 });
    expect(fg.centerOffset).toBeGreaterThan(0);
    // sqrt((0.2-0.5)^2 + (0.8-0.5)^2) = sqrt(0.09+0.09) = sqrt(0.18) ≈ 0.4243
    expect(fg.centerOffset).toBeCloseTo(Math.sqrt(0.18), 5);
  });

  it('eye near edge produces small minEyeEdgeMargin', () => {
    const fg = buildFramingGeometry(0.5, 0.5, [
      { x: 0.02, y: 0.5 }, { x: 0.6, y: 0.4 },
    ], false, { x: 0, y: 0, w: 375, h: 667 });
    expect(fg.minEyeEdgeMargin).toBeCloseTo(0.02, 5);
  });

  it('empty eyeCorners array produces minEyeEdgeMargin of 0', () => {
    const fg = buildFramingGeometry(0.5, 0.5, [], false, { x: 0, y: 0, w: 375, h: 667 });
    expect(fg.minEyeEdgeMargin).toBe(0);
  });

  it('null nose produces null centerOffset and null nosePosition', () => {
    const fg = buildFramingGeometry(null, null, [
      { x: 0.4, y: 0.4 },
    ], true, { x: 0, y: 50, w: 375, h: 567 });
    expect(fg.nosePosition).toBeNull();
    expect(fg.centerOffset).toBeNull();
    expect(fg.cropActive).toBe(true);
    expect(fg.videoRenderRect).toEqual({ x: 0, y: 50, w: 375, h: 567 });
  });

  it('nose at corner produces large centerOffset', () => {
    const fg = buildFramingGeometry(0, 0, [], false, { x: 0, y: 0, w: 375, h: 667 });
    // sqrt(0.25 + 0.25) ≈ 0.7071
    expect(fg.centerOffset).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it('preserves videoRenderRect passthrough', () => {
    const rect = { x: 10, y: 20, w: 300, h: 500 };
    const fg = buildFramingGeometry(0.5, 0.5, [], true, rect);
    expect(fg.videoRenderRect).toEqual(rect);
    expect(fg.cropActive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildTransformMetadata
// ---------------------------------------------------------------------------

describe('buildTransformMetadata', () => {
  it('constructs correct metadata', () => {
    const tm = buildTransformMetadata(true, 'right', 'contain', 1280, 720, 375, 667);
    expect(tm.mirrored).toBe(true);
    expect(tm.selectedEye).toBe('right');
    expect(tm.objectFit).toBe('contain');
    expect(tm.videoResolution).toEqual({ w: 1280, h: 720 });
    expect(tm.containerSize).toEqual({ w: 375, h: 667 });
  });

  it('handles null selectedEye', () => {
    const tm = buildTransformMetadata(false, null, 'cover', 640, 480, 960, 720);
    expect(tm.selectedEye).toBeNull();
    expect(tm.objectFit).toBe('cover');
  });
});

// ---------------------------------------------------------------------------
// buildSessionDiagnostic
// ---------------------------------------------------------------------------

describe('buildSessionDiagnostic', () => {
  it('combines all parts and flattens failureCodes from cal + quality', () => {
    const cal = goodCalibration();
    const quality = goodQuality();
    const framing = goodFraming();
    const transform = goodTransform();

    const diag = buildSessionDiagnostic(cal, quality, framing, transform);
    expect(diag.version).toBe(2);
    expect(diag.timestamp).toBeTruthy();
    expect(diag.calibration).toBe(cal);
    expect(diag.testQuality).toBe(quality);
    expect(diag.framing).toBe(framing);
    expect(diag.transform).toBe(transform);
    expect(diag.failureCodes).toEqual([]);
    expect(diag.summary).toBe('All checks passed');
  });

  it('flattens failureCodes from failing calibration', () => {
    const cal = buildCalibrationDiagnostic(false, 5, 30, 3000, [
      failingCriterion('faceCentering', 'Center your face: Move left'),
    ]);
    const quality = goodQuality();
    const framing = goodFraming();
    const transform = goodTransform();

    const diag = buildSessionDiagnostic(cal, quality, framing, transform);
    expect(diag.failureCodes).toContain('FACE_OFF_CENTER');
  });

  it('flattens failureCodes from failing quality', () => {
    const cal = goodCalibration();
    const quality = buildTestQualityDiagnostic(false, 0.3, 2, 0.02, 59, 'right', null, null);
    const framing = goodFraming();
    const transform = goodTransform();

    const diag = buildSessionDiagnostic(cal, quality, framing, transform);
    expect(diag.failureCodes).toContain('LOW_USABLE_FRAMES');
    expect(diag.failureCodes).toContain('INSUFFICIENT_SEGMENTS');
    expect(diag.failureCodes).toContain('LOW_PHASE_COVERAGE');
  });

  it('combines failureCodes from both cal and quality', () => {
    const cal = buildCalibrationDiagnostic(false, 5, 30, 3000, [
      failingCriterion('headPose', 'Turn head right'),
    ]);
    const quality = buildTestQualityDiagnostic(false, 0.3, 12, 0.35, 59, 'right', null, null);
    const framing = goodFraming();
    const transform = goodTransform();

    const diag = buildSessionDiagnostic(cal, quality, framing, transform);
    expect(diag.failureCodes).toContain('HEAD_YAW');
    expect(diag.failureCodes).toContain('LOW_USABLE_FRAMES');
  });

  it('generates ISO timestamp', () => {
    const diag = buildSessionDiagnostic(goodCalibration(), goodQuality(), goodFraming(), goodTransform());
    // Should be a valid ISO 8601 date
    expect(new Date(diag.timestamp).toISOString()).toBe(diag.timestamp);
  });
});

// ---------------------------------------------------------------------------
// summarizeDiagnostic
// ---------------------------------------------------------------------------

describe('summarizeDiagnostic', () => {
  it('returns "All checks passed" when everything passes', () => {
    const diag = buildSessionDiagnostic(goodCalibration(), goodQuality(), goodFraming(), goodTransform());
    expect(summarizeDiagnostic(diag)).toBe('All checks passed');
  });

  it('includes calibration failure hints', () => {
    const cal = buildCalibrationDiagnostic(false, 5, 30, 3000, [
      failingCriterion('faceCentering', 'Center your face: Move left'),
      failingCriterion('headPose', 'Turn head right'),
    ]);
    const diag = buildSessionDiagnostic(cal, goodQuality(), goodFraming(), goodTransform());
    const summary = summarizeDiagnostic(diag);
    expect(summary).toContain('Calibration failed');
    expect(summary).toContain('Center your face: Move left');
    expect(summary).toContain('Turn head right');
  });

  it('includes quality failure details', () => {
    const quality = buildTestQualityDiagnostic(false, 0.3, 2, 0.02, 59, 'right', null, null);
    const diag = buildSessionDiagnostic(goodCalibration(), quality, goodFraming(), goodTransform());
    const summary = summarizeDiagnostic(diag);
    expect(summary).toContain('Low quality');
    expect(summary).toContain('usable frames');
  });

  it('combines calibration and quality failure messages', () => {
    const cal = buildCalibrationDiagnostic(false, 5, 30, 3000, [
      failingCriterion('headPose', 'Turn head right'),
    ]);
    const quality = buildTestQualityDiagnostic(false, 0.3, 12, 0.35, 59, 'right', null, null);
    const diag = buildSessionDiagnostic(cal, quality, goodFraming(), goodTransform());
    const summary = summarizeDiagnostic(diag);
    expect(summary).toContain('Calibration failed');
    expect(summary).toContain('Low quality');
    expect(summary).toContain('. ');
  });

  it('returns fallback when qualityPass=false but all sub-thresholds pass', () => {
    // Quality flagged as failing by app.js but all individual metrics are above thresholds
    const quality = buildTestQualityDiagnostic(false, 0.85, 12, 0.35, 59, 'right', 0.9, 0.88);
    const diag = buildSessionDiagnostic(goodCalibration(), quality, goodFraming(), goodTransform());
    const summary = summarizeDiagnostic(diag);
    expect(summary).toContain('quality check failed');
  });
});

// ---------------------------------------------------------------------------
// Diagnostic types and builders for HazyEyes session diagnostics.
// Stream 3 — fully independent, no imports from Streams 1 or 2.
// ---------------------------------------------------------------------------

export type CriterionName =
  | 'bothEyes' | 'safeZone' | 'faceCentering'
  | 'headPose' | 'motionStability' | 'irisSize';

export type FailureCode =
  | 'CALIBRATION_INCOMPLETE'
  | 'EYE_OCCLUDED_LEFT' | 'EYE_OCCLUDED_RIGHT' | 'EYES_TOO_SMALL'
  | 'FACE_OFF_CENTER' | 'FACE_OUT_OF_ZONE'
  | 'HEAD_YAW' | 'HEAD_PITCH'
  | 'MOTION_UNSTABLE'
  | 'IRIS_TOO_SMALL' | 'IRIS_TOO_LARGE'
  | 'LOW_USABLE_FRAMES' | 'INSUFFICIENT_SEGMENTS' | 'LOW_PHASE_COVERAGE';

export interface CriterionResult {
  criterion: CriterionName;
  pass: boolean;
  hint?: string;
  value?: number;
  threshold?: number;
  failureCode?: FailureCode;
}

export interface FramingGeometry {
  nosePosition: { x: number; y: number } | null;
  centerOffset: number | null;
  minEyeEdgeMargin: number | null;
  cropActive: boolean;
  videoRenderRect: { x: number; y: number; w: number; h: number };
}

export interface TransformMetadata {
  mirrored: boolean;
  selectedEye: 'left' | 'right' | null;
  objectFit: 'contain' | 'cover';
  videoResolution: { w: number; h: number };
  containerSize: { w: number; h: number };
}

export interface CalibrationDiagnostic {
  passed: boolean;
  stableFrames: number;
  requiredStableFrames: number;
  durationMs: number;
  criteria: CriterionResult[];
  failureCodes: FailureCode[];
  failureHistory?: CriterionName[];
}

export interface TestQualityDiagnostic {
  qualityPass: boolean;
  usableFraction: number;
  segmentCount: number;
  phaseCoverage: number;
  detectedFps: number;
  selectedEye: 'left' | 'right' | null;
  gainCal: number | null;
  rSquared: number | null;
  failureCodes: FailureCode[];
}

export interface SessionDiagnostic {
  version: 2;
  timestamp: string;
  calibration: CalibrationDiagnostic;
  testQuality: TestQualityDiagnostic;
  framing: FramingGeometry;
  transform: TransformMetadata;
  summary: string;
  failureCodes: FailureCode[];
}

// ---------------------------------------------------------------------------
// Failure code derivation
// ---------------------------------------------------------------------------

const KNOWN_CRITERIA: ReadonlySet<CriterionName> = new Set<CriterionName>([
  'bothEyes', 'safeZone', 'faceCentering',
  'headPose', 'motionStability', 'irisSize',
]);

/**
 * Two-level dispatch: match on criterion name first, then disambiguate
 * by hint text within that criterion. This prevents cross-criterion
 * ambiguity (e.g., faceCentering "Move left" vs bothEyes "Left eye").
 */
export function deriveCalibrationFailureCodes(
  criteria: CriterionResult[],
): FailureCode[] {
  const codes: FailureCode[] = [];

  for (const r of criteria) {
    if (r.pass) continue;
    if (!KNOWN_CRITERIA.has(r.criterion)) continue;

    const hint = r.hint ?? '';

    switch (r.criterion) {
      case 'bothEyes':
        if (hint.includes('Left')) codes.push('EYE_OCCLUDED_LEFT');
        else if (hint.includes('Right')) codes.push('EYE_OCCLUDED_RIGHT');
        else if (hint.includes('Both')) codes.push('EYES_TOO_SMALL');
        else codes.push('CALIBRATION_INCOMPLETE');
        break;

      case 'faceCentering':
        codes.push('FACE_OFF_CENTER');
        break;

      case 'safeZone':
        codes.push('FACE_OUT_OF_ZONE');
        break;

      case 'headPose':
        if (hint.includes('Turn')) codes.push('HEAD_YAW');
        else if (hint.includes('Tilt')) codes.push('HEAD_PITCH');
        else codes.push('HEAD_YAW'); // default to yaw
        break;

      case 'motionStability':
        codes.push('MOTION_UNSTABLE');
        break;

      case 'irisSize':
        if (hint.includes('closer')) codes.push('IRIS_TOO_SMALL');
        else if (hint.includes('farther')) codes.push('IRIS_TOO_LARGE');
        else codes.push('IRIS_TOO_SMALL'); // default
        break;
    }
  }

  return codes;
}

export function deriveQualityFailureCodes(
  quality: TestQualityDiagnostic,
): FailureCode[] {
  const codes: FailureCode[] = [];
  if (quality.usableFraction < 0.6) codes.push('LOW_USABLE_FRAMES');
  if (quality.segmentCount < 6) codes.push('INSUFFICIENT_SEGMENTS');
  if (quality.phaseCoverage < 0.10) codes.push('LOW_PHASE_COVERAGE');
  return codes;
}

// ---------------------------------------------------------------------------
// Builder functions
// ---------------------------------------------------------------------------

export function buildCalibrationDiagnostic(
  passed: boolean,
  stableFrames: number,
  requiredStableFrames: number,
  durationMs: number,
  criteria: CriterionResult[],
  failureHistory?: CriterionName[],
): CalibrationDiagnostic {
  const diag: CalibrationDiagnostic = {
    passed,
    stableFrames,
    requiredStableFrames,
    durationMs,
    criteria,
    failureCodes: deriveCalibrationFailureCodes(criteria),
  };
  if (failureHistory !== undefined) {
    diag.failureHistory = failureHistory;
  }
  return diag;
}

export function buildTestQualityDiagnostic(
  qualityPass: boolean,
  usableFraction: number,
  segmentCount: number,
  phaseCoverage: number,
  detectedFps: number,
  selectedEye: 'left' | 'right' | null,
  gainCal: number | null,
  rSquared: number | null,
): TestQualityDiagnostic {
  const diag: TestQualityDiagnostic = {
    qualityPass,
    usableFraction,
    segmentCount,
    phaseCoverage,
    detectedFps,
    selectedEye,
    gainCal,
    rSquared,
    failureCodes: [], // placeholder — filled below
  };
  diag.failureCodes = deriveQualityFailureCodes(diag);
  return diag;
}

/**
 * Build framing geometry. Center-offset and eye-margin math is inlined
 * (no import from framingGeometry.ts) to keep Stream 3 independent.
 */
export function buildFramingGeometry(
  noseX: number | null,
  noseY: number | null,
  eyeCorners: { x: number; y: number }[],
  cropActive: boolean,
  videoRenderRect: { x: number; y: number; w: number; h: number },
): FramingGeometry {
  const hasNose = noseX !== null && noseY !== null;

  // Inlined center-offset: Euclidean distance from nose to (0.5, 0.5)
  const centerOffset = hasNose
    ? Math.sqrt((noseX - 0.5) ** 2 + (noseY - 0.5) ** 2)
    : null;

  // Inlined eye-margin: min distance from any eye corner to frame edge.
  // Returns 0 (not null) when eyeCorners is empty — semantically "no margin".
  let minEyeEdgeMargin = 0;
  if (eyeCorners.length > 0) {
    let minM = Infinity;
    for (const c of eyeCorners) {
      minM = Math.min(minM, c.x, 1 - c.x, c.y, 1 - c.y);
    }
    minEyeEdgeMargin = isFinite(minM) ? minM : 0;
  }

  return {
    nosePosition: hasNose ? { x: noseX, y: noseY } : null,
    centerOffset,
    minEyeEdgeMargin,
    cropActive,
    videoRenderRect,
  };
}

export function buildTransformMetadata(
  mirrored: boolean,
  selectedEye: 'left' | 'right' | null,
  objectFit: 'contain' | 'cover',
  videoW: number,
  videoH: number,
  containerW: number,
  containerH: number,
): TransformMetadata {
  return {
    mirrored,
    selectedEye,
    objectFit,
    videoResolution: { w: videoW, h: videoH },
    containerSize: { w: containerW, h: containerH },
  };
}

/**
 * Generate a human-readable summary from the diagnostic.
 */
export function summarizeDiagnostic(diag: SessionDiagnostic): string {
  const parts: string[] = [];

  if (!diag.calibration.passed) {
    const failingHints = diag.calibration.criteria
      .filter(c => !c.pass && c.hint)
      .map(c => c.hint!);
    if (failingHints.length > 0) {
      parts.push('Calibration failed: ' + failingHints.join('; '));
    } else {
      parts.push('Calibration failed');
    }
  }

  if (!diag.testQuality.qualityPass) {
    const issues: string[] = [];
    if (diag.testQuality.usableFraction < 0.6) {
      issues.push(`low usable frames (${Math.round(diag.testQuality.usableFraction * 100)}%)`);
    }
    if (diag.testQuality.segmentCount < 6) {
      issues.push(`insufficient segments (${diag.testQuality.segmentCount})`);
    }
    if (diag.testQuality.phaseCoverage < 0.10) {
      issues.push(`low phase coverage (${Math.round(diag.testQuality.phaseCoverage * 100)}%)`);
    }
    if (issues.length > 0) {
      parts.push('Low quality: ' + issues.join(', '));
    } else {
      parts.push('Low quality: quality check failed');
    }
  }

  if (parts.length === 0) return 'All checks passed';
  return parts.join('. ');
}

export function buildSessionDiagnostic(
  calibration: CalibrationDiagnostic,
  testQuality: TestQualityDiagnostic,
  framing: FramingGeometry,
  transform: TransformMetadata,
): SessionDiagnostic {
  const failureCodes: FailureCode[] = [
    ...calibration.failureCodes,
    ...testQuality.failureCodes,
  ];

  const diag: SessionDiagnostic = {
    version: 2,
    timestamp: new Date().toISOString(),
    calibration,
    testQuality,
    framing,
    transform,
    summary: '', // placeholder
    failureCodes,
  };

  diag.summary = summarizeDiagnostic(diag);

  return diag;
}

/**
 * Pure functions for calibration quality assessment.
 * These are testable reference implementations. app.js has equivalent inline copies.
 * See plan 2B-DEBT for dual-source-of-truth acknowledgment.
 */

// Thresholds — initial values, instrument and tune via Release 3C timeout data
export const SAFE_ZONE_X_MIN = 0.15;
export const SAFE_ZONE_X_MAX = 0.85;
export const SAFE_ZONE_Y_MIN = 0.10;
export const SAFE_ZONE_Y_MAX = 0.90;
export const YAW_LIMIT_NORM = 0.08;
export const PITCH_LIMIT_NORM = 0.10;
export const MIN_EYE_SPAN_NORM = 0.035;
export const NOSE_MOTION_SIGMA_MAX = 0.012;
export const CALIB_REQUIRED_STABLE = 15;

export const CENTER_ZONE_X_MIN = 0.25;
export const CENTER_ZONE_X_MAX = 0.75;
export const CENTER_ZONE_Y_MIN = 0.25;
export const CENTER_ZONE_Y_MAX = 0.75;

export interface Landmark {
  x: number;
  y: number;
}

export interface CalibrationFrame {
  leftCornerIn: Landmark | null;
  leftCornerOut: Landmark | null;
  rightCornerIn: Landmark | null;
  rightCornerOut: Landmark | null;
  nose: Landmark | null;
  forehead: Landmark | null;
  chin: Landmark | null;
  faceEdgeL: Landmark | null;
  faceEdgeR: Landmark | null;
}

export interface CheckResult {
  pass: boolean;
  hint?: string;
}

/**
 * Check that both eyes have sufficient corner-to-corner span.
 * Span < MIN_EYE_SPAN_NORM suggests the eye is partially off-screen or occluded.
 */
export function bothEyesVisible(frame: CalibrationFrame): CheckResult {
  const { leftCornerIn, leftCornerOut, rightCornerIn, rightCornerOut } = frame;

  if (!leftCornerIn || !leftCornerOut || !rightCornerIn || !rightCornerOut) {
    return { pass: false, hint: 'Face not fully detected' };
  }

  const leftSpan = Math.abs(leftCornerIn.x - leftCornerOut.x);
  const rightSpan = Math.abs(rightCornerOut.x - rightCornerIn.x);

  if (leftSpan < MIN_EYE_SPAN_NORM && rightSpan < MIN_EYE_SPAN_NORM) {
    return { pass: false, hint: 'Both eyes too small — move closer' };
  }
  if (leftSpan < MIN_EYE_SPAN_NORM) {
    return { pass: false, hint: 'Left eye partially hidden' };
  }
  if (rightSpan < MIN_EYE_SPAN_NORM) {
    return { pass: false, hint: 'Right eye partially hidden' };
  }

  return { pass: true };
}

/**
 * Check that the face center (nose tip) is within the safe zone of the frame.
 * Returns directional hints when off-center.
 */
export function faceInSafeZone(frame: CalibrationFrame): CheckResult {
  const { nose } = frame;
  if (!nose) {
    return { pass: false, hint: 'Face not detected' };
  }

  const { x, y } = nose;
  const hints: string[] = [];

  // Selfie mirror: camera-left(low x) → display-right → user moves LEFT to center
  if (x < SAFE_ZONE_X_MIN) hints.push('Move left');
  if (x > SAFE_ZONE_X_MAX) hints.push('Move right');
  if (y < SAFE_ZONE_Y_MIN) hints.push('Move down');
  if (y > SAFE_ZONE_Y_MAX) hints.push('Move up');

  if (hints.length > 0) {
    return { pass: false, hint: hints.join(', ') };
  }
  return { pass: true };
}

/**
 * Check that the face center is within the center zone (0.25-0.75) of the frame.
 * Stricter than faceInSafeZone — ensures face is well-centered for quality tracking.
 * Same hint convention as faceInSafeZone (selfie mirror: low x → 'Move left').
 */
export function faceCentering(frame: CalibrationFrame): CheckResult {
  const { nose } = frame;
  if (!nose) return { pass: false, hint: 'Face not detected' };
  const hints: string[] = [];
  if (nose.x < CENTER_ZONE_X_MIN) hints.push('Move left');
  if (nose.x > CENTER_ZONE_X_MAX) hints.push('Move right');
  if (nose.y < CENTER_ZONE_Y_MIN) hints.push('Move down');
  if (nose.y > CENTER_ZONE_Y_MAX) hints.push('Move up');
  if (hints.length > 0) return { pass: false, hint: 'Center your face: ' + hints.join(', ') };
  return { pass: true };
}

/**
 * Check that head yaw and pitch are within acceptable limits.
 * Uses nose deviation from face center as a proxy for yaw,
 * and forehead-chin vertical ratio as a proxy for pitch.
 */
export function headPoseCheck(frame: CalibrationFrame): CheckResult {
  const { nose, faceEdgeL, faceEdgeR, forehead, chin } = frame;

  if (!nose || !faceEdgeL || !faceEdgeR) {
    return { pass: false, hint: 'Not enough landmarks for pose check' };
  }

  // Yaw proxy: nose deviation from midpoint of face edges
  const faceMidX = (faceEdgeL.x + faceEdgeR.x) / 2;
  const yawDeviation = nose.x - faceMidX;

  if (Math.abs(yawDeviation) > YAW_LIMIT_NORM) {
    // yawDev > 0 = nose to camera-right = user facing left = turn right to straighten
    const direction = yawDeviation > 0 ? 'Turn head right' : 'Turn head left';
    return { pass: false, hint: direction };
  }

  // Pitch proxy: if forehead and chin are available
  if (forehead && chin) {
    const faceHeight = Math.abs(chin.y - forehead.y);
    if (faceHeight > 0) {
      const noseFraction = (nose.y - forehead.y) / faceHeight;
      // Neutral: nose is roughly 60% down from forehead. Deviation > PITCH_LIMIT_NORM = tilted.
      const pitchDeviation = noseFraction - 0.6;
      if (Math.abs(pitchDeviation) > PITCH_LIMIT_NORM) {
        const direction = pitchDeviation > 0 ? 'Tilt head up' : 'Tilt head down';
        return { pass: false, hint: direction };
      }
    }
  }

  return { pass: true };
}

/**
 * Check motion stability using running variance of nose position.
 * Requires a buffer of recent nose positions.
 */
export function motionStability(nosePositions: Landmark[]): CheckResult {
  if (nosePositions.length < 5) {
    return { pass: false, hint: 'Stabilizing...' };
  }

  const recentX = nosePositions.slice(-10).map(p => p.x);
  const meanX = recentX.reduce((a, b) => a + b, 0) / recentX.length;
  const varianceX = recentX.reduce((a, v) => a + (v - meanX) ** 2, 0) / recentX.length;
  const sigmaX = Math.sqrt(varianceX);

  const recentY = nosePositions.slice(-10).map(p => p.y);
  const meanY = recentY.reduce((a, b) => a + b, 0) / recentY.length;
  const varianceY = recentY.reduce((a, v) => a + (v - meanY) ** 2, 0) / recentY.length;
  const sigmaY = Math.sqrt(varianceY);

  const maxSigma = Math.max(sigmaX, sigmaY);

  if (maxSigma > NOSE_MOTION_SIGMA_MAX) {
    return { pass: false, hint: 'Hold as steady as you can' };
  }

  return { pass: true };
}

export interface CoachingMessage {
  priority: number;
  message: string;
  criterion: string;
}

/**
 * Produce a priority-ordered list of coaching messages based on all calibration checks.
 * Priority order: bothEyes > safeZone > faceCentering > headPose > motionStability
 */
export function calibrationCoach(
  frame: CalibrationFrame,
  nosePositions: Landmark[]
): CoachingMessage[] {
  const messages: CoachingMessage[] = [];

  const eyeCheck = bothEyesVisible(frame);
  if (!eyeCheck.pass) {
    messages.push({ priority: 1, message: eyeCheck.hint!, criterion: 'bothEyes' });
  }

  const zoneCheck = faceInSafeZone(frame);
  if (!zoneCheck.pass) {
    messages.push({ priority: 2, message: zoneCheck.hint!, criterion: 'safeZone' });
  }

  const centerCheck = faceCentering(frame);
  if (!centerCheck.pass) {
    messages.push({ priority: 2.5, message: centerCheck.hint!, criterion: 'faceCentering' });
  }

  const poseCheck = headPoseCheck(frame);
  if (!poseCheck.pass) {
    messages.push({ priority: 3, message: poseCheck.hint!, criterion: 'headPose' });
  }

  const stabilityCheck = motionStability(nosePositions);
  if (!stabilityCheck.pass) {
    messages.push({ priority: 4, message: stabilityCheck.hint!, criterion: 'motionStability' });
  }

  return messages.sort((a, b) => a.priority - b.priority);
}

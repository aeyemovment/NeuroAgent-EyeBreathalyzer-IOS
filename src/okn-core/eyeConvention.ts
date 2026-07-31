/**
 * Canonical eye identity convention for HazyEyes.
 *
 * MediaPipe Face Mesh labels landmarks from the SUBJECT's perspective:
 * - L_IRIS [468-471] = subject's anatomical LEFT eye (at camera-RIGHT, higher x)
 * - R_IRIS [473-476] = subject's anatomical RIGHT eye (at camera-LEFT, lower x)
 *
 * selectedEye = 'left' | 'right' = subject's ANATOMICAL eye, NOT camera-side.
 * The selection picks whichever iris center is closer to x=0.5 in camera coords.
 *
 * Normalization: both eyes produce negative values for leftward tracking
 * (following leftward stimulus). The negation (-) ensures this.
 *
 * CSS scaleX(-1) mirrors the display only. Landmark coordinates are always
 * in unmirrored camera space. Sidecar JSON irisL/irisR use anatomical labels.
 */

/** Select the eye whose iris center is closer to frame center. */
export function selectEye(leftIrisX: number, rightIrisX: number): 'left' | 'right' {
  const leftDist = Math.abs(leftIrisX - 0.5);
  const rightDist = Math.abs(rightIrisX - 0.5);
  return rightDist < leftDist ? 'right' : 'left';
}

/**
 * Normalize iris position within eye opening to [-1, +1].
 * Returns negative values when iris tracks leftward stimulus.
 */
export function normalizeEyeX(
  irisX: number,
  cornerInX: number,
  cornerOutX: number
): number {
  const min = Math.min(cornerOutX, cornerInX);
  const span = Math.abs(cornerInX - cornerOutX);
  if (span <= 0) return 0;
  const norm = (irisX - min) / span;
  return -(norm * 2 - 1);
}

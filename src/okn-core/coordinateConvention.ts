/**
 * Coordinate convention metadata for HazyEyes sidecar JSON.
 *
 * This module provides the canonical documentation of all coordinate spaces
 * used in the HazyEyes data pipeline, and a builder for embedding convention
 * metadata into sidecar JSON files.
 *
 * Coordinate spaces (in pipeline order):
 * 1. Camera space: MediaPipe Face Mesh normalized [0,1], unmirrored
 * 2. Eye-normalized space: iris within eye opening, negated → [-1,+1]
 * 3. EMA-smoothed space: after exponential moving average (factor 0.25)
 * 4. Display space: CSS scaleX(-1) mirror, never stored
 *
 * See eyeConvention.ts for the normalizeEyeX() function that implements
 * the camera → eye-normalized transform.
 *
 * Key invariants:
 * - Leftward eye tracking (following leftward stimulus) = negative slope
 * - Saccade resets = positive slope (sharp upward jumps)
 * - Same polarity on ALL devices — never negate eyeXNorm
 * - CSS mirror is display-only — never affects stored coordinates
 * - Anatomical labels (irisL = subject's left eye) throughout
 */

export const COORDINATE_CONVENTION_VERSION = '1.0';

export interface CoordinateSpaceMetadata {
  convention_version: string;
  camera_space: string;
  eye_normalized_space: string;
  anatomical_labels: boolean;
  css_mirror_display_only: boolean;
  leftward_tracking_slope: string;
}

/** Build coordinate space metadata for sidecar JSON. */
export function getCoordinateSpaceMetadata(): CoordinateSpaceMetadata {
  return {
    convention_version: COORDINATE_CONVENTION_VERSION,
    camera_space: 'mediapipe_face_mesh_normalized_0_1',
    eye_normalized_space: 'negated_within_eye_span',
    anatomical_labels: true,
    css_mirror_display_only: true,
    leftward_tracking_slope: 'negative',
  };
}

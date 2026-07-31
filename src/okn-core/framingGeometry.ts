/**
 * Pure functions for computing video framing geometry.
 * Used to remap overlay drawing when using object-fit: contain.
 */

export interface VideoRenderRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Compute where the video actually renders within its container
 * when using object-fit: contain. Returns the render rect in
 * container pixel coordinates.
 */
export function computeVideoRenderRect(
  containerW: number,
  containerH: number,
  videoW: number,
  videoH: number
): VideoRenderRect {
  if (videoW <= 0 || videoH <= 0) {
    return { x: 0, y: 0, w: containerW, h: containerH };
  }
  const containerAR = containerW / containerH;
  const videoAR = videoW / videoH;
  if (videoAR > containerAR) {
    // Video wider than container → letterbox top/bottom
    const rW = containerW;
    const rH = containerW / videoAR;
    return { x: 0, y: (containerH - rH) / 2, w: rW, h: rH };
  } else {
    // Video taller than container → letterbox left/right
    const rH = containerH;
    const rW = containerH * videoAR;
    return { x: (containerW - rW) / 2, y: 0, w: rW, h: rH };
  }
}

/**
 * Whether the video aspect ratio differs from the container,
 * causing letterboxing (with contain) or cropping (with cover).
 */
export function isCropActive(
  containerW: number,
  containerH: number,
  videoW: number,
  videoH: number
): boolean {
  if (videoW <= 0 || videoH <= 0) return false;
  const containerAR = containerW / containerH;
  const videoAR = videoW / videoH;
  return Math.abs(containerAR - videoAR) > 0.01;
}

/**
 * Euclidean distance from nose to frame center (0.5, 0.5).
 * Returns 0 for perfectly centered, increases with distance.
 */
export function computeCenterOffset(noseX: number, noseY: number): number {
  return Math.sqrt((noseX - 0.5) ** 2 + (noseY - 0.5) ** 2);
}

/**
 * Minimum distance from any eye corner to the nearest frame edge.
 * Low values indicate eyes near the edge — risk of partial detection.
 */
export function computeMinEyeEdgeMargin(
  eyeCorners: { x: number; y: number }[]
): number {
  let minMargin = Infinity;
  for (const c of eyeCorners) {
    minMargin = Math.min(minMargin, c.x, 1 - c.x, c.y, 1 - c.y);
  }
  return isFinite(minMargin) ? minMargin : 0;
}

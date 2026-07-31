/**
 * Oval-based calibration logic for HazyEyes.
 *
 * Two ovals centered on screen, sized as a fraction of the canvas.
 * Distance enforcement uses the same iris size range as the old calibration
 * (0.05–0.07). The ovals are purely visual guides — they turn green when
 * the user's eye centroid is inside them. Combined with the iris size gate,
 * this ensures the correct viewing distance on any device.
 *
 * All functions are pure — no DOM, no side effects.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Target iris size — same as old calibration. */
export const TARGET_IRIS_SIZE = 0.06;

/** Tolerance around target — iris must be in [TARGET - TOL, TARGET + TOL]. */
export const IRIS_SIZE_TOLERANCE = 0.01;

/** Oval width as a fraction of canvas width. Visually prominent guide. */
export const OVAL_WIDTH_FRAC = 0.12;

/** Oval height = width / aspect ratio. Eyes are ~1.6:1 wide:tall. */
export const OVAL_ASPECT = 1.6;

/** Horizontal distance between oval centers, as fraction of canvas width. */
export const OVAL_SEPARATION_FRAC = 0.22;

/** Vertical center of ovals, as fraction of canvas height. */
export const OVAL_CENTER_Y_FRAC = 0.42;

/** Consecutive frames both eyes must fit before calibration passes. */
export const OVAL_REQUIRED_STABLE = 8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OvalTarget {
  /** Center x in pixels. */
  cx: number;
  /** Center y in pixels. */
  cy: number;
  /** Horizontal radius in pixels. */
  rx: number;
  /** Vertical radius in pixels. */
  ry: number;
}

export interface EyeContour {
  center: { x: number; y: number };
  span: number;
  height: number;
}

export interface OvalFitResult {
  fit: boolean;
  reason?: string;
}

export interface BothEyesFitResult {
  leftFit: boolean;
  rightFit: boolean;
  bothFit: boolean;
}

// ---------------------------------------------------------------------------
// Oval target computation — canvas-relative
// ---------------------------------------------------------------------------

/**
 * Compute oval targets in pixel coordinates for a given canvas size.
 * Ovals are always centered on screen, sized as a fraction of canvas width.
 */
export function computeOvalTargets(
  canvasW: number,
  canvasH: number
): { left: OvalTarget; right: OvalTarget } {
  const rx = (OVAL_WIDTH_FRAC * canvasW) / 2;
  const ry = rx / OVAL_ASPECT;
  const cy = OVAL_CENTER_Y_FRAC * canvasH;
  const sepPx = OVAL_SEPARATION_FRAC * canvasW;

  return {
    left:  { cx: canvasW / 2 - sepPx / 2, cy, rx, ry },
    right: { cx: canvasW / 2 + sepPx / 2, cy, rx, ry },
  };
}

// ---------------------------------------------------------------------------
// Eye-oval fit check
// ---------------------------------------------------------------------------

/**
 * Check whether an eye's centroid falls inside an oval.
 * Uses the standard ellipse containment test: ((dx/rx)^2 + (dy/ry)^2) <= 1.
 *
 * Eye coordinates must be in the same pixel space as the oval.
 */
export function checkEyeOvalFit(
  eyeCenterX: number,
  eyeCenterY: number,
  oval: OvalTarget
): OvalFitResult {
  const dx = eyeCenterX - oval.cx;
  const dy = eyeCenterY - oval.cy;
  const norm = (dx / oval.rx) ** 2 + (dy / oval.ry) ** 2;

  if (norm <= 1.0) {
    return { fit: true };
  }
  return { fit: false, reason: 'Eye not inside oval' };
}

// ---------------------------------------------------------------------------
// Iris size distance gate — same range as old calibration
// ---------------------------------------------------------------------------

/**
 * Check if iris size is in the acceptable range for the target viewing distance.
 * Returns true if iris size is within [TARGET - TOLERANCE, TARGET + TOLERANCE].
 */
export function irisInRange(irisSize: number): boolean {
  const eps = 1e-9;
  return irisSize >= (TARGET_IRIS_SIZE - IRIS_SIZE_TOLERANCE - eps)
      && irisSize <= (TARGET_IRIS_SIZE + IRIS_SIZE_TOLERANCE + eps);
}

// ---------------------------------------------------------------------------
// Median eye span (robust calibration capture)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Calibration hint layout — computes font size and pill geometry
// ---------------------------------------------------------------------------

export interface HintLayout {
  fontSize: number;
  pillW: number;
  pillH: number;
  pillR: number;
  textX: number;
  textY: number;
}

/** Max fraction of box width the pill can occupy. */
export const HINT_MAX_WIDTH_FRAC = 0.50;

/**
 * Compute hint text layout given the framing box dimensions (in pixels).
 * Font size is clamped so the pill never exceeds HINT_MAX_WIDTH_FRAC of boxW.
 *
 * @param boxX - left edge of framing box (px)
 * @param boxY - top edge of framing box (px)
 * @param boxW - width of framing box (px)
 * @param boxH - height of framing box (px)
 * @param textWidthPerFontPx - approximate text width per font pixel (from measureText / fontSize)
 */
export function computeHintLayout(
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  textWidthPerFontPx: number
): HintLayout {
  const padXRatio = 0.5;
  const padYRatio = 0.35;

  // Start with desired font size
  let fontSize = Math.max(12, Math.round(boxW * 0.025));

  // Clamp: pill must not exceed HINT_MAX_WIDTH_FRAC of box width
  const maxPillW = boxW * HINT_MAX_WIDTH_FRAC;
  let textW = fontSize * textWidthPerFontPx;
  let pillW = textW + fontSize * padXRatio * 2;
  if (pillW > maxPillW) {
    // Solve: fontSize * (textWidthPerFontPx + padXRatio * 2) = maxPillW
    fontSize = Math.floor(maxPillW / (textWidthPerFontPx + padXRatio * 2));
    fontSize = Math.max(10, fontSize);
    textW = fontSize * textWidthPerFontPx;
    pillW = textW + fontSize * padXRatio * 2;
  }

  const pillH = fontSize + fontSize * padYRatio * 2;
  const pillR = pillH / 2;
  const textX = boxX + boxW / 2;
  const textY = boxY + fontSize * 1.6;

  return { fontSize, pillW, pillH, pillR, textX, textY };
}

// ---------------------------------------------------------------------------
// Median eye span (robust calibration capture)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Gaze target crosshairs — fade out after CROSSHAIR_FADE_MS
// ---------------------------------------------------------------------------

/** Duration in ms that the center line is visible after test starts. */
export const CROSSHAIR_FADE_MS = 4000;

/** Crosshair arm length as fraction of canvas height. */
export const CROSSHAIR_SIZE_FRAC = 0.06;

/** Gap in the center of each crosshair (fraction of arm length). */
export const CROSSHAIR_GAP_FRAC = 0.3;

/**
 * Compute crosshair opacity based on elapsed time since test start.
 * Returns 1.0 for the first portion, then fades linearly to 0.
 */
export function crosshairOpacity(elapsedMs: number): number {
  if (elapsedMs < 0) return 1;
  if (elapsedMs >= CROSSHAIR_FADE_MS) return 0;
  // Hold full opacity for first 60%, then fade over remaining 40%
  const holdMs = CROSSHAIR_FADE_MS * 0.6;
  if (elapsedMs <= holdMs) return 1;
  return 1 - (elapsedMs - holdMs) / (CROSSHAIR_FADE_MS - holdMs);
}

/**
 * Compute positions for two crosshairs placed at horizontal thirds of the canvas,
 * vertically centered.
 */
export function crosshairPositions(
  canvasW: number,
  canvasH: number
): { left: { x: number; y: number }; right: { x: number; y: number } } {
  return {
    left:  { x: canvasW / 3,     y: canvasH / 2 },
    right: { x: (canvasW * 2) / 3, y: canvasH / 2 },
  };
}

export function medianEyeSpan(spans: number[]): number {
  if (spans.length === 0) return 0;
  const sorted = [...spans].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

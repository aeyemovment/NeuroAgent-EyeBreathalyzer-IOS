# Coordinate Conventions

## Overview
HazyEyes uses 4 coordinate spaces in its data pipeline. This document is the canonical reference for all of them.

## Pipeline Order

### 1. Camera Space (Raw MediaPipe)
- Source: MediaPipe Face Mesh landmark detection
- Range: [0, 1] normalized to video frame dimensions
- Origin: top-left corner of video frame
- x increases rightward, y increases downward
- **Unmirrored**: landmarks are in camera-native coordinates
- Used in: sidecar JSON fields `irisL`, `irisR`, `cornerL_in`, `cornerL_out`, `cornerR_in`, `cornerR_out`, `nose`, `forehead`, `chin`, `faceEdgeL`, `faceEdgeR`; CSV field `rawIrisX`
- Anatomical labels: `irisL` = subject's anatomical LEFT eye (at camera-RIGHT, higher x), `irisR` = subject's anatomical RIGHT eye (at camera-LEFT, lower x)

### 2. Eye-Normalized Space (Pre-Smoothing)
- Transform: `normalizeEyeX()` in `eyeConvention.ts`
- Formula: `-(((irisX - min(corners)) / span) * 2 - 1)`
- Range: approximately [-1, +1]
- The negation ensures leftward iris tracking produces negative values
- Used in: sidecar JSON field `rawEyeXNorm`

### 3. EMA-Smoothed Space
- Transform: Exponential Moving Average with factor 0.25
- Same range as eye-normalized space
- Used in: CSV field `eyeXNorm`

### 4. Display Space (CSS Mirror)
- Transform: CSS `scaleX(-1)` applied to `<video>` element
- **Display-only**: never affects stored coordinates or landmarks
- Purpose: shows user a mirror image (natural selfie view)

## Critical Invariants

1. **Leftward tracking = negative slope**: When eyes track the leftward-moving stimulus, both `rawEyeXNorm` and `eyeXNorm` have negative slope over time
2. **Saccade resets = positive slope**: Quick phase resets appear as sharp positive jumps
3. **Same polarity on ALL devices**: Never negate eyeXNorm — the convention holds on all screen widths and frame rates
4. **Anatomical labels throughout**: `L` always means subject's left eye (camera-right), `R` always means subject's right eye (camera-left)
5. **CSS mirror never stored**: The `scaleX(-1)` transform is applied to the video element only. All landmarks, CSV data, and sidecar JSON use unmirrored camera coordinates

## Sidecar JSON `coordinateSpace` Field

As of sidecar version 2, an optional `coordinateSpace` metadata block documents the convention:

```json
{
  "convention_version": "1.0",
  "camera_space": "mediapipe_face_mesh_normalized_0_1",
  "eye_normalized_space": "negated_within_eye_span",
  "anatomical_labels": true,
  "css_mirror_display_only": true,
  "leftward_tracking_slope": "negative"
}
```

Old sidecars (before this field was added) use the same convention — the field is additive documentation, not a behavioral change. Consumers can check for its presence: `if ('coordinateSpace' in sidecarData)`.

## Why Do Annotated Video Frames Look Mirrored?

The app's live preview uses CSS `scaleX(-1)` to show users a mirror image (selfie view). However, MediaPipe landmarks and all stored data are in unmirrored camera coordinates. This means:

- **Time-series plots** (eyeXNorm vs time) are unaffected — they show the correct waveform polarity regardless of CSS mirroring
- **Annotated video frames** (e.g., from `visualize_benchmark.py`) use camera-space pixel coordinates, which appear "flipped" compared to the live app preview
- This is **expected behavior**, not a bug — the data is correct, only the display is mirrored

## Relationship to ConVNG

ConVNG (DeepLabCut-based tracker) uses its own normalization:
- Strategy C: `(pupil_x - lateral_corner) / (medial_corner - lateral_corner)`
- This produces a ratio in approximately [0, 1]
- It is independent of the MediaPipe coordinate convention
- ConVNG scripts read raw landmarks and apply their own normalization — they are unaffected by sidecar coordinate metadata

## Related Modules

| Module | Responsibility |
|--------|---------------|
| `src/okn-core/eyeConvention.ts` | `selectEye()` and `normalizeEyeX()` — the camera→eye-normalized transform |
| `src/okn-core/coordinateConvention.ts` | `getCoordinateSpaceMetadata()` — sidecar metadata builder |
| `public/app.js` | Full pipeline: landmark capture → normalization → smoothing → CSV/sidecar output |
| `src/styles.css` | CSS `scaleX(-1)` on video element (display-only mirror) |

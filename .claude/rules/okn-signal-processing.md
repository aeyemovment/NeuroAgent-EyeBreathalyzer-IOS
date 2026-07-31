# OKN Signal Processing Rules

## Waveform Polarity (CRITICAL)

- **Stimulus moves LEFT** (`drawStimulus` uses `-stimPhase`)
- **Slow phases**: gradual NEGATIVE slope (eye follows leftward stimulus)
- **Saccades (quick phase resets)**: sharp POSITIVE jumps (full upward line, trough to peak)
- **NEVER negate eyeXNorm** — same polarity on ALL devices

## Phase Detection Thresholds

| Parameter | Value | Unit |
|-----------|-------|------|
| Saccade onset velocity | 1.5 | norm/s |
| Saccade offset velocity | 0.05 | norm/s |
| Slow phase velocity | < -0.05 | norm/s |
| Velocity window | ±5 frames | centered |
| Bridge gap max | 14 frames | (~230ms) |
| Min slow phase duration | 8 frames | (~130ms) |
| Median pre-filter | 5 samples | (if segments > ~20) |

## Saccade Detection Algorithm

1. Find frames where velocity > 1.5 norm/s (onset threshold)
2. Expand BACKWARD to local trough (where position starts rising)
3. Expand FORWARD until velocity drops below 0.05 norm/s (offset threshold)
4. The FULL upward line is the saccade, not just the peak frame

## Slow Phase Detection

1. Mark frames with smoothed velocity < -0.05 norm/s
2. Use ±5-frame centered velocity window to tolerate EMA holdover
3. Bridge slow phase fragments separated by ≤14 frames IF gap contains no saccade
4. Discard segments shorter than 8 frames

## K_GEO Calibration

- **K_GEO = 1714.1** (recalibrated 2026-03-12 on 28 post-fix recordings)
- Gain formula: `gainCal = |slopeNorm| * K_GEO / stimSpeed_px`
- Target sober median gain: ~0.9
- Validated: median=0.900, CV=0.302, 93% in [0.5, 1.4]

## Reference Implementation

[`hazyeyes-ml: analysis_csvs/device_invariance/phase_detector_tdd.py`](https://github.com/EvanBatten/hazyeyes-ml/blob/main/analysis_csvs/device_invariance/phase_detector_tdd.py) — the authoritative implementation.
All other phase detection code must match this behavior.

## Known Bugs in app.js (NOT YET FIXED)

1. Line ~2956: `slopeNorm > 0` INVERTED — rejects real slow phases
2. Line ~2973: `posChange < -SACCADE_DROP_NORM` INVERTED — targets slow phases instead of saccades
3. Line ~2213: `slopeNorm <= 0` INVERTED — discards valid slow phases

These bugs affect the in-app classification. The Python analysis pipeline uses the correct implementation.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

HazyEyes is an dementia research eye-tracking system using optokinetic nystagmus (OKN) eye tracking. A web app displays a moving-bar stimulus, tracks eye movements via MediaPipe Face Mesh, computes OKN gain, and produces research eye-movement signals.

**Safety-critical**: This system detects alcohol impairment. False negatives are dangerous. Treat data integrity and model validation with extreme care.

## Related Repos

| Repo | Purpose |
|------|---------|
| [hazyeyes-ml](https://github.com/EvanBatten/hazyeyes-ml) | ML training pipeline (CatBoost, Optuna, feature engineering, synthetic data) |
| [hazyeyes-no-baseline](https://github.com/EvanBatten/hazyeyes-no-baseline) | OpenNystagmus baseline-free video pipeline + validation frontend |
| [hazyeyes-archive](https://github.com/EvanBatten/hazyeyes-archive) | Completed experiments, legacy CTO pipeline, historical reference |

## Project Structure

- **public/app.js** — Core OKN tracking logic (~2700 lines vanilla JS): stimulus animation, MediaPipe integration, signal processing, gain computation, classification, CSV export
- **public/model_artifact.json** — Deployed CatBoost model artifact
- **src/App.tsx** — React wrapper with Clerk auth and Supabase integration
- **src/okn-core/** — TypeScript domain logic: calibration, diagnostics, upload helpers, coordinate conventions
- **supabase/** — Database schema (`okn_results` table)
- **validate_model_artifact.py** — Model safety gate (validates schema + drunk_recall >= 0.80)

## Development Commands

```bash
npm run dev          # Dev server on port 3000
npm run build        # Production build (Vite -> dist/)
npm run test         # Run unit tests
```

### Deployment

`vercel.json` has `buildCommand: ""` (empty) — no auto-deploys on push. Production is deployed manually:

```bash
npm run build && vercel --prod
```

## Model Promotion Workflow

When promoting an ML model from `hazyeyes-ml` to production:

1. Train model in hazyeyes-ml, validate metrics (drunk_recall, AUC, leakage tests)
2. Export `model_artifact.json` using `validate_model_artifact.py`
3. Open PR in this repo: place artifact in `public/model_artifact.json`
4. CI runs `validate_model_artifact.py` — blocks merge if schema invalid or safety thresholds unmet
5. `npm run test && npm run build` passes
6. Human reviews safety metrics, approves, deploys via `npm run build && vercel --prod`

## Architecture Details

### Frontend Data Flow
1. `calibrateDistance()` — Pre-test iris size check (target: 0.08 normalized units)
2. `drawStimulus(dt)` — Horizontal bars oscillate on 10s loop
3. MediaPipe Face Mesh tracks iris landmarks at ~30fps via `onResults()`
4. Signal processing: EMA smoothing (factor 0.25), saccade detection (acceleration threshold 6000 px/s²)
5. `analyzeOKN(samples)` — Least-squares OKN gain computation
6. `showDecision(result)` — Classification: gain >=1.0 unlikely, 0.75-1.0 possible, <0.75 likely impaired
7. CSV uploaded to Supabase Storage + row to `okn_results` table

### Environment Variables (.env.local)
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_BUCKET` — Supabase connection
- `VITE_CLERK_PUBLISHABLE_KEY` — Clerk authentication

### OKN Waveform Shape (confirmed by user 2026-03-12)
**Stimulus moves LEFT** (drawStimulus uses `-stimPhase`, so increasing phase = leftward stripe motion). The comment "left -> right" at line 421 of app.js is WRONG.

The OKN sawtooth waveform in eyeXNorm coordinates:
- **Slow phases**: Gradual **negative slope** — eye follows leftward stimulus. Due to signal noise, slow phases often get split into fragments. A good phase detector must bridge these gaps.
- **Quick phase resets (saccades)**: Sharp **positive jumps** — the FULL upward line (not just the peak frame) is the quick phase. This includes the entire rapid transition from trough to peak.

**CRITICAL BUGS in app.js segment builder (NOT YET FIXED):**
1. Line ~2956: `slopeNorm > 0` REJECTS all real slow phases and only captures saccade resets
2. Line ~2973: `posChange < -SACCADE_DROP_NORM` incorrectly targets slow phase motion instead of saccades
3. Line ~2213: `slopeNorm <= 0` rejection filter is inverted — discards valid slow phases

### K_GEO Calibration (recalibrated 2026-03-12)
- **K_GEO = 1714.1** — recalibrated using correct slow-phase segments from 28 post-fix recordings
- Gain formula: `gainCal = |slopeNorm| * K_GEO / stimSpeed_px` (note: absolute value since slow phases have negative slope)
- Target sober median gain: ~0.9. Validated: median=0.900, CV=0.302, 93% in [0.5, 1.4]

### Domain Rules (authoritative source)
- `.claude/rules/okn-signal-processing.md` — OKN waveform validation rules
- `.claude/rules/ml-data-integrity.md` — GroupKFold, SMOTE, leakage prevention
- `.claude/rules/ml-data-cutoff.md` — Data cutoff date and rationale

### Mobile Deployment
Capacitor wraps the Vite build for iOS/Android. App ID: `com.hazyeyes.app`. MediaPipe runs on-device (no server round-trips). Camera permissions required for eye tracking.

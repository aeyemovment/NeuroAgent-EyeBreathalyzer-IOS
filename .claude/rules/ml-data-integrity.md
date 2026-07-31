# ML Data Integrity Rules

**Safety-critical system.** False negatives (missing impaired subjects) are dangerous.

## Data Cutoff (CRITICAL)

- **Only use sessions after 2026-03-10.** Pre-fix data has inverted phase-detection bugs that corrupt OKN features.
- ML training uses [`data_loader.py`](https://github.com/EvanBatten/hazyeyes-ml/blob/main/analysis_csvs/makowski_experiment/data_loader.py) in **hazyeyes-ml** (enforces cutoff automatically). These rules apply when promoting models from that repo.
- **Do NOT use** `analysis/results/*.parquet` — that's pre-fix data from a different subject pool.
- See `.claude/rules/ml-data-cutoff.md` for full details.

## Cross-Validation

- **ALWAYS use GroupKFold with `subject_id` as the group key.** Never split the same subject across train and test sets.
- A subject's sober and drunk sessions must appear in the same fold.

## Feature Engineering

- **Feature-to-sample ratio**: max features = min_class_samples / 10
- Document every feature with its physical interpretation (what eye movement pattern does it capture?)
- All features must be computed per-session, never across sessions

## SMOTE / Oversampling

- **SMOTE applied INSIDE CV folds only** — never before splitting
- Apply to training fold after the split, before model fitting
- The test fold must always reflect the natural class distribution

## Leakage Prevention

- Run `test_leakage.py` (7 automated tests) before any model selection decision
- Never use test set metrics to tune hyperparameters
- Never use future data to predict past (temporal leakage)
- Feature computation must not use label information

## Data Validation

- Use Pandera schemas (`schemas.py`) at pipeline boundaries
- Validate raw data on load, feature matrix before training, predictions before evaluation
- Schema violations are hard failures — do not skip or coerce silently

## Anti-Patterns (NEVER do these)

1. Shuffling data before GroupKFold (destroys group integrity)
2. Computing features on the full dataset before splitting
3. Using accuracy as primary metric (meaningless with 80/20 imbalance)
4. Training on synthetic data without clearly marking it
5. Averaging metrics across folds without reporting per-fold variance

# ML Data Cutoff Rule

## Cutoff Date: 2026-03-10

**Only use OKN session data recorded AFTER 2026-03-10.**

### Why

Before this date, `app.js` had three inverted phase-detection bugs (lines ~2956, ~2973, ~2213) that caused:
- Slow phases rejected (slope sign inverted)
- Saccades misidentified as slow phases
- Valid slow phases discarded

These bugs corrupted all phase-dependent features (OKN gain, slow phase coverage, saccade metrics). The bugs were identified on 2026-03-12 and the cutoff set to 2026-03-10 to include only clean recordings.

### Two Data Sources — Do NOT Mix

| Source | Date Range | Subjects | Pipeline | Status |
|--------|-----------|----------|----------|--------|
| [`hazyeyes-ml: data_loader.py`](https://github.com/EvanBatten/hazyeyes-ml/blob/main/analysis_csvs/makowski_experiment/data_loader.py) | **Post 2026-03-10** | 10 subjects (8 with both labels) | Supabase → raw CSV → feature extraction | **Canonical for ML experiments** |
| Legacy `analysis/` pipeline (archived) | Pre-fix (older) | 7 subjects (different pool) | Separate windowed pipeline | **Archived to [hazyeyes-archive](https://github.com/EvanBatten/hazyeyes-archive) — do not use** |

These datasets have **different subjects** (only 3 overlap) and **different feature extraction pipelines**. Mixing them produces misleading results.

### Enforcement

- [`data_loader.py`](https://github.com/EvanBatten/hazyeyes-ml/blob/main/analysis_csvs/makowski_experiment/data_loader.py) in **hazyeyes-ml** enforces the cutoff via `CUTOFF_DATE = "2026-03-10"` in the Supabase query
- The legacy `analysis/` pipeline has been archived to [hazyeyes-archive](https://github.com/EvanBatten/hazyeyes-archive)
- When promoting models from hazyeyes-ml, verify the training data respects this cutoff

# Development Workflows

Quick-reference card for HazyEyes development workflows.

## Product Workflow (App/Frontend)

**Scope:** React, app.js, Supabase, Capacitor (root `src/`, `public/`)

```
/plan → /tdd → implement → npm test → npm build → /verify → /code-review → merge
```

**Pre-merge gates:** `npm run test` + `npm run build`

| Step | Command | Purpose |
|------|---------|---------|
| 1 | `/plan` | Design the change |
| 2 | `/tdd` | Tests first |
| 3 | Implement | Write the code |
| 4 | `npm run test && npm run build` | Verify locally |
| 5 | `/verify` | End-to-end check |
| 6 | `/code-review` | Review before merge |

## Model Promotion (ML → Production)

When promoting a model from [hazyeyes-ml](https://github.com/EvanBatten/hazyeyes-ml):

1. Finish ML experiment workflow (metrics validated, leakage tests pass)
2. Export `model_artifact.json` with `validate_model_artifact.py`
3. Open PR in this repo with updated `public/model_artifact.json`
4. CI validates model schema + safety metrics automatically
5. Human reviews, approves, deploys via `npm run build && vercel --prod`

## Key Rules

| Rule | Location |
|------|----------|
| OKN signal processing | `.claude/rules/okn-signal-processing.md` |
| ML data integrity | `.claude/rules/ml-data-integrity.md` |
| ML data cutoff | `.claude/rules/ml-data-cutoff.md` |

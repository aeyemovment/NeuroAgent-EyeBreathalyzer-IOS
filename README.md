# OpenDementia

**NeuroAgent open research app** for **dementia research** organizations.

Built on the HazyEyesIOS MediaPipe OKN / camera pipeline. In research use, may surface **OKN / eye-movement impairment-pattern signals associated with some dementia subtypes** and help **prioritize referral for targeted genetic testing** (e.g. C9ORF72). Research only — not a clinical diagnosis or genetic test.

| | |
|---|---|
| **Product code name** | **OpenDementia** |
| **Publisher** | NeuroAgent |
| **Local path** | `~/HazyEyesIOS-main` |
| **Contact** | info@neuroagentai.org |
| **Stack** | Vite + React + Capacitor + MediaPipe Face Mesh + OKN core |

```
research_prototype=true · dementia focus · non_commercial · not diagnostic
```

## App links

After deploy:

- Production: set on Vercel as `opendementia` (alias may be `neuroagent-eyebreathalyzer` until renamed)
- GitHub: https://github.com/aeyemovment/NeuroAgent-EyeBreathalyzer-IOS

## Quick start

```bash
cd ~/HazyEyesIOS-main
npm install
cp .env.example .env.local
# VITE_SUPABASE_* · VITE_CLERK_PUBLISHABLE_KEY
npm run dev
```

## Deploy

```bash
npm run build
vercel --prod
```

## Legal

- In-app research consent (Layer A)
- Modular consent master v0.9 in `legal/` — not auto-deployed as IRB participant form

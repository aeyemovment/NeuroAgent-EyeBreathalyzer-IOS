# NeuroAgent · EyeBreathalyzer (HazyEyesIOS-main)

**Correct app base:** this is the **HazyEyesIOS** MediaPipe OKN / camera app (not the RareNeuroScreen Next.js fork).

| | |
|---|---|
| **Publisher** | NeuroAgent |
| **Product** | EyeBreathalyzer research edition |
| **Repo folder** | `~/HazyEyesIOS-main` |
| **Stack** | Vite + React + Capacitor + MediaPipe Face Mesh + OKN core |
| **Lanes** | Autism (Mon 2026-08-03) · Dementia · Rare neuro — same UI, lane-specific language |
| **Contact** | info@neuroagentai.org |

```
research_prototype=true · not for diagnosis · not clinical screening · non_commercial research use
```

## What this is

The real **eye-tracking OKN protocol app** (from `HazyEyesIOS-main`):

1. Camera + MediaPipe Face Mesh  
2. Moving-bar OKN stimulus (`public/app.js`)  
3. Gain / signal analysis  
4. Baseline gate + upload helpers (`src/okn-core/`)  
5. Research consent + **research lane** switcher (autism / dementia / rare-neuro)  

Legacy alcohol-impairment **UI labels** are scrubbed in the research edition display; core OKN pipeline is preserved.

## Quick start

```bash
cd ~/HazyEyesIOS-main
npm install
cp .env.example .env.local
# VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_CLERK_PUBLISHABLE_KEY
npm run dev
```

Shareable lanes:

- `http://localhost:3000/?lane=autism`
- `http://localhost:3000/?lane=dementia`
- `http://localhost:3000/?lane=rare-neuro`

## Deploy

```bash
npm run build
vercel --prod
```

Suggested Vercel project name: `neuroagent-eyebreathalyzer` or keep linked to your iOS deploy pipeline.

## Mobile (Capacitor)

```bash
npm run build:prod
npx cap open ios
```

App ID: `org.neuroagentai.eyebreathalyzer`

## Legal

- In-app **Layer A** research consent (NeuroAgent / modular master referenced)  
- Modular master v0.9 in `legal/` — **not** auto-deployed as IRB participant form  
- Press pack in `press/` (update URLs after deploy)

## Related (do not confuse)

| Path / URL | Role |
|------------|------|
| `~/HazyEyesIOS-main` | **This app** — correct EyeBreathalyzer iOS/web OKN |
| `~/RareNeuroScreen` | Earlier Next.js synthetic simulator fork (not this camera OKN app) |
| focimeg-generative.vercel.app | Old HazyEyes synthetic preview |
| rareneuroscreen.vercel.app | Next.js fork deploy — **not** the primary iOS app |

## Source lineage

Copied from `Downloads/HazyEyesIOS-main` (EvanBatten/HazyEyesIOS lineage) and rebranded for NeuroAgent research double-launch.

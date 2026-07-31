# OpenDementia — Complete Package

**Status:** Live research preview · review before public social posts  
**Product:** OpenDementia  
**Publisher:** NeuroAgent  
**Focus:** Dementia research only  
**License:** Research Non-Commercial (see `LICENSE`)  

```
research_prototype=true · non_commercial=true · not_diagnostic=true
```

---

## 1) Where everything is

| Item | Location |
|------|----------|
| **Live app** | **https://opendementia.vercel.app** |
| **Alt URL** | https://neuroagent-eyebreathalyzer.vercel.app |
| **Local code** | `~/HazyEyesIOS-main` |
| **GitHub** | https://github.com/aeyemovment/NeuroAgent-EyeBreathalyzer-IOS |
| **Vercel project** | `hazy-eyes/opendementia` |
| **Primary contact** | info@neuroagentai.org |
| **Escalation** | kemarearlgreen@neuroagentai.org |

---

## 2) Product definition

| | |
|---|---|
| **Name** | OpenDementia |
| **What** | Open research OKN / MediaPipe eye-tracking app for dementia research orgs |
| **Base** | HazyEyesIOS (camera + Face Mesh + OKN core) |
| **Not** | Medical device · dementia diagnostic · clinical screening · commercial product without written license |
| **Stack** | Vite · React · Capacitor · MediaPipe · Supabase · Clerk (optional on public preview) |

---

## 3) Legal / consent package

### A. Non-commercialization copyright
- **File:** `LICENSE` — OpenDementia Research Non-Commercial License  
- **UI strings:** `src/copyright.ts`  
- **In-app:** dual acceptance (research-only + non-commercialization)  
- **Footer:** © 2026 NeuroAgent AI, Inc. / NeuroAgent · OpenDementia  

### B. Layer A — app access consent (live in UI)
- Research preview consent in `src/App.tsx` + landing in `src/main.tsx`  
- Contact: info@neuroagentai.org  
- Explicit non-diagnostic / non-commercial terms  

### C. Layer B — Modular Informed Consent Master v0.9 (archive)
- `legal/NeuroAgent_AI_Modular_Consent_Master_v0.9.docx`  
- `legal/modular_consent_master_v0.9.md`  
- **Status on master:** drafting template — **DO NOT DEPLOY** as universal participant consent  
- Use only after IRB localization + filled placeholders  

---

## 4) App features (current)

| Feature | Status |
|---------|--------|
| OpenDementia branding | Live |
| Dementia-only focus | Live |
| Research consent + non-commercial checkboxes | Live |
| Copyright notice in UI | Live |
| Full camera OKN protocol | Needs Clerk + Supabase env on Vercel |
| MediaPipe / OKN core (`public/app.js`, `src/okn-core/`) | In repo |
| Capacitor iOS/Android shell | In repo (`org.neuroagentai.opendementia`) |

### Env for full protocol (Vercel → opendementia → Environment Variables)
```
VITE_CLERK_PUBLISHABLE_KEY=
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_SUPABASE_BUCKET=okn-results-v2
```
Then redeploy.

---

## 5) Press / social package (files)

| File | Purpose |
|------|---------|
| `press/X_POSTS.txt` | X / Twitter drafts |
| `press/LINKEDIN_POST.txt` | LinkedIn draft |
| `press/INSTAGRAM_CAPTION.txt` | Instagram caption + story overlays |
| `press/PRESS_ARTICLE_EN_2026-08-03.md` | English press article |
| `press/PRESS_ARTICLE_FR_2026-08-03.md` | French press article |
| `press/PRESS_SOCIAL_RELEASE_2026-08-03.md` | Full social + wire pack |
| `press/REVIEW_PACKAGE_FULL.md` | Review matrix (needs URL refresh to opendementia.vercel.app) |
| `press/PRESS_CORRECT_APP.md` | Correct-app note |

**Canonical public URL for all press:** https://opendementia.vercel.app  

**Do not promote as primary:** rareneuroscreen.vercel.app (wrong app / Next.js fork)

### Ready-to-post drafts (OpenDementia)

**X**
```
OpenDementia is live — NeuroAgent open research eye-tracking for dementia research orgs.

Research only. Not a diagnostic.
Non-commercial license.

→ https://opendementia.vercel.app
info@neuroagentai.org
```

**LinkedIn**
```
NeuroAgent is opening OpenDementia — an open research OKN / MediaPipe eye-tracking app for dementia research organizations.

• Research and education use only
• Research Non-Commercial License (no commercial use without written license)
• Not a medical device · not for diagnosis or clinical screening

Preview: https://opendementia.vercel.app
GitHub: https://github.com/aeyemovment/NeuroAgent-EyeBreathalyzer-IOS
Contact: info@neuroagentai.org
```

**Instagram**
```
OpenDementia is live.

NeuroAgent open research for dementia research orgs
OKN eye-tracking · research only
🚫 Not a diagnostic
📜 Non-commercial license

Link in bio → opendementia.vercel.app
info@neuroagentai.org

#OpenDementia #NeuroAgent #DementiaResearch #ResearchOnly
```

---

## 6) Who reviews what

| Reviewer | Required? | Scope |
|----------|-----------|--------|
| **CEO (Kemar)** | **Yes** | Final APPROVE before social posts |
| **Legal / claims** | **Yes** for press + consent language; **Yes** before IRB study | Non-commercial + modular master |
| **Technical co-builder (HazyEyesIOS lineage)** | Recommended | Camera OKN, baseline, model safety |
| **Clinical advisor** | Recommended | Dementia claim-safety |
| **CCO / iDrunk / fleet** | No | Wrong lane |

**Minimum to post socials:** CEO APPROVE  
**Minimum for human-subjects study:** IRB + localized Layer B + legal  

---

## 7) Repo map (important paths)

```
~/HazyEyesIOS-main/
├── LICENSE                 # Research Non-Commercial
├── README.md
├── COMPLETE_PACKAGE.md     # this file
├── src/
│   ├── App.tsx             # main OKN UI + full consent
│   ├── main.tsx            # landing + Clerk optional
│   ├── copyright.ts        # non-commercial strings
│   ├── researchLanes.ts    # dementia-only
│   └── okn-core/           # baseline, calibration, upload
├── public/app.js           # MediaPipe OKN protocol
├── legal/                  # modular consent master v0.9
├── press/                  # social + articles
├── supabase/               # migrations
└── capacitor.config.ts     # iOS app id org.neuroagentai.opendementia
```

---

## 8) Related but not this product

| Path / URL | Note |
|------------|------|
| `~/RareNeuroScreen` | Earlier Next.js synthetic sim fork — not OpenDementia |
| rareneuroscreen.vercel.app | Do not use as primary |
| idrunk-hazyeyes.vercel.app | HazyEyes public safety — separate |
| focimeg-generative.vercel.app | Old HazyEyes synthetic preview |

---

## 9) Operator checklist

- [ ] Open https://opendementia.vercel.app — loads OpenDementia  
- [ ] Accept research + non-commercial checkboxes  
- [ ] Confirm copyright footer visible  
- [ ] Add Clerk + Supabase env for full OKN  
- [ ] CEO APPROVE press before posting  
- [ ] info@neuroagentai.org monitored  

---

*Last updated: 2026-07-31 · OpenDementia complete package*

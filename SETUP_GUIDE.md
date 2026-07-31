# Environment Setup Guide

Step-by-step instructions for getting the HazyEyes production app running locally.

## Prerequisites

- Node.js 20+
- npm
- Git

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/EvanBatten/HazyEyesIOS.git
cd HazyEyesIOS

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env.local
# Fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_BUCKET, VITE_CLERK_PUBLISHABLE_KEY

# 4. Run dev server
npm run dev

# 5. Run tests
npm run test

# 6. Build for production
npm run build
```

## Vercel Deployment

The project uses manual deployments. `vercel.json` has `buildCommand: ""` (empty) — pushes to main do NOT trigger auto-deploys.

```bash
# Link to the Vercel project (first time only)
vercel link

# Deploy to production
npm run build && vercel --prod
```

## Mobile (Capacitor)

```bash
npm run build:prod   # Build + Capacitor sync
npm run open:ios     # Open Xcode project
```

## Related Repos

For ML experiments, video pipeline, or archived experiments, see the related repos listed in [README.md](README.md#related-repos).

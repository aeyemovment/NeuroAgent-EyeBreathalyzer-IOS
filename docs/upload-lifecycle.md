# Upload Lifecycle

## Overview

When a test completes, the app uploads results to Supabase asynchronously. The upload does NOT block the results display — users see their results immediately while upload happens in the background.

## Event Flow

```
Test completes
  │
  ├─▶ test-complete event (immediate, detail has no supabaseRowId yet)
  │     → React shows results screen
  │
  └─▶ upload-state-change { phase: 'uploading' }
        │
        ├─▶ Success: upload-state-change { phase: 'complete', supabaseRowId, csvPath }
        │     → React can now submit BAC/metadata to this row
        │
        └─▶ Failure: upload-state-change { phase: 'failed', error }
              → React shows error, BAC submission disabled
```

## BAC Queue Behavior

Users can fill in research metadata (BAC, subject number, camera position) while the upload is in progress:

| Upload Phase | User Action | Result |
|---|---|---|
| `uploading` | Clicks "Save" | Metadata queued; auto-submitted when upload completes |
| `complete` | Clicks "Save" | Metadata submitted immediately to the Supabase row |
| `failed` | Clicks "Save" | Error shown; button disabled |
| `idle` | Clicks "Save" | Error: upload not started |

## Implementation

- **app.js**: Dispatches `test-complete` (unchanged) and `upload-state-change` events
- **uploadHelpers.ts**: Pure decision logic (`resolveBacAction`, `parseUploadEvent`)
- **App.tsx**: React state management — `uploadPhase`, `uploadRowId`, `pendingMetadata` state; auto-submit effect

## Known Gap: Failed Upload = Data Loss

If the upload fails and the user closes the app, the CSV and video blob are lost. There is no offline persistence or retry mechanism.

**Mitigation (deferred):** IndexedDB persistence of test artifacts for retry on next session.

This is documented as a known limitation of a safety-critical system. Any failed upload should be investigated.

-- Migration: Add sidecar_json_path and capture_completeness to okn_results_v2
-- Run this in Supabase SQL Editor BEFORE deploying the updated app.js
--
-- sidecar_json_path: storage path to the per-frame iris landmark JSON sidecar
-- capture_completeness: which artifacts uploaded ('csv', 'csv+video', 'csv+json', 'csv+video+json')

ALTER TABLE public.okn_results_v2
  ADD COLUMN IF NOT EXISTS sidecar_json_path text;

ALTER TABLE public.okn_results_v2
  ADD COLUMN IF NOT EXISTS capture_completeness text;

-- Backfill existing rows: they have csv (always) + video_path (if present)
UPDATE public.okn_results_v2
SET capture_completeness = CASE
  WHEN video_path IS NOT NULL THEN 'csv+video'
  ELSE 'csv'
END
WHERE capture_completeness IS NULL;

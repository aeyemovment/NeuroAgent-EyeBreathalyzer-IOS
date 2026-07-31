-- Migration: Create archive table and move unusable sessions
-- Run this in Supabase SQL Editor
-- Date: 2026-04-04
--
-- Archives:
--   1. ALL okn_results (v1) pre-fix data (418 rows, Nov 2025 – Mar 2026)
--   2. Anonymous v2 sessions with no user_id (34 rows)
--   3. Unlabeled test sessions from non-dev subjects (78 rows)
--
-- Keeps in okn_results_v2:
--   - All labeled sessions (BAC present)
--   - Baseline sessions (session_type='baseline')
--   - Dev user (ebatten28, evan@hazyeyesai) unlabeled sessions (just labeled)

-- Step 1: Create archive table (superset of v1 + v2 columns)
CREATE TABLE IF NOT EXISTS public.okn_results_archive (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ,
  tester_id TEXT,
  bac FLOAT,
  device TEXT,
  okn_gain_auto FLOAT,
  csv_path TEXT,
  user_id TEXT,
  classifier_probability FLOAT,
  prediction_result TEXT,
  quality_score FLOAT,
  n_usable_samples INT,
  -- v2-only columns (NULL for v1 rows)
  gain_raw FLOAT,
  gain_median_raw FLOAT,
  gain_calibrated FLOAT,
  gain_cal_median FLOAT,
  theil_sen_velocity_norm FLOAT,
  r_squared FLOAT,
  slow_phase_coverage FLOAT,
  slow_phase_segments INT,
  slow_phase_median_velocity_norm FLOAT,
  slow_phase_mean_velocity_norm FLOAT,
  observed_range_norm FLOAT,
  cal_factor FLOAT,
  stim_velocity_norm FLOAT,
  pass_quality BOOLEAN,
  selected_eye TEXT,
  rejection_stats JSONB,
  classifier_features JSONB,
  camera_position TEXT,
  video_path TEXT,
  sidecar_json_path TEXT,
  capture_completeness TEXT,
  session_type TEXT,
  ml_features JSONB,
  baseline_gain_cal FLOAT,
  -- Archive metadata
  archived_at TIMESTAMPTZ DEFAULT now(),
  archive_reason TEXT,
  source_table TEXT  -- 'okn_results' or 'okn_results_v2'
);

-- Step 2: RLS policies
ALTER TABLE public.okn_results_archive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read archive"
  ON public.okn_results_archive
  FOR SELECT USING (true);

CREATE POLICY "Allow anon insert archive"
  ON public.okn_results_archive
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anon delete archive"
  ON public.okn_results_archive
  FOR DELETE USING (true);

-- Step 3: Move ALL v1 data (pre-fix, different subject pool, buggy phase detection)
INSERT INTO public.okn_results_archive (
  id, created_at, tester_id, bac, device, okn_gain_auto, csv_path,
  user_id, classifier_probability, prediction_result, quality_score,
  n_usable_samples, archive_reason, source_table
)
SELECT
  id, created_at, tester_id, bac, device, okn_gain_auto, csv_path,
  user_id, classifier_probability, prediction_result, quality_score,
  n_usable_samples, 'pre_fix_data', 'okn_results'
FROM public.okn_results
ON CONFLICT (id) DO NOTHING;

-- Step 4: Move anonymous v2 sessions (no user_id)
INSERT INTO public.okn_results_archive (
  id, created_at, tester_id, bac, device, okn_gain_auto, csv_path,
  user_id, classifier_probability, prediction_result, quality_score,
  n_usable_samples, gain_raw, gain_median_raw, gain_calibrated,
  gain_cal_median, theil_sen_velocity_norm, r_squared,
  slow_phase_coverage, slow_phase_segments,
  slow_phase_median_velocity_norm, slow_phase_mean_velocity_norm,
  observed_range_norm, cal_factor, stim_velocity_norm, pass_quality,
  selected_eye, rejection_stats, classifier_features, camera_position,
  video_path, sidecar_json_path, capture_completeness,
  session_type, ml_features, baseline_gain_cal,
  archive_reason, source_table
)
SELECT
  id, created_at, tester_id, bac, device, okn_gain_auto, csv_path,
  user_id, classifier_probability, prediction_result, quality_score,
  n_usable_samples, gain_raw, gain_median_raw, gain_calibrated,
  gain_cal_median, theil_sen_velocity_norm, r_squared,
  slow_phase_coverage, slow_phase_segments,
  slow_phase_median_velocity_norm, slow_phase_mean_velocity_norm,
  observed_range_norm, cal_factor, stim_velocity_norm, pass_quality,
  selected_eye, rejection_stats, classifier_features, camera_position,
  video_path, sidecar_json_path, capture_completeness,
  session_type, ml_features, baseline_gain_cal,
  'anonymous_no_user_id', 'okn_results_v2'
FROM public.okn_results_v2
WHERE user_id IS NULL
ON CONFLICT (id) DO NOTHING;

-- Step 5: Move unlabeled test sessions from non-dev subjects
INSERT INTO public.okn_results_archive (
  id, created_at, tester_id, bac, device, okn_gain_auto, csv_path,
  user_id, classifier_probability, prediction_result, quality_score,
  n_usable_samples, gain_raw, gain_median_raw, gain_calibrated,
  gain_cal_median, theil_sen_velocity_norm, r_squared,
  slow_phase_coverage, slow_phase_segments,
  slow_phase_median_velocity_norm, slow_phase_mean_velocity_norm,
  observed_range_norm, cal_factor, stim_velocity_norm, pass_quality,
  selected_eye, rejection_stats, classifier_features, camera_position,
  video_path, sidecar_json_path, capture_completeness,
  session_type, ml_features, baseline_gain_cal,
  archive_reason, source_table
)
SELECT
  id, created_at, tester_id, bac, device, okn_gain_auto, csv_path,
  user_id, classifier_probability, prediction_result, quality_score,
  n_usable_samples, gain_raw, gain_median_raw, gain_calibrated,
  gain_cal_median, theil_sen_velocity_norm, r_squared,
  slow_phase_coverage, slow_phase_segments,
  slow_phase_median_velocity_norm, slow_phase_mean_velocity_norm,
  observed_range_norm, cal_factor, stim_velocity_norm, pass_quality,
  selected_eye, rejection_stats, classifier_features, camera_position,
  video_path, sidecar_json_path, capture_completeness,
  session_type, ml_features, baseline_gain_cal,
  'unlabeled_test_no_bac', 'okn_results_v2'
FROM public.okn_results_v2
WHERE bac IS NULL
  AND (session_type = 'test' OR session_type IS NULL)
  AND user_id IS NOT NULL
  AND user_id NOT IN ('ebatten28@gmail.com', 'evan@hazyeyesai.com')
ON CONFLICT (id) DO NOTHING;

-- Step 6: Delete archived rows from v2
DELETE FROM public.okn_results_v2
WHERE user_id IS NULL;

DELETE FROM public.okn_results_v2
WHERE bac IS NULL
  AND (session_type = 'test' OR session_type IS NULL)
  AND user_id IS NOT NULL
  AND user_id NOT IN ('ebatten28@gmail.com', 'evan@hazyeyesai.com');

-- Step 7: Verify counts (run after migration)
SELECT
  (SELECT count(*) FROM public.okn_results_v2) AS v2_remaining,
  (SELECT count(*) FROM public.okn_results_archive) AS archive_total,
  (SELECT count(*) FROM public.okn_results_archive WHERE source_table = 'okn_results') AS from_v1_prefix,
  (SELECT count(*) FROM public.okn_results_archive WHERE archive_reason = 'anonymous_no_user_id') AS anonymous,
  (SELECT count(*) FROM public.okn_results_archive WHERE archive_reason = 'unlabeled_test_no_bac') AS unlabeled_tests;

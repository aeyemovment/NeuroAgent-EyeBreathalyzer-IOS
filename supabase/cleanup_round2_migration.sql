-- Migration: Second round cleanup — new data from April 4
-- Run this in Supabase SQL Editor
-- Date: 2026-04-05
--
-- Archives 7 unlabeled test sessions from non-dev subjects
-- Recovers 1 misclassified baseline (bosleyjill)

-- Step 1: Recover bosleyjill's misclassified baseline
-- She has 0 baselines and 1 unlabeled v4 test — this is her baseline
UPDATE public.okn_results_v2
SET session_type = 'baseline'
WHERE id = '429345ed-b7a2-4fc2-81f0-4e8d82bd3a3b'
  AND user_id = 'bosleyjill@gmail.com'
  AND session_type = 'test'
  AND bac IS NULL;

-- Step 2: Archive unlabeled tests from non-dev subjects
-- midian879 (2), jessicabosley412 (2), oscarjackburke999 (3)
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
  AND session_type = 'test'
  AND user_id IN (
    'midian879@gmail.com',
    'jessicabosley412@gmail.com',
    'oscarjackburke999@gmail.com'
  )
  AND created_at > '2026-04-04T04:00:00+00:00'
ON CONFLICT (id) DO NOTHING;

-- Step 3: Delete archived rows from v2
DELETE FROM public.okn_results_v2
WHERE bac IS NULL
  AND session_type = 'test'
  AND user_id IN (
    'midian879@gmail.com',
    'jessicabosley412@gmail.com',
    'oscarjackburke999@gmail.com'
  )
  AND created_at > '2026-04-04T04:00:00+00:00';

-- Step 4: Verify
SELECT
  (SELECT count(*) FROM public.okn_results_v2) AS v2_remaining,
  (SELECT count(*) FROM public.okn_results_archive) AS archive_total,
  (SELECT count(*) FROM public.okn_results_v2 WHERE session_type = 'baseline' AND user_id = 'bosleyjill@gmail.com') AS bosleyjill_baselines;

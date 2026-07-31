-- Migration: Recover misclassified baseline sessions from archive
-- Run this in Supabase SQL Editor
-- Date: 2026-04-04
--
-- Bug: session_type defaulted to 'test' when window.__SESSION_TYPE__ was null/undefined.
-- This caused baseline sessions to be tagged as 'test' and then archived as unlabeled.
-- Recovery: move these 11 sessions back to okn_results_v2 with session_type='baseline'.

-- Step 1: Copy recovered sessions back to v2 with corrected session_type
INSERT INTO public.okn_results_v2 (
  id, created_at, tester_id, bac, device, okn_gain_auto, csv_path,
  user_id, classifier_probability, prediction_result, quality_score,
  n_usable_samples, gain_raw, gain_median_raw, gain_calibrated,
  gain_cal_median, theil_sen_velocity_norm, r_squared,
  slow_phase_coverage, slow_phase_segments,
  slow_phase_median_velocity_norm, slow_phase_mean_velocity_norm,
  observed_range_norm, cal_factor, stim_velocity_norm, pass_quality,
  selected_eye, rejection_stats, classifier_features, camera_position,
  video_path, sidecar_json_path, capture_completeness,
  session_type, ml_features, baseline_gain_cal
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
  'baseline',  -- CORRECTED: was 'test'
  ml_features, baseline_gain_cal
FROM public.okn_results_archive
WHERE id IN (
  '222faf1e-be05-4bc1-882b-e80fddd9296f',
  '73cae90e-268f-4b61-9fc3-b1e8eaf560c8',
  'eb7e15f5-7f81-46bd-a2cc-8fe1f5d7cde7',
  '2a25b58e-8fb3-4ec3-b986-4f77c5747ccf',
  '20dabdac-3851-4b00-ab3e-dc1ba00c80e0',
  'e9188152-61fd-498d-9d59-2a3f20c0ddd6',
  '6a77e856-3957-42b9-88ea-fec809b5872c',
  '46c4ccba-4835-465c-b7db-e0c289bd37f3',
  'b7d69f69-68fa-40cc-b6cf-c629449d324f',
  '346fce9f-f70d-44cb-a689-4cae82c8015f',
  '28e571be-a810-45d1-9628-a575268f46a5'
)
ON CONFLICT (id) DO NOTHING;

-- Step 2: Remove recovered sessions from archive
DELETE FROM public.okn_results_archive
WHERE id IN (
  '222faf1e-be05-4bc1-882b-e80fddd9296f',
  '73cae90e-268f-4b61-9fc3-b1e8eaf560c8',
  'eb7e15f5-7f81-46bd-a2cc-8fe1f5d7cde7',
  '2a25b58e-8fb3-4ec3-b986-4f77c5747ccf',
  '20dabdac-3851-4b00-ab3e-dc1ba00c80e0',
  'e9188152-61fd-498d-9d59-2a3f20c0ddd6',
  '6a77e856-3957-42b9-88ea-fec809b5872c',
  '46c4ccba-4835-465c-b7db-e0c289bd37f3',
  'b7d69f69-68fa-40cc-b6cf-c629449d324f',
  '346fce9f-f70d-44cb-a689-4cae82c8015f',
  '28e571be-a810-45d1-9628-a575268f46a5'
);

-- Step 3: Verify — every user should now have 2+ baselines
SELECT
  user_id,
  count(*) AS baseline_count
FROM public.okn_results_v2
WHERE session_type = 'baseline'
GROUP BY user_id
ORDER BY user_id;

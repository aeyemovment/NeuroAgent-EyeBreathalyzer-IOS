-- Migration: Create uncertain_BAC_tests table
-- For tests where the user provides a sober/drunk self-report but no breathalyzer BAC.
-- Same schema as okn_results_v2 + a self_report_label column.

CREATE TABLE IF NOT EXISTS public.uncertain_bac_tests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),

  -- Same fields as okn_results_v2
  user_id text,
  tester_id text,
  bac double precision,
  device text,
  okn_gain_auto double precision,
  csv_path text,
  classifier_probability double precision,
  prediction_result text,
  quality_score double precision,
  n_usable_samples integer,
  gain_raw double precision,
  gain_median_raw double precision,
  gain_calibrated double precision,
  gain_cal_median double precision,
  theil_sen_velocity_norm double precision,
  r_squared double precision,
  slow_phase_coverage double precision,
  slow_phase_segments integer,
  slow_phase_median_velocity_norm double precision,
  slow_phase_mean_velocity_norm double precision,
  observed_range_norm double precision,
  cal_factor double precision,
  stim_velocity_norm double precision,
  pass_quality boolean,
  selected_eye text,
  rejection_stats jsonb,
  classifier_features jsonb,
  video_path text,
  sidecar_json_path text,
  capture_completeness text,
  session_type text,
  ml_features jsonb,
  baseline_gain_cal double precision,
  camera_position text,

  -- Additional field for self-reported label
  self_report_label text NOT NULL CHECK (self_report_label IN ('sober', 'drunk'))
);

-- RLS: allow anon insert and select
ALTER TABLE public.uncertain_bac_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon insert uncertain" ON public.uncertain_bac_tests;
CREATE POLICY "Allow anon insert uncertain"
  ON public.uncertain_bac_tests
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon select uncertain" ON public.uncertain_bac_tests;
CREATE POLICY "Allow anon select uncertain"
  ON public.uncertain_bac_tests
  FOR SELECT
  USING (true);

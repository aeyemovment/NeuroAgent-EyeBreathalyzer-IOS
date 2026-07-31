-- Migration: Add sober-baseline workflow columns to okn_results_v2
-- Run this in Supabase SQL Editor AFTER the base okn_results_v2 table exists
-- Backwards-compatible: existing rows get session_type='test' by default

-- session_type: 'baseline' (sober calibration) or 'test' (impairment check)
ALTER TABLE public.okn_results_v2
  ADD COLUMN IF NOT EXISTS session_type TEXT DEFAULT 'test';

-- ml_features: JSON blob storing the 3 C2-alt features for baseline retrieval
-- {saccade_frequency: float, gaze_entropy: float, accel_kurtosis: float}
ALTER TABLE public.okn_results_v2
  ADD COLUMN IF NOT EXISTS ml_features JSONB;

-- baseline_gain_cal: gain at baseline time, for researcher audit of drunk-baseline risk
ALTER TABLE public.okn_results_v2
  ADD COLUMN IF NOT EXISTS baseline_gain_cal FLOAT;

-- Migration: Add camera_position to okn_results_v2 and enable updates
-- Run this in Supabase SQL Editor AFTER the base okn_results_v2 table exists

-- Add camera_position column (left or right camera orientation)
ALTER TABLE public.okn_results_v2
  ADD COLUMN IF NOT EXISTS camera_position text;

-- Allow anon updates (so React can update rows with researcher-provided fields)
DROP POLICY IF EXISTS "Allow anon update v2" ON public.okn_results_v2;
CREATE POLICY "Allow anon update v2"
  ON public.okn_results_v2
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

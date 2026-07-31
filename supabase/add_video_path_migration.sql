-- Migration: Add video_path to okn_results_v2 and set up video storage bucket policies
-- Run this in Supabase SQL Editor

-- Add video_path column
ALTER TABLE public.okn_results_v2
  ADD COLUMN IF NOT EXISTS video_path text;

-- Storage policies for okn-videos bucket
-- NOTE: Create the 'okn-videos' bucket manually in Supabase Dashboard > Storage > New bucket (private)

DROP POLICY IF EXISTS "Allow anon upload to okn-videos" ON storage.objects;
CREATE POLICY "Allow anon upload to okn-videos"
  ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'okn-videos');

DROP POLICY IF EXISTS "Allow anon read from okn-videos" ON storage.objects;
CREATE POLICY "Allow anon read from okn-videos"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'okn-videos');

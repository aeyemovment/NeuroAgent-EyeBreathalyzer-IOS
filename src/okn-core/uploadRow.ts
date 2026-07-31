/**
 * Pure function to build the Supabase row object for upload.
 *
 * Extracted from uploadResultsToSupabase() in app.js to fix a race condition:
 * session_type was previously read from window.__SESSION_TYPE__ AFTER async
 * storage uploads. If handleFinish() reset it to 'test' before the row was
 * constructed, baseline sessions got uploaded as 'test'.
 *
 * This function takes sessionType as an explicit parameter (captured eagerly
 * at upload start) instead of reading from the mutable global.
 */

export interface BuildUploadRowParams {
  sessionType: string
  userEmail: string | null
  result: Record<string, any> | null
  // Optional fields passed through from app.js
  objectPath?: string
  videoPath?: string | null
  sidecarJsonPath?: string | null
  captureCompleteness?: string
  selectedEye?: string | null
}

export function buildUploadRow(params: BuildUploadRowParams) {
  const {
    sessionType: rawSessionType,
    userEmail,
    result,
    objectPath = '',
    videoPath = null,
    sidecarJsonPath = null,
    captureCompleteness = 'csv',
    selectedEye = null,
  } = params

  const sessionType = rawSessionType || 'test'

  const nUsable = result && result.classifierFeatures && typeof result.classifierFeatures.n_samples === 'number'
    ? result.classifierFeatures.n_samples : null

  const predictionResult = result && result.decision ? String(result.decision) : null

  return {
    user_id: userEmail,
    tester_id: result && result.testerId ? String(result.testerId) : null,
    bac: result && typeof result.bac === 'number' && Number.isFinite(result.bac) ? result.bac : null,
    okn_gain_auto: result && typeof result.gain === 'number' && Number.isFinite(result.gain) ? result.gain : null,
    csv_path: objectPath,
    classifier_probability: result && typeof result.classifierProbability === 'number' && Number.isFinite(result.classifierProbability) ? result.classifierProbability : null,
    prediction_result: predictionResult,
    quality_score: result && typeof result.quality === 'number' && Number.isFinite(result.quality) ? result.quality : null,
    n_usable_samples: nUsable,
    gain_raw: result && typeof result.gainRaw === 'number' && Number.isFinite(result.gainRaw) ? result.gainRaw : null,
    gain_median_raw: result && typeof result.gainMedianRaw === 'number' && Number.isFinite(result.gainMedianRaw) ? result.gainMedianRaw : null,
    gain_calibrated: result && typeof result.gainCalibrated === 'number' && Number.isFinite(result.gainCalibrated) ? result.gainCalibrated : null,
    gain_cal_median: result && typeof result.gainCalMedian === 'number' && Number.isFinite(result.gainCalMedian) ? result.gainCalMedian : null,
    theil_sen_velocity_norm: result && typeof result.theilSenVelocityNorm === 'number' && Number.isFinite(result.theilSenVelocityNorm) ? result.theilSenVelocityNorm : null,
    r_squared: result && typeof result.r2 === 'number' && Number.isFinite(result.r2) ? result.r2 : null,
    slow_phase_coverage: result && typeof result.slowPhaseCoverage === 'number' && Number.isFinite(result.slowPhaseCoverage) ? result.slowPhaseCoverage : null,
    slow_phase_segments: result && typeof result.slowPhaseSegments === 'number' ? result.slowPhaseSegments : null,
    slow_phase_median_velocity_norm: result && typeof result.slowPhaseMedianVelocityNorm === 'number' && Number.isFinite(result.slowPhaseMedianVelocityNorm) ? result.slowPhaseMedianVelocityNorm : null,
    slow_phase_mean_velocity_norm: result && typeof result.slowPhaseMeanVelocityNorm === 'number' && Number.isFinite(result.slowPhaseMeanVelocityNorm) ? result.slowPhaseMeanVelocityNorm : null,
    observed_range_norm: result && typeof result.observedRangeNorm === 'number' && Number.isFinite(result.observedRangeNorm) ? result.observedRangeNorm : null,
    cal_factor: result && typeof result.calFactor === 'number' && Number.isFinite(result.calFactor) ? result.calFactor : null,
    stim_velocity_norm: result && typeof result.stimVelocityNorm === 'number' && Number.isFinite(result.stimVelocityNorm) ? result.stimVelocityNorm : null,
    pass_quality: result ? !!result.passQuality : null,
    selected_eye: selectedEye,
    rejection_stats: result && result.rejectionStats ? result.rejectionStats : null,
    classifier_features: result && result.classifierFeatures ? result.classifierFeatures : null,
    video_path: videoPath,
    sidecar_json_path: sidecarJsonPath,
    capture_completeness: captureCompleteness,
    // FIX: session_type uses the captured value, not a late-read global
    session_type: sessionType,
    ml_features: result && result.baselineRawFeatures ? {
      gaze_transition_entropy: result.baselineRawFeatures.gaze_transition_entropy,
      saccade_frequency: result.baselineRawFeatures.saccade_frequency,
      _version: 4,
    } : null,
    baseline_gain_cal: (sessionType === 'baseline' && result && isFinite(result.gainCalMedian))
      ? result.gainCalMedian : null,
  }
}

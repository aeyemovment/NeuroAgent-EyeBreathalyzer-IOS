/**
 * OpenDementia — ALS-FTD / C9ORF72 trial-interest research protocol
 *
 * RESEARCH PROTOTYPE ONLY.
 * Does NOT diagnose ALS, FTD, ALS-FTD, or C9ORF72 genotype.
 * Genetic confirmation is required for any gene-specific clinical trial.
 * Outputs are exploratory research signals for investigator-facing trial referral workflows.
 */

export const C9_PROTOCOL_ID = 'opendementia-c9orf72-als-ftd-v0.1'

export const C9_PROTOCOL = {
  id: C9_PROTOCOL_ID,
  name: 'ALS-FTD · C9ORF72 trial-interest research flag',
  version: '0.1',
  mutation: 'C9ORF72 (hexanucleotide repeat expansion) — gene-specific trials',
  phenotype: 'ALS-FTD spectrum (research framing)',
  purpose:
    'Help dementia / ALS research teams flag participants who may warrant referral to C9ORF72 gene-specific clinical-trial screening workflows. Not a genetic test.',
  demoVideo: '/demo/okn_demo_c9orf72.mp4',
  demoPoster: '/demo/frames/frame_01.jpg',
  collaborateUrl:
    'https://www.theneuroagentai.com/collaborate?source=OpenDementia&protocol=C9ORF72-ALS-FTD&app=https%3A%2F%2Fopendementia.vercel.app',
  nonClaims: [
    'Does not diagnose ALS, FTD, or ALS-FTD.',
    'Does not detect or confirm C9ORF72 genotype.',
    'Does not replace clinical evaluation, EMG, imaging, or genetic counseling/testing.',
    'Trial eligibility is determined only by the trial protocol and genetic confirmation.',
    'Demo analysis on uploaded/sample video is synthetic / illustrative for research workflow design.',
  ],
  researchFlags: [
    { id: 'saccade_irregularity', label: 'Saccade irregularity index (research)', unit: '0–1' },
    { id: 'pursuit_gain_asym', label: 'Pursuit gain asymmetry (research)', unit: '0–1' },
    { id: 'fixation_instability', label: 'Fixation instability index (research)', unit: '0–1' },
    { id: 'okn_fatigue', label: 'OKN fatigue slope (research)', unit: 'a.u.' },
    { id: 'composite_c9_interest', label: 'Composite C9 trial-interest flag (research)', unit: '0–1' },
  ],
} as const

export type C9ResearchResult = {
  protocolId: string
  analyzedAt: string
  source: 'demo_video' | 'live_session'
  demoFile: string
  /** Illustrative research signals only */
  metrics: Record<string, number>
  /** low | moderate | elevated — research interest only */
  trialInterestBand: 'low' | 'moderate' | 'elevated'
  investigatorSummary: string
  requiredNextSteps: string[]
  disclaimers: string[]
  syntheticOnly: true
  researchPrototype: true
  notGeneticTest: true
  notDiagnostic: true
}

/** Deterministic pseudo-metrics from demo context for workflow demos (not clinical). */
export function runDemoC9ResearchAnalysis(seed = 'eyebreathalyzer-3-demo'): C9ResearchResult {
  // Stable hash-like values from seed so demos are reproducible
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const r = (n: number) => ((h + n * 9973) % 1000) / 1000

  const saccade = Number((0.35 + r(1) * 0.45).toFixed(3))
  const pursuit = Number((0.28 + r(2) * 0.5).toFixed(3))
  const fixation = Number((0.3 + r(3) * 0.48).toFixed(3))
  const oknFatigue = Number((0.2 + r(4) * 0.55).toFixed(3))
  const composite = Number(
    Math.min(1, (saccade * 0.3 + pursuit * 0.25 + fixation * 0.25 + oknFatigue * 0.2)).toFixed(3),
  )

  const trialInterestBand: C9ResearchResult['trialInterestBand'] =
    composite >= 0.62 ? 'elevated' : composite >= 0.42 ? 'moderate' : 'low'

  return {
    protocolId: C9_PROTOCOL_ID,
    analyzedAt: new Date().toISOString(),
    source: 'demo_video',
    demoFile: C9_PROTOCOL.demoVideo,
    metrics: {
      saccade_irregularity: saccade,
      pursuit_gain_asym: pursuit,
      fixation_instability: fixation,
      okn_fatigue: oknFatigue,
      composite_c9_interest: composite,
    },
    trialInterestBand,
    investigatorSummary:
      trialInterestBand === 'elevated'
        ? 'Research demo: composite interest flag elevated. Suitable for investigator review of whether to offer genetic counseling / C9ORF72 testing pathway toward gene-specific trial screening. Not a diagnosis.'
        : trialInterestBand === 'moderate'
          ? 'Research demo: intermediate interest flag. Consider research enrollment context and standard clinical/genetic pathways. Not a diagnosis.'
          : 'Research demo: lower composite interest flag. Still research-only; does not rule out genotype or phenotype. Not a diagnosis.',
    requiredNextSteps: [
      'Confirm research consent / IRB pathway for any human subjects use.',
      'Clinical evaluation by neurology (ALS / FTD specialist as appropriate).',
      'Genetic counseling before C9ORF72 testing.',
      'Gene-specific trial eligibility only after confirmed genotype + trial inclusion criteria.',
      'Register collaborator interest: ' + C9_PROTOCOL.collaborateUrl,
    ],
    disclaimers: [...C9_PROTOCOL.nonClaims],
    syntheticOnly: true,
    researchPrototype: true,
    notGeneticTest: true,
    notDiagnostic: true,
  }
}

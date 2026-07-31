/**
 * OpenDementia — ALS-FTD / C9ORF72 targeted genetic-testing referral protocol
 *
 * RESEARCH PROTOTYPE ONLY.
 * Intended use: help clinicians/researchers prioritize who may benefit from
 * targeted genetic counseling and C9ORF72 testing for gene-specific trials.
 * Does NOT diagnose ALS, FTD, ALS-FTD, or C9ORF72 genotype.
 * Genetic confirmation is required before any gene-specific clinical trial.
 */

export const C9_PROTOCOL_ID = 'opendementia-c9orf72-als-ftd-v0.2'

export const C9_PROTOCOL = {
  id: C9_PROTOCOL_ID,
  name: 'ALS-FTD · C9ORF72 — screen for targeted genetic testing',
  version: '0.2',
  mutation: 'C9ORF72 (hexanucleotide repeat expansion) — gene-specific trials',
  phenotype: 'ALS-FTD spectrum (research framing)',
  purpose:
    'Help dementia / ALS research teams screen patients who may warrant referral for ' +
    'targeted genetic counseling and C9ORF72 testing, so investigators can identify ' +
    'candidates for gene-specific clinical trials. Research decision-support only — not a genetic test.',
  intendedUse:
    'Research decision-support to prioritize referral for targeted genetic testing (e.g. C9ORF72) ' +
    'and subsequent gene-specific trial screening pathways.',
  demoVideo: '/demo/okn_demo_c9orf72.mp4',
  demoPoster: '/demo/frames/frame_01.jpg',
  collaborateUrl:
    'https://www.theneuroagentai.com/collaborate?source=OpenDementia&protocol=C9ORF72-ALS-FTD&app=https%3A%2F%2Fopendementia.vercel.app',
  nonClaims: [
    'Does not diagnose ALS, FTD, or ALS-FTD.',
    'Does not detect or confirm C9ORF72 genotype — laboratory genetic testing is required.',
    'Does not replace clinical evaluation, EMG, imaging, or genetic counseling.',
    '“Screen for genetic testing” means research prioritization for referral, not a stand-alone diagnosis.',
    'Trial eligibility is determined only by the trial protocol and genetic confirmation.',
    'Demo analysis on sample video is synthetic / illustrative for research workflow design.',
  ],
  researchFlags: [
    { id: 'saccade_irregularity', label: 'Saccade irregularity index (research)', unit: '0–1' },
    { id: 'pursuit_gain_asym', label: 'Pursuit gain asymmetry (research)', unit: '0–1' },
    { id: 'fixation_instability', label: 'Fixation instability index (research)', unit: '0–1' },
    { id: 'okn_fatigue', label: 'OKN fatigue slope (research)', unit: 'a.u.' },
    {
      id: 'composite_c9_interest',
      label: 'Composite flag — priority for targeted genetic testing (research)',
      unit: '0–1',
    },
  ],
} as const

export type C9ResearchResult = {
  protocolId: string
  analyzedAt: string
  source: 'demo_video' | 'live_session'
  demoFile: string
  /** Illustrative research signals only */
  metrics: Record<string, number>
  /** low | moderate | elevated — priority for genetic-testing referral (research) */
  trialInterestBand: 'low' | 'moderate' | 'elevated'
  geneticTestingReferralBand: 'low' | 'moderate' | 'elevated'
  investigatorSummary: string
  requiredNextSteps: string[]
  disclaimers: string[]
  syntheticOnly: true
  researchPrototype: true
  notGeneticTest: true
  notDiagnostic: true
  helpsPrioritizeGeneticTesting: true
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
    geneticTestingReferralBand: trialInterestBand,
    investigatorSummary:
      trialInterestBand === 'elevated'
        ? 'Research demo: elevated priority for targeted genetic testing referral (e.g. genetic counseling → C9ORF72 testing). May help identify candidates for gene-specific clinical-trial screening after genotype is confirmed. Not a diagnosis or genetic result.'
        : trialInterestBand === 'moderate'
          ? 'Research demo: intermediate priority for discussing genetic counseling / targeted testing in context of clinical history. Not a diagnosis or genetic result.'
          : 'Research demo: lower priority flag on this demo session. Does not rule out C9ORF72 or ALS-FTD. Not a diagnosis or genetic result.',
    requiredNextSteps: [
      'Confirm research consent / IRB pathway for any human subjects use.',
      'Clinical evaluation by neurology (ALS / FTD specialist as appropriate).',
      'If priority flag warrants: refer for genetic counseling, then targeted C9ORF72 testing.',
      'Gene-specific trial screening only after confirmed genotype + trial inclusion criteria.',
      'Register collaborator / trial network interest: ' + C9_PROTOCOL.collaborateUrl,
    ],
    disclaimers: [...C9_PROTOCOL.nonClaims],
    syntheticOnly: true,
    researchPrototype: true,
    notGeneticTest: true,
    notDiagnostic: true,
    helpsPrioritizeGeneticTesting: true,
  }
}

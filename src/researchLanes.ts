/** OpenDementia — single product focus. */
export type ResearchLaneId = 'dementia'

export interface ResearchLane {
  id: ResearchLaneId
  label: string
  tagline: string
  nonClaim: string
}

export const RESEARCH_LANES: Record<ResearchLaneId, ResearchLane> = {
  dementia: {
    id: 'dementia',
    label: 'Dementia research',
    tagline:
      'Open research OKN for dementia · help prioritize referral for targeted genetic testing (e.g. C9ORF72)',
    nonClaim:
      'Research decision-support only. Not a dementia diagnosis and not a genetic test — lab confirmation required for genotype and trial eligibility.',
  },
}

export const DEFAULT_LANE: ResearchLaneId = 'dementia'

export function parseLaneFromQuery(): ResearchLaneId {
  return 'dementia'
}

export const PRODUCT = {
  name: 'OpenDementia',
  publisher: 'NeuroAgent',
  contact: 'info@neuroagentai.org',
  site: 'https://neuroagentai.org',
} as const

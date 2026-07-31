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
    tagline: 'Open research OKN / eye-dynamics for dementia research organizations',
    nonClaim:
      'Not a dementia diagnostic or screening tool. Research use only — not for clinical care.',
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

/** Dementia-focused research edition (single product focus). */
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
    tagline: 'NeuroAgent · dementia research (synthetic OKN / eye-dynamics preview)',
    nonClaim:
      'Not a dementia diagnostic or screening tool. Research use only — not for clinical care.',
  },
}

export const DEFAULT_LANE: ResearchLaneId = 'dementia'

export function parseLaneFromQuery(): ResearchLaneId {
  return 'dementia'
}

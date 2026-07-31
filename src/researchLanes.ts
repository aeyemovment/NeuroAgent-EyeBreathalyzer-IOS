/** Research lanes — same OKN app interface; language only. */
export type ResearchLaneId = 'autism' | 'dementia' | 'rare-neuro'

export interface ResearchLane {
  id: ResearchLaneId
  label: string
  tagline: string
  nonClaim: string
}

export const RESEARCH_LANES: Record<ResearchLaneId, ResearchLane> = {
  autism: {
    id: 'autism',
    label: 'Autism research',
    tagline: 'NeuroAgent · autism research lane (public launch Mon 2026-08-03)',
    nonClaim:
      'Not an autism diagnostic or screening tool. Research use only — synthetic/illustrative analysis of eye-movement signals.',
  },
  dementia: {
    id: 'dementia',
    label: 'Dementia research',
    tagline: 'NeuroAgent · dementia research lane',
    nonClaim:
      'Not a dementia diagnostic or screening tool. Research use only — synthetic/illustrative analysis of eye-movement signals.',
  },
  'rare-neuro': {
    id: 'rare-neuro',
    label: 'Rare neuro research',
    tagline: 'NeuroAgent · rare neurological disease research lane',
    nonClaim:
      'Not a clinical diagnostic tool. Research use only — synthetic/illustrative analysis of eye-movement signals.',
  },
}

export const DEFAULT_LANE: ResearchLaneId = 'autism'
export const AUTISM_PUBLIC_LAUNCH_DATE = '2026-08-03'

export function parseLaneFromQuery(): ResearchLaneId {
  if (typeof window === 'undefined') return DEFAULT_LANE
  const q = new URLSearchParams(window.location.search).get('lane')?.toLowerCase()
  if (q === 'dementia' || q === 'ad') return 'dementia'
  if (q === 'rare-neuro' || q === 'rare') return 'rare-neuro'
  if (q === 'autism' || q === 'asd') return 'autism'
  return DEFAULT_LANE
}

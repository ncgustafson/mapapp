import brassWallPhoto from './assets/brass-wall.jpg'

export type TopoLine = {
  /** OpenBeta climb id this topo is for. */
  climbId: string
  image: string
  imageCredit: string
  /** Normalized (0-1) image-space points, base of the climb to the top. */
  points: [number, number][]
  note: string
}

// Birdland (Brass Wall, Pine Creek Canyon) — the only route with a topo so
// far. No source (OpenBeta, Mountain Project, or any topo site found) has
// real digitized line data for this climb — OpenBeta's schema supports a
// photo-overlay line (`topoData`) but it's unset on every photo tagged to
// Birdland. This line is a hand-placed approximation from the published
// pitch descriptions (SummitPost, trip reports), drawn over a real,
// correctly-tagged community photo of the wall — not a survey.
export const BIRDLAND_TOPO: TopoLine = {
  climbId: 'aa8fc4a4-366a-503a-ac13-3120e5dd9d0f',
  image: brassWallPhoto,
  imageCredit: 'Photo: OpenBeta contributor — Pine Creek Canyon / Brass Wall',
  points: [
    [0.228, 0.667],
    [0.255, 0.533],
    [0.269, 0.381],
    [0.31, 0.286],
    [0.359, 0.21],
    [0.414, 0.143],
    [0.469, 0.086],
    [0.503, 0.029],
  ],
  note: 'Approximate line only — hand-placed from written route descriptions, not surveyed data.',
}

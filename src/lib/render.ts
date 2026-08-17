import { add, cross, scale, sub } from '@/lib/geometry'
import type { Point } from '@/lib/geometry'
import type { OpeningGeometry } from '@/lib/wallGeometry'

/**
 * Shared drawing vocabulary for the two things that put marks on paper: the
 * live SVG canvas (Vue components) and the export builder (a string).
 *
 * They cannot share components — one renders to the DOM, the other to a file —
 * so they share this instead. Every path shape and every colour a plan is drawn
 * with lives here, which is what keeps "what I see" and "what I printed"
 * honest with each other.
 */

/** Mirrors the `--paper-*` custom properties in styles/main.css. Exports have no DOM to read from. */
export const PALETTE = {
  paper: '#F2F3EF',
  paperEdge: '#D5D9D1',
  gridMinor: '#E2E5DE',
  gridMajor: '#CFD5CC',
  graphite: '#2B3338',
  graphiteLine: '#171D21',
  roomFill: '#FAFBF8',
  blueprint: '#2F6E97',
  blueprintBright: '#5A9FC9',
  dimension: '#4A6B80',
  amber: '#B8752E',
  danger: '#B8543F',
  label: '#4C565C',
  labelFaint: '#8B979D',
} as const

export const FONT_MONO = "'IBM Plex Mono', ui-monospace, monospace"
export const FONT_UI = "'Archivo Variable', 'Archivo', system-ui, sans-serif"

const round = (value: number) => Math.round(value * 100) / 100

export function polygonPath(points: Point[]): string {
  if (points.length === 0) return ''
  const [first, ...rest] = points
  return [
    `M ${round(first!.x)} ${round(first!.y)}`,
    ...rest.map((point) => `L ${round(point.x)} ${round(point.y)}`),
    'Z',
  ].join(' ')
}

export function linePath(a: Point, b: Point): string {
  return `M ${round(a.x)} ${round(a.y)} L ${round(b.x)} ${round(b.y)}`
}

export interface OpeningPaths {
  /** Rectangle covering the wall thickness across the opening — painted in the floor colour to read as a hole. */
  cut: string
  /** The jamb lines closing each end of the hole. */
  jambs: string[]
  /** Door leaves, drawn fully open. */
  leaves: string[]
  /** Quarter-circle swing arcs. */
  arcs: string[]
  /** Window glazing lines. */
  panes: string[]
}

/**
 * Openings are painted over their wall rather than subtracted from it.
 *
 * A real boolean would mean clipping the wall polygon, which sounds more
 * correct but is worse: it fights the mitred corners, and it breaks the moment
 * an opening overruns the end of a wall. Painting the hole gives an identical
 * result on screen and in PDF, and degrades gracefully when the numbers are
 * silly.
 */
export function openingPaths(entry: OpeningGeometry): OpeningPaths {
  const { opening, centre, direction, normal, thickness } = entry
  const half = opening.width / 2
  const halfThickness = thickness / 2

  const along = (value: number) => scale(direction, value)
  const across = (value: number) => scale(normal, value)

  const startInner = add(add(centre, along(-half)), across(-halfThickness))
  const startOuter = add(add(centre, along(-half)), across(halfThickness))
  const endInner = add(add(centre, along(half)), across(-halfThickness))
  const endOuter = add(add(centre, along(half)), across(halfThickness))

  const paths: OpeningPaths = {
    cut: polygonPath([startInner, endInner, endOuter, startOuter]),
    jambs: [linePath(startInner, startOuter), linePath(endInner, endOuter)],
    leaves: [],
    arcs: [],
    panes: [],
  }

  const faceSign = opening.flipFace ? -1 : 1

  const swing = (hinge: Point, otherJamb: Point, leafLength: number) => {
    const leafEnd = add(hinge, across(faceSign * leafLength))
    paths.leaves.push(linePath(hinge, leafEnd))
    // Sweep direction follows the turn from the open leaf back to the jamb.
    const turn = cross(sub(leafEnd, hinge), sub(otherJamb, hinge))
    const sweep = turn > 0 ? 1 : 0
    paths.arcs.push(
      `M ${round(leafEnd.x)} ${round(leafEnd.y)} A ${round(leafLength)} ${round(leafLength)} 0 0 ${sweep} ${round(otherJamb.x)} ${round(otherJamb.y)}`,
    )
  }

  switch (opening.kind) {
    case 'door': {
      const hingeSign = opening.flipHinge ? 1 : -1
      const hinge = add(centre, along(hingeSign * half))
      const otherJamb = add(centre, along(-hingeSign * half))
      swing(hinge, otherJamb, opening.width)
      break
    }
    case 'double-door': {
      const leftHinge = add(centre, along(-half))
      const rightHinge = add(centre, along(half))
      swing(leftHinge, centre, half)
      swing(rightHinge, centre, half)
      break
    }
    case 'sliding-door': {
      // Two panels offset to either face, overlapping at the centre.
      const panelOffset = halfThickness * 0.42
      const left = [
        add(add(centre, along(-half)), across(panelOffset)),
        add(add(centre, along(half * 0.1)), across(panelOffset)),
      ]
      const right = [
        add(add(centre, along(-half * 0.1)), across(-panelOffset)),
        add(add(centre, along(half)), across(-panelOffset)),
      ]
      paths.leaves.push(linePath(left[0]!, left[1]!), linePath(right[0]!, right[1]!))
      break
    }
    case 'window': {
      // Frame lines at both faces plus the glazing line down the middle.
      paths.panes.push(
        linePath(startOuter, endOuter),
        linePath(startInner, endInner),
        linePath(add(centre, along(-half)), add(centre, along(half))),
      )
      break
    }
    case 'opening':
    default:
      break
  }

  return paths
}

/**
 * An architectural dimension string: witness lines at each end, a run between
 * them, 45° tick slashes where they meet, and the length in a gap in the
 * middle.
 *
 * This is the signature mark of the whole app. Anyone can draw a rectangle and
 * put a number next to it; the tick-slash dimension string is what makes a
 * drawing read as a drawing, and reading measurements accurately is the entire
 * job the product exists to do.
 */
export interface DimensionPaths {
  /** The main run between witness lines. */
  run: string
  /** Short perpendicular lines from the measured feature out to the run. */
  witnesses: string[]
  /** 45° ticks at each end of the run. */
  ticks: string[]
  /** Where the label sits, and how it should be rotated to stay upright. */
  label: { x: number; y: number; angle: number }
}

export function dimensionPaths(
  from: Point,
  to: Point,
  offset: number,
  options: { tickLength?: number; witnessGap?: number } = {},
): DimensionPaths {
  const { tickLength = 90, witnessGap = 40 } = options
  const delta = sub(to, from)
  const length = Math.hypot(delta.x, delta.y) || 1
  const direction = { x: delta.x / length, y: delta.y / length }
  const normal = { x: -direction.y, y: direction.x }

  const shift = (point: Point, amount: number) => add(point, scale(normal, amount))
  const runStart = shift(from, offset)
  const runEnd = shift(to, offset)

  // Witness lines stop just short of the feature, as they do on a real sheet.
  const gapSign = Math.sign(offset) || 1
  const witnessStart = shift(from, gapSign * witnessGap)
  const witnessEnd = shift(to, gapSign * witnessGap)

  const tick = add(scale(direction, tickLength / 2), scale(normal, tickLength / 2))
  const negTick = scale(tick, -1)

  // Keep text right side up: past vertical, read the string the other way.
  let angle = (Math.atan2(direction.y, direction.x) * 180) / Math.PI
  if (angle > 90 || angle < -90) angle += 180

  const midpoint = { x: (runStart.x + runEnd.x) / 2, y: (runStart.y + runEnd.y) / 2 }

  return {
    run: linePath(runStart, runEnd),
    witnesses: [
      linePath(witnessStart, shift(from, offset + gapSign * witnessGap * 0.6)),
      linePath(witnessEnd, shift(to, offset + gapSign * witnessGap * 0.6)),
    ],
    ticks: [
      linePath(add(runStart, negTick), add(runStart, tick)),
      linePath(add(runEnd, negTick), add(runEnd, tick)),
    ],
    label: { x: midpoint.x, y: midpoint.y, angle },
  }
}

/** Grid lines covering a world rectangle, snapped to the step. */
export function gridLines(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  step: number,
): { vertical: number[]; horizontal: number[] } {
  if (step <= 0) return { vertical: [], horizontal: [] }
  const vertical: number[] = []
  const horizontal: number[] = []
  const startX = Math.floor(bounds.minX / step) * step
  const startY = Math.floor(bounds.minY / step) * step
  // Hard cap so a zoomed-out view can never try to draw a hundred thousand lines.
  const limit = 900
  for (let x = startX, i = 0; x <= bounds.maxX && i < limit; x += step, i += 1) vertical.push(x)
  for (let y = startY, i = 0; y <= bounds.maxY && i < limit; y += step, i += 1) horizontal.push(y)
  return { vertical, horizontal }
}

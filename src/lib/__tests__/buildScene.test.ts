import { describe, expect, it } from 'vitest'

import { pointInPolygon, polygonArea } from '@/lib/geometry'
import {
  buildSceneModel,
  clipPolygonToRange,
  findWalkStart,
  wallSpans,
} from '@/lib/three/buildScene'
import { createSamplePlan } from '@/lib/samplePlan'
import { MM_PER_INCH } from '@/lib/units'
import { computePlanGeometry } from '@/lib/wallGeometry'
import type { WallOutline } from '@/lib/wallGeometry'
import { emptyPlan } from '@/types/plan'
import type { Opening, Plan } from '@/types/plan'

/**
 * The 3D scene is derived, so it gets tested as arithmetic rather than
 * eyeballed in a viewport. What matters is that openings become real holes,
 * that mitred corners survive being cut into pieces, and that nothing here can
 * write back to the plan.
 */

const WALL_HEIGHT = 2400
const inches = (value: number) => value * MM_PER_INCH

function straightWall(length = 4000, thickness = 100): { plan: Plan; outline: WallOutline } {
  const plan = emptyPlan()
  plan.nodes = {
    a: { id: 'a', x: 0, y: 0 },
    b: { id: 'b', x: length, y: 0 },
  }
  plan.walls = { w: { id: 'w', start: 'a', end: 'b', thickness, height: WALL_HEIGHT } }
  return { plan, outline: computePlanGeometry(plan).wallsById.get('w')! }
}

function opening(overrides: Partial<Opening>): Opening {
  return {
    id: 'o',
    wall: 'w',
    distance: 2000,
    width: 900,
    kind: 'door',
    sillHeight: 0,
    height: 2032,
    flipFace: false,
    flipHinge: false,
    ...overrides,
  }
}

describe('wallSpans', () => {
  const { outline } = straightWall()

  it('leaves a blank wall as one full-height piece with both mitres intact', () => {
    const spans = wallSpans(outline, [], WALL_HEIGHT)
    expect(spans).toEqual([{ from: null, to: null, bottom: 0, top: WALL_HEIGHT }])
  })

  it('splits around a door and puts a header over it', () => {
    const spans = wallSpans(outline, [opening({})], WALL_HEIGHT)

    // Wall either side, plus the header above the door. No piece below it.
    expect(spans).toHaveLength(3)
    expect(spans.filter((span) => span.bottom === 0 && span.top === WALL_HEIGHT)).toHaveLength(2)

    const header = spans.find((span) => span.bottom > 0)!
    expect(header.bottom).toBe(2032)
    expect(header.top).toBe(WALL_HEIGHT)
    expect(header.from).toBe(1550)
    expect(header.to).toBe(2450)
  })

  it('gives a window both a sill below and a header above', () => {
    const spans = wallSpans(
      outline,
      [opening({ kind: 'window', sillHeight: 900, height: 1200, width: 1000 })],
      WALL_HEIGHT,
    )

    const under = spans.find((span) => span.bottom === 0 && span.top === 900)
    const over = spans.find((span) => span.bottom === 2100)
    expect(under).toBeDefined()
    expect(over).toBeDefined()
    expect(over!.top).toBe(WALL_HEIGHT)
  })

  it('keeps the outer ends unclipped so the mitres are not sawn off', () => {
    const spans = wallSpans(outline, [opening({})], WALL_HEIGHT)
    const solids = spans.filter((span) => span.top === WALL_HEIGHT && span.bottom === 0)
    // The first piece runs from the mitred start, the last to the mitred end.
    expect(solids.some((span) => span.from === null)).toBe(true)
    expect(solids.some((span) => span.to === null)).toBe(true)
  })

  it('handles two openings on one wall', () => {
    const spans = wallSpans(
      outline,
      [
        opening({ id: 'o1', distance: 1000, width: 800 }),
        opening({ id: 'o2', distance: 3000, width: 800 }),
      ],
      WALL_HEIGHT,
    )
    // Three solid pieces (before, between, after) plus two headers.
    expect(spans.filter((span) => span.bottom === 0 && span.top === WALL_HEIGHT)).toHaveLength(3)
    expect(spans.filter((span) => span.bottom === 2032)).toHaveLength(2)
  })

  it('leaves nothing solid when an opening spans the whole wall', () => {
    const spans = wallSpans(
      outline,
      [opening({ distance: 2000, width: 4000, height: WALL_HEIGHT })],
      WALL_HEIGHT,
    )
    expect(spans.filter((span) => span.top === WALL_HEIGHT && span.bottom === 0)).toHaveLength(0)
  })

  it('clamps an opening that overruns its wall instead of producing nonsense', () => {
    const spans = wallSpans(outline, [opening({ distance: 3900, width: 900 })], WALL_HEIGHT)
    for (const span of spans) {
      if (span.from !== null) expect(span.from).toBeGreaterThanOrEqual(0)
      if (span.to !== null) expect(span.to).toBeLessThanOrEqual(4000)
      expect(span.top).toBeLessThanOrEqual(WALL_HEIGHT)
    }
  })
})

describe('clipPolygonToRange', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]
  const origin = { x: 0, y: 0 }
  const direction = { x: 1, y: 0 }

  it('cuts a band out of the middle', () => {
    const clipped = clipPolygonToRange(square, origin, direction, 25, 75)
    expect(polygonArea(clipped)).toBeCloseTo(50 * 100, 6)
  })

  it('returns the polygon untouched when both bounds are null', () => {
    expect(clipPolygonToRange(square, origin, direction, null, null)).toEqual(square)
  })

  it('clips only one end when the other bound is null', () => {
    const clipped = clipPolygonToRange(square, origin, direction, 40, null)
    expect(polygonArea(clipped)).toBeCloseTo(60 * 100, 6)
  })

  it('returns nothing for a band outside the polygon', () => {
    expect(clipPolygonToRange(square, origin, direction, 200, 300).length).toBeLessThan(3)
  })

  it('keeps a mitred quad convex and area-preserving across a split', () => {
    // A wall end mitred outward: the footprint is wider at one end.
    const mitred = [
      { x: -50, y: -50 },
      { x: 1000, y: -50 },
      { x: 1000, y: 50 },
      { x: -50, y: 50 },
    ]
    const left = clipPolygonToRange(mitred, { x: 0, y: 0 }, direction, null, 400)
    const right = clipPolygonToRange(mitred, { x: 0, y: 0 }, direction, 400, null)
    expect(polygonArea(left) + polygonArea(right)).toBeCloseTo(polygonArea(mitred), 6)
    // The outer mitre point survives on the left piece.
    expect(left.some((point) => point.x === -50 && point.y === -50)).toBe(true)
  })
})

describe('buildSceneModel', () => {
  const plan = createSamplePlan()
  const model = buildSceneModel(plan, computePlanGeometry(plan))

  it('extrudes every wall to its own height', () => {
    expect(model.walls.length).toBeGreaterThan(0)
    for (const piece of model.walls) {
      expect(piece.top).toBeLessThanOrEqual(model.wallHeight + 1e-6)
      expect(piece.top).toBeGreaterThan(piece.bottom)
      expect(piece.polygon.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('cuts real holes: the sample has a header over every opening', () => {
    // Four openings, each with a piece of wall above it.
    const headers = model.walls.filter((piece) => piece.bottom > 0)
    expect(headers).toHaveLength(4)

    // The two windows also get a sill piece, which sits at floor level but
    // stops short of the wall head.
    const sills = model.walls.filter(
      (piece) => piece.bottom === 0 && piece.top < model.wallHeight - 1,
    )
    expect(sills).toHaveLength(2)
    for (const sill of sills) expect(sill.top).toBeCloseTo(inches(36), 6)
  })

  it('gives every room a floor', () => {
    expect(model.floors).toHaveLength(computePlanGeometry(plan).rooms.length)
  })

  it('carries furniture through at true size', () => {
    expect(model.furniture).toHaveLength(Object.keys(plan.furniture).length)
    const bed = model.furniture.find((item) => item.id === 'f_bed')!
    expect(bed.width).toBeCloseTo(inches(60), 6)
    expect(bed.depth).toBeCloseTo(inches(80), 6)
    expect(bed.height).toBeGreaterThan(0)
    expect(bed.color).toMatch(/^#/)
  })

  it('frames the camera on something real', () => {
    expect(model.radius).toBeGreaterThan(1000)
    expect(Number.isFinite(model.centre.x)).toBe(true)
    expect(Number.isFinite(model.centre.y)).toBe(true)
  })

  it('survives an empty plan', () => {
    const empty = emptyPlan()
    const built = buildSceneModel(empty, computePlanGeometry(empty))
    expect(built.walls).toHaveLength(0)
    expect(built.floors).toHaveLength(0)
    expect(built.wallHeight).toBeGreaterThan(0)
    expect(Number.isFinite(built.radius)).toBe(true)
  })

  /**
   * The whole feature rests on 3D being a read-only view. If deriving a scene
   * could mutate the plan, the two views would need to agree with each other
   * and the boundary would be gone.
   */
  it('does not touch the plan it reads', () => {
    const source = createSamplePlan()
    const before = JSON.stringify(source)
    buildSceneModel(source, computePlanGeometry(source))
    expect(JSON.stringify(source)).toBe(before)
  })
})

/**
 * Where the walkthrough drops you. The first attempt put the camera at the
 * room's centre, which in a bedroom is the middle of the bed, and a version
 * after that stood it inside the desk.
 */
describe('findWalkStart', () => {
  const plan = createSamplePlan()
  const geometry = computePlanGeometry(plan)
  const model = buildSceneModel(plan, geometry)
  const start = findWalkStart(model)

  it('stands inside the room', () => {
    const room = geometry.rooms[0]!
    const xs = room.polygon.map((point) => point.x)
    const ys = room.polygon.map((point) => point.y)
    expect(start.at.x).toBeGreaterThan(Math.min(...xs))
    expect(start.at.x).toBeLessThan(Math.max(...xs))
    expect(start.at.y).toBeGreaterThan(Math.min(...ys))
    expect(start.at.y).toBeLessThan(Math.max(...ys))
  })

  it('does not stand inside the furniture', () => {
    for (const item of model.furniture) {
      const cos = Math.abs(Math.cos(item.rotation))
      const sin = Math.abs(Math.sin(item.rotation))
      const spanX = item.width * cos + item.depth * sin
      const spanY = item.width * sin + item.depth * cos
      const inside =
        Math.abs(start.at.x - item.x) < spanX / 2 && Math.abs(start.at.y - item.y) < spanY / 2
      expect(inside).toBe(false)
    }
  })

  it('faces into the room rather than at the nearest wall', () => {
    // Walking forward from the start must stay inside the room for a while —
    // if the heading pointed at a wall, a metre would already be outside it.
    const ahead = {
      x: start.at.x - Math.sin(start.heading) * 1000,
      y: start.at.y - Math.cos(start.heading) * 1000,
    }
    expect(pointInPolygon(ahead, geometry.rooms[0]!.polygon)).toBe(true)
  })

  it('falls back to the plan centre when there is no enclosed room', () => {
    const open = emptyPlan()
    open.nodes = { a: { id: 'a', x: 0, y: 0 }, b: { id: 'b', x: 3000, y: 0 } }
    open.walls = { w: { id: 'w', start: 'a', end: 'b', thickness: 100, height: 2400 } }
    const built = buildSceneModel(open, computePlanGeometry(open))
    const fallback = findWalkStart(built)
    expect(Number.isFinite(fallback.at.x)).toBe(true)
    expect(Number.isFinite(fallback.heading)).toBe(true)
  })
})

describe('scene isolation', () => {
  it('leaves the plan untouched', () => {
    const source = createSamplePlan()
    const before = JSON.stringify(source)
    buildSceneModel(source, computePlanGeometry(source))
    expect(JSON.stringify(source)).toBe(before)
  })
})

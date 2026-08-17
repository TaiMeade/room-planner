import { describe, expect, it } from 'vitest'

import { polygonArea } from '@/lib/geometry'
import { clampOpening, computePlanGeometry } from '@/lib/wallGeometry'
import { emptyPlan } from '@/types/plan'
import type { Plan, Point } from '@/types/plan'

/**
 * The wall solver is the load-bearing piece of the whole app — joins, mitres
 * and room detection. These tests pin the behaviour the plan calls the
 * go/no-go: corners that mitre, walls that drag without tearing, and interiors
 * that close.
 */

const THICKNESS = 100

function buildPlan(points: Point[], options: { closed?: boolean; thickness?: number } = {}): Plan {
  const { closed = true, thickness = THICKNESS } = options
  const plan = emptyPlan()
  const ids = points.map((point, index) => {
    const id = `n${index}`
    plan.nodes[id] = { id, x: point.x, y: point.y }
    return id
  })
  const limit = closed ? ids.length : ids.length - 1
  for (let i = 0; i < limit; i += 1) {
    const id = `w${i}`
    plan.walls[id] = {
      id,
      start: ids[i]!,
      end: ids[(i + 1) % ids.length]!,
      thickness,
      height: 2400,
    }
  }
  return plan
}

/** A 4000 x 3000 room measured on the wall centrelines. */
function rectanglePlan(width = 4000, height = 3000, thickness = THICKNESS) {
  return buildPlan(
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    { thickness },
  )
}

describe('wall outlines', () => {
  it('gives every wall a closed four-point footprint', () => {
    const geometry = computePlanGeometry(rectanglePlan())
    expect(geometry.walls).toHaveLength(4)
    for (const outline of geometry.walls) {
      expect(outline.polygon).toHaveLength(4)
      expect(polygonArea(outline.polygon)).toBeGreaterThan(0)
    }
  })

  it('mitres a right-angle corner so neighbouring walls share exact corner points', () => {
    const geometry = computePlanGeometry(rectanglePlan())
    const top = geometry.wallsById.get('w0')!
    const right = geometry.wallsById.get('w1')!

    // The two walls meet at (4000, 0). Both outlines must contain the outer
    // mitre point (4050, -50) and the inner one (3950, 50) — if they don't,
    // the corner has a visible notch or overlap.
    const contains = (polygon: Point[], target: Point) =>
      polygon.some((p) => Math.abs(p.x - target.x) < 1e-6 && Math.abs(p.y - target.y) < 1e-6)

    for (const outline of [top, right]) {
      expect(contains(outline.polygon, { x: 4050, y: -50 })).toBe(true)
      expect(contains(outline.polygon, { x: 3950, y: 50 })).toBe(true)
    }
  })

  it('caps a dead-end wall square across its thickness', () => {
    const plan = buildPlan(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
      ],
      { closed: false },
    )
    const [outline] = computePlanGeometry(plan).walls
    // A lone 1000-long wall at 100 thick is exactly 100,000 mm² of footprint.
    expect(polygonArea(outline!.polygon)).toBeCloseTo(1000 * THICKNESS, 6)
  })

  it('runs collinear walls straight through their shared node', () => {
    const plan = buildPlan(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 2000, y: 0 },
      ],
      { closed: false },
    )
    const geometry = computePlanGeometry(plan)
    // No mitre spike: each half keeps its own length at full thickness.
    for (const outline of geometry.walls) {
      expect(polygonArea(outline.polygon)).toBeCloseTo(1000 * THICKNESS, 6)
    }
  })

  it('does not let an acute corner spike off to infinity', () => {
    // A 2-degree wedge would produce a mitre ~57x the thickness unclamped.
    const plan = buildPlan(
      [
        { x: 0, y: 0 },
        { x: 5000, y: 0 },
        { x: 5000 * Math.cos(0.035), y: 5000 * Math.sin(0.035) },
      ],
      { closed: false },
    )
    const geometry = computePlanGeometry(plan)
    for (const outline of geometry.walls) {
      for (const point of outline.polygon) {
        expect(Math.hypot(point.x, point.y)).toBeLessThan(6000)
      }
    }
  })
})

describe('room detection', () => {
  it('closes a rectangle into one room measured to the inside faces', () => {
    const geometry = computePlanGeometry(rectanglePlan(4000, 3000))
    expect(geometry.rooms).toHaveLength(1)
    // Interior is the centreline rectangle inset by half a wall on each side.
    const expected = (4000 - THICKNESS) * (3000 - THICKNESS)
    expect(geometry.rooms[0]!.area).toBeCloseTo(expected, 4)
  })

  it('puts the centroid inside the room', () => {
    const [room] = computePlanGeometry(rectanglePlan(4000, 3000)).rooms
    expect(room!.centroid.x).toBeCloseTo(2000, 4)
    expect(room!.centroid.y).toBeCloseTo(1500, 4)
  })

  it('ignores the unbounded outside face', () => {
    // Three separate rectangles, not one big one: only real interiors count.
    const geometry = computePlanGeometry(rectanglePlan())
    expect(geometry.rooms.every((room) => room.area < 4000 * 3000)).toBe(true)
  })

  it('finds two rooms when a dividing wall splits the space', () => {
    const plan = emptyPlan()
    const points: Record<string, Point> = {
      a: { x: 0, y: 0 },
      b: { x: 4000, y: 0 },
      c: { x: 4000, y: 3000 },
      d: { x: 0, y: 3000 },
      e: { x: 2000, y: 0 },
      f: { x: 2000, y: 3000 },
    }
    for (const [id, point] of Object.entries(points)) plan.nodes[id] = { id, ...point }
    const edges: [string, string][] = [
      ['a', 'e'],
      ['e', 'b'],
      ['b', 'c'],
      ['c', 'f'],
      ['f', 'd'],
      ['d', 'a'],
      ['e', 'f'],
    ]
    edges.forEach(([start, end], index) => {
      const id = `w${index}`
      plan.walls[id] = { id, start, end, thickness: THICKNESS, height: 2400 }
    })

    const geometry = computePlanGeometry(plan)
    expect(geometry.rooms).toHaveLength(2)
    for (const room of geometry.rooms) {
      expect(room.area).toBeCloseTo((2000 - THICKNESS) * (3000 - THICKNESS), 4)
    }
  })

  it('reports no rooms for walls that do not enclose anything', () => {
    const plan = buildPlan(
      [
        { x: 0, y: 0 },
        { x: 2000, y: 0 },
        { x: 2000, y: 2000 },
      ],
      { closed: false },
    )
    expect(computePlanGeometry(plan).rooms).toHaveLength(0)
  })

  it('keeps geometry stable when a shared node moves', () => {
    const plan = rectanglePlan()
    plan.nodes.n1 = { id: 'n1', x: 5000, y: 0 }
    plan.nodes.n2 = { id: 'n2', x: 5000, y: 3000 }
    const geometry = computePlanGeometry(plan)
    expect(geometry.rooms).toHaveLength(1)
    expect(geometry.rooms[0]!.area).toBeCloseTo((5000 - THICKNESS) * (3000 - THICKNESS), 4)
  })
})

describe('openings', () => {
  it('follows its host wall when the wall moves', () => {
    const plan = rectanglePlan()
    plan.openings.o1 = {
      id: 'o1',
      wall: 'w0',
      distance: 1000,
      width: 900,
      kind: 'door',
      sillHeight: 0,
      height: 2032,
      flipFace: false,
      flipHinge: false,
    }

    const before = computePlanGeometry(plan).openings[0]!
    expect(before.centre).toEqual({ x: 1000, y: 0 })

    // Drag the whole top wall down by 500 by moving both of its nodes.
    plan.nodes.n0 = { id: 'n0', x: 0, y: 500 }
    plan.nodes.n1 = { id: 'n1', x: 4000, y: 500 }

    const after = computePlanGeometry(plan).openings[0]!
    expect(after.centre).toEqual({ x: 1000, y: 500 })
    expect(after.overflows).toBe(false)
  })

  it('flags an opening that is wider than the space left on its wall', () => {
    const plan = rectanglePlan()
    plan.openings.o1 = {
      id: 'o1',
      wall: 'w0',
      distance: 3900,
      width: 900,
      kind: 'window',
      sillHeight: 900,
      height: 1200,
      flipFace: false,
      flipHinge: false,
    }
    expect(computePlanGeometry(plan).openings[0]!.overflows).toBe(true)
  })

  it('clamps an opening back inside its wall', () => {
    const outline = computePlanGeometry(rectanglePlan()).wallsById.get('w0')!
    expect(clampOpening(outline, 3900, 900)).toBeCloseTo(4000 - 450, 6)
    expect(clampOpening(outline, 100, 900)).toBeCloseTo(450, 6)
    // Wider than the wall: centre it rather than producing nonsense.
    expect(clampOpening(outline, 100, 9000)).toBeCloseTo(2000, 6)
  })
})

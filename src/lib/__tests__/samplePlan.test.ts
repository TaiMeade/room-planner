import { describe, expect, it } from 'vitest'

import { createSamplePlan } from '@/lib/samplePlan'
import { MM_PER_INCH, formatArea } from '@/lib/units'
import { computePlanGeometry } from '@/lib/wallGeometry'
import type { FurnitureItem, Plan } from '@/types/plan'

/**
 * The sample room is a specification, not a decoration — it was measured off a
 * real room and given in inches. Every number below was stated; if one drifts,
 * the room quietly stops being the room it is meant to be, and nothing else in
 * the app would notice.
 */

const inches = (value: number) => value * MM_PER_INCH
const toInches = (mm: number) => mm / MM_PER_INCH

const plan: Plan = createSamplePlan()
const geometry = computePlanGeometry(plan)

/** Footprint as it lands in the world, after rotation. Every item is axis-aligned. */
function footprint(item: FurnitureItem) {
  const turned = Math.abs(Math.round(Math.sin(item.rotation))) === 1
  const spanX = turned ? item.depth : item.width
  const spanY = turned ? item.width : item.depth
  return {
    minX: item.x - spanX / 2,
    maxX: item.x + spanX / 2,
    minY: item.y - spanY / 2,
    maxY: item.y + spanY / 2,
  }
}

function overlaps(a: ReturnType<typeof footprint>, b: ReturnType<typeof footprint>): boolean {
  const gap = 1 // mm, so items merely touching don't count as colliding
  return a.minX < b.maxX - gap && b.minX < a.maxX - gap && a.minY < b.maxY - gap && b.minY < a.maxY - gap
}

/** Shortest distance from a point to an axis-aligned rectangle. */
function distanceToRect(
  point: { x: number; y: number },
  rect: ReturnType<typeof footprint>,
): number {
  const dx = Math.max(rect.minX - point.x, 0, point.x - rect.maxX)
  const dy = Math.max(rect.minY - point.y, 0, point.y - rect.maxY)
  return Math.hypot(dx, dy)
}

/**
 * The floor an item needs in *front* of it — drawers pulled out, a door swung
 * open. Front is the item's local +y face, which points south unrotated and
 * turns with it: 90° faces west, 180° north, 270° east.
 */
function accessZone(item: FurnitureItem, reach: number) {
  const box = footprint(item)
  const degrees = Math.round((((item.rotation * 180) / Math.PI) % 360 + 360) % 360)
  switch (degrees) {
    case 90:
      return { ...box, minX: box.minX - reach, maxX: box.minX }
    case 180:
      return { ...box, minY: box.minY - reach, maxY: box.minY }
    case 270:
      return { ...box, minX: box.maxX, maxX: box.maxX + reach }
    default:
      return { ...box, minY: box.maxY, maxY: box.maxY + reach }
  }
}

describe('the room', () => {
  it('measures 180" wide by 108" deep on the inside', () => {
    expect(geometry.rooms).toHaveLength(1)
    const room = geometry.rooms[0]!
    const xs = room.polygon.map((point) => point.x)
    const ys = room.polygon.map((point) => point.y)

    // The long run is the width. Getting these the wrong way round produces a
    // room of the right area that nothing else fits in.
    expect(toInches(Math.max(...xs) - Math.min(...xs))).toBeCloseTo(180, 6)
    expect(toInches(Math.max(...ys) - Math.min(...ys))).toBeCloseTo(108, 6)
  })

  it('comes to 135 square feet', () => {
    expect(geometry.rooms[0]!.area).toBeCloseTo(inches(108) * inches(180), 4)
    expect(formatArea(geometry.rooms[0]!.area, 'imperial')).toBe('135.0 sq ft')
  })
})

describe('the door and closet', () => {
  const door = plan.openings.o_door!
  const closet = plan.openings.o_closet!
  const southWall = geometry.wallsById.get('w_south')!

  it('puts a 33" door in the bottom-right corner', () => {
    expect(door.wall).toBe('w_south')
    expect(toInches(door.width)).toBeCloseTo(33, 6)
    // The south wall runs right-to-left, so distance counts from that corner.
    // Under two inches of jamb to the inside corner is as tight as a frame goes.
    const toCorner = toInches(door.distance - door.width / 2) - toInches(southWall.thickness / 2)
    expect(toCorner).toBeGreaterThan(0)
    expect(toCorner).toBeLessThan(3)
  })

  it('hinges the door on the right so it opens away from the corner', () => {
    // flipHinge false puts the hinge at the wall's start side, which on the
    // right-to-left south wall is the right-hand jamb.
    expect(door.flipHinge).toBe(false)
    const hingeX = southWall.start.x - southWall.direction.x * 0 // start corner is the right one
    expect(hingeX).toBeGreaterThan(southWall.end.x)
  })

  it('gives the closet two 22.5" leaves in a 45" opening', () => {
    expect(closet.kind).toBe('double-door')
    expect(toInches(closet.width)).toBeCloseTo(45, 6)
    // A double-door is drawn as two leaves of half the opening each.
    expect(toInches(closet.width / 2)).toBeCloseTo(22.5, 6)
  })

  it('leaves exactly 17" of wall between the door frame and the closet', () => {
    const doorFarJamb = door.distance + door.width / 2
    const closetNearJamb = closet.distance - closet.width / 2
    expect(toInches(closetNearJamb - doorFarJamb)).toBeCloseTo(17, 6)
  })

  it('swings both the door and the closet into the room', () => {
    // The south wall's normal points into the room, and an unflipped face
    // swings along it.
    const inward = southWall.normal
    const probe = {
      x: southWall.start.x + inward.x * 100,
      y: southWall.start.y + inward.y * 100,
    }
    // A point just inside the south wall must be nearer the room than the wall.
    expect(probe.y).toBeLessThan(southWall.start.y)
    expect(door.flipFace).toBe(false)
    expect(closet.flipFace).toBe(false)
  })

  it('keeps both openings on the wall', () => {
    for (const entry of geometry.openings) {
      expect(entry.overflows).toBe(false)
    }
  })
})

describe('the windows', () => {
  it('centres one on the back wall', () => {
    const window = plan.openings.o_win_back!
    const wall = geometry.wallsById.get('w_north')!
    expect(window.kind).toBe('window')
    expect(window.distance).toBeCloseTo(wall.centrelineLength / 2, 6)
  })

  it('puts one low on the left wall', () => {
    const window = plan.openings.o_win_side!
    const wall = geometry.wallsById.get('w_west')!
    expect(window.kind).toBe('window')
    // The west wall runs bottom-to-top, so a small distance is near the bottom.
    expect(window.distance).toBeLessThan(wall.centrelineLength / 2)
  })
})

/**
 * The gap this suite originally missed: every piece was checked for a place to
 * *stand*, and none for a place to *open*. Two rolling carts sat in the 24"
 * alcoves beside the bed with 7" of floor in front of their drawers — a
 * footprint that fits and furniture that doesn't work.
 */
describe('room to open things', () => {
  const opening: { id: string; reach: number }[] = [
    // Drawers pull out roughly the depth of the carcass they sit in.
    { id: 'f_cart_left', reach: 17 },
    { id: 'f_cart_right', reach: 17 },
    { id: 'f_fridge', reach: 18.5 },
  ]

  it.each(opening)('leaves $id its full pull-out depth', ({ id, reach }) => {
    const item = plan.furniture[id]!
    const zone = accessZone(item, inches(reach))

    for (const other of Object.values(plan.furniture)) {
      if (other.id === id) continue
      expect(overlaps(zone, footprint(other))).toBe(false)
    }
  })

  it('keeps every pull-out zone inside the room', () => {
    const room = geometry.rooms[0]!
    const bounds = {
      minX: Math.min(...room.polygon.map((p) => p.x)),
      maxX: Math.max(...room.polygon.map((p) => p.x)),
      minY: Math.min(...room.polygon.map((p) => p.y)),
      maxY: Math.max(...room.polygon.map((p) => p.y)),
    }

    for (const { id, reach } of opening) {
      const zone = accessZone(plan.furniture[id]!, inches(reach))
      expect(zone.minX).toBeGreaterThanOrEqual(bounds.minX - 1)
      expect(zone.maxX).toBeLessThanOrEqual(bounds.maxX + 1)
      expect(zone.minY).toBeGreaterThanOrEqual(bounds.minY - 1)
      expect(zone.maxY).toBeLessThanOrEqual(bounds.maxY + 1)
    }
  })

  it('gives the desk enough room for a chair to pull back', () => {
    const zone = accessZone(plan.furniture.f_desk!, inches(29.5))
    for (const other of Object.values(plan.furniture)) {
      if (other.id === 'f_desk') continue
      expect(overlaps(zone, footprint(other))).toBe(false)
    }
  })
})

describe('the furniture', () => {
  const expected: Record<string, { width: number; depth: number }> = {
    f_desk: { width: 71, depth: 29.5 },
    f_bed: { width: 60, depth: 80 },
    f_fridge: { width: 17.5, depth: 18.5 },
    f_cart_left: { width: 25, depth: 17 },
    f_cart_right: { width: 25, depth: 17 },
    f_bookshelf: { width: 24, depth: 11 },
  }

  it('is exactly the six pieces asked for, at the sizes asked for', () => {
    expect(Object.keys(plan.furniture).sort()).toEqual(Object.keys(expected).sort())
    for (const [id, size] of Object.entries(expected)) {
      const item = plan.furniture[id]!
      expect(toInches(item.width)).toBeCloseTo(size.width, 6)
      expect(toInches(item.depth)).toBeCloseTo(size.depth, 6)
    }
  })

  it('fits everything inside the room', () => {
    const room = geometry.rooms[0]!
    const bounds = {
      minX: Math.min(...room.polygon.map((p) => p.x)),
      maxX: Math.max(...room.polygon.map((p) => p.x)),
      minY: Math.min(...room.polygon.map((p) => p.y)),
      maxY: Math.max(...room.polygon.map((p) => p.y)),
    }
    for (const item of Object.values(plan.furniture)) {
      const box = footprint(item)
      expect(box.minX).toBeGreaterThanOrEqual(bounds.minX - 1)
      expect(box.maxX).toBeLessThanOrEqual(bounds.maxX + 1)
      expect(box.minY).toBeGreaterThanOrEqual(bounds.minY - 1)
      expect(box.maxY).toBeLessThanOrEqual(bounds.maxY + 1)
    }
  })

  it('does not stack two pieces on the same floor', () => {
    const items = Object.values(plan.furniture)
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        expect(overlaps(footprint(items[i]!), footprint(items[j]!))).toBe(false)
      }
    }
  })

  /**
   * A sample room that draws furniture through its own doors undercuts the one
   * thing it exists to demonstrate, so the swings are checked rather than eyeballed.
   */
  it('keeps every door swing clear of the furniture', () => {
    const swings = geometry.openings
      .filter((entry) => entry.opening.kind === 'door' || entry.opening.kind === 'double-door')
      .flatMap((entry) => {
        const leaf =
          entry.opening.kind === 'double-door' ? entry.opening.width / 2 : entry.opening.width
        // Both jambs for a pair; for a single door only the hinged one matters,
        // but checking both is stricter and still passes.
        return [entry.from, entry.to].map((hinge) => ({ hinge, leaf }))
      })

    expect(swings.length).toBeGreaterThan(0)

    for (const { hinge, leaf } of swings) {
      for (const item of Object.values(plan.furniture)) {
        expect(distanceToRect(hinge, footprint(item))).toBeGreaterThan(leaf)
      }
    }
  })
})

import { dot, pointInPolygon, sub } from '@/lib/geometry'
import type { Point } from '@/lib/geometry'
import { catalogEntry } from '@/lib/catalog'
import type { PlanGeometry, WallOutline } from '@/lib/wallGeometry'
import type { Id, Opening, Plan } from '@/types/plan'

/**
 * The 3D scene, derived from the plan.
 *
 * Read-only by construction, and that boundary is the only thing keeping the
 * 3D view bounded: there is no path from here back into the document. Edits
 * happen in 2D and this re-derives. The moment something in 3D can be dragged,
 * two editors exist and have to agree, which is how projects like this stall.
 *
 * Deliberately free of any Three.js import so it can be tested as arithmetic.
 * Turning these descriptions into meshes is `meshes.ts`'s job.
 */

export interface WallPiece {
  wallId: Id
  /** World-XY footprint of this piece of wall. */
  polygon: Point[]
  /** Heights above the floor, mm. */
  bottom: number
  top: number
}

export interface FloorPiece {
  id: string
  polygon: Point[]
}

export interface FurniturePiece {
  id: Id
  x: number
  y: number
  rotation: number
  width: number
  depth: number
  height: number
  color: string
  label: string
}

export interface SceneModel {
  walls: WallPiece[]
  floors: FloorPiece[]
  furniture: FurniturePiece[]
  /** Tallest wall, used to place the camera and the ceiling light. */
  wallHeight: number
  centre: Point
  /** Half-diagonal of the plan's extent, for framing the orbit camera. */
  radius: number
}

/**
 * A vertical slice of wall. `from`/`to` are distances along the centreline;
 * null means "don't cut here", which is what preserves the mitred corner at a
 * wall end — clipping a span at exactly 0 or the wall length would saw the
 * mitres off and leave a gap at every corner.
 */
export interface WallSpan {
  from: number | null
  to: number | null
  bottom: number
  top: number
}

/**
 * Break a wall into the solid pieces left once its openings are removed.
 *
 * Openings are cut by *splitting the wall*, not by subtracting meshes. A real
 * boolean would need a CSG dependency and would fight the mitred footprint;
 * splitting along the wall's length gives exactly the same result — a header
 * over every door, a sill under every window — out of arithmetic that can be
 * unit-tested.
 */
export function wallSpans(
  outline: WallOutline,
  openings: Opening[],
  wallHeight: number,
): WallSpan[] {
  const length = outline.centrelineLength

  // Clamp each opening to the wall and drop any that leave nothing behind.
  const cuts = openings
    .map((opening) => {
      const half = opening.width / 2
      const from = Math.max(0, opening.distance - half)
      const to = Math.min(length, opening.distance + half)
      return {
        from,
        to,
        sill: Math.max(0, Math.min(wallHeight, opening.sillHeight)),
        head: Math.max(0, Math.min(wallHeight, opening.sillHeight + opening.height)),
      }
    })
    .filter((cut) => cut.to - cut.from > 1)
    .sort((a, b) => a.from - b.from)

  if (cuts.length === 0) {
    return [{ from: null, to: null, bottom: 0, top: wallHeight }]
  }

  const spans: WallSpan[] = []
  let cursor = 0

  for (const [index, cut] of cuts.entries()) {
    // Full-height wall between the previous opening and this one. The first
    // such piece runs from the wall's mitred start, hence the null.
    if (cut.from > cursor + 1) {
      spans.push({
        from: index === 0 ? null : cursor,
        to: cut.from,
        bottom: 0,
        top: wallHeight,
      })
    }

    pushLintels(spans, cut, wallHeight)
    cursor = Math.max(cursor, cut.to)
  }

  // Whatever is left after the last opening, out to the mitred far end.
  if (cursor < length - 1) {
    spans.push({ from: cursor, to: null, bottom: 0, top: wallHeight })
  }

  return spans
}

/** The wall below a window's sill and above any opening's head. */
function pushLintels(
  spans: WallSpan[],
  cut: { from: number; to: number; sill: number; head: number },
  wallHeight: number,
): void {
  if (cut.sill > 1) {
    spans.push({ from: cut.from, to: cut.to, bottom: 0, top: cut.sill })
  }
  if (cut.head < wallHeight - 1) {
    spans.push({ from: cut.from, to: cut.to, bottom: cut.head, top: wallHeight })
  }
}

/**
 * Clip a convex polygon to a band measured along a direction.
 *
 * Sutherland–Hodgman against at most two parallel planes. A null bound skips
 * that plane entirely, leaving the mitre at that end untouched.
 */
export function clipPolygonToRange(
  polygon: Point[],
  origin: Point,
  direction: Point,
  from: number | null,
  to: number | null,
): Point[] {
  let result = polygon
  if (from !== null) result = clipHalfPlane(result, origin, direction, from, true)
  if (to !== null) result = clipHalfPlane(result, origin, direction, to, false)
  return result
}

function clipHalfPlane(
  polygon: Point[],
  origin: Point,
  direction: Point,
  offset: number,
  keepAbove: boolean,
): Point[] {
  if (polygon.length === 0) return polygon

  const along = (point: Point) => dot(sub(point, origin), direction)
  const inside = (value: number) => (keepAbove ? value >= offset : value <= offset)

  const result: Point[] = []
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i]!
    const next = polygon[(i + 1) % polygon.length]!
    const currentValue = along(current)
    const nextValue = along(next)
    const currentIn = inside(currentValue)
    const nextIn = inside(nextValue)

    if (currentIn) result.push(current)
    if (currentIn !== nextIn) {
      const span = nextValue - currentValue
      // Parallel to the plane: nothing meaningful to interpolate.
      if (Math.abs(span) < 1e-9) continue
      const t = (offset - currentValue) / span
      result.push({
        x: current.x + (next.x - current.x) * t,
        y: current.y + (next.y - current.y) * t,
      })
    }
  }
  return result
}

/** Axis-aligned bounds of a placed item, conservative for any rotation. */
function furnitureBounds(item: FurniturePiece) {
  const cos = Math.abs(Math.cos(item.rotation))
  const sin = Math.abs(Math.sin(item.rotation))
  const spanX = item.width * cos + item.depth * sin
  const spanY = item.width * sin + item.depth * cos
  return {
    minX: item.x - spanX / 2,
    maxX: item.x + spanX / 2,
    minY: item.y - spanY / 2,
    maxY: item.y + spanY / 2,
  }
}

function distanceToBounds(
  point: Point,
  bounds: ReturnType<typeof furnitureBounds>,
): number {
  const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX)
  const dy = Math.max(bounds.minY - point.y, 0, point.y - bounds.maxY)
  return Math.hypot(dx, dy)
}

/**
 * Somewhere sensible to stand when the walkthrough opens.
 *
 * Naively dropping the camera at the room's centre puts you inside the
 * furniture as often as not — in a bedroom the centre of the room is usually
 * the bed. So this samples the floor for the spot with the most clearance
 * around it and faces the far end of the room from there.
 */
export function findWalkStart(model: SceneModel): { at: Point; heading: number } {
  const room = model.floors[0]
  if (!room || room.polygon.length < 3) return { at: model.centre, heading: 0 }

  const xs = room.polygon.map((point) => point.x)
  const ys = room.polygon.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const obstacles = model.furniture.map(furnitureBounds)
  const steps = 24
  let best: { point: Point; clearance: number } | null = null

  for (let i = 0; i < steps; i += 1) {
    for (let j = 0; j < steps; j += 1) {
      const point = {
        x: minX + ((i + 0.5) * (maxX - minX)) / steps,
        y: minY + ((j + 0.5) * (maxY - minY)) / steps,
      }
      if (!pointInPolygon(point, room.polygon)) continue

      // Distance to the nearest obstacle, capped so a wide-open room doesn't
      // always plant you dead centre.
      let clearance = Math.min(4000, Math.min(maxX - point.x, point.x - minX))
      clearance = Math.min(clearance, maxY - point.y, point.y - minY)
      for (const obstacle of obstacles) {
        clearance = Math.min(clearance, distanceToBounds(point, obstacle))
      }
      if (!best || clearance > best.clearance) best = { point, clearance }
    }
  }

  const at = best?.point ?? model.centre

  // Face the farthest corner of the room, which is the view that shows most of it.
  let target = room.polygon[0]!
  let farthest = -1
  for (const vertex of room.polygon) {
    const distance = Math.hypot(vertex.x - at.x, vertex.y - at.y)
    if (distance > farthest) {
      farthest = distance
      target = vertex
    }
  }

  // Camera forward is (−sin yaw, −cos yaw) in plan coordinates.
  return { at, heading: Math.atan2(-(target.x - at.x), -(target.y - at.y)) }
}

export function buildSceneModel(plan: Plan, geometry: PlanGeometry): SceneModel {
  const openingsByWall = new Map<Id, Opening[]>()
  for (const opening of Object.values(plan.openings)) {
    const list = openingsByWall.get(opening.wall) ?? []
    list.push(opening)
    openingsByWall.set(opening.wall, list)
  }

  const walls: WallPiece[] = []
  let wallHeight = 0

  for (const outline of geometry.walls) {
    const wall = plan.walls[outline.wallId]
    if (!wall) continue
    wallHeight = Math.max(wallHeight, wall.height)

    const spans = wallSpans(outline, openingsByWall.get(outline.wallId) ?? [], wall.height)
    for (const span of spans) {
      if (span.top - span.bottom < 1) continue
      const polygon = clipPolygonToRange(
        outline.polygon,
        outline.start,
        outline.direction,
        span.from,
        span.to,
      )
      if (polygon.length < 3) continue
      walls.push({ wallId: outline.wallId, polygon, bottom: span.bottom, top: span.top })
    }
  }

  const floors: FloorPiece[] = geometry.rooms.map((room) => ({
    id: room.id,
    polygon: room.polygon,
  }))

  const furniture: FurniturePiece[] = plan.furnitureOrder
    .map((id) => plan.furniture[id])
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => ({
      id: item.id,
      x: item.x,
      y: item.y,
      rotation: item.rotation,
      width: item.width,
      depth: item.depth,
      height: item.height,
      color: item.color ?? catalogEntry(item.catalogId)?.color ?? '#D8CFC0',
      label: item.label,
    }))

  // Frame on the walls if there are any, otherwise on whatever has been placed.
  const points: Point[] = walls.length > 0
    ? walls.flatMap((piece) => piece.polygon)
    : furniture.map((item) => ({ x: item.x, y: item.y }))

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  if (!Number.isFinite(minX)) {
    minX = 0
    minY = 0
    maxX = 1000
    maxY = 1000
  }

  return {
    walls,
    floors,
    furniture,
    wallHeight: wallHeight || 2438.4,
    centre: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    radius: Math.max(Math.hypot(maxX - minX, maxY - minY) / 2, 1000),
  }
}

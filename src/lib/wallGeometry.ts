import {
  add,
  angleOf,
  distance,
  intersectLines,
  length,
  nearlyEqual,
  normalize,
  perpendicular,
  polygonArea,
  polygonCentroid,
  scale,
  signedArea,
  sub,
  vec,
} from '@/lib/geometry'
import type { Id, Opening, Plan, Point, Wall } from '@/types/plan'

/**
 * Turns the node/wall graph into drawable geometry: mitred wall outlines and
 * the closed interior regions between them.
 *
 * The whole thing is one pure function of the plan so that the editor, the 3D
 * view and every export read identical geometry. If they ever disagree, it is
 * a bug here and only here.
 *
 * The core idea: walls store node ids, not coordinates. Two walls meeting at a
 * corner *share* that node, so a join is not something to detect — it is
 * structural. All that remains is deciding where the outline corners land, and
 * that is a line-line intersection between the two walls' offset edges.
 */

/** Past this multiple of thickness a mitre is bevelled instead, so acute corners cannot spike off-screen. */
const MITER_LIMIT = 4

interface WallEnd {
  wallId: Id
  /** Which end of the wall sits at this node. */
  end: 'start' | 'end'
  /** Unit vector pointing from this node along the wall, away from it. */
  direction: Point
  angle: number
  halfThickness: number
}

export interface WallOutline {
  wallId: Id
  /** Closed polygon of the wall's footprint, mitred into its neighbours. */
  polygon: Point[]
  /** Centreline endpoints. */
  start: Point
  end: Point
  direction: Point
  /** Unit normal, 90° counter-clockwise of `direction`. */
  normal: Point
  centrelineLength: number
  thickness: number
}

export interface Room {
  id: string
  /** Interior boundary, following the inner faces of the surrounding walls. */
  polygon: Point[]
  /** Area of the interior polygon, mm². */
  area: number
  centroid: Point
  /** Walls forming the boundary, in traversal order. */
  wallIds: Id[]
}

export interface OpeningGeometry {
  opening: Opening
  wall: Wall
  /** Centre of the opening on the wall centreline. */
  centre: Point
  /** Along-wall unit vector (start → end). */
  direction: Point
  normal: Point
  /** The two centreline points where the opening starts and stops. */
  from: Point
  to: Point
  thickness: number
  /** True when the opening runs past either end of its host wall. */
  overflows: boolean
}

export interface PlanGeometry {
  walls: WallOutline[]
  wallsById: Map<Id, WallOutline>
  rooms: Room[]
  openings: OpeningGeometry[]
}

/** The corner points of each wall end, keyed `${wallId}:${nodeId}`. */
type CornerMap = Map<string, { left: Point; right: Point }>

function cornerKey(wallId: Id, nodeId: Id): string {
  return `${wallId}:${nodeId}`
}

function wallDirection(plan: Plan, wall: Wall, fromNode: Id): Point | null {
  const otherId = wall.start === fromNode ? wall.end : wall.start
  const from = plan.nodes[fromNode]
  const to = plan.nodes[otherId]
  if (!from || !to) return null
  const delta = sub(to, from)
  if (length(delta) < 1e-6) return null
  return normalize(delta)
}

/**
 * Group wall ends by the node they touch, sorted counter-clockwise. The sort is
 * what makes the corner solve work: for two angularly adjacent walls, the
 * sector between them is bounded by the first wall's left edge and the second
 * wall's right edge, and their intersection is the shared outline corner.
 */
function collectWallEnds(plan: Plan): Map<Id, WallEnd[]> {
  const byNode = new Map<Id, WallEnd[]>()

  for (const wall of Object.values(plan.walls)) {
    for (const end of ['start', 'end'] as const) {
      const nodeId = wall[end]
      const direction = wallDirection(plan, wall, nodeId)
      if (!direction) continue
      const list = byNode.get(nodeId) ?? []
      list.push({
        wallId: wall.id,
        end,
        direction,
        angle: angleOf(direction),
        halfThickness: wall.thickness / 2,
      })
      byNode.set(nodeId, list)
    }
  }

  for (const list of byNode.values()) {
    list.sort((a, b) => a.angle - b.angle)
  }
  return byNode
}

/** Clamp a runaway mitre back to a bevel-equivalent distance from the node. */
function limitMiter(node: Point, corner: Point, halfThickness: number): Point {
  const reach = distance(node, corner)
  const maximum = halfThickness * 2 * MITER_LIMIT
  if (reach <= maximum || reach < 1e-9) return corner
  return add(node, scale(sub(corner, node), maximum / reach))
}

function solveCorners(plan: Plan, endsByNode: Map<Id, WallEnd[]>): CornerMap {
  const corners: CornerMap = new Map()

  for (const [nodeId, ends] of endsByNode) {
    const node = plan.nodes[nodeId]
    if (!node) continue

    if (ends.length === 1) {
      // Dead end: a flat cap square across the wall.
      const only = ends[0]!
      const normal = perpendicular(only.direction)
      corners.set(cornerKey(only.wallId, nodeId), {
        left: add(node, scale(normal, only.halfThickness)),
        right: add(node, scale(normal, -only.halfThickness)),
      })
      continue
    }

    // For each angularly adjacent pair, solve the one corner they share.
    const shared: Point[] = []
    for (let i = 0; i < ends.length; i += 1) {
      const current = ends[i]!
      const next = ends[(i + 1) % ends.length]!

      const currentNormal = perpendicular(current.direction)
      const nextNormal = perpendicular(next.direction)
      const currentLeftOrigin = add(node, scale(currentNormal, current.halfThickness))
      const nextRightOrigin = add(node, scale(nextNormal, -next.halfThickness))

      const hit = intersectLines(
        currentLeftOrigin,
        current.direction,
        nextRightOrigin,
        next.direction,
      )

      // Parallel means the two walls run straight through each other; the two
      // offset lines are already coincident, so either origin is the answer.
      const corner = hit ?? currentLeftOrigin
      shared.push(limitMiter(node, corner, Math.max(current.halfThickness, next.halfThickness)))
    }

    // Corner i is the left edge of wall i and the right edge of wall i+1.
    for (let i = 0; i < ends.length; i += 1) {
      const current = ends[i]!
      const next = ends[(i + 1) % ends.length]!
      const point = shared[i]!

      const currentEntry = corners.get(cornerKey(current.wallId, nodeId)) ?? {
        left: point,
        right: point,
      }
      currentEntry.left = point
      corners.set(cornerKey(current.wallId, nodeId), currentEntry)

      const nextEntry = corners.get(cornerKey(next.wallId, nodeId)) ?? {
        left: point,
        right: point,
      }
      nextEntry.right = point
      corners.set(cornerKey(next.wallId, nodeId), nextEntry)
    }
  }

  return corners
}

function buildOutlines(plan: Plan, corners: CornerMap): WallOutline[] {
  const outlines: WallOutline[] = []

  for (const wall of Object.values(plan.walls)) {
    const start = plan.nodes[wall.start]
    const end = plan.nodes[wall.end]
    if (!start || !end) continue
    const delta = sub(end, start)
    const centrelineLength = length(delta)
    if (centrelineLength < 1e-6) continue

    const direction = normalize(delta)
    const normal = perpendicular(direction)
    const half = wall.thickness / 2

    const atStart = corners.get(cornerKey(wall.id, wall.start))
    const atEnd = corners.get(cornerKey(wall.id, wall.end))

    // `left` at a node is measured against that end's outward direction, so the
    // wall's globally-left edge is `left` at the start and `right` at the end.
    const leftStart = atStart?.left ?? add(start, scale(normal, half))
    const leftEnd = atEnd?.right ?? add(end, scale(normal, half))
    const rightEnd = atEnd?.left ?? add(end, scale(normal, -half))
    const rightStart = atStart?.right ?? add(start, scale(normal, -half))

    outlines.push({
      wallId: wall.id,
      polygon: [leftStart, leftEnd, rightEnd, rightStart],
      start: { ...start },
      end: { ...end },
      direction,
      normal,
      centrelineLength,
      thickness: wall.thickness,
    })
  }

  return outlines
}

/**
 * Walk the planar graph face by face to find enclosed rooms.
 *
 * At each node we arrive along a half-edge and leave along the next one
 * clockwise. That rule traces every bounded face counter-clockwise and the
 * unbounded outer face clockwise, so filtering on positive signed area drops
 * the outside world without needing to identify it.
 */
function findRooms(plan: Plan, endsByNode: Map<Id, WallEnd[]>, corners: CornerMap): Room[] {
  // Index each node's wall ends by wall id so we can step around the fan.
  const indexAtNode = new Map<string, number>()
  for (const [nodeId, ends] of endsByNode) {
    ends.forEach((entry, index) => indexAtNode.set(cornerKey(entry.wallId, nodeId), index))
  }

  const visited = new Set<string>()
  const rooms: Room[] = []

  const halfEdgeKey = (wallId: Id, fromNode: Id) => `${wallId}>${fromNode}`

  for (const wall of Object.values(plan.walls)) {
    for (const startNode of [wall.start, wall.end]) {
      if (visited.has(halfEdgeKey(wall.id, startNode))) continue

      const cycleWalls: Id[] = []
      const polygon: Point[] = []
      let currentWallId = wall.id
      let currentFrom = startNode
      let ok = true

      for (let guard = 0; guard < 4096; guard += 1) {
        visited.add(halfEdgeKey(currentWallId, currentFrom))

        const currentWall = plan.walls[currentWallId]
        if (!currentWall) {
          ok = false
          break
        }
        const toNode = currentWall.start === currentFrom ? currentWall.end : currentWall.start

        const near = corners.get(cornerKey(currentWallId, currentFrom))
        const far = corners.get(cornerKey(currentWallId, toNode))
        if (!near || !far) {
          ok = false
          break
        }

        // Interior of the face lies to the left of travel, and consecutive
        // half-edges already agree on the corner between them — `far.right`
        // here is the same solved intersection as the next edge's `near.left`,
        // so the ring closes exactly and dedupeRing drops the repeat.
        polygon.push(near.left, far.right)
        cycleWalls.push(currentWallId)

        // Leave `toNode` along the next half-edge clockwise from the one we
        // arrived on — the previous entry in counter-clockwise order.
        const fan = endsByNode.get(toNode)
        const arrivalIndex = indexAtNode.get(cornerKey(currentWallId, toNode))
        if (!fan || arrivalIndex === undefined) {
          ok = false
          break
        }
        const nextEntry = fan[(arrivalIndex - 1 + fan.length) % fan.length]!

        currentWallId = nextEntry.wallId
        currentFrom = toNode

        if (currentWallId === wall.id && currentFrom === startNode) break
        if (visited.has(halfEdgeKey(currentWallId, currentFrom))) {
          // Ran into an already-traced face: not a fresh cycle.
          ok = false
          break
        }
      }

      if (!ok || polygon.length < 3) continue

      const ring = dedupeRing(polygon)
      if (ring.length < 3) continue
      // The clockwise-next rule traces bounded faces positively and the
      // unbounded outer face negatively, so this single test discards the
      // outside world without having to identify it.
      if (signedArea(ring) <= 0) continue

      const area = polygonArea(ring)
      if (area < 1000) continue // sub-square-centimetre slivers are noise

      rooms.push({
        id: `room-${cycleWalls.slice().sort().join('-')}`,
        polygon: ring,
        area,
        centroid: polygonCentroid(ring),
        wallIds: cycleWalls,
      })
    }
  }

  return rooms
}

function dedupeRing(points: Point[]): Point[] {
  const result: Point[] = []
  for (const point of points) {
    const previous = result[result.length - 1]
    if (previous && nearlyEqual(previous, point, 0.05)) continue
    result.push(point)
  }
  while (result.length > 1 && nearlyEqual(result[0]!, result[result.length - 1]!, 0.05)) {
    result.pop()
  }
  return result
}

function buildOpenings(plan: Plan, wallsById: Map<Id, WallOutline>): OpeningGeometry[] {
  const result: OpeningGeometry[] = []

  for (const opening of Object.values(plan.openings)) {
    const wall = plan.walls[opening.wall]
    const outline = wallsById.get(opening.wall)
    if (!wall || !outline) continue

    const half = opening.width / 2
    const centre = add(outline.start, scale(outline.direction, opening.distance))
    result.push({
      opening,
      wall,
      centre,
      direction: outline.direction,
      normal: outline.normal,
      from: add(outline.start, scale(outline.direction, opening.distance - half)),
      to: add(outline.start, scale(outline.direction, opening.distance + half)),
      thickness: wall.thickness,
      overflows: opening.distance - half < -1 || opening.distance + half > outline.centrelineLength + 1,
    })
  }

  return result
}

export function computePlanGeometry(plan: Plan): PlanGeometry {
  const endsByNode = collectWallEnds(plan)
  const corners = solveCorners(plan, endsByNode)
  const walls = buildOutlines(plan, corners)
  const wallsById = new Map(walls.map((outline) => [outline.wallId, outline]))
  const rooms = findRooms(plan, endsByNode, corners)
  const openings = buildOpenings(plan, wallsById)
  return { walls, wallsById, rooms, openings }
}

/** Total enclosed floor area across every detected room. */
export function totalFloorArea(rooms: Room[]): number {
  return rooms.reduce((sum, room) => sum + room.area, 0)
}

/**
 * Where along a wall a world point falls, clamped to the wall and expressed as
 * a centreline distance from the start node. Used to drop and slide openings.
 */
export function distanceAlongWall(outline: WallOutline, point: Point): number {
  const projected = sub(point, outline.start)
  const along = projected.x * outline.direction.x + projected.y * outline.direction.y
  return Math.max(0, Math.min(outline.centrelineLength, along))
}

/** Clamp an opening so it stays fully inside its host wall. */
export function clampOpening(outline: WallOutline, distance: number, width: number): number {
  const half = width / 2
  if (width >= outline.centrelineLength) return outline.centrelineLength / 2
  return Math.max(half, Math.min(outline.centrelineLength - half, distance))
}

export function wallMidpoint(outline: WallOutline): Point {
  return add(outline.start, scale(outline.direction, outline.centrelineLength / 2))
}

/** A point offset from the wall centreline, used to place dimension lines clear of the wall. */
export function offsetFromWall(outline: WallOutline, along: number, offset: number): Point {
  return add(
    add(outline.start, scale(outline.direction, along)),
    scale(outline.normal, offset),
  )
}

export { vec }

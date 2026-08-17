import {
  distance,
  distanceToSegment,
  pointInPolygon,
  rectCorners,
  rotate,
  sub,
} from '@/lib/geometry'
import type { PlanGeometry } from '@/lib/wallGeometry'
import type { Id, Plan, Point, Selection } from '@/types/plan'

/**
 * What's under the cursor.
 *
 * DOM-native hit-testing was one of the arguments for rendering in SVG, and the
 * canvas does lean on it for pointer events. But dragging needs to know what
 * would be grabbed *before* anything is clicked — for the hover highlight, for
 * snapping a new wall onto an existing corner, for dropping a door onto the
 * nearest wall — and none of that has an event to hang off. So this exists as a
 * plain query over the same geometry the renderer draws.
 *
 * Priority runs smallest-target-first: corner handles beat furniture, furniture
 * beats openings, openings beat walls. Otherwise a node sitting inside a wall
 * footprint would be unclickable.
 */

export interface HitResult extends Selection {
  /** Distance from the query point in world mm; 0 when the point is inside the shape. */
  distance: number
}

export interface HitOptions {
  /** Grab radius in world mm — callers convert from a pixel tolerance so it stays constant on screen. */
  tolerance: number
  /** Restrict the search, e.g. to walls only while placing a door. */
  kinds?: Selection['kind'][]
  /** Ignore these, so dragging a node doesn't snap to itself. */
  exclude?: Id[]
}

function allowed(kind: Selection['kind'], options: HitOptions): boolean {
  return !options.kinds || options.kinds.includes(kind)
}

export function findNodeAt(
  plan: Plan,
  point: Point,
  tolerance: number,
  exclude: Id[] = [],
): HitResult | null {
  let best: HitResult | null = null
  for (const node of Object.values(plan.nodes)) {
    if (exclude.includes(node.id)) continue
    const gap = distance(point, node)
    if (gap <= tolerance && (!best || gap < best.distance)) {
      best = { kind: 'node', id: node.id, distance: gap }
    }
  }
  return best
}

export function findWallAt(
  plan: Plan,
  geometry: PlanGeometry,
  point: Point,
  tolerance: number,
): HitResult | null {
  let best: HitResult | null = null
  for (const outline of geometry.walls) {
    // Inside the footprint counts as a direct hit; near it counts within tolerance.
    const inside = pointInPolygon(point, outline.polygon)
    const gap = inside ? 0 : distanceToSegment(point, outline.start, outline.end) - outline.thickness / 2
    if (gap <= tolerance && (!best || gap < best.distance)) {
      best = { kind: 'wall', id: outline.wallId, distance: Math.max(0, gap) }
    }
  }
  return best
}

export function findOpeningAt(
  plan: Plan,
  geometry: PlanGeometry,
  point: Point,
  tolerance: number,
): HitResult | null {
  let best: HitResult | null = null
  for (const entry of geometry.openings) {
    const gap = distanceToSegment(point, entry.from, entry.to) - entry.thickness / 2
    if (gap <= tolerance && (!best || gap < best.distance)) {
      best = { kind: 'opening', id: entry.opening.id, distance: Math.max(0, gap) }
    }
  }
  return best
}

/** Furniture is tested in reverse z-order so the item drawn on top is the one you grab. */
export function findFurnitureAt(plan: Plan, point: Point, tolerance: number): HitResult | null {
  for (let i = plan.furnitureOrder.length - 1; i >= 0; i -= 1) {
    const item = plan.furniture[plan.furnitureOrder[i]!]
    if (!item || item.locked) continue

    // Work in the item's local frame: an axis-aligned box test after unrotating.
    const local = rotate(sub(point, { x: item.x, y: item.y }), -item.rotation)
    const halfWidth = item.width / 2 + tolerance
    const halfDepth = item.depth / 2 + tolerance
    if (Math.abs(local.x) <= halfWidth && Math.abs(local.y) <= halfDepth) {
      const inside = Math.abs(local.x) <= item.width / 2 && Math.abs(local.y) <= item.depth / 2
      return { kind: 'furniture', id: item.id, distance: inside ? 0 : tolerance }
    }
  }
  return null
}

export function hitTest(
  plan: Plan,
  geometry: PlanGeometry,
  point: Point,
  options: HitOptions,
): HitResult | null {
  const { tolerance, exclude = [] } = options

  if (allowed('node', options)) {
    const node = findNodeAt(plan, point, tolerance, exclude)
    if (node) return node
  }
  if (allowed('furniture', options)) {
    const item = findFurnitureAt(plan, point, 0)
    if (item) return item
  }
  if (allowed('opening', options)) {
    const opening = findOpeningAt(plan, geometry, point, tolerance)
    if (opening) return opening
  }
  if (allowed('wall', options)) {
    const wall = findWallAt(plan, geometry, point, tolerance)
    if (wall) return wall
  }
  return null
}

/** Everything inside a rubber-band rectangle, for marquee selection. */
export function hitTestRect(
  plan: Plan,
  geometry: PlanGeometry,
  a: Point,
  b: Point,
): Selection[] {
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxY = Math.max(a.y, b.y)
  const within = (point: Point) =>
    point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY

  const found: Selection[] = []

  for (const outline of geometry.walls) {
    // A wall counts as selected only if it is fully enclosed — half-caught
    // walls in a marquee are almost never what someone meant.
    if (within(outline.start) && within(outline.end)) {
      found.push({ kind: 'wall', id: outline.wallId })
    }
  }

  for (const id of plan.furnitureOrder) {
    const item = plan.furniture[id]
    if (!item || item.locked) continue
    const corners = rectCorners({ x: item.x, y: item.y }, item.width, item.depth, item.rotation)
    if (corners.every(within)) found.push({ kind: 'furniture', id })
  }

  return found
}

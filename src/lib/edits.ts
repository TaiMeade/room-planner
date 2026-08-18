import type { Command } from '@/lib/commands'
import {
  addFurniture,
  addOpening,
  addWall,
  composite,
  detachWall,
  moveNodes,
  removeFurniture,
  removeOpening,
  removeWall,
  updateOpening,
} from '@/lib/commands'
import { catalogEntry } from '@/lib/catalog'
import { distance, projectOnSegment, scale, sub } from '@/lib/geometry'
import type { Point } from '@/lib/geometry'
import { findNodeAt } from '@/lib/hitTest'
import { furnitureId, nodeId, openingId, wallId } from '@/lib/id'
import { clampOpening, computePlanGeometry, distanceAlongWall } from '@/lib/wallGeometry'
import type { PlanGeometry } from '@/lib/wallGeometry'
import type { Id, OpeningKind, Plan, PlanNode, Selection, Wall } from '@/types/plan'

/**
 * Editing operations, one level above raw commands.
 *
 * The commands module knows how to change one thing reversibly. This module
 * knows what a user action actually means — that drawing a wall onto an
 * existing corner should weld rather than stack two nodes, that drawing into
 * the middle of a wall should split it, that deleting a wall should take its
 * doors with it. All of it composes down to commands, so all of it undoes as
 * one step.
 */

/**
 * A throwaway copy, used to look at the plan as it will be *after* an endpoint
 * has been resolved. A JSON round trip for the same reason the command layer
 * uses one: the live plan is a Vue proxy, and the document is JSON by
 * definition.
 */
function clonePlan(plan: Plan): Plan {
  return JSON.parse(JSON.stringify(plan)) as Plan
}

/** How close (world mm) a new endpoint has to be before it snaps onto existing structure. */
export interface WeldOptions {
  nodeTolerance: number
  wallTolerance: number
}

interface Resolved {
  /** The node the endpoint should use. */
  nodeId: Id
  /** Commands needed to bring that node into existence. */
  commands: Command[]
  /** The position actually used, after welding. */
  point: Point
  /**
   * A node that doesn't exist yet. It travels with the wall's own add command
   * rather than getting one of its own, so an undone wall never leaves a
   * stranded corner behind.
   */
  pendingNode?: PlanNode
}

/**
 * Split a wall at a point along it, handing its openings to whichever half now
 * contains them.
 *
 * This is what makes T-junctions drawable rather than merely representable. The
 * geometry solver has always handled three walls meeting at a node; without
 * splitting, you could only get there by drawing in exactly the right order.
 */
export function splitWall(
  plan: Plan,
  targetWallId: Id,
  at: Point,
): { commands: Command[]; nodeId: Id } | null {
  const wall = plan.walls[targetWallId]
  const start = wall && plan.nodes[wall.start]
  const end = wall && plan.nodes[wall.end]
  if (!wall || !start || !end) return null

  const { point, t } = projectOnSegment(at, start, end)
  // Too near an existing end to be a genuine split — use that node instead.
  if (t <= 0.001 || t >= 0.999) {
    return { commands: [], nodeId: t <= 0.001 ? wall.start : wall.end }
  }

  const newNode: PlanNode = { id: nodeId(), x: point.x, y: point.y }
  const firstHalf: Wall = {
    id: wallId(),
    start: wall.start,
    end: newNode.id,
    thickness: wall.thickness,
    height: wall.height,
  }
  const secondHalf: Wall = {
    id: wallId(),
    start: newNode.id,
    end: wall.end,
    thickness: wall.thickness,
    height: wall.height,
  }

  const fullLength = distance(start, end)
  const splitAt = fullLength * t

  // Re-home the openings before the original wall disappears.
  const openingMoves: Command[] = []
  for (const opening of Object.values(plan.openings)) {
    if (opening.wall !== targetWallId) continue
    const onFirst = opening.distance <= splitAt
    const host = onFirst ? firstHalf : secondHalf
    const hostLength = onFirst ? splitAt : fullLength - splitAt
    const newDistance = onFirst ? opening.distance : opening.distance - splitAt
    const half = opening.width / 2
    openingMoves.push({
      label: 'rehost opening',
      apply(target) {
        const item = target.openings[opening.id]
        if (!item) return
        item.wall = host.id
        item.distance = Math.max(half, Math.min(Math.max(half, hostLength - half), newDistance))
      },
      revert(target) {
        const item = target.openings[opening.id]
        if (!item) return
        item.wall = targetWallId
        item.distance = opening.distance
      },
    })
  }

  const removal = detachWall(plan, targetWallId)

  return {
    // `detachWall`, not `removeWall`: the original is being replaced, not
    // deleted, so its corners and openings must survive the handover — they
    // now belong to the two halves.
    commands: [
      addWall(firstHalf, [newNode]),
      addWall(secondHalf),
      ...openingMoves,
      ...(removal ? [removal] : []),
    ],
    nodeId: newNode.id,
  }
}

/** Find or create the node a wall endpoint should attach to. */
function resolveEndpoint(
  plan: Plan,
  geometry: PlanGeometry,
  point: Point,
  options: WeldOptions,
  preferNodeId?: Id | null,
): Resolved {
  if (preferNodeId && plan.nodes[preferNodeId]) {
    const node = plan.nodes[preferNodeId]!
    return { nodeId: preferNodeId, commands: [], point: { x: node.x, y: node.y } }
  }

  const existing = findNodeAt(plan, point, options.nodeTolerance)
  if (existing) {
    const node = plan.nodes[existing.id]!
    return { nodeId: existing.id, commands: [], point: { x: node.x, y: node.y } }
  }

  // Landing on the body of a wall means a T-junction: split it.
  for (const outline of geometry.walls) {
    const projected = projectOnSegment(point, outline.start, outline.end)
    if (distance(point, projected.point) <= Math.max(options.wallTolerance, outline.thickness / 2)) {
      const split = splitWall(plan, outline.wallId, projected.point)
      if (split) {
        return { nodeId: split.nodeId, commands: split.commands, point: projected.point }
      }
    }
  }

  const created: PlanNode = { id: nodeId(), x: point.x, y: point.y }
  return { nodeId: created.id, commands: [], point, pendingNode: created }
}

/**
 * Draw one wall between two points, welding or splitting at either end.
 *
 * Returns null when the wall would be degenerate — a click that didn't travel
 * anywhere shouldn't leave a zero-length wall behind.
 */
export function createWall(
  plan: Plan,
  geometry: PlanGeometry,
  from: Point,
  to: Point,
  options: WeldOptions & { thickness: number; height: number; fromNode?: Id | null; toNode?: Id | null },
): { command: Command; endNodeId: Id } | null {
  if (distance(from, to) < Math.max(options.nodeTolerance, 1)) return null

  const start = resolveEndpoint(plan, geometry, from, options, options.fromNode)

  // The second endpoint has to be resolved against the plan the first one
  // leaves behind. Both ends of a wall drawn across a single existing wall land
  // on it, and against the original geometry the far end would split the very
  // wall the near end had already replaced — emitting a second pair of halves
  // and leaving the wall doubled, stacked on itself.
  //
  // Only when the start actually restructured something: the common case
  // resolves to an existing node or a brand-new one and costs nothing.
  let endPlan = plan
  let endGeometry = geometry
  if (start.commands.length > 0) {
    endPlan = clonePlan(plan)
    for (const command of start.commands) command.apply(endPlan)
    endGeometry = computePlanGeometry(endPlan)
  }

  const end = resolveEndpoint(endPlan, endGeometry, to, options, options.toNode)

  if (start.nodeId === end.nodeId) return null

  const newNodes = [start.pendingNode, end.pendingNode].filter(
    (node): node is PlanNode => Boolean(node),
  )

  const wall: Wall = {
    id: wallId(),
    start: start.nodeId,
    end: end.nodeId,
    thickness: options.thickness,
    height: options.height,
  }

  const command = composite('draw wall', [
    ...start.commands,
    ...end.commands,
    addWall(wall, newNodes),
  ])
  if (!command) return null
  return { command, endNodeId: end.nodeId }
}

/** Four walls from a dragged rectangle — the fast way to start a plan. */
export function createRoom(
  from: Point,
  to: Point,
  options: { thickness: number; height: number },
): Command | null {
  const width = Math.abs(to.x - from.x)
  const height = Math.abs(to.y - from.y)
  if (width < 200 || height < 200) return null

  const minX = Math.min(from.x, to.x)
  const maxX = Math.max(from.x, to.x)
  const minY = Math.min(from.y, to.y)
  const maxY = Math.max(from.y, to.y)

  const corners: PlanNode[] = [
    { id: nodeId(), x: minX, y: minY },
    { id: nodeId(), x: maxX, y: minY },
    { id: nodeId(), x: maxX, y: maxY },
    { id: nodeId(), x: minX, y: maxY },
  ]

  const walls = corners.map((corner, index) =>
    addWall(
      {
        id: wallId(),
        start: corner.id,
        end: corners[(index + 1) % corners.length]!.id,
        thickness: options.thickness,
        height: options.height,
      },
      // Every node is introduced by the first wall that references it.
      index === 0 ? corners : [],
    ),
  )

  return composite('draw room', walls)
}

const OPENING_DEFAULTS: Record<OpeningKind, { width: number; height: number; sill: number }> = {
  door: { width: 813, height: 2032, sill: 0 },
  'double-door': { width: 1524, height: 2032, sill: 0 },
  'sliding-door': { width: 1524, height: 2032, sill: 0 },
  opening: { width: 914, height: 2032, sill: 0 },
  window: { width: 914, height: 1219, sill: 914 },
}

/** Drop a door or window onto the wall nearest a point. */
export function placeOpening(
  geometry: PlanGeometry,
  targetWallId: Id,
  at: Point,
  kind: OpeningKind,
): { command: Command; id: Id } | null {
  const outline = geometry.wallsById.get(targetWallId)
  if (!outline) return null

  const defaults = OPENING_DEFAULTS[kind]
  // A wall too short to hold the opening gets a narrower one rather than a refusal.
  const width = Math.min(defaults.width, Math.max(300, outline.centrelineLength - 100))
  const along = clampOpening(outline, distanceAlongWall(outline, at), width)

  const id = openingId()
  return {
    id,
    command: addOpening({
      id,
      wall: targetWallId,
      distance: along,
      width,
      kind,
      sillHeight: defaults.sill,
      height: defaults.height,
      flipFace: false,
      flipHinge: false,
    }),
  }
}

/** Slide an existing opening to a new position along its host wall. */
export function moveOpening(
  plan: Plan,
  geometry: PlanGeometry,
  id: Id,
  at: Point,
): Command | null {
  const opening = plan.openings[id]
  const outline = opening && geometry.wallsById.get(opening.wall)
  if (!opening || !outline) return null
  const along = clampOpening(outline, distanceAlongWall(outline, at), opening.width)
  return updateOpening(plan, id, { distance: along }, 'move opening')
}

/** Place a catalog item, centred on a point. */
export function placeFurniture(
  catalogId: string,
  at: Point,
  rotation = 0,
): { command: Command; id: Id } | null {
  const entry = catalogEntry(catalogId)
  if (!entry) return null
  const id = furnitureId()
  return {
    id,
    command: addFurniture({
      id,
      catalogId,
      x: at.x,
      y: at.y,
      rotation,
      width: entry.width,
      depth: entry.depth,
      height: entry.height,
      label: entry.name,
      color: entry.color,
    }),
  }
}

/** Delete everything selected, cascading walls into their openings and nodes. */
export function deleteSelection(plan: Plan, selection: Selection[]): Command | null {
  const commands: (Command | null)[] = []
  const removedWalls = new Set<Id>()

  for (const entry of selection) {
    if (entry.kind === 'wall') {
      removedWalls.add(entry.id)
      commands.push(removeWall(plan, entry.id))
    }
  }
  for (const entry of selection) {
    if (entry.kind === 'opening') {
      const opening = plan.openings[entry.id]
      // Skip openings already taken by their wall — deleting twice would leave
      // undo restoring them out of order.
      if (opening && !removedWalls.has(opening.wall)) commands.push(removeOpening(plan, entry.id))
    }
    if (entry.kind === 'furniture') commands.push(removeFurniture(plan, entry.id))
    if (entry.kind === 'node') {
      // Deleting a corner means deleting the walls that rely on it.
      for (const wall of Object.values(plan.walls)) {
        if ((wall.start === entry.id || wall.end === entry.id) && !removedWalls.has(wall.id)) {
          removedWalls.add(wall.id)
          commands.push(removeWall(plan, wall.id))
        }
      }
    }
  }

  return composite(selection.length > 1 ? 'delete selection' : 'delete', commands)
}

/** Nudge a selection by a world offset. Walls move via their nodes. */
export function nudgeSelection(
  plan: Plan,
  selection: Selection[],
  delta: Point,
): Command | null {
  const nodeIds = new Set<Id>()
  const commands: (Command | null)[] = []

  for (const entry of selection) {
    if (entry.kind === 'node') nodeIds.add(entry.id)
    if (entry.kind === 'wall') {
      const wall = plan.walls[entry.id]
      if (wall) {
        nodeIds.add(wall.start)
        nodeIds.add(wall.end)
      }
    }
    if (entry.kind === 'furniture') {
      const item = plan.furniture[entry.id]
      if (item && !item.locked) {
        commands.push({
          label: 'nudge',
          mergeKey: `furniture:${entry.id}:x,y`,
          get after() {
            return { x: item.x, y: item.y }
          },
          apply(target) {
            const current = target.furniture[entry.id]
            if (current) {
              current.x += delta.x
              current.y += delta.y
            }
          },
          revert(target) {
            const current = target.furniture[entry.id]
            if (current) {
              current.x -= delta.x
              current.y -= delta.y
            }
          },
        })
      }
    }
  }

  if (nodeIds.size > 0) {
    const moves = [...nodeIds]
      .map((id) => plan.nodes[id])
      .filter((node): node is PlanNode => Boolean(node))
      .map((node) => ({
        id: node.id,
        from: { x: node.x, y: node.y },
        to: { x: node.x + delta.x, y: node.y + delta.y },
      }))
    if (moves.length > 0) commands.push(moveNodes(moves, 'nudge'))
  }

  return composite('nudge', commands)
}

/** Copy the selected furniture, offset so the copies are visible and grabbable. */
export function duplicateFurniture(
  plan: Plan,
  selection: Selection[],
  offset: Point,
): { command: Command; ids: Id[] } | null {
  const commands: Command[] = []
  const ids: Id[] = []

  for (const entry of selection) {
    if (entry.kind !== 'furniture') continue
    const item = plan.furniture[entry.id]
    if (!item) continue
    const id = furnitureId()
    ids.push(id)
    commands.push(
      addFurniture({ ...item, id, x: item.x + offset.x, y: item.y + offset.y, locked: false }),
    )
  }

  const command = composite(ids.length > 1 ? 'duplicate items' : 'duplicate', commands)
  return command ? { command, ids } : null
}

/**
 * Turn an item to face away from the nearest wall behind it, so a dropped sofa
 * lands against the wall rather than at whatever angle the last one was.
 */
export function alignToNearestWall(
  geometry: PlanGeometry,
  at: Point,
  searchRadius: number,
): number | null {
  let best: { distance: number; rotation: number } | null = null

  for (const outline of geometry.walls) {
    const projected = projectOnSegment(at, outline.start, outline.end)
    const gap = distance(at, projected.point)
    if (gap > searchRadius) continue

    // Face away from the wall: the item's back (local −y) points at it.
    const toItem = sub(at, projected.point)
    const facing = toItem.x * outline.normal.x + toItem.y * outline.normal.y >= 0 ? 1 : -1
    const away = scale(outline.normal, facing)
    const rotation = Math.atan2(away.y, away.x) - Math.PI / 2

    if (!best || gap < best.distance) best = { distance: gap, rotation }
  }

  return best?.rotation ?? null
}

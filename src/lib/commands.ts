import type { FurnitureItem, Id, Opening, Plan, PlanNode, Point, Wall } from '@/types/plan'

/**
 * Undo/redo, as a stack of invertible commands rather than a stack of cloned
 * documents.
 *
 * Snapshotting would be far less code and would be a mistake: a plan with an
 * underlay carries a base64 image, and thirty snapshots of that is thirty
 * copies of a photograph sitting in memory. Commands store only the fields they
 * touched, which is usually two numbers.
 *
 * The other reason is correctness. Retrofitting undo onto direct mutation is a
 * rewrite, not a feature — so every mutation in the app goes through here, and
 * anything that can't be expressed as a command doesn't get to happen.
 */

export interface Command {
  /** Shown in the UI as "Undo <label>". */
  label: string
  apply(plan: Plan): void
  revert(plan: Plan): void
  /**
   * Consecutive commands sharing a merge key are folded together, so holding an
   * arrow key or dragging a slider is one undo step rather than four hundred.
   * Undefined means "never merge".
   */
  mergeKey?: string
  /**
   * The values this command wrote. Merging keeps the earlier command's `before`
   * and adopts the later one's `after`, which is the whole of the fold — hence
   * this being data rather than a method.
   */
  after?: Record<string, unknown>
  /** Adopt a later command's result, extending this command's span. */
  absorb?(after: Record<string, unknown>): void
}

/**
 * Deep copy for values captured out of the live document.
 *
 * A JSON round trip rather than `structuredClone`, for two reasons. The values
 * handed to these commands are read out of a Vue reactive store, so they are
 * Proxy objects — `structuredClone` throws DataCloneError on those. And the
 * plan is JSON by definition, since the exported file *is* the save format, so
 * a round trip is a complete copy rather than a lossy shortcut.
 */
function clone<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

type Collection = 'nodes' | 'walls' | 'openings' | 'furniture'

/**
 * The one mutation primitive: write some fields on one entity, remember what
 * was there. Everything that edits an existing object is built from this, which
 * is why merging only has to be written once.
 */
function patch<T extends object>(
  collection: Collection,
  id: Id,
  current: T | undefined,
  fields: Partial<T>,
  label: string,
): Command | null {
  if (!current) return null

  const before: Record<string, unknown> = {}
  for (const key of Object.keys(fields)) {
    before[key] = clone((current as Record<string, unknown>)[key])
  }
  let after = clone(fields) as Record<string, unknown>

  return {
    label,
    mergeKey: `${collection}:${id}:${Object.keys(fields).sort().join(',')}`,
    get after() {
      return after
    },
    absorb(next) {
      after = { ...after, ...next }
    },
    apply(plan) {
      const target = plan[collection][id]
      if (target) Object.assign(target, after)
    },
    revert(plan) {
      const target = plan[collection][id]
      if (target) Object.assign(target, before)
    },
  }
}

// --- nodes ------------------------------------------------------------------

/** Move any number of nodes at once — a wall drag, a corner drag, a multi-select nudge. */
export function moveNodes(
  moves: { id: Id; from: Point; to: Point }[],
  label = 'move',
): Command {
  const record = moves.map((move) => ({
    id: move.id,
    from: { ...move.from },
    to: { ...move.to },
  }))
  return {
    label,
    // Merged by the exact set of nodes involved, so successive nudges of the
    // same selection collapse but a nudge of something else starts fresh.
    mergeKey: `moveNodes:${record.map((move) => move.id).sort().join(',')}`,
    get after() {
      return Object.fromEntries(record.map((move) => [move.id, move.to]))
    },
    absorb(next) {
      for (const [id, position] of Object.entries(next)) {
        const existing = record.find((move) => move.id === id)
        if (existing) existing.to = { ...(position as Point) }
      }
    },
    apply(plan) {
      for (const move of record) {
        const node = plan.nodes[move.id]
        if (node) {
          node.x = move.to.x
          node.y = move.to.y
        }
      }
    },
    revert(plan) {
      for (const move of record) {
        const node = plan.nodes[move.id]
        if (node) {
          node.x = move.from.x
          node.y = move.from.y
        }
      }
    },
  }
}

// --- walls ------------------------------------------------------------------

/** Add a wall plus any brand-new nodes it needs, as one atomic step. */
export function addWall(wall: Wall, newNodes: PlanNode[] = []): Command {
  const wallCopy = clone(wall)
  const nodeCopies = clone(newNodes)
  return {
    label: 'draw wall',
    apply(plan) {
      for (const node of nodeCopies) plan.nodes[node.id] = { ...node }
      plan.walls[wallCopy.id] = { ...wallCopy }
    },
    revert(plan) {
      delete plan.walls[wallCopy.id]
      for (const node of nodeCopies) delete plan.nodes[node.id]
    },
  }
}

/**
 * Remove a wall, its openings, and any corner left with nothing attached to it.
 *
 * Which corners are orphaned is decided when the command *runs*, not when it is
 * built, and that distinction is load-bearing. Composites routinely add and
 * remove walls around each other — splitting a wall builds its two halves
 * before dropping the original — so a list of orphans captured up front is
 * already wrong by the time it is used, and deletes a corner the new walls are
 * standing on.
 */
export function removeWall(plan: Plan, wallId: Id): Command | null {
  const wall = plan.walls[wallId]
  if (!wall) return null

  const wallCopy = clone(wall)
  const openingCopies = Object.values(plan.openings)
    .filter((opening) => opening.wall === wallId)
    .map((opening) => clone(opening))

  // Recorded during apply so revert can put back exactly what was taken.
  let removedNodes: PlanNode[] = []

  return {
    label: 'delete wall',
    apply(target) {
      delete target.walls[wallId]
      for (const opening of openingCopies) delete target.openings[opening.id]

      removedNodes = [wallCopy.start, wallCopy.end]
        .filter(
          (nodeId) =>
            !Object.values(target.walls).some(
              (other) => other.start === nodeId || other.end === nodeId,
            ),
        )
        .map((nodeId) => target.nodes[nodeId])
        .filter((node): node is PlanNode => Boolean(node))
        .map((node) => clone(node))

      for (const node of removedNodes) delete target.nodes[node.id]
    },
    revert(target) {
      for (const node of removedNodes) target.nodes[node.id] = { ...node }
      target.walls[wallCopy.id] = { ...wallCopy }
      for (const opening of openingCopies) target.openings[opening.id] = { ...opening }
    },
  }
}

/**
 * Drop a wall record and nothing else — no openings, no corners.
 *
 * Used when a wall is being *replaced* rather than deleted, as in a split,
 * where the corners and openings are being handed to its successors and must
 * survive the handover.
 */
export function detachWall(plan: Plan, wallId: Id): Command | null {
  const wall = plan.walls[wallId]
  if (!wall) return null
  const copy = clone(wall)
  return {
    label: 'replace wall',
    apply(target) {
      delete target.walls[wallId]
    },
    revert(target) {
      target.walls[copy.id] = { ...copy }
    },
  }
}

export function updateWall(
  plan: Plan,
  wallId: Id,
  fields: Partial<Wall>,
  label = 'edit wall',
): Command | null {
  return patch('walls', wallId, plan.walls[wallId], fields, label)
}

// --- openings ---------------------------------------------------------------

export function addOpening(opening: Opening): Command {
  const copy = clone(opening)
  return {
    label: `add ${copy.kind.replace('-', ' ')}`,
    apply(plan) {
      plan.openings[copy.id] = { ...copy }
    },
    revert(plan) {
      delete plan.openings[copy.id]
    },
  }
}

export function removeOpening(plan: Plan, openingId: Id): Command | null {
  const opening = plan.openings[openingId]
  if (!opening) return null
  const copy = clone(opening)
  return {
    label: 'delete opening',
    apply(target) {
      delete target.openings[openingId]
    },
    revert(target) {
      target.openings[openingId] = { ...copy }
    },
  }
}

export function updateOpening(
  plan: Plan,
  openingId: Id,
  fields: Partial<Opening>,
  label = 'edit opening',
): Command | null {
  return patch('openings', openingId, plan.openings[openingId], fields, label)
}

// --- furniture --------------------------------------------------------------

export function addFurniture(item: FurnitureItem): Command {
  const copy = clone(item)
  return {
    label: `add ${copy.label.toLowerCase()}`,
    apply(plan) {
      plan.furniture[copy.id] = { ...copy }
      if (!plan.furnitureOrder.includes(copy.id)) plan.furnitureOrder.push(copy.id)
    },
    revert(plan) {
      delete plan.furniture[copy.id]
      plan.furnitureOrder = plan.furnitureOrder.filter((id) => id !== copy.id)
    },
  }
}

export function removeFurniture(plan: Plan, itemId: Id): Command | null {
  const item = plan.furniture[itemId]
  if (!item) return null
  const copy = clone(item)
  const index = plan.furnitureOrder.indexOf(itemId)
  return {
    label: 'delete item',
    apply(target) {
      delete target.furniture[itemId]
      target.furnitureOrder = target.furnitureOrder.filter((id) => id !== itemId)
    },
    revert(target) {
      target.furniture[itemId] = { ...copy }
      const order = target.furnitureOrder.filter((id) => id !== itemId)
      order.splice(index < 0 ? order.length : index, 0, itemId)
      target.furnitureOrder = order
    },
  }
}

/**
 * Move any number of items at once, as one command.
 *
 * The per-item `updateFurniture` merges only against itself, so a drag of two
 * selected items alternates between two merge keys and nothing ever folds —
 * a ten-frame drag of two chairs left twenty entries on the undo stack. Moving
 * them together gives the whole gesture a single key, exactly as `moveNodes`
 * does for corners.
 */
export function moveFurniture(
  moves: { id: Id; from: Point; to: Point }[],
  label = 'move item',
): Command {
  const record = moves.map((move) => ({
    id: move.id,
    from: { ...move.from },
    to: { ...move.to },
  }))
  return {
    label,
    mergeKey: `moveFurniture:${record.map((move) => move.id).sort().join(',')}`,
    get after() {
      return Object.fromEntries(record.map((move) => [move.id, move.to]))
    },
    absorb(next) {
      for (const [id, position] of Object.entries(next)) {
        const existing = record.find((move) => move.id === id)
        if (existing) existing.to = { ...(position as Point) }
      }
    },
    apply(plan) {
      for (const move of record) {
        const item = plan.furniture[move.id]
        if (item) {
          item.x = move.to.x
          item.y = move.to.y
        }
      }
    },
    revert(plan) {
      for (const move of record) {
        const item = plan.furniture[move.id]
        if (item) {
          item.x = move.from.x
          item.y = move.from.y
        }
      }
    },
  }
}

export function updateFurniture(
  plan: Plan,
  itemId: Id,
  fields: Partial<FurnitureItem>,
  label = 'edit item',
): Command | null {
  return patch('furniture', itemId, plan.furniture[itemId], fields, label)
}

export function reorderFurniture(plan: Plan, itemId: Id, toIndex: number): Command | null {
  const from = plan.furnitureOrder.indexOf(itemId)
  if (from < 0) return null
  const to = Math.max(0, Math.min(plan.furnitureOrder.length - 1, toIndex))
  if (from === to) return null
  return {
    label: 'reorder',
    apply(target) {
      const order = [...target.furnitureOrder]
      order.splice(from, 1)
      order.splice(to, 0, itemId)
      target.furnitureOrder = order
    },
    revert(target) {
      const order = [...target.furnitureOrder]
      order.splice(to, 1)
      order.splice(from, 0, itemId)
      target.furnitureOrder = order
    },
  }
}

// --- composition ------------------------------------------------------------

/**
 * Group several commands into one undo step. Reverts in reverse order.
 *
 * Composites never merge: they represent a discrete user action, and folding
 * two of them together would make one undo swallow two intentions. That is also
 * why a single-command composite is re-wrapped rather than passed through — it
 * must shed the inner command's merge key.
 */
export function composite(label: string, commands: (Command | null)[]): Command | null {
  const parts = commands.filter((command): command is Command => command !== null)
  if (parts.length === 0) return null
  return {
    label,
    apply(plan) {
      for (const command of parts) command.apply(plan)
    },
    revert(plan) {
      for (let i = parts.length - 1; i >= 0; i -= 1) parts[i]!.revert(plan)
    },
  }
}

/**
 * Replace the whole document — import, clear, or load a sample.
 *
 * The one place a snapshot is honest, because the "patch" genuinely is the
 * entire plan, and it keeps "I just imported over an hour of work" undoable.
 */
export function replacePlan(before: Plan, after: Plan, label = 'load plan'): Command {
  const beforeCopy = clone(before)
  const afterCopy = clone(after)
  const assign = (target: Plan, source: Plan) => {
    target.meta = clone(source.meta)
    target.settings = clone(source.settings)
    target.nodes = clone(source.nodes)
    target.walls = clone(source.walls)
    target.openings = clone(source.openings)
    target.furniture = clone(source.furniture)
    target.furnitureOrder = [...source.furnitureOrder]
    target.underlay = source.underlay ? clone(source.underlay) : null
  }
  return {
    label,
    apply(plan) {
      assign(plan, afterCopy)
    },
    revert(plan) {
      assign(plan, beforeCopy)
    },
  }
}

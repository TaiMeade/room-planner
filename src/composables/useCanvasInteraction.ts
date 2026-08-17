import { ref, shallowRef } from 'vue'

import { add, distance, snapPointToGrid, sub } from '@/lib/geometry'
import type { Point } from '@/lib/geometry'
import { createRoom, createWall, moveOpening, placeOpening } from '@/lib/edits'
import { moveNodes, updateFurniture } from '@/lib/commands'
import { hitTest, hitTestRect } from '@/lib/hitTest'
import { useEditorStore } from '@/stores/editor'
import { usePlanStore } from '@/stores/plan'
import type { Id, PlanNode, Selection } from '@/types/plan'

/**
 * The pointer state machine.
 *
 * Two rules hold everything else together. First, every drag mutates through
 * `execute` on each move rather than mutating live and committing at the end —
 * because the commands merge, a whole drag still collapses to one undo step,
 * and nothing in the app gets to touch the document off the record. Second,
 * hit tolerances are authored in screen pixels and converted to world
 * millimetres, so a handle is the same size to grab at every zoom.
 */

/** Grab radius, in screen pixels. */
const GRAB_PX = 9
/** How far a pointer must travel before a click becomes a drag. */
const DRAG_THRESHOLD_PX = 3

type Drag =
  | { kind: 'none' }
  | { kind: 'pan'; lastScreen: Point }
  | { kind: 'marquee'; from: Point; to: Point; additive: boolean }
  | { kind: 'nodes'; ids: Id[]; origins: Map<Id, Point>; grab: Point }
  | { kind: 'furniture'; ids: Id[]; origins: Map<Id, Point>; grab: Point }
  | { kind: 'rotate'; id: Id; centre: Point; startRotation: number; startAngle: number }
  | { kind: 'opening'; id: Id }
  | { kind: 'draw'; anchorScreen: Point }
  | { kind: 'room'; from: Point }
  | { kind: 'measure' }

/** Drags that change the document, and so must wait for real movement. */
const MOVES_ONLY_ON_DRAG = new Set<Drag['kind']>(['nodes', 'furniture', 'rotate', 'opening'])

export function useCanvasInteraction(surface: () => SVGSVGElement | null) {
  const editor = useEditorStore()
  const planStore = usePlanStore()

  const drag = shallowRef<Drag>({ kind: 'none' })
  const marquee = ref<{ from: Point; to: Point } | null>(null)
  /** Set on pointerdown, cleared once movement exceeds the threshold. */
  const pressOrigin = ref<Point | null>(null)
  const movedSincePress = ref(false)

  function screenPoint(event: PointerEvent | WheelEvent): Point {
    const element = surface()
    if (!element) return { x: 0, y: 0 }
    const rect = element.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const grabTolerance = () => editor.pixelsToWorld(GRAB_PX)

  function pick(world: Point, kinds?: Selection['kind'][], exclude: Id[] = []) {
    return hitTest(planStore.plan, planStore.geometry, world, {
      tolerance: grabTolerance(),
      kinds,
      exclude,
    })
  }

  /** Every node the current selection implies — walls contribute both of theirs. */
  function selectedNodeIds(): Id[] {
    const ids = new Set<Id>()
    for (const entry of editor.selection) {
      if (entry.kind === 'node') ids.add(entry.id)
      if (entry.kind === 'wall') {
        const wall = planStore.plan.walls[entry.id]
        if (wall) {
          ids.add(wall.start)
          ids.add(wall.end)
        }
      }
    }
    return [...ids]
  }

  function originsFor(ids: Id[]): Map<Id, Point> {
    const map = new Map<Id, Point>()
    for (const id of ids) {
      const node = planStore.plan.nodes[id]
      if (node) map.set(id, { x: node.x, y: node.y })
    }
    return map
  }

  function furnitureOriginsFor(ids: Id[]): Map<Id, Point> {
    const map = new Map<Id, Point>()
    for (const id of ids) {
      const item = planStore.plan.furniture[id]
      if (item && !item.locked) map.set(id, { x: item.x, y: item.y })
    }
    return map
  }

  // --- pointer down ---------------------------------------------------------

  function onPointerDown(event: PointerEvent): void {
    const element = surface()
    if (!element) return
    // Capture keeps a drag alive when the cursor leaves the canvas. It can
    // throw for a pointer the browser no longer considers active, and losing
    // the whole gesture over that would be worse than losing the capture.
    try {
      element.setPointerCapture(event.pointerId)
    } catch {
      // Carry on uncaptured.
    }

    const screen = screenPoint(event)
    const world = editor.toWorld(screen)
    pressOrigin.value = screen
    movedSincePress.value = false

    // Panning is reachable from every tool, by three routes that between them
    // cover a mouse, a trackpad and muscle memory: the middle button,
    // space-drag, and right-drag. The Pan tool in the rail is the fourth — the
    // discoverable one, for anyone who never learns a shortcut.
    const wantsPan =
      event.button === 1 ||
      event.button === 2 ||
      (event.button === 0 && (editor.spaceHeld || editor.tool === 'pan'))

    if (wantsPan) {
      drag.value = { kind: 'pan', lastScreen: screen }
      editor.isPanning = true
      return
    }
    if (event.button !== 0) return

    const additive = event.shiftKey

    switch (editor.tool) {
      case 'pan':
        // Already handled above; listed so the switch stays exhaustive.
        return
      case 'wall':
        beginWall(world)
        return
      case 'room':
        drag.value = { kind: 'room', from: editor.snapPoint(world) }
        editor.draftWall = null
        return
      case 'opening':
        placeOpeningAt(world)
        return
      case 'measure':
        editor.measurement = { from: editor.snapPoint(world), to: editor.snapPoint(world) }
        drag.value = { kind: 'measure' }
        return
      case 'select':
      default:
        beginSelect(world, additive)
    }
  }

  function beginSelect(world: Point, additive: boolean): void {
    // Rotation grips sit above everything and are checked first.
    const rotateTarget = findRotationGrip(world)
    if (rotateTarget) {
      const item = planStore.plan.furniture[rotateTarget]!
      drag.value = {
        kind: 'rotate',
        id: rotateTarget,
        centre: { x: item.x, y: item.y },
        startRotation: item.rotation,
        startAngle: Math.atan2(world.y - item.y, world.x - item.x),
      }
      editor.isDragging = true
      planStore.beginGesture()
      return
    }

    const hit = pick(world)

    if (!hit) {
      if (!additive) editor.clearSelection()
      drag.value = { kind: 'marquee', from: world, to: world, additive }
      marquee.value = { from: world, to: world }
      return
    }

    const alreadySelected = editor.isSelected(hit.kind, hit.id)
    if (!alreadySelected) {
      editor.select({ kind: hit.kind, id: hit.id }, additive)
    } else if (additive) {
      editor.select({ kind: hit.kind, id: hit.id }, true)
      return
    }

    // Begin the drag that matches whatever is now selected.
    if (hit.kind === 'opening') {
      drag.value = { kind: 'opening', id: hit.id }
    } else if (hit.kind === 'furniture') {
      const ids = editor.selection
        .filter((entry) => entry.kind === 'furniture')
        .map((entry) => entry.id)
      drag.value = { kind: 'furniture', ids, origins: furnitureOriginsFor(ids), grab: world }
    } else {
      const ids = selectedNodeIds()
      if (ids.length === 0) return
      drag.value = { kind: 'nodes', ids, origins: originsFor(ids), grab: world }
    }

    editor.isDragging = true
    planStore.beginGesture()
  }

  /** Rotation grips are drawn by the overlay; this recomputes where they are. */
  function findRotationGrip(world: Point): Id | null {
    const reach = editor.pixelsToWorld(26)
    const tolerance = editor.pixelsToWorld(8)
    for (const entry of editor.selection) {
      if (entry.kind !== 'furniture') continue
      const item = planStore.plan.furniture[entry.id]
      if (!item || item.locked) continue
      const offset = item.depth / 2 + reach
      const grip = {
        x: item.x + Math.sin(item.rotation) * offset,
        y: item.y - Math.cos(item.rotation) * offset,
      }
      if (distance(world, grip) <= tolerance) return entry.id
    }
    return null
  }

  function beginWall(world: Point): void {
    const snapped = editor.snapPoint(world)
    const existing = pick(snapped, ['node'])

    if (editor.draftWall) {
      // Second click of a click-click chain: commit and continue from the end.
      commitWall()
      return
    }

    const from = existing ? pointOfNode(existing.id) ?? snapped : snapped
    editor.draftWall = {
      from,
      to: from,
      fromNode: existing?.id ?? null,
      toNode: null,
    }
    drag.value = { kind: 'draw', anchorScreen: editor.toScreen(from) }
  }

  function pointOfNode(id: Id): Point | null {
    const node = planStore.plan.nodes[id]
    return node ? { x: node.x, y: node.y } : null
  }

  function placeOpeningAt(world: Point): void {
    const hit = pick(world, ['wall'])
    if (!hit) return
    const placed = placeOpening(
      planStore.geometry,
      hit.id,
      world,
      editor.pendingOpeningKind,
    )
    if (!placed) return
    planStore.execute(placed.command)
    editor.setTool('select')
    editor.select({ kind: 'opening', id: placed.id })
  }

  // --- pointer move ---------------------------------------------------------

  function onPointerMove(event: PointerEvent): void {
    const screen = screenPoint(event)
    const world = editor.toWorld(screen)
    editor.cursor = world

    if (pressOrigin.value && !movedSincePress.value) {
      if (distance(screen, pressOrigin.value) > DRAG_THRESHOLD_PX) movedSincePress.value = true
    }

    const current = drag.value

    if (current.kind === 'none') {
      updateHover(world)
      return
    }

    // A click is not a drag. Without this, selecting something would snap it to
    // the grid on the spare pointermove a click emits — you would tap a bed to
    // look at its size and watch it jump three inches.
    if (!movedSincePress.value && MOVES_ONLY_ON_DRAG.has(current.kind)) return

    switch (current.kind) {
      case 'pan': {
        editor.panBy(screen.x - current.lastScreen.x, screen.y - current.lastScreen.y)
        drag.value = { kind: 'pan', lastScreen: screen }
        return
      }

      case 'marquee': {
        drag.value = { ...current, to: world }
        marquee.value = { from: current.from, to: world }
        return
      }

      case 'draw': {
        const draft = editor.draftWall
        if (!draft) return
        const snapped = editor.snapFrom(draft.from, world)
        const nearNode = pick(snapped, ['node'], draft.fromNode ? [draft.fromNode] : [])
        const to = nearNode ? pointOfNode(nearNode.id) ?? snapped : snapped
        editor.draftWall = { ...draft, to, toNode: nearNode?.id ?? null }
        return
      }

      case 'room': {
        editor.draftWall = null
        drag.value = { ...current }
        marquee.value = { from: current.from, to: editor.snapPoint(world) }
        return
      }

      case 'measure': {
        if (editor.measurement) {
          editor.measurement = {
            ...editor.measurement,
            to: editor.snapFrom(editor.measurement.from, world),
          }
        }
        return
      }

      case 'nodes': {
        const delta = snapDelta(sub(world, current.grab), current.origins)
        const moves = [...current.origins.entries()].map(([id, origin]) => ({
          id,
          from: origin,
          to: add(origin, delta),
        }))
        planStore.execute(moveNodes(moves, moves.length > 2 ? 'move walls' : 'move wall'))
        return
      }

      case 'furniture': {
        const delta = snapDelta(sub(world, current.grab), current.origins)
        for (const [id, origin] of current.origins) {
          const target = add(origin, delta)
          planStore.execute(
            updateFurniture(planStore.plan, id, { x: target.x, y: target.y }, 'move item'),
          )
        }
        return
      }

      case 'rotate': {
        const angle = Math.atan2(world.y - current.centre.y, world.x - current.centre.x)
        let rotation = current.startRotation + (angle - current.startAngle)
        if (editor.snapEnabled && planStore.settings.angleSnap > 0) {
          const step = (planStore.settings.angleSnap * Math.PI) / 180
          rotation = Math.round(rotation / step) * step
        }
        planStore.execute(
          updateFurniture(planStore.plan, current.id, { rotation }, 'rotate item'),
        )
        return
      }

      case 'opening': {
        planStore.execute(moveOpening(planStore.plan, planStore.geometry, current.id, world))
        return
      }
    }
  }

  /**
   * Snap the *result* rather than the delta, so a dragged wall lands on the
   * grid instead of merely moving in grid-sized steps from wherever it was.
   */
  function snapDelta(raw: Point, origins: Map<Id, Point>): Point {
    if (!editor.snapEnabled) return raw
    const anchor = origins.values().next().value as Point | undefined
    if (!anchor) return raw
    const target = add(anchor, raw)
    const snapped = snapPointToGrid(target, editor.gridStep)
    return sub(snapped, anchor)
  }

  function updateHover(world: Point): void {
    if (editor.tool === 'opening') {
      const wall = pick(world, ['wall'])
      editor.hovered = wall ? { kind: wall.kind, id: wall.id } : null
      return
    }
    if (editor.tool !== 'select') {
      editor.hovered = null
      return
    }
    const hit = pick(world)
    editor.hovered = hit ? { kind: hit.kind, id: hit.id } : null
  }

  // --- pointer up -----------------------------------------------------------

  function onPointerUp(event: PointerEvent): void {
    const element = surface()
    if (element?.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId)
    }

    const current = drag.value
    const world = editor.toWorld(screenPoint(event))

    // Right button does double duty: a drag pans, a click cancels whatever is
    // in progress. Which one it was is only knowable on release, so the cancel
    // lives here rather than on the contextmenu event — firing it there would
    // tear down the pan the same gesture had just started.
    if (event.button === 2) {
      if (!movedSincePress.value) endDraft()
      drag.value = { kind: 'none' }
      editor.isPanning = false
      editor.isDragging = false
      pressOrigin.value = null
      return
    }

    switch (current.kind) {
      case 'marquee': {
        const found = hitTestRect(planStore.plan, planStore.geometry, current.from, current.to)
        editor.selectMany(
          current.additive ? dedupe([...editor.selection, ...found]) : found,
        )
        break
      }

      case 'room': {
        const command = createRoom(current.from, editor.snapPoint(world), {
          thickness: planStore.settings.defaultWallThickness,
          height: planStore.settings.defaultWallHeight,
        })
        if (command) {
          planStore.execute(command)
          editor.setTool('select')
        }
        break
      }

      case 'draw': {
        // A drag long enough to be intentional commits the segment; a plain
        // click leaves the draft alive so the next click can finish it.
        if (movedSincePress.value) commitWall()
        break
      }

      case 'measure':
        break

      default:
        break
    }

    if (current.kind !== 'draw' && current.kind !== 'measure') {
      drag.value = { kind: 'none' }
      marquee.value = null
    } else if (current.kind === 'measure') {
      drag.value = { kind: 'none' }
    }

    editor.isPanning = false
    editor.isDragging = false
    planStore.endGesture()
    pressOrigin.value = null
  }

  function dedupe(entries: Selection[]): Selection[] {
    const seen = new Set<string>()
    return entries.filter((entry) => {
      const key = `${entry.kind}:${entry.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  /** Commit the current draft segment and chain a new one from its far end. */
  function commitWall(): void {
    const draft = editor.draftWall
    if (!draft) return

    const result = createWall(planStore.plan, planStore.geometry, draft.from, draft.to, {
      nodeTolerance: grabTolerance(),
      wallTolerance: grabTolerance(),
      thickness: planStore.settings.defaultWallThickness,
      height: planStore.settings.defaultWallHeight,
      fromNode: draft.fromNode,
      toNode: draft.toNode,
    })

    if (!result) {
      // Nowhere to go — abandon rather than leaving a zero-length wall.
      editor.draftWall = null
      drag.value = { kind: 'none' }
      return
    }

    planStore.execute(result.command)

    const endPoint = planStore.plan.nodes[result.endNodeId] as PlanNode | undefined
    const from = endPoint ? { x: endPoint.x, y: endPoint.y } : draft.to
    editor.draftWall = { from, to: from, fromNode: result.endNodeId, toNode: null }
    drag.value = { kind: 'draw', anchorScreen: editor.toScreen(from) }
    movedSincePress.value = false
  }

  function endDraft(): void {
    editor.draftWall = null
    editor.measurement = null
    marquee.value = null
    drag.value = { kind: 'none' }
    planStore.endGesture()
  }

  // --- wheel & keys ---------------------------------------------------------

  function onWheel(event: WheelEvent): void {
    event.preventDefault()
    const screen = screenPoint(event)
    if (event.ctrlKey || event.metaKey || !event.shiftKey) {
      // Trackpad pinch arrives as ctrl+wheel; a plain wheel zooms too, because
      // in a drawing tool zoom is the thing you reach for constantly.
      const factor = Math.exp(-event.deltaY * 0.0016)
      editor.zoomAt(screen, factor)
    } else {
      editor.panBy(-event.deltaX, -event.deltaY)
    }
  }

  function onDoubleClick(): void {
    if (editor.draftWall) endDraft()
  }

  // Keyboard handling lives in App.vue, on `window` — shortcuts have to work
  // while focus is in the inspector, which is nowhere near this canvas.

  return {
    marquee,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    onDoubleClick,
    endDraft,
  }
}

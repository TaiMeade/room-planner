import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import { snapAngle, snapPointToGrid } from '@/lib/geometry'
import type { Bounds } from '@/lib/geometry'
import { usePlanStore } from '@/stores/plan'
import type { EntityKind, Id, OpeningKind, Point, Selection } from '@/types/plan'

export type Tool = 'select' | 'pan' | 'wall' | 'room' | 'opening' | 'measure'

/**
 * Which view is on screen. 3D is a viewing mode over the same document, not a
 * second editor — nothing in it writes back to the plan.
 */
export type ViewMode = '2d' | '3d'

/**
 * Pixels per millimetre at 100% zoom. A 4 m wall is ~470 px, so a typical room
 * fills a laptop window — which is what "100%" ought to mean in a tool where
 * the drawing has no inherent pixel size.
 */
export const DEFAULT_SCALE = 0.118
const MIN_SCALE = 0.012
const MAX_SCALE = 2.4

export interface Viewport {
  /** Pixels per world millimetre. */
  scale: number
  /** Screen-space translation applied after scaling. */
  x: number
  y: number
}

export interface DraftWall {
  from: Point
  to: Point
  /** Node the draft started on, when it began by clicking an existing corner. */
  fromNode: Id | null
  /** Node the cursor is currently over, so releasing there welds instead of duplicating. */
  toNode: Id | null
}

export interface Measurement {
  from: Point
  to: Point
}

export const useEditorStore = defineStore('editor', () => {
  const planStore = usePlanStore()

  const tool = ref<Tool>('select')
  const viewMode = ref<ViewMode>('2d')
  const viewport = ref<Viewport>({ scale: DEFAULT_SCALE, x: 80, y: 80 })
  const canvasSize = ref({ width: 1200, height: 800 })

  const selection = shallowRef<Selection[]>([])
  const hovered = shallowRef<Selection | null>(null)

  const draftWall = ref<DraftWall | null>(null)
  const measurement = ref<Measurement | null>(null)
  const pendingOpeningKind = ref<OpeningKind>('door')

  /** Suppresses grid snapping while held, for the times the grid is in the way. */
  const snapOverride = ref(false)
  /**
   * Space-to-pan. Lives in the store because the key is caught by the global
   * handler in App.vue while the canvas is the thing that acts on it.
   */
  const spaceHeld = ref(false)
  /** Cursor position in world mm, shown in the status bar. */
  const cursor = ref<Point>({ x: 0, y: 0 })
  const isPanning = ref(false)
  /** True between pointerdown and pointerup on a moveable thing. */
  const isDragging = ref(false)

  const snapEnabled = computed(() => planStore.settings.snapToGrid && !snapOverride.value)
  const gridStep = computed(() => planStore.settings.gridSize)

  // --- coordinate transforms -------------------------------------------------

  function toWorld(screen: Point): Point {
    return {
      x: (screen.x - viewport.value.x) / viewport.value.scale,
      y: (screen.y - viewport.value.y) / viewport.value.scale,
    }
  }

  function toScreen(world: Point): Point {
    return {
      x: world.x * viewport.value.scale + viewport.value.x,
      y: world.y * viewport.value.scale + viewport.value.y,
    }
  }

  /** Convert a screen-pixel distance into world millimetres — hit tolerances live in pixels. */
  function pixelsToWorld(pixels: number): number {
    return pixels / viewport.value.scale
  }

  function snapPoint(point: Point): Point {
    if (!snapEnabled.value) return point
    return snapPointToGrid(point, gridStep.value)
  }

  /** Apply angle snapping relative to an anchor — used while drawing and dragging walls. */
  function snapFrom(anchor: Point, point: Point): Point {
    const angle = planStore.settings.angleSnap
    if (!snapEnabled.value) return point
    const angled = angle > 0 ? snapAngle(anchor, point, angle) : point
    // Grid-snap the result too, but only when it doesn't fight the angle snap.
    return angle > 0 ? angled : snapPointToGrid(angled, gridStep.value)
  }

  // --- viewport --------------------------------------------------------------

  function zoomAt(screenPoint: Point, factor: number): void {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewport.value.scale * factor))
    if (next === viewport.value.scale) return
    // Keep the world point under the cursor pinned in place.
    const world = toWorld(screenPoint)
    viewport.value = {
      scale: next,
      x: screenPoint.x - world.x * next,
      y: screenPoint.y - world.y * next,
    }
  }

  function panBy(dx: number, dy: number): void {
    viewport.value = {
      ...viewport.value,
      x: viewport.value.x + dx,
      y: viewport.value.y + dy,
    }
  }

  function fitToBounds(bounds: Bounds, padding = 64): void {
    const width = bounds.maxX - bounds.minX
    const height = bounds.maxY - bounds.minY
    if (!(width > 0) || !(height > 0)) return
    const available = {
      width: Math.max(120, canvasSize.value.width - padding * 2),
      height: Math.max(120, canvasSize.value.height - padding * 2),
    }
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min(available.width / width, available.height / height)),
    )
    viewport.value = {
      scale,
      x: canvasSize.value.width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
      y: canvasSize.value.height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
    }
  }

  function resetZoom(): void {
    viewport.value = { ...viewport.value, scale: DEFAULT_SCALE }
  }

  /** The world rectangle currently on screen, used to draw only the visible grid. */
  const visibleWorld = computed(() => {
    const topLeft = toWorld({ x: 0, y: 0 })
    const bottomRight = toWorld({ x: canvasSize.value.width, y: canvasSize.value.height })
    return {
      minX: topLeft.x,
      minY: topLeft.y,
      maxX: bottomRight.x,
      maxY: bottomRight.y,
    }
  })

  // --- selection -------------------------------------------------------------

  const hasSelection = computed(() => selection.value.length > 0)
  const singleSelection = computed(() =>
    selection.value.length === 1 ? selection.value[0]! : null,
  )

  function isSelected(kind: EntityKind, id: Id): boolean {
    return selection.value.some((entry) => entry.kind === kind && entry.id === id)
  }

  function select(entry: Selection | null, additive = false): void {
    if (!entry) {
      if (!additive) selection.value = []
      return
    }
    if (!additive) {
      selection.value = [entry]
      return
    }
    selection.value = isSelected(entry.kind, entry.id)
      ? selection.value.filter((item) => !(item.kind === entry.kind && item.id === entry.id))
      : [...selection.value, entry]
  }

  function selectMany(entries: Selection[]): void {
    selection.value = entries
  }

  function clearSelection(): void {
    selection.value = []
  }

  /** Drop selections whose entity no longer exists — after a delete or an undo. */
  function pruneSelection(): void {
    const { plan } = planStore
    selection.value = selection.value.filter((entry) => {
      if (entry.kind === 'wall') return Boolean(plan.walls[entry.id])
      if (entry.kind === 'opening') return Boolean(plan.openings[entry.id])
      if (entry.kind === 'furniture') return Boolean(plan.furniture[entry.id])
      return Boolean(plan.nodes[entry.id])
    })
  }

  function setTool(next: Tool): void {
    tool.value = next
    draftWall.value = null
    measurement.value = null
    if (next !== 'select') clearSelection()
    // Reaching for a tool means you want to draw, and drawing only happens in
    // 2D — so picking one carries you back there rather than doing nothing.
    viewMode.value = '2d'
  }

  /** Leaving 3D shouldn't strand a half-drawn wall or a live selection. */
  function setViewMode(next: ViewMode): void {
    if (next === viewMode.value) return
    viewMode.value = next
    if (next === '3d') {
      draftWall.value = null
      measurement.value = null
    }
  }

  return {
    tool,
    viewMode,
    setViewMode,
    viewport,
    canvasSize,
    selection,
    hovered,
    draftWall,
    measurement,
    pendingOpeningKind,
    snapOverride,
    spaceHeld,
    cursor,
    isPanning,
    isDragging,
    snapEnabled,
    gridStep,
    visibleWorld,
    hasSelection,
    singleSelection,
    toWorld,
    toScreen,
    pixelsToWorld,
    snapPoint,
    snapFrom,
    zoomAt,
    panBy,
    fitToBounds,
    resetZoom,
    isSelected,
    select,
    selectMany,
    clearSelection,
    pruneSelection,
    setTool,
  }
})

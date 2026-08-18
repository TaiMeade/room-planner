import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'

import type { Command } from '@/lib/commands'
import { replacePlan } from '@/lib/commands'
import { computePlanGeometry, totalFloorArea } from '@/lib/wallGeometry'
import type { PlanGeometry } from '@/lib/wallGeometry'
import { createSamplePlan } from '@/lib/samplePlan'
import { serializePlan } from '@/lib/schema'
import type { Plan, PlanSettings } from '@/types/plan'
import { emptyPlan } from '@/types/plan'

/** How many undo steps to keep. Commands are tiny, so this can be generous. */
const HISTORY_LIMIT = 200
/** Consecutive mergeable commands fold together only if they land within this window. */
const MERGE_WINDOW_MS = 900

export const usePlanStore = defineStore('plan', () => {
  const plan = ref<Plan>(createSamplePlan())

  const undoStack = shallowRef<Command[]>([])
  const redoStack = shallowRef<Command[]>([])
  let lastCommandAt = 0
  /**
   * Set for the duration of a pointer gesture. A drag emits a command per
   * frame; without this, pausing mid-drag for longer than the merge window
   * would split one movement into two undo steps.
   */
  let gestureDepth = 0

  /** Bumped on every committed change so autosave and exports know something moved. */
  const revision = ref(0)
  /** Set once the user has done anything of their own; drives the "this is a sample" hint. */
  const touched = ref(false)

  /**
   * Geometry is derived, cached, and recomputed only when the plan actually
   * changes. Every consumer — canvas, inspector, exports — reads this same
   * object, which is the only way 2D, 3D and PDF can be guaranteed to agree.
   */
  const geometry = computed<PlanGeometry>(() => {
    // Touch the revision so a mutation inside a command invalidates the cache
    // even where the change is deep enough that Vue's tracking might miss it.
    void revision.value
    return computePlanGeometry(plan.value)
  })

  const rooms = computed(() => geometry.value.rooms)
  const floorArea = computed(() => totalFloorArea(geometry.value.rooms))

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  const undoLabel = computed(() => undoStack.value[undoStack.value.length - 1]?.label ?? '')
  const redoLabel = computed(() => redoStack.value[redoStack.value.length - 1]?.label ?? '')

  const settings = computed(() => plan.value.settings)
  const units = computed(() => plan.value.settings.units)

  function bump() {
    revision.value += 1
    plan.value.meta.updatedAt = new Date().toISOString()
  }

  /**
   * The single entry point for changing the document. Nothing else may mutate
   * `plan` — if a change can't be expressed as a command it can't be undone,
   * and a planner you can't undo in is a planner people lose work in.
   */
  function execute(command: Command | null): void {
    if (!command) return

    const now = Date.now()
    const previous = undoStack.value[undoStack.value.length - 1]
    const mergeable =
      previous &&
      previous.mergeKey !== undefined &&
      previous.mergeKey === command.mergeKey &&
      previous.absorb !== undefined &&
      command.after !== undefined &&
      (gestureDepth > 0 || now - lastCommandAt < MERGE_WINDOW_MS)

    command.apply(plan.value)

    if (mergeable) {
      // Fold into the previous step: keep its `before`, adopt this `after`.
      previous.absorb!(command.after!)
    } else {
      const next = [...undoStack.value, command]
      if (next.length > HISTORY_LIMIT) next.shift()
      undoStack.value = next
    }

    redoStack.value = []
    lastCommandAt = now
    touched.value = true
    bump()
  }

  /**
   * Bracket a pointer gesture. Commands emitted between these calls always
   * merge with each other, so one drag is one undo step regardless of how long
   * the user hovers mid-movement.
   */
  function beginGesture(): void {
    gestureDepth += 1
  }

  function endGesture(): void {
    gestureDepth = Math.max(0, gestureDepth - 1)
    // Force the next command to start a fresh step rather than folding into
    // the gesture that just ended.
    if (gestureDepth === 0) lastCommandAt = 0
  }

  function undo(): void {
    const command = undoStack.value[undoStack.value.length - 1]
    if (!command) return
    command.revert(plan.value)
    undoStack.value = undoStack.value.slice(0, -1)
    redoStack.value = [...redoStack.value, command]
    lastCommandAt = 0
    bump()
  }

  function redo(): void {
    const command = redoStack.value[redoStack.value.length - 1]
    if (!command) return
    command.apply(plan.value)
    redoStack.value = redoStack.value.slice(0, -1)
    undoStack.value = [...undoStack.value, command]
    lastCommandAt = 0
    bump()
  }

  /**
   * Settings are view preferences, not document structure, so they sidestep the
   * undo stack — nobody expects Ctrl+Z to turn the grid back on. Wall defaults
   * live here too because they only affect what gets drawn *next*.
   */
  function updateSettings(fields: Partial<PlanSettings>): void {
    Object.assign(plan.value.settings, fields)
    bump()
  }

  /**
   * Rename the document. Like settings, this sidesteps undo — a name is a label
   * on the work, not part of it.
   *
   * It still has to go through here rather than being assigned from a template.
   * Autosave watches `revision`, so a rename written straight onto `plan.meta`
   * changes what is on screen and never reaches the browser copy: the user
   * renames, refreshes, and the old name is back.
   */
  function setName(name: string): void {
    if (plan.value.meta.name === name) return
    plan.value.meta.name = name
    bump()
  }

  /** Swap the whole document in — import, clear, or reload the sample — as one undoable step. */
  function loadPlan(next: Plan, label = 'load plan'): void {
    execute(replacePlan(plan.value, next, label))
  }

  /**
   * Reset without leaving a history trail. Used only when there is nothing worth
   * keeping, so undo shouldn't dangle across two unrelated documents.
   */
  function resetTo(next: Plan): void {
    plan.value = next
    undoStack.value = []
    redoStack.value = []
    lastCommandAt = 0
    touched.value = false
    revision.value += 1
  }

  function newBlankPlan(): void {
    loadPlan(emptyPlan('Untitled plan'), 'new plan')
  }

  function loadSample(): void {
    loadPlan(createSamplePlan(), 'load sample room')
  }

  const asJson = () => serializePlan(plan.value)

  /** Everything a caller needs to know whether autosave should fire. */
  const isEmpty = computed(
    () =>
      Object.keys(plan.value.walls).length === 0 &&
      Object.keys(plan.value.furniture).length === 0,
  )

  // Keep the document title honest about which plan is open.
  watch(
    () => plan.value.meta.name,
    (name) => {
      if (typeof document !== 'undefined') {
        document.title = `${name || 'Untitled'} — Room Planner`
      }
    },
    { immediate: true },
  )

  return {
    plan,
    settings,
    units,
    geometry,
    rooms,
    floorArea,
    revision,
    touched,
    isEmpty,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    execute,
    beginGesture,
    endGesture,
    undo,
    redo,
    updateSettings,
    setName,
    loadPlan,
    resetTo,
    newBlankPlan,
    loadSample,
    asJson,
  }
})

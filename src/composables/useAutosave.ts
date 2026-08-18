import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { clearAutosave, loadAutosave, saveAutosave, storageAvailable } from '@/lib/persistence'
import { usePlanStore } from '@/stores/plan'

/**
 * Keeps the browser copy current, and keeps track of whether the user has a
 * real file yet.
 *
 * `hasUnexportedWork` is the number this whole module exists to produce. It
 * drives the download nag, and it is deliberately not the same thing as
 * "unsaved" — the browser copy is always current; what may be missing is a file
 * the user actually owns.
 */

const DEBOUNCE_MS = 800

export function useAutosave() {
  const planStore = usePlanStore()

  const available = ref(storageAvailable())
  const lastSavedAt = ref<Date | null>(null)
  const restoredFrom = ref<Date | null>(null)
  const failed = ref(false)
  /** Revision at the last export. Anything above it is work that exists only here. */
  const exportedRevision = ref(0)
  const hasUnexportedWork = ref(false)

  let timer: number | null = null

  function schedule(): void {
    if (timer !== null) window.clearTimeout(timer)
    timer = window.setTimeout(async () => {
      timer = null
      const ok = await saveAutosave(planStore.plan, !hasUnexportedWork.value)
      failed.value = !ok
      if (ok) lastSavedAt.value = new Date()
    }, DEBOUNCE_MS)
  }

  /**
   * Restore a previous session, if there is one worth restoring.
   *
   * The sample room is what the app opens with, so an autosave is only offered
   * when the user actually changed something — otherwise every visit would
   * "restore" a plan they never made.
   */
  async function restore(): Promise<{ restored: boolean; warnings: string[] }> {
    const stored = await loadAutosave()
    if (!stored) return { restored: false, warnings: [] }

    const hasContent =
      Object.keys(stored.plan.walls).length > 0 ||
      Object.keys(stored.plan.furniture).length > 0
    if (!hasContent) return { restored: false, warnings: [] }

    planStore.resetTo(stored.plan)
    restoredFrom.value = stored.savedAt
    lastSavedAt.value = stored.savedAt
    exportedRevision.value = planStore.revision
    // Work carried over from a previous session is only safe if that session
    // got it into a file. Assuming it did would hide the download prompt from
    // exactly the person who most needs it — someone whose only copy is a
    // browser database they haven't thought about.
    hasUnexportedWork.value = !stored.exported
    return { restored: true, warnings: stored.warnings }
  }

  function markExported(): void {
    exportedRevision.value = planStore.revision
    hasUnexportedWork.value = false
  }

  async function forget(): Promise<void> {
    // Drop any save already in flight first. An edit within the debounce window
    // of pressing "clear" would otherwise land just after the delete and write
    // the copy straight back, having told the user it was gone.
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
    await clearAutosave()
    lastSavedAt.value = null
    restoredFrom.value = null
  }

  watch(
    () => planStore.revision,
    (revision) => {
      if (planStore.touched) hasUnexportedWork.value = revision > exportedRevision.value
      schedule()
    },
  )

  /**
   * A last-ditch warning on the way out. Only shown when there is work with no
   * file behind it — nagging on every close would train people to dismiss it.
   */
  function onBeforeLeave(event: BeforeUnloadEvent): void {
    if (!hasUnexportedWork.value) return
    event.preventDefault()
    event.returnValue = ''
  }

  onMounted(() => window.addEventListener('beforeunload', onBeforeLeave))
  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', onBeforeLeave)
    if (timer !== null) window.clearTimeout(timer)
  })

  return {
    available,
    lastSavedAt,
    restoredFrom,
    failed,
    hasUnexportedWork,
    restore,
    markExported,
    forget,
  }
}

import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'

import { parsePlan } from '@/lib/schema'
import type { Plan } from '@/types/plan'

/**
 * Autosave to IndexedDB.
 *
 * This is a convenience, not a backup, and the difference matters enough that
 * the UI is required to say so. IndexedDB dies with a cleared cache, an
 * incognito window, a "free up space" prompt, or a browser reset — and someone
 * who spent an hour on a plan will not accept "you should have downloaded it".
 *
 * So: this layer never claims more than it does. Nothing in it says "saved".
 * The exported JSON is the save file; this is only what makes a refresh
 * survivable.
 */

const DB_NAME = 'room-planner'
const DB_VERSION = 1
const STORE = 'plans'
const CURRENT_KEY = 'current'

interface PlanRecord {
  plan: unknown
  savedAt: string
  /**
   * Whether this plan had been exported to a file when it was last stored.
   *
   * Kept across sessions because it is the difference between "your work is in
   * a file somewhere" and "your work exists only here". Without it, reopening
   * the app would silently treat a never-exported plan as safe.
   */
  exported?: boolean
}

interface RoomPlannerDb extends DBSchema {
  plans: {
    key: string
    value: PlanRecord
  }
}

let connection: Promise<IDBPDatabase<RoomPlannerDb>> | null = null

/** Private browsing and locked-down configurations can refuse IndexedDB entirely. */
export function storageAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

function db(): Promise<IDBPDatabase<RoomPlannerDb>> {
  if (!connection) {
    connection = openDB<RoomPlannerDb>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE)
        }
      },
    })
  }
  return connection
}

export interface StoredPlan {
  plan: Plan
  savedAt: Date
  warnings: string[]
  /** False for anything written before this was recorded — the safer assumption. */
  exported: boolean
}

export async function loadAutosave(): Promise<StoredPlan | null> {
  if (!storageAvailable()) return null
  try {
    const record = await (await db()).get(STORE, CURRENT_KEY)
    if (!record) return null
    const { plan, warnings } = parsePlan(record.plan)
    return {
      plan,
      savedAt: new Date(record.savedAt),
      warnings,
      exported: record.exported === true,
    }
  } catch {
    // A corrupt or unreadable autosave should never stop the app from opening.
    return null
  }
}

export async function saveAutosave(plan: Plan, exported = false): Promise<boolean> {
  if (!storageAvailable()) return false
  try {
    await (await db()).put(
      STORE,
      {
        plan: JSON.parse(JSON.stringify(plan)),
        savedAt: new Date().toISOString(),
        exported,
      },
      CURRENT_KEY,
    )
    return true
  } catch {
    // Quota exceeded, or storage denied. The caller surfaces this as a warning
    // rather than a failure, because the plan in memory is still fine.
    return false
  }
}

export async function clearAutosave(): Promise<void> {
  if (!storageAvailable()) return
  try {
    await (await db()).delete(STORE, CURRENT_KEY)
  } catch {
    // Nothing useful to do; the next save overwrites it anyway.
  }
}

/** Read a plan file the user picked. */
export async function readPlanFile(file: File): Promise<string> {
  return file.text()
}

/** Turn a picked image into a data URL so the underlay travels inside the plan JSON. */
export async function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('That image could not be read.'))
    reader.readAsDataURL(file)
  })
}

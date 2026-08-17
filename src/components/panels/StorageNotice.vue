<script setup lang="ts">
import { mdiClose, mdiTrayArrowDown } from '@mdi/js'
import { computed, ref, watch } from 'vue'

/**
 * The honest storage warning.
 *
 * IndexedDB dies with a cleared cache, an incognito window, or a browser reset,
 * and someone who spent an hour on a plan will not accept "you should have
 * downloaded it". So the wording is deliberate and never shortened: this app
 * says *saved in this browser*, and it never says "saved".
 *
 * The nag waits for the work to be worth warning about, and it can be
 * dismissed — a banner that cannot be closed gets ignored, which is worse than
 * one that appears at the right moment.
 */

const props = defineProps<{
  hasUnexportedWork: boolean
  storageAvailable: boolean
  storageFailed: boolean
  lastSavedAt: Date | null
  /** Rough measure of how much there is to lose. */
  weight: number
}>()

const emit = defineEmits<{ export: [] }>()

const dismissed = ref(false)

/** Enough drawn to be worth a warning — a couple of walls isn't. */
const SUBSTANTIAL = 6

const severity = computed<'none' | 'nag' | 'blocked'>(() => {
  if (!props.storageAvailable || props.storageFailed) return 'blocked'
  if (props.hasUnexportedWork && props.weight >= SUBSTANTIAL && !dismissed.value) return 'nag'
  return 'none'
})

// A fresh round of unexported work earns a fresh warning.
watch(
  () => props.hasUnexportedWork,
  (value) => {
    if (!value) dismissed.value = false
  },
)

const message = computed(() => {
  if (severity.value === 'blocked') {
    return 'Private windows and blocked storage mean nothing is being kept between visits. Export the JSON to keep this plan.'
  }
  const where = props.lastSavedAt
    ? `Kept in this browser since ${props.lastSavedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`
    : 'Kept in this browser as you work.'
  return `${where} Clearing your cache or opening it elsewhere loses it — export the JSON to own a copy.`
})
</script>

<template>
  <transition name="notice">
    <div v-if="severity !== 'none'" class="notice" :class="`notice--${severity}`" role="status">
      <div class="notice__text">
        <p class="notice__title">
          {{
            severity === 'blocked'
              ? 'This browser will not keep a copy'
              : 'This plan lives in this browser only'
          }}
        </p>
        <p class="notice__body">{{ message }}</p>
      </div>
      <div class="notice__actions">
        <v-btn
          size="small"
          variant="flat"
          color="primary"
          :prepend-icon="mdiTrayArrowDown"
          @click="emit('export')"
        >
          Export JSON
        </v-btn>
        <button
          v-if="severity === 'nag'"
          type="button"
          class="notice__close"
          title="Dismiss"
          @click="dismissed = true"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="mdiClose" fill="currentColor" /></svg>
        </button>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.notice {
  position: absolute;
  left: 14px;
  bottom: 14px;
  z-index: 4;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  max-width: 400px;
  padding: 11px 11px 11px 13px;
  border: 1px solid var(--ink-line);
  border-left: 3px solid var(--amber-bright);
  border-radius: var(--radius);
  background: var(--ink-raised);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.36);
}

.notice--blocked {
  border-left-color: var(--danger);
}

.notice__text {
  min-width: 0;
}

.notice__title {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--chalk);
}

.notice__body {
  margin: 3px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--chalk-dim);
}

.notice__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
  margin-top: 2px;
}

.notice__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--chalk-faint);
  cursor: pointer;
}

.notice__close:hover {
  color: var(--chalk);
  background: rgba(255, 255, 255, 0.06);
}

.notice__close svg {
  width: 15px;
  height: 15px;
}

.notice-enter-active,
.notice-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.notice-enter-from,
.notice-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { formatLength, parseLength } from '@/lib/units'
import { usePlanStore } from '@/stores/plan'

/**
 * A length in whatever form the user wants to type it.
 *
 * Mouse-only planners fail on precision — at some point everyone needs to say
 * "that wall is 12 foot 6" rather than nudge until it looks right. So this
 * accepts `12' 6"`, `12'6`, `150"`, `3.05m` or a bare number, and shows the
 * value back in the plan's own units.
 *
 * It commits on blur and on Enter, never on keystroke: parsing mid-type would
 * fight the person writing `12'` on their way to `12' 6"`.
 */

const props = withDefaults(
  defineProps<{
    modelValue: number
    label?: string
    min?: number
    max?: number
    disabled?: boolean
    /** Shown under the field when the value is refused. */
    hint?: string
  }>(),
  { min: undefined, max: undefined, disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const planStore = usePlanStore()

const draft = ref('')
const focused = ref(false)
const invalid = ref(false)

const display = computed(() => formatLength(props.modelValue, planStore.units))

/** Show the forms that work, in the units currently in play. */
const errorMessage = computed(() => {
  if (props.hint) return props.hint
  return planStore.units === 'imperial'
    ? `Try 12' 6", 150" or 3.05m`
    : 'Try 3810, 3.81m or 381cm'
})

// Keep the field in step with the model whenever the user isn't editing it —
// this is what makes a field track a value being dragged on the canvas.
watch(
  () => [props.modelValue, planStore.units] as const,
  () => {
    if (!focused.value) draft.value = display.value
  },
  { immediate: true },
)

function commit(): void {
  const parsed = parseLength(draft.value, planStore.units)
  if (parsed === null) {
    invalid.value = true
    return
  }

  let value = parsed
  if (props.min !== undefined) value = Math.max(props.min, value)
  if (props.max !== undefined) value = Math.min(props.max, value)

  invalid.value = false
  emit('update:modelValue', value)
  draft.value = formatLength(value, planStore.units)
}

function onFocus(event: FocusEvent): void {
  focused.value = true
  ;(event.target as HTMLInputElement).select()
}

function onBlur(): void {
  focused.value = false
  if (draft.value.trim() === display.value) {
    invalid.value = false
    return
  }
  commit()
  // Whatever happened, show the truth rather than a stale draft.
  if (invalid.value) draft.value = display.value
  invalid.value = false
}

function onEnter(event: KeyboardEvent): void {
  commit()
  ;(event.target as HTMLInputElement).select()
}

function onEscape(event: KeyboardEvent): void {
  draft.value = display.value
  invalid.value = false
  ;(event.target as HTMLInputElement).blur()
}
</script>

<template>
  <v-text-field
    v-model="draft"
    :label="props.label"
    :disabled="props.disabled"
    :error="invalid"
    :messages="invalid ? errorMessage : undefined"
    class="length-field"
    autocomplete="off"
    spellcheck="false"
    @focus="onFocus"
    @blur="onBlur"
    @keydown.enter.prevent="onEnter"
    @keydown.esc.prevent="onEscape"
  />
</template>

<style scoped>
.length-field :deep(input) {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  letter-spacing: -0.01em;
}
</style>

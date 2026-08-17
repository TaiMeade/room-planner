<script setup lang="ts">
import { mdiAlertOutline, mdiTrayArrowDown } from '@mdi/js'
import { computed, ref, watch } from 'vue'

import type { SheetExportOptions } from '@/lib/export/buildSvg'
import { exportJson, exportPdf, exportPng, exportSvg, PNG_DPI_PRESETS, previewDataUrl } from '@/lib/export'
import type { ExportFormat } from '@/lib/export'
import { bestScaleFor, makeSheet, PAPER_SIZES, scalesFor } from '@/lib/export/sheet'
import { planBounds } from '@/lib/export/buildSvg'
import { boundsAreValid } from '@/lib/geometry'
import { usePlanStore } from '@/stores/plan'

/**
 * Export.
 *
 * Nothing here is gated, and that is the entire product thesis — every
 * competitor puts a signup and a subscription between the drawing and the file.
 * So the dialog's job is to be plain: pick a format, see the sheet, get the
 * file.
 *
 * The preview is the live export SVG, not a mock-up of one. Whatever is in that
 * frame is what lands in the file.
 */

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; exported: [] }>()

const planStore = usePlanStore()

const format = ref<ExportFormat>('pdf')
const paperId = ref('letter')
const landscape = ref(true)
const scaleId = ref('in-1-4')
const dpi = ref(300)
const includeTitleBlock = ref(true)
const includeLegend = ref(false)
const includeDimensions = ref(true)
const includeAreas = ref(true)
const includeLabels = ref(true)
const includeBackground = ref(true)
/** On by default: it is the only way to catch a printer that rescaled the page. */
const includeScaleBar = ref(true)

const busy = ref(false)
const error = ref('')

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const availableScales = computed(() =>
  scalesFor(planStore.units).map((scale) => ({ title: scale.label, value: scale.id })),
)

const paperOptions = computed(() =>
  PAPER_SIZES.map((size) => ({ title: size.label, value: size.id })),
)

const sheet = computed(() => makeSheet(paperId.value, scaleId.value, landscape.value))

const options = computed<SheetExportOptions>(() => ({
  sheet: sheet.value,
  titleBlock: includeTitleBlock.value,
  legend: includeLegend.value,
  dimensions: includeDimensions.value,
  areas: includeAreas.value,
  furnitureLabels: includeLabels.value,
  background: includeBackground.value,
  scaleBar: includeScaleBar.value,
}))

/** Keep the scale valid when the unit system changes underneath the dialog. */
watch(
  () => planStore.units,
  (units) => {
    const scales = scalesFor(units)
    if (!scales.some((scale) => scale.id === scaleId.value)) {
      scaleId.value = scales[Math.min(1, scales.length - 1)]!.id
    }
  },
  { immediate: true },
)

/**
 * Pick a scale that actually fits when the dialog opens, rather than leaving
 * someone to discover the overflow warning and work it out themselves.
 */
watch(open, (isOpen) => {
  if (!isOpen) return
  error.value = ''
  const bounds = planBounds(planStore.plan, planStore.geometry)
  if (!boundsAreValid(bounds)) return
  const suggestion = bestScaleFor(
    planStore.units,
    { widthMm: sheet.value.widthMm, heightMm: sheet.value.heightMm, marginMm: sheet.value.marginMm, landscape: landscape.value },
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    includeTitleBlock.value ? 26 : 0,
  )
  if (suggestion) scaleId.value = suggestion.id
})

const preview = computed(() => {
  try {
    return previewDataUrl(planStore.plan, options.value)
  } catch {
    return ''
  }
})

const overflows = computed(() => {
  const bounds = planBounds(planStore.plan, planStore.geometry)
  if (!boundsAreValid(bounds)) return false
  const available = {
    width: sheet.value.widthMm - sheet.value.marginMm * 2,
    height:
      sheet.value.heightMm - sheet.value.marginMm * 2 - (includeTitleBlock.value ? 26 : 0),
  }
  return (
    (bounds.maxX - bounds.minX) / sheet.value.denominator > available.width ||
    (bounds.maxY - bounds.minY) / sheet.value.denominator > available.height
  )
})

const pixelSize = computed(() => {
  const width = Math.round((sheet.value.widthMm / 25.4) * dpi.value)
  const height = Math.round((sheet.value.heightMm / 25.4) * dpi.value)
  return `${width} × ${height} px`
})

const formats: { value: ExportFormat; label: string; note: string }[] = [
  { value: 'pdf', label: 'PDF', note: 'Vector, printed at true scale' },
  { value: 'svg', label: 'SVG', note: 'Vector, exact, editable elsewhere' },
  { value: 'png', label: 'PNG', note: 'An image to text or drop in slides' },
  { value: 'json', label: 'JSON', note: 'The save file. Re-openable here' },
]

async function run(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    if (format.value === 'json') await exportJson(planStore.plan)
    else if (format.value === 'svg') await exportSvg(planStore.plan, options.value)
    else if (format.value === 'png') await exportPng(planStore.plan, options.value, dpi.value)
    else await exportPdf(planStore.plan, options.value)
    emit('exported')
    open.value = false
  } catch (caught) {
    error.value =
      caught instanceof Error ? caught.message : 'The export did not finish. Try again.'
  } finally {
    busy.value = false
  }
}

const showsSheetOptions = computed(() => format.value !== 'json')
</script>

<template>
  <v-dialog v-model="open" max-width="880" scrollable>
    <v-card class="export">
      <div class="export__body">
        <div class="export__controls">
          <h2 class="eyebrow">Format</h2>
          <div class="formats">
            <button
              v-for="entry in formats"
              :key="entry.value"
              type="button"
              class="format"
              :class="{ 'format--on': format === entry.value }"
              @click="format = entry.value"
            >
              <span class="format__name mono">{{ entry.label }}</span>
              <span class="format__note">{{ entry.note }}</span>
            </button>
          </div>

          <template v-if="showsSheetOptions">
            <v-divider class="my-4" />
            <h2 class="eyebrow">Sheet</h2>
            <v-select
              v-model="paperId"
              :items="paperOptions"
              label="Paper size"
              class="mt-2"
            />
            <div class="row mt-2">
              <v-select v-model="scaleId" :items="availableScales" label="Scale" />
              <v-btn
                size="small"
                variant="tonal"
                class="orient"
                @click="landscape = !landscape"
              >
                {{ landscape ? 'Landscape' : 'Portrait' }}
              </v-btn>
            </div>

            <v-select
              v-if="format === 'png'"
              v-model="dpi"
              :items="PNG_DPI_PRESETS.map((preset) => ({ title: preset.label, value: preset.value }))"
              label="Resolution"
              class="mt-2"
              :hint="pixelSize"
              persistent-hint
            />

            <v-alert
              v-if="overflows"
              type="warning"
              variant="tonal"
              density="compact"
              class="mt-3"
              :icon="mdiAlertOutline"
            >
              The plan is bigger than this sheet at 1:{{ sheet.denominator }}. Choose a smaller
              scale or larger paper, or it will be cropped.
            </v-alert>

            <v-divider class="my-4" />
            <h2 class="eyebrow">Include</h2>
            <div class="toggles mt-1">
              <v-switch v-model="includeDimensions" label="Dimension strings" />
              <v-switch v-model="includeAreas" label="Room areas" />
              <v-switch v-model="includeLabels" label="Furniture labels" />
              <v-switch v-model="includeTitleBlock" label="Title block" />
              <v-switch v-model="includeLegend" label="Contents list" />
              <v-switch v-model="includeScaleBar" label="Scale bar" />
              <v-switch v-model="includeBackground" label="Paper background" />
            </div>
          </template>

          <p v-else class="note mt-3">
            The JSON file is the save file. It holds the whole plan and opens straight back into
            Room Planner — keep it somewhere you'd keep a document, not somewhere you'd keep a
            screenshot.
          </p>
        </div>

        <div class="export__preview">
          <h2 class="eyebrow">Preview</h2>
          <div
            class="sheet"
            :class="{ 'sheet--portrait': !landscape }"
            :style="{ aspectRatio: `${sheet.widthMm} / ${sheet.heightMm}` }"
          >
            <img v-if="showsSheetOptions && preview" :src="preview" alt="Export preview" />
            <div v-else class="sheet__placeholder mono">
              {{ showsSheetOptions ? 'No preview' : '{ plan.json }' }}
            </div>
          </div>
          <p v-if="showsSheetOptions" class="scalenote mono">
            1:{{ sheet.denominator }} · {{ Math.round(sheet.widthMm) }} ×
            {{ Math.round(sheet.heightMm) }} mm
          </p>
        </div>
      </div>

      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mx-4 mb-2">
        {{ error }}
      </v-alert>

      <v-card-actions class="export__actions">
        <p class="freehint">No account, no upload, no watermark.</p>
        <v-spacer />
        <v-btn variant="text" @click="open = false">Cancel</v-btn>
        <v-btn
          variant="flat"
          color="primary"
          :loading="busy"
          :prepend-icon="mdiTrayArrowDown"
          @click="run"
        >
          Export {{ format.toUpperCase() }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.export__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  padding: 18px 18px 6px;
}

@media (max-width: 760px) {
  .export__body {
    grid-template-columns: minmax(0, 1fr);
  }
}

.formats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 8px;
}

.format {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--chalk);
  text-align: left;
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease;
}

.format:hover {
  border-color: var(--blueprint);
}

.format--on {
  border-color: var(--blueprint-bright);
  background: rgba(90, 159, 201, 0.12);
}

.format__name {
  font-size: 12px;
  font-weight: 600;
}

.format__note {
  font-size: 10.5px;
  line-height: 1.35;
  color: var(--chalk-faint);
}

.row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
}

.orient {
  height: 40px;
}

.toggles {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.sheet {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin-top: 8px;
  background: #fff;
  border: 1px solid var(--ink-line);
  border-radius: 2px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
}

.sheet img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.sheet__placeholder {
  font-size: 12px;
  color: #8b979d;
}

.scalenote {
  margin: 8px 0 0;
  font-size: 10.5px;
  color: var(--chalk-faint);
  text-align: center;
}

.note {
  font-size: 12px;
  line-height: 1.55;
  color: var(--chalk-dim);
}

.export__actions {
  padding: 10px 16px 14px;
}

.freehint {
  margin: 0;
  font-size: 11px;
  color: var(--chalk-faint);
}

.my-4 {
  margin: 16px 0;
}
.mt-1 {
  margin-top: 4px;
}
.mt-2 {
  margin-top: 8px;
}
.mt-3 {
  margin-top: 12px;
}
.mx-4 {
  margin-left: 16px;
  margin-right: 16px;
}
.mb-2 {
  margin-bottom: 8px;
}
</style>

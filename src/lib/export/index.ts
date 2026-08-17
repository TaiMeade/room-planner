import { buildSheetSvg } from '@/lib/export/buildSvg'
import type { SheetExportOptions } from '@/lib/export/buildSvg'
import { serializePlan } from '@/lib/schema'
import type { Plan } from '@/types/plan'

/**
 * Getting a plan out of the browser.
 *
 * The premise of the whole app is that a plan leaves as a file and nothing is
 * gated, so this path has to be dependable and it has to be free. Every format
 * is derived from one SVG so they cannot disagree, and nothing here touches a
 * network.
 */

export type ExportFormat = 'svg' | 'png' | 'pdf' | 'json'

const MM_PER_INCH = 25.4

function safeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
  return cleaned || 'floor-plan'
}

/**
 * Save a blob. Uses the File System Access API where it exists so the user gets
 * a real Save dialog and picks the folder, and falls back to a download link
 * everywhere else.
 */
export async function saveBlob(
  blob: Blob,
  filename: string,
  description: string,
  mimeType: string,
  extension: string,
): Promise<void> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (options: unknown) => Promise<{
        createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>
      }>
    }
  ).showSaveFilePicker

  if (picker) {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description, accept: { [mimeType]: [extension] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (error) {
      // A cancelled picker is a user decision, not a failure — don't fall
      // through and download the file they just declined to save.
      if (error instanceof DOMException && error.name === 'AbortError') return
      // Anything else (an unsupported context, a permissions policy) falls back.
    }
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export async function exportJson(plan: Plan): Promise<void> {
  const blob = new Blob([serializePlan(plan)], { type: 'application/json' })
  await saveBlob(
    blob,
    `${safeFilename(plan.meta.name)}.json`,
    'Room Planner plan',
    'application/json',
    '.json',
  )
}

export async function exportSvg(plan: Plan, options: SheetExportOptions): Promise<void> {
  const { svg } = buildSheetSvg(plan, options)
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  await saveBlob(
    blob,
    `${safeFilename(plan.meta.name)}.svg`,
    'SVG drawing',
    'image/svg+xml',
    '.svg',
  )
}

/**
 * Rasterise the same SVG at a chosen DPI.
 *
 * The SVG is loaded as a data URL rather than an object URL because a tainted
 * canvas cannot be read back — and `toBlob` on a tainted canvas is exactly the
 * failure mode that would break this silently in Safari.
 */
export async function renderPng(
  plan: Plan,
  options: SheetExportOptions,
  dpi: number,
): Promise<Blob> {
  const { svg, widthMm, heightMm } = buildSheetSvg(plan, options)

  const pixelWidth = Math.round((widthMm / MM_PER_INCH) * dpi)
  const pixelHeight = Math.round((heightMm / MM_PER_INCH) * dpi)

  const image = new Image()
  image.decoding = 'sync'
  const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('The drawing could not be rasterised.'))
    image.src = encoded
  })

  const canvas = document.createElement('canvas')
  canvas.width = pixelWidth
  canvas.height = pixelHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser did not provide a 2D canvas.')

  if (options.background) {
    context.fillStyle = '#FFFFFF'
    context.fillRect(0, 0, pixelWidth, pixelHeight)
  }
  context.drawImage(image, 0, 0, pixelWidth, pixelHeight)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('The image could not be encoded.'))
    }, 'image/png')
  })
}

export async function exportPng(
  plan: Plan,
  options: SheetExportOptions,
  dpi: number,
): Promise<void> {
  const blob = await renderPng(plan, options, dpi)
  await saveBlob(blob, `${safeFilename(plan.meta.name)}.png`, 'PNG image', 'image/png', '.png')
}

/**
 * Vector PDF at true scale.
 *
 * The document is created in millimetres at the sheet's exact size, and the SVG
 * it receives is already laid out in millimetres — so the drawing lands at
 * world-size ÷ denominator with no unit conversion in between. That is the
 * whole reason the scale survives to the printer.
 *
 * jsPDF and svg2pdf are imported lazily: together they are the largest
 * dependency in the app, and most sessions never export a PDF.
 */
export async function exportPdf(plan: Plan, options: SheetExportOptions): Promise<void> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])

  const { svg, widthMm, heightMm } = buildSheetSvg(plan, options)

  const document_ = new jsPDF({
    orientation: widthMm >= heightMm ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [widthMm, heightMm],
    compress: true,
  })

  document_.setProperties({
    title: plan.meta.name || 'Floor plan',
    creator: 'Room Planner',
    subject: `Floor plan at 1:${options.sheet.denominator}`,
  })

  const container = document.createElement('div')
  container.innerHTML = svg
  const element = container.firstElementChild as SVGSVGElement | null
  if (!element) throw new Error('The drawing could not be prepared for PDF.')

  await svg2pdf(element, document_, { x: 0, y: 0, width: widthMm, height: heightMm })

  const blob = document_.output('blob')
  await saveBlob(
    blob,
    `${safeFilename(plan.meta.name)}.pdf`,
    'PDF drawing',
    'application/pdf',
    '.pdf',
  )
}

/** A small preview of the sheet, for the export dialog. */
export function previewDataUrl(plan: Plan, options: SheetExportOptions): string {
  const { svg } = buildSheetSvg(plan, options)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export const PNG_DPI_PRESETS = [
  { label: 'Screen · 96 dpi', value: 96 },
  { label: 'Sharp · 150 dpi', value: 150 },
  { label: 'Print · 300 dpi', value: 300 },
  { label: 'Large · 600 dpi', value: 600 },
]
